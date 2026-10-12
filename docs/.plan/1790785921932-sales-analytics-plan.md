# План: раздел «Аналитика продаж» в профиле Продавца и Админа

## Цель

Добавить продавцу и администратору раздел аналитики с 6 инструментами (общими) и одним
**админ-инструментом «Рассрочка от Альфа-Банка»**, построенными на Recharts + shadcn-обёртке.
Продавец видит данные **только по своим позициям**; Админ — по выбранному продавцу либо
агрегат **«Все продавцы»** через селектор.

## Принятые решения

- **Период**: пресеты `7 дней / 30 дней / 90 дней / Весь период`. По умолчанию `30 дней`.
- **Админ**: селектор продавца с опцией **«Все продавцы»** (агрегат) + каждый продавец отдельно.
- **Деньги**: `SUM(order_item.price_kopecks * order_item.count)`; денежные KPI исключают
  `status='cancelled'`. `order_header.total_kopecks` для отчётности не используется (заказ
  может содержать позиции нескольких продавцов).
- **Источник атрибуции**: снимки `order_item.seller_id` и `order_item.category`.
- **П.4 (выручка по категориям) исключён.** Вместо него — топ компонентов (инструмент 4).
- **П.3**: топ **готовых сборок**; все кастомные сборки агрегируются **одной позицией**
  (`kind='config'` → строка «Кастомные сборки»).

## Инструменты аналитики

| # | Инструмент | Доступ | Тип визуализации | Источник данных |
|---|------------|--------|------------------|-----------------|
| 1 | Воронка заказов | seller + admin | **Funnel** (`FunnelChart`/`Funnel`) или горизонтальные прогресс-бары по стадиям | `order_header.status` + `order_item.seller_id` |
| 2 | Динамика выручки и заказов | seller + admin | **Composed**: Area (выручка, левая ось) + Bar (кол-во заказов, правая ось) | `order_header.created_at` (по дням) |
| 3 | Топ готовых сборок | seller + admin | **Ranked Horizontal Bar** (одна ось = выручка) | `order_item` где `kind='ready'` |
| 4 | Топ компонентов | seller + admin | **Ranked Horizontal Bar** | `order_item` где `kind='config'` (снимок `category`/`name`) |
| 5 | Средний чек и распределение заказов | seller + admin | **KPI-карточки** + **Bar (Histogram)** по корзинам сумм | агрегат по `order_id` |
| 6 | Каталог, цены и наличие | seller + admin | **Stacked Bar** покрытия по категориям | `part`, `price_list_item`, `ready_pc.in_stock` |
| 7 | **Рассрочка от Альфа-Банка** | **только admin** | **Donut/Pie** (решения) + **Stacked 100% Bar** (доля продаж с/без рассрочки) + KPI | `order_header.payment_method` + `order_header.installment_decision` |

### Ограничения (зафиксировать в UI через подпись/тултип)

- Нет истории смен статусов: воронка строится **по текущему статусу** и является кумулятивной
  (переходы монотонны, см. `SELLER_ORDER_TRANSITIONS`): «дошёл до `confirmed`» =
  `confirmed + delivery + done + alpha + alpha_rejected`; «до `delivery`» = `delivery + done`;
  «до `done`» = `done`. `cancelled` и `alpha*` показываются отдельными ветками. Метрики
  времени в стадии недоступны.
- Исторические `config`-строки до миграции v9 могут иметь `category = NULL` (группировать как «—»).
- «Топ компонентов» для `kind='config'` опирается на снимок `name`/`category`, а не на `config_id`.
- После одобрения рассрочки признак «рассрочка» в текущих данных **не сохраняется** (одобрение это
  просто `alpha → confirmed`). Инструмент 7 требует новых колонок `payment_method` и
  `installment_decision` (миграция v11, см. ниже).

### Инструмент 7 «Рассрочка от Альфа-Банка» (только admin)

**Метрики:**

