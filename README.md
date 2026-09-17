# Confi — конфигуратор ПК

Веб-приложение для подбора, сборки и оформления персонального компьютера под задачи пользователя: готовые сборки, ручной конфигуратор с живой проверкой совместимости и умный автоподбор по ответам на несколько вопросов.

> Демо-проект. Всё состояние персистится в **SQLite** (`db/confi.db`) через встроенный
> Express API-сервер; локальная работа с `localStorage` удалена. Цены и отзывы — вымышленные.

## Возможности

- **Готовые ПК** — подборки Confi под задачи (игры, работа, монтаж, универсальные) с карточками, рейтингами, отзывами и признаком наличия на складе.
- **Ручной конфигуратор** — выбор компонентов из каталога по 8 категориям с автоматической блокировкой несовместимых позиций в реальном времени.
- **Автоподбор** — пошаговый опрос из 4 шагов (бюджет, назначение, платформа Intel/AMD, приоритет — производительность/цена/тишина) и автоматическая сборка оптимальной конфигурации.
- **Администрирование** — для роли `admin`: список пользователей, создание, удаление и назначение ролей (`customer`/`seller`/`admin`) на отдельном защищённом маршруте `/admin` и на вкладке «Администрирование пользователей» в профиле.
- **Справочник компонентов и вендоров** — компоненты хранятся в БД (`part`) и администрируются на вкладке «Компоненты» для ролей `seller`/`admin`: создание с **полной картой реквизитов совместимости** по категориям (сокет, чипсет, тип ОЗУ, форм-факторы, мощность БП, длина GPU, высота кулера, coolTDP, размер, bench-баллы), редактирование и **мягкая деактивация**. Название компонента **собирается из вендора и модели**: «Вендор (торговая марка)» (`Intel`) + «Модель / линейка» (`Core i5-13400F`) → полное `Intel Core i5-13400F` (отдельно не хранится). Вендор пополняется на лету из общего справочника `vendor` (регистронезависимо). Админ может выполнить **полную инициализацию каталога** эталонным набором из `mock.ts` (физически удаляя не-эталонные компоненты, поэтому в старых сборках они становятся «недоступны»).
- **Живая проверка совместимости** — сокет CPU ↔ материнской платы, TDP процессора ↔ охлаждения, тип памяти (DDR4/DDR5) платы ↔ ОЗУ, форм-факторы корпуса/платы/БП (включая требование SFX для ITX), длина видеокарты, высота кулера и запас мощности БП (×1.6 к потреблению).
- **Сохранение и хранение сборок** — сохранение, загрузка, копирование в конфигуратор и удаление конфигураций в профиле.
- **Оформление заказа** — детализация состава, итоговая сумма и оформление покупки, попадание в историю заказов.
- **Рассрочка 0-0-4 от Альфа-Банка** — кликабельный блок «Купить в рассрочку на 4 месяца» с визуальным разбиением суммы на 4 равные части (первый платёж — со следующего месяца). Ведёт на отдельную форму `/alpha` в красных тонах с атрибутикой Альфа-Банка и кнопкой «Отправить заявку на покупку в рассрочку». Такие заявки получают статус «На рассмотрении в Альфа-Банке».
- **Ролевая модель** — четыре роли: **Гость** (аноним: публичные страницы, конфигуратор и автоподбор без сохранения), **Клиент** (email+телефон, вход по email или SMS, профиль с конфигурациями/заказами/отзывами), **Продавец** (только email, поле «Компания», вкладка «Бренды» с CRUD и описанием бренда, плейсхолдер «Прайс-лист — в разработке») и **Администратор** (только email, управление пользователями в профиле и на `/admin`). **admin/seller не могут покупать** (заказ и рассрочка), **сохранять сборки и оставлять отзывы** — у них нет вкладок «Заказы», «Отзывы», «Конфигурации» и «Настройки». Бренд **Confi** закреплён за `user@company.com` (с описанием «Собственные сборки Confi»), админ — `avgordeev@alfabank.ru`.
- **Профиль и авторизация** — вход по телефону (мок-SMS) или по e-mail; самообслуживание аккаунта (клиент и продавец редактируют имя, продавец — «Компанию»). Вкладки зависят от роли: **Клиент** — «Конфигурации / Заказы / Отзывы»; **Администратор** — «Администрирование пользователей» и «Компоненты»; **Продавец** — «Бренды» и «Компоненты». В разделе «Заказы» для любого заказа, кроме «Выполнен», доступна кнопка «Отменить», удаляющая заказ из хранилища.
- **Отзывы и рейтинги** — оставление отзывов к готовым сборкам и к кастомному конфигуратору (только для `customer`).
- **Темы оформления** — светлая и тёмная тема (oklch-токены); настройка темы и уведомлений вынесена в шестерёнку **«Настройки»** в правом верхнем углу хэдера (только для авторизованных; у гостя остаются только переключатель темы и кнопка входа).
- **Онбординг** — гейт при первом посещении с перенаправлением неприветствованных пользователей на `/onboarding`.
- **Доступность** — WCAG 2.1 AA, обязательный `:focus`, `prefers-reduced-motion`, семантическая разметка, поддержка клавиатуры, корректный `sr-only`.
- **Недоступность компонентов** — деактивированный (`is_active=0`/`is_available=0`) или полностью удалённый при переинициализации компонент в сохранённой конфигурации/готовом ПК отображается как «**Компонент более недоступен для заказа**» (вместо названия и цены). Такая сборка считается **неполной** для заказа/сохранения; сумма и TDP считаются только по доступным компонентам.

