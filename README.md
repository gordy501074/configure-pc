# Confi — конфигуратор ПК

Веб-приложение для подбора, сборки и оформления персонального компьютера под задачи пользователя: готовые сборки, ручной конфигуратор с живой проверкой совместимости и умный автоподбор по ответам на несколько вопросов.

> Демо-проект. Всё состояние персистится в **SQLite** (`db/confi.db`) через встроенный
> Express API-сервер; локальная работа с `localStorage` удалена. Цены и отзывы — вымышленные.

## Возможности

- **Готовые ПК** — подборки Confi под задачи (игры, работа, монтаж, универсальные) с карточками, рейтингами, отзывами и признаком наличия на складе.
- **Ручной конфигуратор** — выбор компонентов из каталога по 8 категориям с автоматической блокировкой несовместимых позиций в реальном времени.
- **Автоподбор** — пошаговый опрос из 4 шагов (бюджет, назначение, платформа Intel/AMD, приоритет — производительность/цена/тишина) и автоматическая сборка оптимальной конфигурации.
- **Администрирование** — для роли `admin`: список пользователей, создание, удаление и назначение ролей (`customer`/`seller`/`admin`) на отдельном защищённом маршруте `/admin`.
- **Живая проверка совместимости** — сокет CPU ↔ материнской платы, TDP процессора ↔ охлаждения, тип памяти (DDR4/DDR5) платы ↔ ОЗУ, форм-факторы корпуса/платы/БП (включая требование SFX для ITX), длина видеокарты, высота кулера и запас мощности БП (×1.6 к потреблению).
- **Сохранение и хранение сборок** — сохранение, загрузка, копирование в конфигуратор и удаление конфигураций в профиле.
- **Оформление заказа** — детализация состава, итоговая сумма и оформление покупки, попадание в историю заказов.
- **Рассрочка 0-0-4 от Альфа-Банка** — кликабельный блок «Купить в рассрочку на 4 месяца» с визуальным разбиением суммы на 4 равные части (первый платёж — со следующего месяца). Ведёт на отдельную форму `/alpha` в красных тонах с атрибутикой Альфа-Банка и кнопкой «Отправить заявку на покупку в рассрочку». Такие заявки получают статус «На рассмотрении в Альфа-Банке».
- **Ролевая модель** — четыре роли: **Гость** (аноним: публичные страницы, конфигуратор и автоподбор без сохранения), **Клиент** (email+телефон, вход по email или SMS, профиль с конфигурациями/заказами/отзывами/настройками), **Продавец** (только email, поле «Компания», бренды, плейсхолдер «Прайс-лист — в разработке») и **Администратор** (только email, управление пользователями на `/admin`). Бренд **Confi** закреплён за `user@company.com`, админ — `avgordeev@alfabank.ru`.
- **Профиль и авторизация** — вход по телефону (мок-SMS) или по e-mail; самообслуживание аккаунта (клиент и продавец редактируют имя, продавец — «Компанию»); разделы «Конфигурации / Заказы / Отзывы / Настройки». В разделе «Заказы» для любого заказа, кроме «Выполнен», доступна кнопка «Отменить», удаляющая заказ из хранилища.
- **Отзывы и рейтинги** — оставление отзывов к готовым сборкам и к кастомному конфигуратору.
- **Темы оформления** — светлая и тёмная тема (оклх-токены), настройка сохраняется, применяется до рендера для избежания «проблеска» темы.
- **Онбординг** — гейт при первом посещении с перенаправлением неприветствованных пользователей на `/onboarding`.
- **Доступность** — WCAG 2.1 AA, обязательный `:focus`, `prefers-reduced-motion`, семантическая разметка, поддержка клавиатуры, корректный `sr-only`.

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
│                      #   InstallmentCheckout, Profile, Admin, NotFound, Layout)
│   └── guards.tsx     # Гейты доступа: RequireAuth / RequireRole (admin)
├── styles/
│   └── global.css     # Tailwind v4 + oklch-дизайн-токены + базовые стили
├── types/
│   └── index.ts       # Доменные типы (Part, Config, ReadyPc, Order, User, SurveyAnswers …)
├── server/            # Express + SQLite API (не входит в клиентскую сборку)
│   ├── index.ts       # Корень API: маршруты каталога, пользователей, авторизации, админки
│   ├── db.ts          # Открытие/кэширование SQLite-подключения (WAL, FK + миграция)
│   └── repository/    # DAO (catalog, user-data, seller, app-state) + типы DTO
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
| `/profile` | Профиль (по умолчанию «Конфигурации») — только авторизованные |
| `/profile/:tab` | Профиль: `configs` / `orders` / `reviews` / `settings` — только авторизованные |
| `/checkout` | Оформление заказа — только авторизованные |
| `/alpha` | Рассрочка 0-0-4 от Альфа-Банка — только авторизованные |
| `/admin` | Администрирование пользователей — только роль `admin` |
| `*` | 404 |

