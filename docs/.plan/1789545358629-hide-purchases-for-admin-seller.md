# Правило: admin/seller не сохраняют контент и не покупают + ролевые вкладки профиля + настройки в хэдере

## Цель
1. **Администратор** (`admin`) и **Продавец** (`seller`): запрещена покупка
   (заказ и рассрочка), сохранение сборок и оставление отзывов. В профиле у них нет
   разделов «Заказы», «Отзывы», «Сохранённые сборки» и «Настройки».
2. **Профиль** для admin/seller остаётся и получает собственные ролевые вкладки:
   - **Администратор** — вкладка «Администрирование пользователей» (то же, что экран `/admin`).
   - **Продавец** — вкладка «Бренды»: список брендов продавца с CRUD (Добавить/Редактировать/Удалить)
     и полем «Описание бренда». У `user@company.com` есть бренд `Confi`.
3. Пункт профиля «Настройки» переносится в правый верхний угол хэдера — шестеренка с
   тултипом «Настройки» и попапом (тема + уведомления), **только для авторизованных**.
   У Гостя «Настройки» отсутствуют — остаются только переключатель темы и кнопка входа.
4. **Клиенту** (`customer`) доступны покупка, сохранение сборок и отзывы как раньше;
   вкладки профиля: `Конфигурации`, `Заказы`, `Отзывы` (без «Настройки»).

## Ключевой вывод из кода
- `useAuth` даёт `isAdmin`/`isSeller`/`isCustomer` (`auth.tsx:90-92`). Действия с данными =
  только `isCustomer`.
- Гейты (`guards.tsx`): `RequireAuth`, `RequireRole`; нет «только покупатель» — добавить.
- Текущий профиль (`Profile.tsx`): `TABS` (41-48) и рендер 4 экранов; `settings`-таб (405-440)
  переносится в хэдер. Экран `/admin` (`Admin.tsx`) — отдельный маршрут с `RequireRole role="admin"`.
  Продавец получает новый рендер «Бренды».
- Сервер (`index.ts`) БЕЗ гвардов на записывающих эндпоинтах:
  `PUT/DELETE /api/configs/:id` (249-263), `PUT/DELETE /api/orders/:id` (270-284),
  `PUT /api/reviews/:id` (294-298) — добавить `requireCustomer`.
- Бренды продавца: `seller_brand (seller_id, brand)` без `description` (`schema.sql:141-146`),
  репозиторий только читает `string[]` (`seller.ts`), эндпоинт `GET /api/seller/:id/brands`
  (owner/auth, `index.ts:229-236`). Для CRUD + описания нужна миграция схемы и новые методы.
- Хэдер `Navbar.tsx` использует `useAuth`, `useTheme`, кнопку Sun/Moon. Radix
  Popover/DropdownMenu в проекте НЕТ — попап настройки сделать на `useState` (как мобильное меню).
- `ThemeProvider` грузит/сохраняет тему только при `user?.id` (`theme.tsx:34-44,53`); для гостя
  — только текущая сессия. `saveSettingsRemote` требует `userId`.
- Миграция схемы — паттерн `db/migrate.ts` (пересоздание таблицы, `user_version` в `schema.sql:4`).

## Изменения

### 1. Серверная блокировка «только клиент» (`src/server/index.ts`)
Добавить `requireCustomer` (по аналогии с `requireAdmin`, 66-80): нет сессии →
`403 unauthorized`; роль !== `customer` → `403 forbidden`; иначе `{ userId, role }`.
Применить к записывающим эндпоинтам:
- `PUT /api/configs/:id` (250), `DELETE /api/configs/:id` (259);
- `PUT /api/orders/:id` (270), `DELETE /api/orders/:id` (280);
- `PUT /api/reviews/:id` (294).

`GET`-эндпоинты (`/configs`, `/orders`, `/reviews`, `/settings`) оставить открытыми
(возвращают данные своего `userId`, у admin/seller пустые; настройки продолжают работать).

### 2. Гейт «только покупатель» (`src/screens/guards.tsx`)
Добавить `RequireCustomer`: не авторизован → `/auth`; роль !== customer → `/`;
иначе `children`. `signingIn` → `null`.

### 3. Маршруты (`src/router.tsx`)
`/checkout` (75-81) и `/alpha` (83-89) обернуть в `RequireCustomer` вместо `RequireAuth`.
Импортировать `RequireCustomer` из `./screens/guards`.