## Технологии

- **React 18.3** + **TypeScript 5.6** (strict-режим, `noUnusedLocals`, `noUnusedParameters`)
- **Vite 5** — сборка и dev-сервер (порт 5173), плагины `@vitejs/plugin-react` и `@tailwindcss/vite`, dev-прокси `/api → http://localhost:8787`
- **React Router 6** (`createBrowserRouter` + `RouterProvider`) — маршрутизация с ленивой загрузкой экранов через `React.lazy` и `Suspense`
- Состояние и данные — контексты (`AuthProvider`, `ThemeProvider`) и клиентский API-слой (`lib/api.ts`), обращающийся к Express+SQLite серверу; уведомления — `ToastProvider`/`useToast`
- **Tailwind CSS v4** (CSS-first, `@import "tailwindcss"`, `@custom-variant dark`, `@theme inline`, `@utility`) + **shadcn/ui** (стиль *New York*, нейтральная база, `oklch`-дизайн-токены)
- Примитивы **Radix UI** (Dialog, Label, Select, Slot, Switch, Tabs)
- Иконки — **lucide-react**; уведомления — **sonner** (`richColors`, по центру сверху)
- Утилиты стилей — **clsx** + **tailwind-merge** (`cn`)
- Форматирование — нативный `Intl.NumberFormat` (рубли `ru-RU`), дни/даты на русском
- **SQLite-бэкенд (основное хранилище)** — Express 5 + `better-sqlite3` (STRICT-таблицы, WAL, внешние ключи), типизированные DAO в `src/server/repository/`
- Шрифты — **Inter** (основной) + **Manrope** (заголовки) через Google Fonts с `display=swap`
- Путь-алиас `@/*` → `src/*`

## Структура проекта

```
src/
├── components/
│   ├── shared/        # Композитные компоненты (ComponentPicker, ConfigPartsTable,
│   │                  #   ReadyPcCard, ReviewDialog, InstallmentPlan)
│   └── ui/            # shadcn/ui-подобные примитивы (Button, Card, Dialog, Select,
│                      #   Modal, Navbar, Table, Badge, StarRating, Breadcrumbs,
│                      #   EmptyState, Field, Tabs, Switch, Skeleton, Toast …)
├── data/
│   └── mock.ts        # Источник для seed каталога/готовых ПК/отзывов (не используется фронтендом)
├── lib/
│   ├── auth.tsx       # Контекст авторизации (сессия в БД, роль customer/seller/admin)
│   ├── theme.tsx      # Контекст темы (светлая/тёмная) с применением к <html>, настройки в БД
│   ├── compatibility.ts # Движок проверки совместимости и валидации сборок
│   ├── survey.ts      # Логика автоподбора (score-функции, бюджетные пресеты)
│   ├── api.ts         # Клиентский API-слой (fetch к /api, маппинг DTO ↔ domain)
│   ├── actions.ts     # Действия: сохранение/удаление сборок, шеринг, отзывы
│   ├── session.ts     # Хранение opaque-идентификатора сессии в куке, генерация uid
│   ├── format.ts      # Форматирование цен, ватт, дат, телефонов, меток категорий
│   └── utils.ts       # cn() — слияние CSS-классов
├── screens/           # Экраны (Home, Onboarding, Auth, ReadyPCs, PcCard,
│                      #   CustomConfig, AutoSelect, AutoResult, Checkout,
│                      #   InstallmentCheckout, Profile, ProfileComponents,
│                      #   Admin, NotFound, Layout)
│   └── guards.tsx     # Гейты доступа: RequireAuth / RequireRole / RequireCustomer
├── styles/
│   └── global.css     # Tailwind v4 + oklch-дизайн-токены + базовые стили
├── types/
│   └── index.ts       # Доменные типы (Part, Config, ReadyPc, Order, User, SurveyAnswers …)
├── server/            # Express + SQLite API (не входит в клиентскую сборку)
│   ├── index.ts       # Корень API: маршруты каталога, пользователей, авторизации, админки
│   ├── db.ts          # Открытие/кэширование SQLite-подключения (WAL, FK + миграция)
│   └── repository/    # DAO (catalog, user-data, seller, vendor, app-state) + типы DTO
├── App.tsx            # Корневой компонент с провайдерами
├── router.tsx         # Конфигурация маршрутов (lazy + Suspense, гейты доступа)
└── main.tsx           # Точка входа (createRoot + StrictMode)
```

