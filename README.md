# Confi — конфигуратор ПК

Веб-приложение для подбора, сборки и оформления персонального компьютера под задачи пользователя: готовые сборки, ручной конфигуратор с живой проверкой совместимости и умный автоподбор по ответам на несколько вопросов.

> Демо-проект. Данные компонентов, цены и отзывы — вымышленные, хранятся локально. Всё состояние персистится в `localStorage` под префиксом `alfagen:`; серверного бэкенда и реальной базы нет.

## Возможности

- **Готовые ПК** — подборки Confi под задачи (игры, работа, монтаж, универсальные) с карточками, рейтингами, отзывами и признаком наличия на складе.
- **Ручной конфигуратор** — выбор компонентов из каталога по 8 категориям с автоматической блокировкой несовместимых позиций в реальном времени.
- **Автоподбор** — пошаговый опрос из 4 шагов (бюджет, назначение, платформа Intel/AMD, приоритет — производительность/цена/тишина) и автоматическая сборка оптимальной конфигурации.
- **Живая проверка совместимости** — сокет CPU ↔ материнской платы, TDP процессора ↔ охлаждения, тип памяти (DDR4/DDR5) платы ↔ ОЗУ, форм-факторы корпуса/платы/БП (включая требование SFX для ITX), длина видеокарты, высота кулера и запас мощности БП (×1.6 к потреблению).
- **Сохранение и хранение сборок** — сохранение, загрузка, копирование в конфигуратор и удаление конфигураций в профиле.
- **Оформление заказа** — детализация состава, итоговая сумма и оформление покупки, попадание в историю заказов.
- **Рассрочка 0-0-4 от Альфа-Банка** — кликабельный блок «Купить в рассрочку на 4 месяца» с визуальным разбиением суммы на 4 равные части (первый платёж — со следующего месяца). Ведёт на отдельную форму `/alpha` в красных тонах с атрибутикой Альфа-Банка и кнопкой «Отправить заявку на покупку в рассрочку». Такие заявки получают статус «На рассмотрении в Альфа-Банке».
- **Профиль и авторизация** — вход по телефону (мок-SMS), режим гостя, разделы «Конфигурации / Заказы / Отзывы / Настройки». В разделе «Заказы» для любого заказа, кроме «Выполнен», доступна кнопка «Отменить», удаляющая заказ из хранилища.
- **Отзывы и рейтинги** — оставление отзывов к готовым сборкам и к кастомному конфигуратору.
- **Темы оформления** — светлая и тёмная тема (оклх-токены), настройка сохраняется, применяется до рендера для избежания «проблеска» темы.
- **Онбординг** — гейт при первом посещении с перенаправлением неприветствованных пользователей на `/onboarding`.
- **Доступность** — WCAG 2.1 AA, обязательный `:focus`, `prefers-reduced-motion`, семантическая разметка, поддержка клавиатуры, корректный `sr-only`.

## Технологии

- **React 18.3** + **TypeScript 5.6** (strict-режим, `noUnusedLocals`, `noUnusedParameters`)
- **Vite 5** — сборка и dev-сервер (порт 5173), плагины `@vitejs/plugin-react` и `@tailwindcss/vite`
- **React Router 6** (`createBrowserRouter` + `RouterProvider`) — маршрутизация с ленивой загрузкой экранов через `React.lazy` и `Suspense`
- Состояние и данные — контексты (`AuthProvider`, `ThemeProvider`) и слой работы с `localStorage` (`lib/storage.ts`); уведомления — `ToastProvider`/`useToast`
- **Tailwind CSS v4** (CSS-first, `@import "tailwindcss"`, `@custom-variant dark`, `@theme inline`, `@utility`) + **shadcn/ui** (стиль *New York*, нейтральная база, `oklch`-дизайн-токены)
- Примитивы **Radix UI** (Dialog, Label, Select, Slot, Switch, Tabs)
- Иконки — **lucide-react**; уведомления — **sonner** (`richColors`, по центру сверху)
- Утилиты стилей — **clsx** + **tailwind-merge** (`cn`)
- Форматирование — нативный `Intl.NumberFormat` (рубли `ru-RU`), дни/даты на русском
- **Опциональный SQLite-бэкенд** — Express 5 + `better-sqlite3` (STRICT-таблицы, WAL, внешние ключи), типизированные DAO в `src/server/repository/`
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
│   └── mock.ts        # Каталог компонентов (8 категорий), готовые ПК и отзывы (вымышленные)
├── lib/
│   ├── auth.tsx       # Контекст авторизации (мок-SMS, роль customer/guest)
│   ├── theme.tsx      # Контекст темы (светлая/тёмная) с применение к <html>
│   ├── compatibility.ts # Движок проверки совместимости и валидации сборок
│   ├── survey.ts      # Логика автоподбора (score-функции, бюджетные пресеты)
│   ├── storage.ts     # Работа с localStorage (ключи alfagen:*, CRUD заказов/сборок, генератор uid)
│   ├── actions.ts     # Действия: сохранение/удаление сборок, шеринг, отзывы
│   ├── format.ts      # Форматирование цен, ватт, дат, телефонов, меток категорий
│   └── utils.ts       # cn() — слияние CSS-классов
├── screens/           # Экраны (Home, Onboarding, Auth, ReadyPCs, PcCard,
│                      #   CustomConfig, AutoSelect, AutoResult, Checkout,
│                      #   InstallmentCheckout, Profile, NotFound, Layout)
├── styles/
│   └── global.css     # Tailwind v4 + oklch-дизайн-токены + базовые стили
├── types/
│   └── index.ts       # Доменные типы (Part, Config, ReadyPc, Order, User, SurveyAnswers …)
├── App.tsx            # Корневой компонент с провайдерами
├── router.tsx         # Конфигурация маршрутов (lazy + Suspense)
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
| `/profile` | Профиль (по умолчанию «Конфигурации») |
| `/profile/:tab` | Профиль: `configs` / `orders` / `reviews` / `settings` |
| `/checkout` | Оформление заказа |
| `/alpha` | Рассрочка 0-0-4 от Альфа-Банка |
| `*` | 404 |