- Доля **одобренных** и **отклонённых** заявок — по `installment_decision` среди всех рассрочных
  заявок (`payment_method='installment'`): `approved / (approved + rejected)` и
  `rejected / (approved + rejected)`; отдельно показывать `pending` (ещё не решены).
- Доля **продаж с рассрочкой и без** — знаменатель = «оплаченные продажи» =
  заказы в статусах `confirmed`/`delivery`/`done`; числитель рассрочки =
  `payment_method='installment' AND status IN ('confirmed','delivery','done')`
  (после `buy-own` заказ становится `full` и уходит в «без рассрочки»).
- Дополнительный KPI: средняя сумма рассрочного заказа vs обычного (по `order_item` позициям заказа).

**Семантика `payment_method`:**

- `'installment'` — создан через форму `/alpha` (`InstallmentCheckout.tsx:122`, `status='alpha'`)
  и **не** выкуплен за свой счёт.
- `'full'` — обычный чекаут (`Checkout.tsx:98`, `status='new'`) **или** любой `buy-own` после отказа.

**Семантика `installment_decision`:**

- `NULL` — не рассрочка.
- `'pending'` — рассрочная заявка создана, решения нет (`payment_method='installment'`, статус `alpha`).
- `'approved'` — админ одобрил (`approve-installment`, `status → confirmed`).
- `'rejected'` — админ отклонил (`reject-installment`, `status → alpha_rejected`); остаётся
  `rejected` даже после последующего `buy-own`.

## Данные и API

### Миграция v11: признак рассрочки в заказе

Файлы `db/schema.sql` (`PRAGMA user_version = 11`) + `db/migrate.ts` (идемпотентная миграция,
вызывается из `db:init`/`db:seed`/`src/server/db.ts`/тестовой инициализации, как предыдущие).

Добавить в `order_header` две колонки (по рецепту FK-off `CREATE temp → INSERT → DROP → RENAME`
с `PRAGMA foreign_key_check`, как в `migrateOrderRejectedStatus` v10, поскольку меняется не только
набор колонок, но и безопаснее пересоздать таблицу):

```sql
payment_method       TEXT NOT NULL DEFAULT 'full'
                     CHECK (payment_method IN ('full','installment')),
installment_decision TEXT CHECK (installment_decision IN ('pending','approved','rejected'))
```

**Бэкфилл (best-effort):**

- `payment_method = 'installment'` для строк с `status IN ('alpha','alpha_rejected')`, иначе `'full'`.
- `installment_decision = 'pending'` для `status='alpha'`; `'rejected'` для `status='alpha_rejected'`;
  `NULL` для остальных. Одобренные задним числом невосстановимы (останутся `NULL`) — в UI подпись
  «исторические одобренные до миграции не учитываются».

### Репозиторий `order_header` (обновления)

- `src/server/repository/types.ts`: `OrderRow` + `paymentMethod`, `installmentDecision`;
  `OrderDto` + `paymentMethod`, `installmentDecision`; `orderToDto` их пробрасывает.
- `src/server/repository/user-data.ts`:
  - `SaveOrderInput` + `paymentMethod?: 'full' | 'installment'`;
  - `upsertOrderStmt` — вставка/обновление `payment_method` и `installment_decision`;
  - новый метод `setInstallmentDecision(orderId, decision)` (для approve/reject);
  - новый метод `setOrderPaymentMethod(orderId, method)` (для `buy-own` → `'full'`).
- `src/types/index.ts`: `Order` + `paymentMethod`, `installmentDecision`.

### Серверные правки lifecycle-эндпоинтов (`src/server/index.ts`)

- `PUT /api/orders/:id`: при создании `payment_method = input.paymentMethod ?? (status==='alpha' ? 'installment' : 'full')`;
  для нового рассрочного заказа `installment_decision='pending'`. Существующий заказ сохраняет
  свои значения (как сейчас со статусом).
