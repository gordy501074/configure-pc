# Раздел «Заказы покупателей» для Продавца (и Администратора)

## Цель

Добавить в профиль роли `seller` (и `admin`) раздел **«Заказы покупателей»**, где продавец видит все заказы, содержащие хотя бы одну его позицию (бренды и кастомные/готовые сборки), и ведёт их по жизненному циклу. Дополнительно: администратор одобряет/отклоняет рассрочку Альфа-Банка, а клиент после отказа может купить за свой счёт.

## Принятые решения (согласовано с пользователем)

- Новых статусов сборки **не вводим**: «передать в сборку» = существующий `confirmed`.
- Продавец видит заказы, где есть хотя бы одна его позиция (`order_item.seller_id = seller.id`); в карточке показываются и суммируются **только его строки**.
- Статус меняется на уровне **всего заказа** (один статус на `order_header`).
- Продавец ведёт полный цикл: `new → confirmed → delivery → done`; аннулирование `new|confirmed|delivery|alpha_rejected → cancelled`.
- Заказы `alpha` для **продавца — только просмотр, без действий**.
- **Админ** одобряет рассрочку (`alpha → confirmed`) или отклоняет (`alpha → alpha_rejected`); секция «Заявки на рассрочку» внутри вкладки «Заказы покупателей» у админа (режим «Все заказы / Заявки на рассрочку»).
- При отклонении заказ **не терминальный**: новый статус `alpha_rejected` («Рассрочка отклонена»), рассрочка недоступна, доступна покупка за свой счёт.
- **Клиент** у своего заказа `alpha_rejected` жмёт «Купить за свой счёт» → заказ переходит в `confirmed` (передаётся в сборку).
- Раздел доступен и роли `admin` с селектором продавца (по образцу «Готовых конфигураций»).

## Изменения в БД (миграция v10)

Нужен новый статус `alpha_rejected` в CHECK `order_header.status`.

- `db/schema.sql`: поднять `PRAGMA user_version = 10`; в CHECK статуса добавить `'alpha_rejected'` (db/schema.sql:102).
- `db/migrate.ts`: новая идемпотентная функция `migrateOrderRejectedStatus` по образцу `migrateOrderAttributionAndCancel` (db/migrate.ts:528):
  - если `tableSql(db, "order_header")` уже содержит `alpha_rejected` → выйти;
  - иначе rebuild `order_header` по рецепту FK-off + temp CREATE/INSERT/DROP/RENAME (CHECK расширяется), с `PRAGMA foreign_key_check`.
- Зарегистрировать вызов в `src/server/db.ts` (после `migrateOrderAttributionAndCancel`) и в цепочке миграций `db/init.js`/`db/seed.js` (там, где вызываются прочие `migrate*`).
- Обновить `tests/unit/migrate.test.ts`, который ассертит старый CHECK (tests/unit/migrate.test.ts:35).

Признак отказа = сам статус `alpha_rejected`; отдельная колонка-флаг не нужна.

## Типы

- `src/types/index.ts` (`Order.status`, строка 157) и `src/server/repository/types.ts` (`OrderStatus`, строка 15): добавить `"alpha_rejected"`.
- `OrderItemRow`/`OrderRow` без изменений.

## Сервер (`src/server/`)

### DAO — `src/server/repository/user-data.ts`
Добавить в `UserDataRepository`:
1. `listOrdersForSeller(sellerId: string): OrderDto[]` — `order_id` из `order_item WHERE seller_id = ?` (DISTINCT) + join `order_header`, `ORDER BY created_at DESC`; строки фильтровать по `seller_id = sellerId`; `total` пересчитать как сумму своих `price_kopecks * count`.
2. `listOrdersByStatus(status: OrderStatus): OrderDto[]` — все заказы со статусом (для админ-секции `alpha`), с полными строками и штатным `total` из `order_header`.
3. `orderHasSeller(orderId, sellerId): boolean`.
4. `getOrderStatus(orderId): OrderStatus | null`.
5. `setOrderStatus(orderId, status): boolean` (`UPDATE order_header SET status = ? WHERE order_id = ?`).