## Маршруты

| Путь | Экран |
| --- | --- |
| `/` | Главная |
| `/onboarding` | Онбординг |
| `/auth` | Вход / регистрация |
| `/ready` | Готовые ПК |
| `/ready/:id` | Карточка готового ПК |
| `/config` | Ручной конфигуратор |
| `/auto` | Автоподбор (опрос) |
| `/auto/result` | Результат автоподбора |
| `/profile` | Профиль (по умолчанию первый раздел роли) — только авторизованные |
| `/profile/:tab` | Профиль: клиент — `configs` / `orders` / `reviews`; админ — `admin-users` / `components`; продавец — `brands` / `components` — только авторизованные |
| `/checkout` | Оформление заказа — только `customer` |
| `/alpha` | Рассрочка 0-0-4 от Альфа-Банка — только `customer` |
| `/admin` | Администрирование пользователей — только роль `admin` |
| `*` | 404 |

> **Доступность роутов:** `/`, `/onboarding`, `/auth`, `/ready`, `/ready/:id`, `/config`, `/auto`, `/auto/result`
> — публичные (Гость). `/profile` недоступен анониму (редирект на `/auth`);
> `/checkout` и `/alpha` доступны только роли `customer` (иначе редирект на `/`); `/admin`
> доступен только администратору (иначе редирект на `/`). Админ/продавец заходят только по e-mail
> (у них нет телефона), клиент — по e-mail или SMS.

## SQLite-бэкенд (основное хранилище)

Приложение полностью работает на **Node-бэкенде** на Express + `better-sqlite3`:
каталог, готовые ПК, сборки, заказы, отзывы, настройки, авторизация/сессии и
онбординг хранятся в `db/confi.db` (STRICT-таблицы, WAL). Фронтенд обращается к
API через Vite-прокси `/api → http://localhost:8787`.

### Команды

| Команда | Действие |
| --- | --- |
| `npm run db:init` | Создать `db/confi.db` со схемой + миграцией (идемпотентно, `user_version=6`) |
| `npm run db:seed` | Seed каталога/готовых ПК/отзывов/ролей из `src/data/mock.ts` (пересоздаёт каталог) |
| `npm run db:import <export.json>` | Импорт данных из устаревшего localStorage-экспорта `alfagen:` (батчинг, quarantine) |
| `npm run db:backup` | Резервная копия `db/confi.db` в `db/backups/` |
| `npm run db:verify` | Проверка целостности и count по таблицам (включая роли и `seller_brand`) |
| `npm run db:test:api` | End-to-end тест API (нужен запущенный сервер) |
| `npm run server` | Запуск API-сервера на `http://localhost:8787` |
| `npm start` | Идемпотентный запуск всего приложения: `db:init` → `db:seed` → API + Vite |

Каталог — единственный источник правды для `part`/`ready_pc`: seed читает
`src/data/mock.ts` напрямую (Node 24 native type-stripping), валидирует каждую
запись и пишет битые строки в `db/quarantine-*.log`.

**Миграция схемы:** `db/schema.sql` — источник DDL (`user_version=6`). В `db/migrate.ts`
— идемпотентные миграции:
- `migrateUserAccount` — пересоздание `user_account` с новым CHECK роли
  (`'guest'` убрана, добавлены `seller`/`admin`) и колонкой `company`
  (SQLite не меняет CHECK на лету; временная таблица + `RENAME`, гостевые строки отбрасываются).
- `migrateSellerBrandDescription` — пересоздание `seller_brand` с колонкой `description`,
  выполняемое в единой транзакции с уникальным именем временной таблицы (безопасно при
  сбое посреди пересоздания и при конкурентном старте нескольких процессов).
- `migrateVendorAndAvailability` — вводит справочник **`vendor`** (торговая марка,
  регистронезависимо уникальна), добавляет `part.vendor_id` и `part.is_available`, и
  меняет FK `config_part`/`ready_pc_part` → `part` на **`ON DELETE SET NULL`**. Вендоры
  заполняются из уникальных `brand` (Intel/AMD/NVIDIA/…); `is_available=1` для всех.
  Таблицы пересоздаются по рецепту FK-off + temp `CREATE/INSERT/DROP/RENAME` с
  `PRAGMA foreign_key_check`.