- `approve-installment`: дополнительно `setInstallmentDecision(orderId, 'approved')`.
- `reject-installment`: дополнительно `setInstallmentDecision(orderId, 'rejected')`.
- `buy-own`: дополнительно `setOrderPaymentMethod(orderId, 'full')` (решение остаётся `rejected`).
- `InstallmentCheckout.tsx` (`saveOrderRemote` body) и `Checkout.tsx` — прокинуть `paymentMethod`
  (`'installment'` / `'full'`).

### Новый репозиторий `src/server/repository/analytics-sales.ts`

`createSalesAnalyticsRepository(db)` с методами, принимающими `{ sellerId: string | null, from: string | null, to: string }`
(`sellerId === null` → все продавцы):

- `kpi()` → `{ revenueKopecks, orders, units, avgOrderKopecks, cancelledOrders, cancelledRate }`
- `revenueByDay()` → `[{ date, revenueKopecks, orders }]`
- `funnel()` → `[{ status, orders, revenueKopecks }]` (кумулятивно, плюс `cancelled`/`alpha_rejected`)
- `topBuilds(limit)` → `[{ kind: 'ready' | 'config', refId, name, units, revenueKopecks }]`
  (кастом → одна строка `kind='config'`, `refId='config'`)
- `topParts(limit)` → `[{ refId, name, category, units, revenueKopecks }]`
- `orderValueBuckets()` → `[{ bucket, orders }]` (границы: `<50k, 50–100k, 100–200k, 200–400k, ≥400k` ₽)
- `catalogCoverage()` → `[{ category, total, priced, available }]`
  - конкретный продавец: `priced` = цена > 0 в его активном прайсе, `available` = `part.is_active=1 AND is_available=1`;
  - «Все продавцы»: `priced` = деталь оценена хотя бы одним продавцом (документировать в подписи).
- `installment()` (только для admin-агрегата, `sellerId` игнорируется/`null`) →
  `{ approved, rejected, pending, withInstallment, withoutInstallment, installmentShare,
       avgInstallmentOrder, avgFullOrder }`:
  - решения: `COUNT(*) FILTER` / `SUM(CASE ...)` по `installment_decision` среди `payment_method='installment'`;
  - продажи: знаменатель — заказы `status IN ('confirmed','delivery','done')`, числитель рассрочки —
    те же статусы с `payment_method='installment'`;
  - средние суммы — по суммам позиций заказа (`SUM(price_kopecks*count)` на `order_id` соответственно группе).

Все `SELECT` фильтруются по `order_header.created_at >= from AND < to` (для `all` — без границ)
и по `order_item.seller_id = ?` (или без условия для агрегата).

### Серверные маршруты (`src/server/index.ts`)

- `GET /api/seller/:id/analytics?period=7d|30d|90d|all` — владелец или `admin`.
  Переиспользовать guard `customerOrdersActor` (уже разрешает владельца/админа).
- `GET /api/admin/analytics?period=...` — только `admin` (`requireAdmin`), агрегат по всем продавцам;
  включает поле `installment` (инструмент 7). У `GET /api/seller/:id/analytics` поля `installment` нет.
- Хелпер `periodRange(period)` → `{ from: string | null, to: string }` (UTC, `to = now`).

Оба возвращают единый DTO:

```ts
interface SalesAnalyticsDto {
  period: { preset: "7d" | "30d" | "90d" | "all"; from: string | null; to: string };
  sellerId: string | null;
  kpi: { revenue: number; orders: number; units: number; avgOrder: number;
         cancelledOrders: number; cancelledRate: number }; // рубли/штуки
  revenueByDay: { date: string; revenue: number; orders: number }[];
  funnel: { status: OrderStatus; orders: number; revenue: number }[];
  topBuilds: { kind: "ready" | "config"; refId: string; name: string; units: number; revenue: number }[];
  topParts: { refId: string; name: string; category: string; units: number; revenue: number }[];
  orderValueBuckets: { bucket: string; orders: number }[];
  catalogCoverage: { category: string; total: number; priced: number; available: number }[];
  /** Только для admin-агрегата (инструмент 7). */
  installment?: {
    approved: number; rejected: number; pending: number;
    withInstallment: number; withoutInstallment: number; installmentShare: number;
    avgInstallmentOrder: number; avgFullOrder: number;
  };
}
```