### 4. Всплывающие действии по ролям (скрыть для admin/seller)
Скрыть для не-`isCustomer` на всех экранах:
- **PcCard** (`PcCard.tsx`): `<InstallmentPlan>` (211-223), «Оформить заказ» (224-226),
  «Сохранить» (231-233), «Отзыв» (237-239); в секции отзывов — «Оставить отзыв» (270-272)
  и `ReviewDialog` (275-281). Список отзывов оставить. Оставить «Настроить в конфигураторе»,
  «Поделиться».
- **AutoResult** (`AutoResult.tsx`): «Оформить заказ · …» (150-152), `<InstallmentPlan>` (167-169),
  «Сохранить» (156-158), «Отзыв» (162-164), `ReviewDialog` (200-205). Оставить «Редактировать
  в конфигураторе», «Поделиться».
- **CustomConfig** (`CustomConfig.tsx`): `<InstallmentPlan>` (280-297), «Оформить заказ» (299-301),
  «Сохранить в профиль» (302-304), «Отзыв» (186-188), `ReviewDialog` (319-324). Построение/выбор
  компонентов оставить.

### 5. `src/screens/Profile.tsx` — вкладки по ролям
Ключ вкладки = `customer | admin | seller`.
- `customer`: `configs`, `orders`, `reviews`.
- `admin`: `admin-users` («Администрирование пользователей»).
- `seller`: `brands` («Бренды»).

Механика: `TABS` — функция роли. `active` = fallback на первый доступный. `reload` —
для customer грузить configs/orders/reviews; для seller грузить бренды; для admin не грузить
контентные списки. Удалить ставшие неиспользуемыми импорты/хелперы/ветки
(`handleDeleteConfig`, `handleCancelOrder`, `sourceLabel`, `statusTone`, `statusLabel` и т.п.),
следить за `noUnusedLocals` (`npm run typecheck`).

### 6. Профиль: вкладка «Администрирование пользователей» (admin)
Переиспользовать существующий экран `Admin.tsx`. Варианты (выбрать, минимизируя дублирование):
- **Рекомендуется:** `Profile` рендерит `<Admin />` внутри вкладки `admin-users`. Придётся
  убрать/приглушить собственные `Breadcrumbs`/`h1` `Admin.tsx`, чтобы вписаться в контентную
  область профиля (или оставить как есть, если визуально приемлемо).
- Альтернатива: оставить `/admin` маршрут и вкладка лишь ведёт на него (`Link`). Но требование —
  «выполнить как вкладку, аналогично вкладкам клиента».
Маршрут `/admin` и ссылку из `Navbar` и `PcCard? ` оставить (обратная совместимость, гейт `admin`).

### 7. Профиль: вкладка «Бренды» (seller) + CRUD с описанием

#### 7a. Схема и миграция
- `seller_brand` добавить колонку `description TEXT` (`schema.sql:141-146`). PRIMARY KEY
  остаётся `(seller_id, brand)`. Поднять `PRAGMA user_version` до 4 (`schema.sql:4`).
- Новая идемпотентная миграция в `db/migrate.ts` (по образцу `migrateUserAccount`):
  пересоздать `seller_brand` с колонкой `description`, скопировав существующие строки
  (description = NULL), без потери FKs. Вызывать из `db/init.js`, `db/seed.js`,
  `src/server/db.ts`, `tests/helpers/testDb.ts` (там, где вызывается `migrateUserAccount`).
- `db/seed.js` — бренд `Confi` для `usr-seller` (208) дополнить description (например,
  «Собственные сборки Confi»).

#### 7b. Репозиторий (`src/server/repository/seller.ts`)
Расширить `SellerRepository` до CRUD, возвращая объекты брендов:
- `listSellerBrands(sellerId): { brand: string; description?: string }[]` (не ломать `GET`);
- `addBrand(sellerId, brand, description?): …` (INSERT, конфликт → ошибка/`OK`);
- `updateBrand(sellerId, brand, patch: {brand?, description?}): …` (переименование/описание);
- `deleteBrand(sellerId, brand): boolean`.
DTO в `repository/types.ts`.

#### 7c. Серверные эндпоинты (`src/server/index.ts`)
Расширить блок `Seller` (228-236), доступ владелец или admin:
- `PUT /api/seller/:id/brands` — создать бренд (body: `{ brand, description? }`);
- `PATCH /api/seller/:id/brands/:brand` — обновить (переименовать/описание);
- `DELETE /api/seller/:id/brands/:brand` — удалить.
`GET /api/seller/:id/brands` — теперь возвращает `{ brand, description }[]`.

