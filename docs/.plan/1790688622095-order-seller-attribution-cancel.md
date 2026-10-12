# План: seller_id, снимок цены/категории и soft-cancel заказов

Цель — сделать данные заказов пригодными для аналитики продавца, устранив три дефекта:
1. Отсутствие атрибуции продавца у заказа/строки.
2. Зависимость «источника истины» по деньгам от живого `ready_pc.price_kopecks`.
3. Физическое удаление заказа при отмене вместо статуса `cancelled`.

## Решения (согласованы)

- **Атрибуция:** добавить `seller_id` (nullable) на **`order_item`**. Заполнять при оформлении: `ready` → `ready_pc.seller_id`, `config` → `config.seller_id` (передаётся клиентом). Поддерживает смешанные заказы.
- **Отмена:** `DELETE /api/orders/:id` больше не удаляет строку — заказ помечается `status='cancelled'` и остаётся в истории. Добавить `'cancelled'` в CHECK и в клиентский `OrderStatus`. Плюс **проверка владельца** (сейчас чужой заказ можно удалить).
- **Категория:** добавить снимок `category` (nullable) на `order_item`, чтобы аналитика по категориям не зависела от живого каталога `part`.
- **Деньги:** подтверждено, что снимок уже пишется в `order_item.price_kopecks` (`src/server/repository/user-data.ts:524`); никаких изменений в расчёте не требуется — только зафиксировать это правило в аналитическом слое и не использовать `ready_pc.price_kopecks` для отчётности.

## Затронутые границы

- Схема: `db/schema.sql`, `db/migrate.ts`, `db/init.js`/`db/seed.js` (вызов миграций), `tests/helpers/testDb.ts`.
- Сервер: `src/server/repository/types.ts`, `src/server/repository/user-data.ts`, `src/server/index.ts`.
- Клиент: `src/types/index.ts`, `src/lib/api.ts`, `src/screens/Checkout.tsx`, `src/screens/InstallmentCheckout.tsx`, `src/screens/PcCard.tsx`, `src/screens/Profile.tsx` (лейбл/тон статуса).
- Тесты: `tests/unit/*`, `tests/regression/*` (порядок/отмена), `db/api-e2e.mjs` при необходимости.

---

## Задача 1 — Миграция схемы (v9)

`order_item` — добавить через `ALTER TABLE ADD COLUMN` (nullable, без default; SQLite/STRICT это допускает, пересборка не нужна):
- `seller_id TEXT` + `FOREIGN KEY (seller_id) REFERENCES user_account(user_id) ON DELETE SET NULL`;
- `category TEXT` (без CHECK, чтобы не блокировать исторические значения; валидировать в коде).

`order_header` — CHECK статуса изменить нельзя на месте: пересобрать по уже принятому в проекте рецепту (temp `CREATE` → `INSERT` → `DROP` → `RENAME`, `PRAGMA foreign_keys=OFF` + `defer_foreign_keys`, затем `foreign_key_check`), расширив CHECK до `('new','confirmed','delivery','done','alpha','cancelled')`.

Шаги:
1. В `db/schema.sql` поднять `PRAGMA user_version = 9`, добавить колонки в `CREATE TABLE IF NOT EXISTS order_item` и `'cancelled'` в CHECK `order_header` (+ индекс `idx_order_item_seller ON order_item(seller_id)` при необходимости).
2. В `db/migrate.ts` добавить идемпотентную `migrateOrderAttributionAndCancel(db)`:
   - определить состояние (наличие колонок в `order_item`, наличие `cancelled` в DDL `order_header`) и выполнить только недостающее;
   - `ALTER TABLE order_item ADD COLUMN seller_id TEXT` / `category TEXT` (обёрнуть в try/catch на «duplicate column» или проверять `PRAGMA table_info`);
   - пересборка `order_header` с новым CHECK по рецепту из соседних миграций;
   - вызвать из `db:init`, `db:seed`, `src/server/db.ts`, `tests/helpers/testDb.ts` (как остальные миграции).
3. **Бэкфилл (best effort, в той же миграции):**
   - `order_item.seller_id`: `UPDATE ... SET seller_id = (SELECT rp.seller_id FROM ready_pc rp WHERE rp.ready_pc_id = order_item.ref_id) WHERE kind='ready' AND seller_id IS NULL`;
   - `order_item.category`: `ready` → `ready_pc_part.category`; `config` → `part.category` по `ref_id=part_id` (пока части существуют; после переинициализации останется NULL);
   - `config`-строки исторически имеют `ref_id=part_id`, поэтому продавец восстановлению не подлежит — остаются NULL («Без продавца»).

**Риск:** пересборка `order_header` при активных FK. Митигируется принятым рецептом и `foreign_key_check`; делать в рамках `db:backup`/теста идемпотентно.

## Задача 2 — Серверный слой (DAO + API)

`src/server/repository/types.ts`:
- `OrderStatus` → добавить `'cancelled'`.
- `OrderItemRow` → `seller_id: string | null`, `category: ComponentCategory | null`.
- `OrderItemDto` → `sellerId?: string`, `category?: ComponentCategory`.

`src/server/repository/user-data.ts`:
- `SaveOrderInput.items[]` → `sellerId?`, `category?`.
- В `saveOrder` при вставке `order_item` писать `seller_id` и `category`; **не менять** существующий расчёт `total` (остаётся `Σ Math.round(it.price*100)*count` — это и есть источник истины).
- `listOrders`: не фильтровать `cancelled` (нужен для истории); при необходимости добавить отдельный `listOrdersForSeller(sellerId)` для аналитики.
- `deleteOrder(id)` → заменить на `cancelOrder(id)`: `UPDATE order_header SET status='cancelled' WHERE order_id=?` (вернуть changes>0). Сохранить имя `deleteOrder` при желании, но семантика меняется — рекомендуется переименовать и не оставлять физическое удаление.