### Клиентский API (`src/lib/api.ts`)

- `export type AnalyticsPeriod = "7d" | "30d" | "90d" | "all";`
- `fetchSellerSalesAnalytics(sellerId, period)` → `req('/seller/${id}/analytics?period=...')`
- `fetchAdminSalesAnalytics(period)` → `req('/admin/analytics?period=...')`
- Типы DTO в `src/types/index.ts` (`SalesAnalytics`, `SalesKpi`, `FunnelStage`, `TopRow`, `BucketRow`, `CoverageRow`).

## UI

### Новый shadcn-примитив

- Добавить зависимость **`recharts`** в `package.json` (`npm install recharts`).
- Создать `src/components/ui/Chart.tsx` по shadcn-схеме: `ChartContainer`, `ChartConfig`,
  `ChartTooltip`, `ChartTooltipContent`, `ChartLegend`, `ChartLegendContent` (использовать
  токены `--chart-1..5` из `global.css`, поддержка тёмной темы). Экспортировать из
  `src/components/ui/index.ts`.

### Экран `src/screens/ProfileSalesAnalytics.tsx`

- Пропсы: `sellerId: string`, `isAdmin?: boolean`.
- Шапка: заголовок, **селектор периода** (сегментированный контрол, как режим в
  `ProfileSellerOrders.tsx`, либо `Select`), для админа — **селектор продавца**
  (данные `fetchSellerSummaries()` + опция «Все продавцы» = `value="all"`).
- Загрузка: `loading` → `Skeleton` (как в `Profile.tsx`); пусто → `EmptyState`
  («Недостаточно данных за выбранный период»).
- Блок KPI (инструмент 5): 4–5 карточек (`Card`) — Выручка, Заказы, Средний чек, Продано
  единиц, Доля отмен. Форматирование через `formatPrice`/существующие хелперы.
- Сетка графиков (адаптив `grid`): инструменты 1–4 и 6, каждый в `Card` с заголовком,
  подписью-ограничением и `role="img"`/`aria-label`.
- **Только для админа** и только когда выбран режим «Все продавцы» (или агрегат): блок
  **«Рассрочка от Альфа-Банка»** — KPI-строка (одобрено / отклонено / на рассмотрении),
  **Donut** долей решений (`approved/rejected/pending`) и **Stacked 100% Bar** «с рассрочкой / без
  рассрочки» (плюс подпись «исторические одобренные до миграции не учитываются»).
- Смена периода/продавца → повторный запрос (состояние в `useState`, `useEffect`).

### Регистрация раздела

- В `src/screens/Profile.tsx`:
  - добавить `"sales-analytics"` в тип `Tab`;
  - в `tabsForRole`: для `seller` и `admin` добавить `{ key: "sales-analytics", label: "Аналитика продаж" }`
    (после «Заказы покупателей»);
  - в рендере — ветка `activeTab === "sales-analytics"` → `<ProfileSalesAnalytics sellerId={user.id} isAdmin={user?.role === "admin"} />`.
- Маршрут `/profile/:tab` уже покрывает новый tab (менять `src/router.tsx` не нужно).

## Затрагиваемые файлы

**Изменяются**
- `package.json` — зависимость `recharts`.
- `db/schema.sql` — `user_version=11`, 2 колонки в `order_header`.
- `db/migrate.ts` — идемпотентная миграция v11 с бэкфиллом.
- `src/server/repository/types.ts` — `OrderRow`/`OrderDto` + 2 поля.
- `src/server/repository/user-data.ts` — `SaveOrderInput`, `upsertOrderStmt`,
  `setInstallmentDecision`, `setOrderPaymentMethod`.