#### 7d. Клиентский API (`src/lib/api.ts`)
- `fetchSellerBrands` → `{ brand, description? }[]` (заменить маппинг строк);
- `addSellerBrand`, `updateSellerBrand`, `deleteSellerBrand`.
Тип `SellerBrand { brand: string; description?: string }` в `src/types/index.ts`.

#### 7e. UI вкладки «Бренды» (`Profile.tsx` или отдельный компонент)
- Список брендов: название + описание; кнопки **Редактировать**/**Удалить** на каждый.
- Кнопка **Добавить** → `Modal` с полями «Название бренда» и «Описание бренда».
- Для `user@company.com` будет показан бренд `Confi` с описанием.

### 8. Настройки в хэдере (`src/components/ui/Navbar.tsx`)
**Только для авторизованных (клиент/продавец/админ). Для Гостя меню «Настройки» отсутствует** —
у гостя в правом верхнем углу остаются только переключатель темы (Sun/Moon) и кнопка «Войти»/логофф.

Для авторизованного:
- Шестеренка (`lucide-react`, `Settings`) справа рядом с логоффом. Тултип/`aria-label="Настройки"`.
- Попап (лёгкий, на `useState` — без Radix Popover; закрытие по клику вне/Escape), содержимое:
  - **Тема** — `Select` (Светлая/Тёмная) через `useTheme`/`setTheme`;
  - **Уведомления** — `Switch` через `fetchSettings`/`saveSettingsRemote` при `user?.id`.
- Sun/Moon-кнопку (82-91) оставить как быстрый переключатель (рекомендуется) либо убрать;
  тесты по `aria-label` не ломать или поправить.

Итог по навигации справа:
- **Гость:** [Sun/Moon] [Войти] (без шестеренки, без логоффа).
- **Авторизованный:** [Sun/Moon] [шестеренка → попап «Настройки»] [профиль] [Выйти].

### 9. Тексты (опционально)
- `aria-label="Покупка"` в `PcCard.tsx:203` переименовать (например «Действия»).
- Маркетинговые упоминания (`Auth.tsx:204`, `Onboarding.tsx:21`) — не критичны.

## Тесты

### Обновить существующие
- `profile.spec.ts`: `profile settings tab renders theme + notifications` (62-69) — таб удалён,
  переписать на проверку попапа настроек в хэдере либо удалить. Прочие (`configs`, `orders`,
  `edit name`) — `customer`, валидны.
- `admin.spec.ts`: маршрут `/admin` и Navbar-ссылка остаются; если вкладка-админ рендерит
  `/admin`-компонент, добавить проверку вкладки в профиле.
- `checkout.spec.ts`, `installment.spec.ts`, `custom-config.spec.ts`, `browse-configure.spec.ts`
  — `customer`, валидны.

### Новые
- Роли admin/seller:
  - на `/ready/:id` нет «Оформить заказ», рассрочки, «Сохранить», «Отзыв»; `/checkout`, `/alpha`
    редиректят на `/`;
  - профиль admin имеет вкладку «Администрирование пользователей»; профиль seller — вкладку «Бренды»;
  - серверный: seller → `PUT /configs`, `PUT /orders`, `PUT /reviews` вернут `403`.
- Бренды (seller): список, создание, редактирование (в т.ч. описание), удаление; для
  `user@company.com` виден `Confi` с описанием.
- Хэдер-настройки: шестерёнка и попап «Настройки» (тема/уведомления) — **только для
  авторизованного**, переключения применяются/сохраняются; **у гостя шестерёнки и пункта
  «Настройки» нет** — только тема + кнопка входа.

## Валидация
- `npm run typecheck` — клиент и сервер (внимание к `noUnusedLocals` в `Profile.tsx`).
- `npm run db:init` + `npm run server` + `npm run dev` — ручная проверка под ролями
  seller/admin/customer/гость.
- `npm run test:all` — юнит-покрытие + Playwright; обновить затронутые тесты
  (профиль, админ, бренды, настройки).

## Открытые вопросы / ограничения
- `PATCH /api/profile` запрещён для `admin` (`index.ts:158`) — не трогаем.
- `/api/users*` — только `admin` — не трогаем (используется вкладкой-админ).
- Admin/seller могут просматривать и строить конфигурации («Настроить в конфигураторе», выбор
  компонентов) — запрещено только сохранение, покупка и отзывы.
- Миграция `seller_brand` (bump user_version 3→4) обязательна для CRUD с описанием; учесть в
  `db/verify.sql`/`db:verify` (проверка колонки `description`).
- «Другие инструменты» admin/seller — за рамками; попадают как новые вкладки профиля по мере нужды.