Все три миграции вызываются из `db:init`, `db:seed`, `src/server/db.ts` и тестовой инициализации.

### API

- `GET /api/parts[?category=]`, `GET /api/parts/:id` — каталог компонентов
  (маркеры совместимости отдаются вложенным документом `part.compat`)
- `GET /api/ready`, `GET /api/ready/:id` — готовые ПК
- `GET /api/vendors` — список вендоров (торговых марок)
- `POST /api/components` — создать компонент (роль `seller`/`admin`; `vendor` — название, upsert в `vendor`)
- `PATCH /api/components/:id` — редактирование компонента (seller/admin)
- `POST /api/components/:id/deactivate` — мягкая деактивация (seller/admin): `is_available=0`, `is_active=0`
- `POST /api/catalog/initialize` — полная инициализация каталога эталоном из `mock.ts` (только `admin`)
- `GET/POST /api/onboarding` — онбординг
- `POST /api/auth/request-code`, `POST /api/auth/verify` — мок-SMS
- `POST /api/session`, `GET /api/session/:id`, `POST /api/session/logout` — сессия/пользователи
- `PATCH /api/profile` — самообслуживание аккаунта (имя; продавец также может менять `company`) — только авторизованные
- `GET /api/users`, `POST /api/users`, `DELETE /api/users/:id`, `PATCH /api/users/:id/role` — управление пользователями (только `admin`; дубль e-mail → `409`)
- `GET/PUT/PATCH/DELETE /api/seller/:id/brands` — бренды продавца (владелец или `admin`): список, создание, обновление (переименование/описание), удаление; `GET` возвращает `{ brand, description }[]`
- `GET/PUT/DELETE /api/configs[/:id]` — сборки (`?userId=`; запись — только `customer`)
- `GET/PUT/DELETE /api/orders[/:id]` — заказы (запись — только `customer`)
- `GET/PUT /api/reviews[/:id]` (`?entityId=`) — отзывы (запись — только `customer`)
- `GET/PATCH /api/settings` — настройки
- `GET /api/health` — проверка состояния

Слой `src/server/repository/` реализует типизированные DAO (part, ready_pc,
config, order, review, user, seller, vendor, app-state). Браузерная часть хранит только
небольшой идентификатор сессии (`auth_session` в БД; на клиенте — кука
`confi_session`). Никакой локальной аудиторской базы нет.

Чувствительные эндпоинты контролируются серверными проверками ролей на основе сессии
(парсер куки `confi_session` + роль из `user_account`): `/api/users*` — только
`admin` (иначе `403`), `PATCH /api/profile` — авторизованные клиент/продавец,
`PUT/DELETE /api/configs/:id`, `PUT/DELETE /api/orders/:id`, `PUT /api/reviews/:id` — только
`customer` (`requireCustomer`, иначе `403`), бренды продавца — владелец или `admin`,
`/api/vendors`, `/api/components*` и `/api/catalog/initialize` — `seller` или `admin`
(`requireSellerOrAdmin`; инициализация — только `admin`).
`upsertUser` при входе по известному `email`/`phone`/`id` восстанавливает существующий
аккаунт и его роль из БД (запрашиваемая роль игнорируется), поэтому вход админа/продавца
по e-mail стабилен и не создаёт новый профиль.

## Хранение состояния

Вся бизнес-логика и данные живут в SQLite. На клиенте от локального хранилища
данных осталась только кука `confi_session` с opaque-идентификатором сессии,
чтобы переживать перезагрузку страницы; сами сессии, пользователи, конфигурации,
заказы, отзывы, настройки, pending-SMS-коды, бренды продавцов и флаг онбординга
хранятся в БД (таблицы `user_account`, `auth_session`, `auth_pending`, `config`,
`order_header`, `review`, `app_setting`, `seller_brand`, `vendor`, `kv_store`).

**Роли:** колонка `user_account.role` — `'customer' | 'seller' | 'admin'` (плюс
аноним вне записей = «Гость»). У клиента есть и e-mail, и телефон; у продавца и
администратора — только e-mail (`phone = NULL`), поэтому они входят по e-mail.
Продавец связан с брендами через таблицу `seller_brand` (1-к-многим). Гость не создаёт
записи в `user_account` (анонимный просмотр без сессии).

## История изменений

### Миграция с localStorage на базу данных

Проект был переведён с клиентского `localStorage` на полноценный SQLite-бэкенд.