> **Доступность роутов:** `/`, `/onboarding`, `/auth`, `/ready`, `/ready/:id`, `/config`, `/auto`, `/auto/result`
> — публичные (Гость). `/profile`, `/checkout`, `/alpha` недоступны анониму (редирект на `/auth`);
> `/admin` доступен только администратору (иначе редирект на `/`). Админ/продавец заходят только по e-mail
> (у них нет телефона), клиент — по e-mail или SMS.

## SQLite-бэкенд (основное хранилище)

Приложение полностью работает на **Node-бэкенде** на Express + `better-sqlite3`:
каталог, готовые ПК, сборки, заказы, отзывы, настройки, авторизация/сессии и
онбординг хранятся в `db/confi.db` (STRICT-таблицы, WAL). Фронтенд обращается к
API через Vite-прокси `/api → http://localhost:8787`.

### Команды

| Команда | Действие |
| --- | --- |
| `npm run db:init` | Создать `db/confi.db` со схемой + миграцией (идемпотентно, `user_version=3`) |
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

**Миграция схемы:** `db/schema.sql` — источник DDL (`user_version=3`). При изменении
CHECK-констрейнта `user_account.role` (роль `'guest'` убрана, добавлены `seller`/`admin`)
SQLite не меняет CHECK на лету, поэтому `db/migrate.ts` идемпотентно пересоздаёт таблицу
(временная таблица + `RENAME`), сохраняя роли и отбрасывая гостевые строки. Миграция
вызывается из `db:init`, `db:seed`, `src/server/db.ts` и тестовой инициализации.

### API

- `GET /api/parts[?category=]`, `GET /api/parts/:id` — каталог компонентов
- `GET /api/ready`, `GET /api/ready/:id` — готовые ПК
- `GET/POST /api/onboarding` — онбординг
- `POST /api/auth/request-code`, `POST /api/auth/verify` — мок-SMS
- `POST /api/session`, `GET /api/session/:id`, `POST /api/session/logout` — сессия/пользователи
- `PATCH /api/profile` — самообслуживание аккаунта (имя; продавец также может менять `company`) — только авторизованные
- `GET /api/users`, `POST /api/users`, `DELETE /api/users/:id`, `PATCH /api/users/:id/role` — управление пользователями (только `admin`; дубль e-mail → `409`)
- `GET /api/seller/:id/brands` — бренды продавца (владелец или `admin`)
- `GET/PUT/DELETE /api/configs[/:id]` — сборки (`?userId=`)
- `GET/PUT/DELETE /api/orders[/:id]` — заказы
- `GET/PUT /api/reviews[/:id]` (`?entityId=`) — отзывы
- `GET/PATCH /api/settings` — настройки
- `GET /api/health` — проверка состояния

Слой `src/server/repository/` реализует типизированные DAO (part, ready_pc,
config, order, review, user, seller, app-state). Браузерная часть хранит только
небольшой идентификатор сессии (`auth_session` в БД; на клиенте — кука
`confi_session`). Никакой локальной аудиторской базы нет.

Чувствительные эндпоинты контролируются серверными проверками ролей на основе сессии
(парсер куки `confi_session` + роль из `user_account`): `/api/users*` — только
`admin` (иначе `403`), `PATCH /api/profile` — авторизованные клиент/продавец.
`upsertUser` при входе по известному `email`/`phone`/`id` восстанавливает существующий
аккаунт и его роль из БД (запрашиваемая роль игнорируется), поэтому вход админа/продавца
по e-mail стабилен и не создаёт новый профиль.

## Хранение состояния

Вся бизнес-логика и данные живут в SQLite. На клиенте от локального хранилища
данных осталась только кука `confi_session` с opaque-идентификатором сессии,
чтобы переживать перезагрузку страницы; сами сессии, пользователи, конфигурации,
заказы, отзывы, настройки, pending-SMS-коды, бренды продавцов и флаг онбординга
хранятся в БД (таблицы `user_account`, `auth_session`, `auth_pending`, `config`,
`order_header`, `review`, `app_setting`, `seller_brand`, `kv_store`).

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
| `npm run db:init` | Создание схемы БД + миграция (`user_version=3`) |
| `npm run db:seed` | Seed каталога/ролей из `mock.ts` |
| `npm run db:import` | Импорт из localStorage-экспорта |
| `npm run db:backup` | Бэкап `confi.db` |
| `npm run db:verify` | Проверка целостности БД (включая роли и `seller_brand`) |
| `npm run db:test:api` | End-to-end тест API (нужен запущенный сервер) |
| `npm run test:smoke` | Playwright smoke-тесты (инициализация тестовой БД + запуск) |
| `npm run test:regression` | Playwright regression-тесты |
| `npm run test:all` | Все Playwright-тесты |