`src/server/index.ts`:
- `DELETE /api/orders/:id` → переименовать в `POST /api/orders/:id/cancel` (или оставить DELETE, но поменять поведение) под `requireCustomer`; **добавить проверку владельца**: загрузить заказ, сверить `order_header.user_id === actor.userId`, иначе `403`/`404`.
- `PUT /api/orders/:id` → добавить ту же проверку владельца перед upsert (сейчас upsert может перезаписать чужой заказ).
- `GET /api/orders` оставить как есть (по владельцу). Новый аналитический эндпоинт — за рамками этой задачи (только данные готовим).

**Совместимость API:** решить, ломать ли `DELETE`. Рекомендация: сохранить `DELETE /api/orders/:id` как alias на soft-cancel (клиент уже вызывает его), пометить в README как deprecated, и ввести явный `POST /api/orders/:id/cancel`.

## Задача 3 — Клиентские типы и API

`src/types/index.ts`:
- `OrderItem` → `sellerId?: string`, `category?: ComponentCategory`.
- `Order["status"]` → добавить `'cancelled'`.

`src/lib/api.ts`:
- `saveOrderRemote` — прокидывать `sellerId`/`category` в items (если мапить в телеграмму вручную — проверить, что они не теряются).
- `deleteOrderRemote` → заменить/дополнить `cancelOrderRemote(id)` (`POST /orders/:id/cancel`); временно оставить старую функцию как обёртку.

## Задача 4 — Оформление заказа (заполнение новых полей)

`src/screens/Checkout.tsx`:
- `CheckoutState.line` → добавить `sellerId?` и `category?` (для ready).
- При построении `items` для `config`: для каждого компонента выставлять `category: cp.category` и `sellerId: config.sellerId`.
- Для `state.line` (ready): выставлять `sellerId` и `category` из переданного состояния; если не переданы — сервер резолвит `seller_id` из `ready_pc` по `ref_id` (добавить фолбэк в `saveOrder` для `kind='ready'`).

Передатчики `state.line` (добавить `sellerId`):
- `src/screens/PcCard.tsx` (`checkout` и `InstallmentPlan` state) — взять `pc.sellerId`, `category` не нужен для готовой сборки (сервер/бэкфилл получит из `ready_pc_part`).
- `src/screens/InstallmentCheckout.tsx` — аналогично для `state.line` и config-позиций.
- `src/screens/CustomConfig.tsx` / `AutoResult.tsx` передают `config` (уже содержит `sellerId` и `parts[].category`) — изменений по sellerId не требуется.

## Задача 5 — UI статуса «Отменён»

- `src/screens/Profile.tsx`: `statusLabel` → `cancelled: "Отменён"`; `statusTone` → `destructive`/`neutral`.
- Кнопку «Отменить» показывать при `status !== 'done' && status !== 'cancelled'`.
- После отмены карточка остаётся с бейджем «Отменён» (без физического исчезновения).
- Проверить, что исключение `cancelled` из выручки/KPI обеспечивается на аналитическом слое (здесь только данные; сам дашборд — вне задачи).

## Задача 6 — Правило источника истины (документация в коде/README)

- Зафиксировать: все денежные агрегаты — только `SUM(order_item.price_kopecks * order_item.count)`; `ready_pc.price_kopecks` — живой пересчёт для витрины, для отчётности не использовать.
- Денежные KPI исключают `status='cancelled'`.
- Обновить `README.md` (разделы API/схема/история): `user_version=9`, новые колонки, `cancelled`, soft-cancel, проверка владельца.

---

## Порядок выполнения

1. Задача 1 (миграция + бэкфилл) — блокирует остальные.
2. Задача 2 (сервер: типы, DAO, API, владелец, cancel).
3. Задача 3 (клиентские типы/API).
4. Задача 4 (Checkout/InstallmentCheckout/передатчики).
5. Задача 5 (UI статуса).
6. Задача 6 (README/правило).
7. Валидация (ниже).

## План валидации

- `npm run db:init` идемпотентно на чистой и на существующей БД; повторный запуск не ломает; `PRAGMA user_version = 9`; `db/verify.js` проходит.
- `npm run db:backup` перед прогоном миграции на реальной копии `db/confi.db`.
- Юнит: `migrate.ts` — колонки добавлены, CHECK содержит `cancelled`, бэкфилл `ready.seller_id` заполнен, `config` = NULL.
- `npm run typecheck` и `npm run test:typecheck`.
- E2E (`npm run test:smoke` / `tests/regression`): оформить ready-заказ и config-заказ → в БД `order_item.seller_id`/`category` заполнены; отмена → `status='cancelled'`, строка НЕ удалена, в списке отображается с бейджем «Отменён»; попытка отменить чужой заказ → `403/404`.
- Проверить, что `db/api-e2e.mjs` (если покрывает orders) обновлён под soft-cancel.

## Открытые риски / решения

- **Backfill config-атрибуции невозможен** для истории (`ref_id=part_id`) — такие строки попадут в бакет «Без продавца». Для config-заказов **только новые** данные атрибутируются корректно.
- **История статусов** (графики длительности этапов) — вне рамок; при необходимости отдельная таблица `order_status_event`.
- **Смешанные заказы** (разные продавцы в одном заказе) поддержаны на уровне строк; агрегаты «по заказу» должны явно выбирать способ (по строкам).