**Бэкенд (Express + better-sqlite3):**
- Схема `db/schema.sql` обновлена до `user_version=2`: добавлены таблицы `auth_session`,
  `auth_pending` и `kv_store` (онбординг). Итог — 13 STRICT-таблиц.
- Новый DAO `src/server/repository/app-state.ts`: сессии, pending-SMS, key/value-хранилище.
- Новые API-маршруты: `GET/POST /api/onboarding`, `POST /api/auth/request-code`,
  `POST /api/auth/verify`, `POST /api/session` (создание сессии), `GET /api/session/:id`,
  `POST /api/session/logout`.
- `upsertUser` умеет генерировать `user_id` на сервере.
- Каталог готовых ПК теперь включает `reviewCount`; части приходят с категорией.

**Фронтенд:**
- Удалён `src/lib/storage.ts` (весь слой работы с `localStorage`); `mock.ts` теперь
  используется только как источник для `db:seed`, а не фронтендом.
- Добавлен клиентский API-слой `src/lib/api.ts` — единый источник данных для всех экранов.
- Добавлен `src/lib/session.ts` — на клиенте остаётся только opaque-идентификатор сессии
  в куке `confi_session`; сами сессии — в БД.
- Переписаны контексты `auth.tsx`/`theme.tsx`, `actions.ts`, `survey.ts` и все экраны
  (`Layout`, `Onboarding`, `Auth`, `ReadyPCs`, `PcCard`, `ComponentPicker`, `AutoResult`,
  `CustomConfig`, `Profile`, `Checkout`, `InstallmentCheckout`) на API.

**Запуск:** теперь требуются оба процесса (`npm run server` + `npm run dev`); Vite
проксирует `/api` на API-сервер.

### Исправление зацикливания онбординга

`Layout` перечитывает флаг `onboarded` при каждой навигации (`[location.pathname]`),
а `Onboarding` дожидается записи флага в БД перед переходом — устранена гонка, из-за
которой пользователя не выпускало со страницы `/onboarding`.

### Ролевая модель (Гость / Клиент / Продавец / Администратор)

- Схема `db/schema.sql` обновлена до `user_version=3`: CHECK роли →
  `('customer','seller','admin')` (без `'guest'`), добавлена колонка `user_account.company`
  и таблица `seller_brand` (связь продавец ↔ бренд, 1-к-многим).
- Новый `db/migrate.ts` — идемпотентная миграция: пересоздаёт `user_account` с новым
  CHECK и `company` (временная таблица + `RENAME`), отбрасывает гостевые строки.
- «Гость» теперь = аноним без записи в `user_account`/сессии; кнопка «Войти как гость»
  заменена на «Продолжить без аккаунта» (просто очищает сессию).
- Сервер: `upsertUser` восстанавливает существующий аккаунт и его роль по
  `id`/`email`/`phone`; новые админ-эндпоинты `/api/users*`, самообслуживание
  `PATCH /api/profile`, бренды продавца `GET /api/seller/:id/brands`; серверные гварды по
  ролям на основе сессии (`actorRole`).
- Клиент: helper-флаги ролей в `auth.tsx`, гейты `RequireAuth`/`RequireRole`
  (`src/screens/guards.tsx`), маршрут `/admin`, экран `Admin.tsx`, обновлены
  `Navbar`/`Auth`/`Profile` (бейдж роли, поля «Компания» и «Прайс-лист — в разработке»).
- Seed добавляет админа (`avgordeev@alfabank.ru`, `admin`) и продавца
  (`user@company.com`, `seller`, компания «Confi Маркет», бренд `Confi`).

### admin/seller не сохраняют контент и не покупают + ролевые вкладки профиля + настройки в хэдере

- **Ограничение покупок/сохранений/отзывов для admin/seller.** Серверный гвард
  `requireCustomer` (`src/server/index.ts`) на `PUT/DELETE /api/configs/:id`,
  `PUT/DELETE /api/orders/:id` и `PUT /api/reviews/:id` (иначе `403`). На клиенте
  у `admin`/`seller` скрыты «Оформить заказ», рассрочка (`InstallmentPlan`),
  «Сохранить», «Отзыв»/«Оставить отзыв»/`ReviewDialog` на `PcCard`, `AutoResult`,
  `CustomConfig`; построение/выбор компонентов, «Настроить/Редактировать в
  конфигураторе» и «Поделиться» остаются. Роуты `/checkout` и `/alpha` обёрнуты в
  новый гейт `RequireCustomer` (`src/screens/guards.tsx`), которые редиректят
  admin/seller на `/` (а аноним — на `/auth`).