- `src/server/index.ts` — 2 маршрута + хелпер периода + правки `PUT /api/orders/:id`,
  `approve-installment`, `reject-installment`, `buy-own`.
- `src/types/index.ts` — DTO-типы аналитики + поля `Order`.
- `src/lib/api.ts` — 2 функции + тип периода + `paymentMethod` в `saveOrderRemote`.
- `src/screens/Checkout.tsx`, `src/screens/InstallmentCheckout.tsx` — прокинуть `paymentMethod`.
- `src/screens/Profile.tsx` — tab + рендер.
- `src/components/ui/index.ts` — экспорт `Chart*`.

**Создаются**
- `src/server/repository/analytics-sales.ts`
- `src/components/ui/Chart.tsx`
- `src/screens/ProfileSalesAnalytics.tsx`
- `tests/regression/sales-analytics.spec.ts`

## Порядок выполнения

1. `npm install recharts`; добавить в `package.json`.
2. Миграция v11: `db/schema.sql` + `db/migrate.ts` (+ бэкфилл) и поля `OrderRow`/`OrderDto`
   в `src/server/repository/types.ts`.
3. `src/server/repository/user-data.ts` — сохранение/обновление `payment_method` и
   `installment_decision`; методы решения.
4. Правки lifecycle-эндпоинтов и `saveOrderRemote`/экранов чекаута (проброс `paymentMethod`).
5. DTO-типы аналитики в `src/types/index.ts`.
6. `src/server/repository/analytics-sales.ts` (все агрегаты, включая `installment()`).
7. Маршруты `GET /api/seller/:id/analytics` и `GET /api/admin/analytics` в `src/server/index.ts`.
8. `fetchSellerSalesAnalytics` / `fetchAdminSalesAnalytics` в `src/lib/api.ts`.
9. `src/components/ui/Chart.tsx` (shadcn chart wrapper) + экспорт.
10. `src/screens/ProfileSalesAnalytics.tsx` (KPI + 6 общих графиков + админ-блок «Рассрочка»).
11. Подключить tab в `src/screens/Profile.tsx`.
12. Тест `tests/regression/sales-analytics.spec.ts`.

## Краевые случаи и режимы отказа

- Нет заказов за период → `EmptyState`, графики не рендерятся.
- `sellerId` не найден / чужой продавец у seller → `403`; `admin` — доступен любой.
- `period` неизвестен → `400` (или дефолт `30d`).
- Пустые категории в `catalogCoverage`/`category=NULL` → строка «—».
- Агрегат «Все продавцы» и `catalogCoverage` — явная подпись о смысле метрики.
- `buy-own` переводит `payment_method` в `'full'`, решение остаётся `'rejected'` — доля
  продаж с рассрочкой не включает выкупленные за свой счёт, доля отклонённых — включает.
- Отсутствие решения (`pending`) не входит в доли одобренных/отклонённых, показывается отдельно.
- Тёмная тема: цвета только из `--chart-*`; `prefers-reduced-motion` — без анимаций.

## Валидация

- `npm run typecheck` (клиент + `tsconfig.server.json`).
- `npm run build`.
- `npm run db:init` — миграция v11 применяется идемпотентно; `PRAGMA foreign_key_check` чист.
- `npm run test:init:db` затем `npx playwright test tests/regression/sales-analytics.spec.ts`
  (проверить: seller видит только свои позиции; admin переключает продавцов и «Все продавцы»;
  смена периода перезапрашивает; пустой период показывает `EmptyState`; отменённые не входят в выручку;
  блок «Рассрочка» виден только админу, доли одобренных/отклонённых и с/без рассрочки корректны,
  `buy-own` не считается рассрочкой).
- Ручная проверка в обеих темах и на мобильном вьюпорте (проект `mobile-chrome`).

## Открытые вопросы

- Нет (ключевые решения зафиксированы выше). При реализации допустимо заменить `FunnelChart`
  на горизонтальные прогресс-бары, если `Funnel`-примитив в текущей версии Recharts неудобен.