### API — `src/server/index.ts`
Переиспользовать паттерн guard'а owner-or-admin (`readyBuildActor`/`priceListActor`).

Продавец/админ:
- `GET /api/seller/:id/orders` — guard owner-or-admin → `listOrdersForSeller(id)`.
- `POST /api/seller/:id/orders/:orderId/status` — guard owner-or-admin; тело `{ status }`:
  - заказ есть → иначе `404`; `orderHasSeller` → иначе `403`;
  - допустимый переход продавца (таблица ниже) → иначе `409 invalid_transition`.

Админ (только `requireAdmin`):
- `GET /api/admin/orders?status=alpha` — заявки на рассрочку → `listOrdersByStatus('alpha')`.
- `POST /api/admin/orders/:orderId/approve-installment` — `alpha → confirmed`.
- `POST /api/admin/orders/:orderId/reject-installment` — `alpha → alpha_rejected`.
  - проверять текущий статус `=== 'alpha'` → иначе `409 invalid_transition`.

Клиент (только владелец заказа):
- `POST /api/orders/:id/buy-own` — `alpha_rejected → confirmed`; проверка `getOrderOwner === actorId` (иначе `403`) и текущего статуса (иначе `409`). Сохранённую логику `POST /api/orders/:id/cancel` (customer, soft-cancel) не трогаем.

Допустимые переходы:
```
Продавец:  new            → confirmed, cancelled
           alpha_rejected → confirmed, cancelled
           confirmed      → delivery, cancelled
           delivery       → done, cancelled
Админ:     alpha          → confirmed (одобрение) | alpha_rejected (отклонение)
Клиент:    alpha_rejected → confirmed (покупка за свой счёт)
alpha (у продавца), done, cancelled → переходов нет
```

## Клиент (`src/lib/`)

- `src/lib/api.ts`:
  - `fetchSellerOrders(sellerId)` → `GET /api/seller/:id/orders`.
  - `updateSellerOrderStatus(sellerId, orderId, status)` → `POST /api/seller/:id/orders/:orderId/status`.
  - `fetchAlphaOrders()` → `GET /api/admin/orders?status=alpha`.
  - `approveInstallment(orderId)` / `rejectInstallment(orderId)` → admin-эндпоинты.
  - `buyOwnOrder(orderId)` → `POST /api/orders/:id/buy-own`.
- Новый `src/lib/orderStatus.ts` (общий для `Profile.tsx` и `ProfileSellerOrders.tsx`):
  - `ORDER_STATUS_LABELS`, `orderStatusLabel(status)`, `orderStatusTone(status)`, `sellerOrderActions(status)` (кнопка → target), `isInstallmentPending/isInstallmentRejected`.
  - Перенести сюда текущие `statusTone`/`statusLabel` из `Profile.tsx:565-595`; `alpha` → «На рассмотрении в Альфа-Банке», `alpha_rejected` → «Рассрочка отклонена» (tone `warning`).

## Клиент — UI

### `src/screens/Profile.tsx`
- `tabsForRole`: добавить вкладку `{ key: "customer-orders", label: "Заказы покупателей" }` для `seller` и `admin`; расширить union `Tab`.
- Рендер: `activeTab === "customer-orders"` → `<ProfileSellerOrders sellerId={user.id} isAdmin={user.role === "admin"} />`.
- Импортировать хелперы статуса из `orderStatus.ts`, удалить локальные копии.
- **Клиентские «Заказы»**: у заказа `alpha_rejected` показать бейдж «Рассрочка отклонена», подсказку «Рассрочка недоступна» и кнопку «Купить за свой счёт» (→ `buyOwnOrder`, затем перезагрузка + toast).

### Новый `src/screens/ProfileSellerOrders.tsx`
По образцу `ProfileReadyBuilds.tsx`:
- Props `{ sellerId: string; isAdmin?: boolean }`.
- Админ: селектор продавца (`fetchSellerSummaries`) + переключатель режима «Все заказы / Заявки на рассрочку».
  - «Все заказы» — `fetchSellerOrders(activeSellerId)` (только строки выбранного продавца).
  - «Заявки на рассрочку» — `fetchAlphaOrders()` (все `alpha`), с кнопками «Одобрить»/«Отклонить».