- **Ролевые вкладки профиля (`Profile.tsx`).** Вкладки теперь зависят от роли: клиент —
  «Конфигурации / Заказы / Отзывы»; админ — «Администрирование пользователей»
  (рендер экрана `Admin embedded` без собственных Breadcrumbs); продавец — «Бренды».
  Вкладка «Настройки» удалена из профиля.
- **Бренды продавца с CRUD и описанием.** Схема `db/schema.sql` → `user_version=4`:
  в `seller_brand` добавлена колонка `description`. Новая идемпотентная миграция
  `migrateSellerBrandDescription` (транзакционное пересоздание таблицы с уникальным
  именем временной таблицы). `SellerRepository` расширен до CRUD (`listSellerBrands`,
  `addBrand`, `updateBrand`, `deleteBrand`) с DTO `{ brand, description? }`. Серверные
  эндпоинты `PUT/PATCH/DELETE /api/seller/:id/brands` (владелец или `admin`). Клиентские
  `addSellerBrand`/`updateSellerBrand`/`deleteSellerBrand` и тип `SellerBrand`. UI-вкладка
  «Бренды» с модалкой «Название/Описание бренда». У `user@company.com` — бренд **Confi**
  с описанием «Собственные сборки Confi».
- **Настройки в хэдере (`Navbar.tsx`).** Новая шестерёнка **«Настройки»** (только для
  авторизованных) с попапом на `useState` (без Radix Popover): тема (Select) и уведомления
  (Switch) через `useTheme`/`fetchSettings`/`saveSettingsRemote`. У гостя остаются только
  переключатель темы (Sun/Moon) и кнопка входа.
- **Тесты:** обновлены `profile.spec.ts` (настройки теперь в попапе хэдера) и добавлен
  `roles.spec.ts` — admin/seller без действий покупки, редиректы `/checkout`/`/alpha`,
  серверные `403`, ролевые вкладки профиля, CRUD брендов, шестерёнка настроек для
  авторизованного и её отсутствие у гостя.

### Справочник компонентов, вендоры и недоступность

- **Схема `db/schema.sql` → `user_version=6`.** Новая таблица **`vendor`** (торговая марка,
  регистронезависимо уникальная `name`); `part` получает колонки `vendor_id` (FK → `vendor`)
  и `is_available` (`is_active` = показывать в каталоге, `is_available` = доступен для заказа;
  `is_active=0` при деактивации тоже = недоступен). FK `config_part`/`ready_pc_part` → `part`
  меняются с `ON DELETE RESTRICT` на **`ON DELETE SET NULL`** (компонент в junction опционален —
  после полной переинициализации удалённые части остаются ссылкой `NULL`).
- **Миграция `migrateVendorAndAvailability`** пересоздаёт `vendor`/`part`/`config_part`/
  `ready_pc_part` по рецепту FK-off (temp CREATE/INSERT/DROP/RENAME + `foreign_key_check`);
  вендоры заполняются из уникальных `part.brand` с нормализацией регистра (Intel == intel).
  Вызывается из `db:init`, `db:seed`, `src/server/db.ts`, `tests/helpers/testDb.ts`.
- **Репозиторий `vendor.ts`** (`VendorRepository`): `listVendors`, `getVendor`,
  `getOrCreateVendor` (upsert по `name` регистронезависимо), `renameVendor`, `deleteVendor`.
  `catalog.ts` дополнен `createPart`/`updatePart`/`deactivatePart` (ставит `is_available=0`,
  `is_active=0`) и `initializeCatalog` (полная замена эталоном; не-эталонные `part` удаляются →
  `ON DELETE SET NULL`). `partToDto` отдаёт `vendorId` и `available` (`is_active && is_available`).
  `configPartsFor`/`readyPcWithParts`/`partsByIds` больше не отбрасывают NULL/missing —
  возвращают `ConfigPartDto` с `part: null` и `unavailableReason: 'deactivated' | 'missing'`.
- **API:** `GET /api/vendors` (публичный), `POST /api/components`, `PATCH /api/components/:id`,
  `POST /api/components/:id/deactivate` (гвард `requireSellerOrAdmin`), `POST
  /api/catalog/initialize` (только `admin`). Валидация по категории — обязательные/релевантные
  поля совместимости (сокет/чипсет/тип ОЗУ/форм-фактор/мощность БП и т. п.).
- **Клиент:** типы `Vendor`, `ConfigPart.part: Part | null` + `unavailableReason`, `Part.vendorId`/
  `available`; функции `fetchVendors`/`createPart`/`updatePart`/`deactivatePart`/`initializeCatalog`.
- **Логика (`compatibility.ts`):** `isConfigComplete` считает сборку неполной, если выбранная
  категория недоступна/отсутствует; `configStats` суммирует цену/TDP **только по доступным**.