## SQLite-бэкенд (миграция данных)

Рядом с `localStorage`-хранилищем появился опциональный **Node-бэкенд** на
Express + `better-sqlite3`, куда переносится каталог, готовые ПК, сборки,
заказы, отзывы и настройки. Данные лежат в `db/confi.db` (STRICT-таблицы).

### Команды

| Команда | Действие |
| --- | --- |
| `npm run db:init` | Создать `db/confi.db` со схемой (идемпотентно, `user_version=1`) |
| `npm run db:seed` | Seed каталога/готовых ПК/отзывов из `src/data/mock.ts` (пересоздаёт каталог) |
| `npm run db:import <export.json>` | Импорт пользовательских данных из localStorage-экспорта (батчинг, quarantine) |
| `npm run db:backup` | Резервная копия `db/confi.db` в `db/backups/` |
| `npm run db:verify` | Проверка целостности и count по таблицам |
| `npm run db:test:api` | End-to-end тест API (нужен запущенный сервер) |
| `npm run server` | Запуск API-сервера на `http://localhost:8787` |

Каталог — единственный источник правды для `part`/`ready_pc`: seed читает
`src/data/mock.ts` напрямую (Node 24 native type-stripping), валидирует каждую
запись и пишет битые строки в `db/quarantine-*.log`.

### API

- `GET /api/parts[?category=]` — каталог компонентов
- `GET /api/parts/:id`, `GET /api/ready`, `GET /api/ready/:id` — каталог
- `POST /api/session`, `GET /api/user/:id` — сессия/пользователи
- `GET/PUT/DELETE /api/configs[/:id]` — сборки (`?userId=`)
- `GET/PUT/DELETE /api/orders[/:id]` — заказы
- `GET/PUT /api/reviews[/:id]` (`?entityId=`) — отзывы
- `GET/PATCH /api/settings` — настройки
- `GET /api/health` — проверка состояния

Актор данных по умолчанию — суррогатный пользователь `usr-localstorage-import`.
Слой `src/server/repository/` реализует типизированные DAO (part, ready_pc,
config, order, review, user, setting). Фронтенд-приложение работает как и раньше
на `localStorage`/`mock.ts` и остаётся fully-функциональным без запущенного
сервера; бэкенд служит опциональным серверным хранилищем.

## Пакет «alfagen»

Хранилище `localStorage` использует префикс `alfagen:`:

- `alfagen:onboarded` — флаг пройденного онбординга
- `alfagen:session` — сессия авторизации (User)
- `alfagen:pendingAuth` — мок-SMS (телефон, код, время истечения)
- `alfagen:configs` — сохранённые конфигурации
- `alfagen:reviews` — отзывы
- `alfagen:orders` — заказы (включая заявки на рассрочку со статусом «На рассмотрении в Альфа-Банке»)
- `alfagen:settings` — настройки (тема, уведомления)

## Установка и запуск

```bash
# Установка зависимостей
npm install

# Режим разработки (dev-сервер на http://localhost:5173)
npm run dev

# Сборка для продакшена (tsc + vite build)
npm run build

# Просмотр продакшен-сборки
npm run preview
```

Требования: Node.js (≥ 22.6 для type-stripping в `db/*.js`; рекомендовано 24+) и npm (проект ESM, `"type": "module"`; таргет сборки `es2020`).

## Скрипты

| Команда | Действие |
| --- | --- |
| `npm run dev` | Запуск dev-сервера |
| `npm run build` | Проверка типов + прод-сборка |
| `npm run preview` | Просмотр прод-сборки |
| `npm run typecheck` | Проверка типов клиента и сервера |
| `npm run server` | Запуск SQLite API-сервера (`http://localhost:8787`) |
| `npm run server:dev` | Запуск SQLite API-сервера в watch-режиме |
| `npm run db:init` | Создание схемы БД |
| `npm run db:seed` | Seed каталога из `mock.ts` |
| `npm run db:import` | Импорт из localStorage-экспорта |
| `npm run db:backup` | Бэкап `confi.db` |
| `npm run db:verify` | Проверка целостности БД |
| `npm run db:test:api` | End-to-end тест API (нужен запущенный сервер) |