- Карточка: `#<id.slice(-6)>`, `formatDate`, `Badge` статуса; строки (`name`, `formatPrice`, `count`); «Итого по вашим позициям»; клиент (`userName`, `address`).
- Продавец: `sellerOrderActions(status)` → «Передать в сборку» (`confirmed`), «В доставку» (`delivery`), «Завершить» (`done`), «Аннулировать» (`cancelled`, destructive). Для `alpha` — без кнопок, бейдж «На рассмотрении в Альфа-Банке». Для `alpha_rejected` — «Передать в сборку»/«Аннулировать» + бейдж «Рассрочка отклонена».
- `EmptyState`: «Заказов покупателей пока нет» / «Заявок на рассрочку нет».

## Документация

- `README.md`:
  - «Возможности»: вкладка «Заказы покупателей» у seller/admin, цикл статусов, роль админа в рассрочке, покупка за свой счёт после отказа.
  - Таблица маршрутов: `/profile/:tab` — добавить `customer-orders` для seller/admin.
  - API: новые эндпоинты (seller orders/status, admin alpha/approve/reject, customer buy-own) и расширенный статус `alpha_rejected`.
  - Раздел схемы: миграция v10 и новый CHECK.

## Валидация

- `npm run typecheck` — без ошибок.
- `npm run test:unit` — обновлённый `migrate.test.ts` проходит (новый CHECK `alpha_rejected`).
- `npm run db:test:api` — добавить проверки:
  - `GET /api/seller/usr-seller/orders` содержит заказ с позицией продавца; строки других продавцов отфильтрованы;
  - `POST .../status {confirmed}` → 200; недопустимый переход (`done→confirmed`) → `409`; чужой продавец → `403`;
  - `alpha → approve-installment → confirmed`; `alpha → reject-installment → alpha_rejected`; повторное решение → `409`;
  - `POST /api/orders/:id/buy-own` владельцем при `alpha_rejected` → `confirmed`; не владельцем → `403`; при другом статусе → `409`.
- Playwright regression — новый `tests/regression/seller-orders.spec.ts`:
  - продавец видит вкладку и свои заказы, «Передать в сборку» → «Подтверждён», «Аннулировать» → «Отменён»;
  - `alpha`-заказ виден продавцу без кнопок статуса;
  - админ в режиме «Заявки на рассрочку» одобряет и отклоняет;
  - клиент у `alpha_rejected` видит «Рассрочка отклонена» и кнопку «Купить за свой счёт» → «Подтверждён».

## Риски и ограничения

- Статус заказа общий: продавец меняет статус всего заказа, даже если в нём позиции других продавцов (согласовано; MVP).
- Строки `order_item` с `seller_id = NULL` (легаси) продавцам не видны.
- Миграция пересоздаёт `order_header` — обязателен бэкап (`npm run db:backup`) перед прогоном на реальной БД; тесты инициализируют схему заново.
- Клиентская «покупка за свой счёт» только меняет статус: платежей/эквайринга не добавляем (демо).

## Порядок работ

1. Схема и миграция v10 (`db/schema.sql`, `db/migrate.ts`, регистрация в `db.ts`/`db:init`/`db:seed`).
2. Типы статуса (`src/types/index.ts`, `src/server/repository/types.ts`).
3. DAO в `user-data.ts` (`listOrdersForSeller`, `listOrdersByStatus`, `orderHasSeller`, `getOrderStatus`, `setOrderStatus`).
4. API-эндпоинты и валидация переходов в `src/server/index.ts`.
5. Клиентские функции в `src/lib/api.ts`; модуль `src/lib/orderStatus.ts`.
6. `Profile.tsx` (вкладка + клиентская кнопка «Купить за свой счёт») и новый `ProfileSellerOrders.tsx`.
7. Обновить `README.md`.
8. Тесты (`migrate.test.ts`, api-e2e, regression); `typecheck`, `test:unit`.

## Открытые вопросы

Нет — ключевые решения согласованы.