- **UI:** вкладка «Компоненты» в профиле у `seller`/`admin` (`ProfileComponents.tsx`) с
  таблицей справочника, модалкой «Создать/Редактировать» с полной картой реквизитов по
  категориям и автодополнением вендора, кнопкой деактивации и блоком инициализации каталога
  (admin). `ConfigPartsTable` и карточки (`PcCard`, `AutoResult`, `InstallmentCheckout`) выводят
  «Компонент более недоступен для заказа» вместо названия/цены; `ComponentPicker` не предлагает
  деактивированные (сервер фильтрует `is_active=1`).
- **Тесты:** юнит-тесты `isPartAvailable`/`configStats`/`isConfigComplete` (недоступные части),
  добор покрытия `redact.ts` до 100%; новый E2E `tests/regression/components.spec.ts` (создание
  компонента продавцом, `403` для клиента, деактивация → «недоступен» в сохранённой конфигурации,
  переинициализация админом).

### Название = вендор + модель, категорийные поля совместимости и доработки

- **Сборка названия из вендора и модели.** Поле «Название» больше не вводится отдельно:
  полное имя компонента составляется из **вендора (торговая марка)** и **модели/линейки**
  (`part.brand`) — например `Intel` + `Core i5-13400F` → `Intel Core i5-13400F`. Сервер
  (`POST/PATCH /api/components`, `initializeCatalog`) вычисляет `name = composePartName(vendor, brand)`;
  вендор ищется/создаётся регистронезависимо через `getOrCreateVendor`. В форме
  `ProfileComponents` поле переименовано в «Модель / линейка», убрано отдельное ввод названия,
  добавлено живое превью «Название: {вендор} {модель}». При инициализации из `mock.ts` марка
  берётся из `p.brand`, модель выводится из `name` удалением префикса-марки
  (`modelFromName`), мультисловные вендоры (`Cooler Master`, `be quiet!`) сохраняются.
- **Категорийные поля совместимости.** В карточке и форме компонента отображаются только
  параметры, релевантные категории (`CATEGORY_FIELDS` в `ProfileComponents`): CPU — сокет +
  bench-баллы; GPU — длина + bench; плата — сокет/чипсет/тип ОЗУ/форм-фактор; RAM — тип ОЗУ;
  корпус — форм-фактор/длина GPU/высота кулера; БП — форм-фактор/мощность; кулер — coolTDP/
  размер; storage — без полей. `buildCompat` пишет в `compat` только поля текущей категории.
- **Устойчивый seed вендоров.** `ensureVendor` в seed привязывает часть к существующему вендору
  по имени (возвращает реальный id), а при отсутствии создаёт со случайным id — без коллизий с
  ids из миграции/API. После вставки seed удаляет «висячие» вендоры
  (`vendor_id` не ссылается ни на одну `part`), зачищая мусорные записи-модели.
- **Миграция v6 (сделанное по ревью).** `migrateVendorAndAvailability` обёрнута в
  `db.transaction` (атомарность пересоздания), сохраняет `part.created_at`, пересоздаёт индекс
  `idx_part_active`; `ready_pc_part.part_id` стал nullable, чтобы `ON DELETE SET NULL` после
  полной переинициализации каталога корректно показывал «недоступен».
- **UI-подписи:** `ComponentPicker` и `CustomConfig` перестали дублировать модель под полным
  именем.

## Автотесты и покрытие (процесс разработки)

Автотесты должны покрывать **100% функционала**. Это достигается двумя
взаимодополняющими уровнями, и оба проверяются в CI:

### 1. Юнит-тесты чистой логики (`tests/unit/`) — гейт покрытия

Каждый чисто-логический модуль (`src/lib/` без DOM/браузерных зависимостей)
должен иметь юнит-тесты на `node:test` с покрытием **~100% строк**. Гейт
жёстко настроен в `package.json` (`test:unit:cov`) — покрытие по ключевым
модулям не ниже **99%** (агрегировано), иначе прогон падает:

```bash
npm run test:unit        # только тесты
npm run test:unit:cov    # тесты + проверка порога покрытия
```

Покрываемые модули:
- `src/lib/format.ts` — 100%
- `src/lib/compatibility.ts` — 100% (включая все правила совместимости и недоступность)
- `src/lib/analytics/redact.ts` — 100%

> Модули, связанные с DOM/браузером (`auth.tsx`, `theme.tsx`, `session.ts`,
> `survey.ts` из-за extensionless-импортов, аналитика-транспорт) покрываются
> **UI/E2E-тестами** Playwright, а не юнит-тестами.

### 2. E2E-тесты пользовательских сценариев (`tests/smoke/`, `tests/regression/`)

Покрывают пользовательскую функциональную поверхность: авторизация (e-mail,
SMS, гостевой вход), профиль (конфигурации/заказы/редактирование, ролевые вкладки,
бренды продавца, компоненты/вендоры, настройки в хэдере), администрирование (создание/удаление/роли
пользователей), ролевые ограничения admin/seller (нет покупки/рассрочки/сохранения/
отзывов, `403` на запись, редиректы `/checkout`/`/alpha`), справочник компонентов
(создание, деактивация → «недоступен» в сохранённых конфигурациях, переинициализация),
оформление заказа, рассрочка `/alpha`, ручной конфигуратор (выбор компонентов, блокировка
несовместимых, сохранение), фильтры готовых ПК.

### Процесс при разработке новой функциональности

1. **Логика в `src/lib/` (чистые функции):** добавьте юнит-тест в
   `tests/unit/` рядом с существующими. Перед merge прогоните `npm run test:unit:cov` —
   гейт не даст закоммитить новую строку без теста, если модуль покрывается.
2. **Новый экран / интерактив:** добавьте E2E-сценарий в `tests/regression/`,
   следуя стилю `auth.spec.ts` / `checkout.spec.ts` (вход через
   `POST /api/session` + куки `confi_session`).
3. **Черновики:** `npm run test:gen:from-logs` генерирует черновики в
   `tests/drafts/` (не гоняются в CI). Продвигайте их в `tests/regression/` после
   проверки бизнес-утверждений.

### Полный прогон

```bash
npm run test:all
```

Это единая команда качества: сначала **юнит-покрытие** (гейт), затем init
тестовой БД и **все Playwright-тесты** (smoke + regression, десктоп + мобайл).
CI (`/.github/workflows/test.yml`) выполняет этот же гейт отдельным job'ом
`unit`, а smoke/regression/verify — обязательными проверками.

## Установка и запуск

Проще всего запустить всё одной командой `npm start` (выполняет `db:init` → `db:seed`
и поднимает API + Vite параллельно). Либо вручную двумя процессами:

```bash
# Установка зависимостей
npm install

# 1) Быстрый запуск всего приложения (инициализация + seed + оба сервера)
npm start
# приложение на http://localhost:5173

# Либо вручную:
# 1) Инициализация и seed базы (идемпотентно)
npm run db:init
npm run db:seed

# 2) Запуск в двух окнах:
npm run server   # API на http://localhost:8787
npm run dev      # фронтенд на http://localhost:5173 (Vite проксирует /api)
```

Демо-доступ: **Клиент** — вход по e-mail или телефону (мок-SMS); **Продавец** —
`user@company.com` (по e-mail); **Администратор** — `avgordeev@alfabank.ru` (по e-mail).

Сборка и проверка типов:

```bash
# Проверка типов клиента и сервера
npm run typecheck

# Сборка для продакшена (tsc + vite build)
npm run build

# Просмотр продакшен-сборки
npm run preview
```

Требования: Node.js (≥ 22.6 для type-stripping в `db/*.js`/`src/server`; рекомендовано 24+) и npm (проект ESM, `"type": "module"`; таргет сборки `es2020`).

## Скрипты

| Команда | Действие |
| --- | --- |
| `npm start` / `npm run dev:app` | Запуск всего приложения: `db:init` → `db:seed` → API + Vite (`scripts/dev-app.mjs`) |
| `npm run dev` | Запуск dev-сервера (Vite) |
| `npm run build` | Проверка типов + прод-сборка |
| `npm run preview` | Просмотр прод-сборки |
| `npm run typecheck` | Проверка типов клиента и сервера |
| `npm run server` | Запуск SQLite API-сервера (`http://localhost:8787`) |
| `npm run server:dev` | Запуск SQLite API-сервера в watch-режиме |
| `npm run db:init` | Создание схемы БД + миграция (`user_version=6`) |
| `npm run db:seed` | Seed каталога/ролей из `mock.ts` |
| `npm run db:import` | Импорт из localStorage-экспорта |
| `npm run db:backup` | Бэкап `confi.db` |
| `npm run db:verify` | Проверка целостности БД (включая роли и `seller_brand`) |
| `npm run db:test:api` | End-to-end тест API (нужен запущенный сервер) |
| `npm run test:smoke` | Playwright smoke-тесты (инициализация тестовой БД + запуск) |
| `npm run test:regression` | Playwright regression-тесты |
| `npm run test:unit` | Node-юнит-тесты чистой логики (`node:test`) |
| `npm run test:unit:cov` | Юнит-тесты + гейт покрытия (≥99% строк по ключевым модулям) |
| `npm run test:all` | Полный прогон: юнит-покрытие + init БД + все Playwright-тесты |