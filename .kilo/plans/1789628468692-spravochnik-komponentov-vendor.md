# Справочник компонентов ПК: перенос в БД, Вендор, администрирование, недоступность

## Цель

Превратить справочник компонентов в постоянную сущность БД с возможностью
административной переинициализации, ввести отдельный справочник «Вендоров»
(торговая марка), дать продавцу/админу вкладку добавления компонентов с полной
картой реквизитов совместимости и обеспечить отображение «Компонент более
недоступен для заказа» для деактивированных или полностью отсутствующих
компонентов в сохранённых конфигурациях и готовых ПК.

## Принятые решения (из уточнений)

1. **Вендор = торговая марка компонента.** Вводится **общий справочник `vendor`**
   (отдельная сущность со своим `vendor_id`). Строковое поле `part.brand`
   сохраняется как есть (название/модель). Вендор пополняется **на лету** при
   добавлении компонента (ввод названия вендора → upsert в `vendor`, возврат id).
   Вендор не влияет на совместимость напрямую — влияют значения (сокет, тип ОЗУ,
   форм-фактор и т. п.), он лишь атрибут компонента.
2. **Инициализация справочника = полная замена с физическим удалением.** Админ
   запускает «инициализацию текущим набором компонентов» (эталон из `mock.ts` /
   seed). Не-эталонные компоненты **физически удаляются**; эталон перезаписывает
   строки (upsert). Поэтому FK `config_part`/`ready_pc_part` меняются с
   `ON DELETE RESTRICT` на `ON DELETE SET NULL` (часть в junction — необязательна).
3. **Недоступность компонента** — два случая:
   - **Деактивирован**: есть в БД, `is_available = 0` (мягкая деактивация
     продавцом/админом);
   - **Полностью отсутствует**: строки нет в `part` (например, после полной
     переинициализации). В junction строка остаётся с `part_id = NULL`.
   В обоих случаях конфигурация/готовый ПК показывает на месте компонента
   **«Компонент более недоступен для заказа»**; цена не учитывается.
4. **Права:** продавец и админ могут **добавлять, редактировать и деактивировать**
   (мягко) компоненты. Жёсткое удаление отдельных компонентов не делается — только
   при полной инициализации справочника (админ).
5. **Заказ с недоступным компонентом запрещён.** Если в конфигурации есть
   деактивированная/отсутствующая категория, сборка не считается корректной для
   заказа/сохранения; пользователь должен заменить компонент. Сумма и TDP считаются
   только по доступным.
6. **Форма добавления — полный набор полей по категориям.** Для каждой из 8
   категорий показываются релевантные поля совместимости (сокет/чипсет/тип ОЗУ/
   форм-фактор/мощность БП/длина GPU/высота кулера/coolTDP/размер/bench-баллы),
   заполняющие `compat_json`.

## Терминология

- **Справочник компонентов** = таблица `part` (постоянная, в БД).
- **Вендор** = таблица `vendor` — **торговая марка** (Intel, AMD, Seagate,
  Kingston, NVIDIA …). Один компонент = один вендор (`vendor_id`).
- **brand** (`part.brand`) остаётся строковым полем (название модели/линейки).
- **Инициализация** = админ-операция полной замены каталога эталонным набором.

## Текущее состояние (что менять)

- Каталог хранится в `part` (`db/schema.sql`), читается только `is_active = 1`
  (`src/server/repository/catalog.ts`); `brand` используется как имя производителя.
- `GET /api/parts` отдаёт только активные; отсутствующий/неактивный компонент в
  конфигурации просто не разрешается (`configPartsFor` в user-data.ts фильтрует
  по существующим строкам).
- `is_active` уже есть на `part` и `ready_pc`, но используется как «показывать /
  не показывать в каталоге», без оговорки «недоступен для заказа».
- FK `config_part`/`ready_pc_part` → `part ... ON DELETE RESTRICT`.

## Архитектура изменений

### 1. Схема БД и миграция

В `db/schema.sql`:

- Новая таблица `vendor`:
  ```sql
  CREATE TABLE IF NOT EXISTS vendor (
    vendor_id TEXT PRIMARY KEY,
    name      TEXT NOT NULL UNIQUE
  ) STRICT;
  ```
- `part` — добавить колонку `vendor_id TEXT` (необязательная; самовосстановление
  при старте миграцией из текущего `brand`), индекс `idx_part_vendor`.
- `part` — добавить колонку `is_available INTEGER NOT NULL DEFAULT 1 CHECK (is_available IN (0,1))`.
  Семантика: `is_active` = показывать в каталоге и конфигураторе (отображается,
  выбирается); `is_available` = доступен для заказа. Компонент, у которого
  `is_active = 0` (после деактивации), тоже считается недоступным.
- FK `config_part`: `FOREIGN KEY (part_id) REFERENCES part(part_id) ON DELETE SET NULL`.
- FK `ready_pc_part`: `FOREIGN KEY (part_id) REFERENCES part(part_id) ON DELETE SET NULL`.
- `user_version` → 6.

Через STRICT нельзя дропать колонки на месте; используем тот же
таблично-пересоздавающий приём, что `db/migrate.ts`. Добавить новый
идемпотентный `migrateVendorAndAvailability(db)`:
- создаёт `vendor` и заполняет из уникальных `brand` текущих `part` (они
  становятся вендорами-торгмарками);
- пересоздаёт `part` с `vendor_id`/`is_available` (перенос `brand → vendor`
  по названию, дефолт `is_available = 1`);
- пересоздаёт `config_part` и `ready_pc_part` с новыми FK
  `ON DELETE SET NULL`.

Вызывается из `db/init.js`, `db/seed.js`, `tests/helpers/testDb.ts`,
`src/server/db.ts` (по образцу `migrateSellerBrandDescription`). `defer_foreign_keys`
нельзя менять внутри транзакции — соблюдать существующий рецепт (FK OFF →
CREATE/INSERT/DROP/RENAME → FK OFF → `PRAGMA foreign_key_check`).

### 2. Слой репозитория

`src/server/repository/types.ts`:
- добавить `VendorDto` / `VendorRow` (`vendor_id`, `name`);
- в `PartRow`/`PartDto` добавить `vendor_id?: string | null` и `isAvailable: boolean`
  (или `available: boolean`);
- `partToDto` считывает `vendor` и `is_available`.

Новый `src/server/repository/vendor.ts` — `VendorRepository`:
- `listVendors(): VendorDto[]`
- `getVendor(id): VendorDto | null`
- `getOrCreateVendor(name): VendorDto` (upsert по `name`, регистронезависимо)
- `renameVendor(id, newName)`
- `deleteVendor(id)` (CASCADE/предохранение, если используется)

`src/server/repository/catalog.ts` — `CatalogRepository` дополнить:
- `createPart(input): PartDto` (с `vendor_id`)
- `updatePart(id, patch): PartDto | null`
- `deactivatePart(id): boolean` (ставит `is_available = 0`, `is_active = 0`)
- `listParts` обязано **возвращать и недоступные** с меткой, чтобы конфигурации
  отображали их корректно (см. раздел «Недоступность» ниже).

`src/server/repository/user-data.ts` — `configPartsFor`:
- читать компоненты **без** отфильтровывания NULL-`part_id`; если связь есть, но
  строки `part` нет (или `is_active = 0` / `is_available = 0`) — возвращать
  `ConfigPartDto` с отсутствующим/недоступным маркером (см. API/типы ниже), чтобы
  UI показал «Компонент более недоступен для заказа».

### 3. API-слой (`src/server/index.ts`)

- `GET /api/vendors` — список вендоров (публичный, нужен для форм выбора).
- `POST /api/components` — создать компонент (роль `seller` или `admin`).
  Тело: `{ category, vendor, name, brand, price, tdp, compat, specs }`.
  `vendor` — название; репозиторий вызывает `getOrCreateVendor`. Валидация по
  категории (обязательные/релевантные поля совместимости).
- `PATCH /api/components/:id` — редактирование (seller/admin). Частичное
  обновление (цена, название, вендор, compat, specs).
- `POST /api/components/:id/deactivate` — мягкая деактивация (seller/admin):
  `is_available = 0`, `is_active = 0`.
- `POST /api/catalog/initialize` — **только админ**: полная замена каталога
  эталонным набором (загрузка `components` из `mock.ts`). Удаляет не-эталонные
  `part` (сработает `ON DELETE SET NULL`), upsert эталона, `vendor` из эталона.
- **Гварды ролей:** переиспользовать `requireAdmin`; добавить
  `requireSellerOrAdmin` (`role === 'seller' || role === 'admin'`).

### 4. Доменные типы и клиентский API

`src/types/index.ts`:
- `Vendor { id; name }`
- `Part` дополняется: `vendorId?: string` и `available?: boolean`.
- Новый тип для отсутствующего компонента конфигурации:
  `UnavailablePart = { unavailable: true; reason: 'deactivated' | 'missing' }`,
  либо расширяем `ConfigPart` маркером. UI ориентируется по смыслу «недоступен».

`src/lib/api.ts`:
- `fetchVendors()`
- `createPart(input): Part`
- `updatePart(id, patch)`
- `deactivatePart(id)`
- `initializeCatalog(): void` (admin)
- `mapPart` учитывает `vendor`/`available`.

### 5. Клиентский UI

**Вкладка в профиле** `Profile.tsx`:
- Для роли `seller` и `admin` в `tabsForRole` добавить вкладку «Компоненты»
  (`key: "components"`). Для `seller` она будет вместе с «Бренды»; для `admin` —
  с «Администрирование пользователей».
- Новый экран компонента (например, `src/screens/ProfileComponents.tsx` или
  секция внутри `Profile`):
  - таблица компонентов справочника (категория, вендор, название, цена,
    доступность), редактирование, **деактивация**;
  - кнопка «Создать компонент» → модалка с **полной картой реквизитов по
    категориям** (Сокет, Чипсет, Тип ОЗУ, Форм-фактор платы, Мощность БП,
    Форм-фактор БП, Длина GPU, Высота кулера, coolTDP, Размер, Bench-баллы),
    поле «Вендор» с автодополнением из `GET /api/vendors` и созданием на лету;
  - для `admin` — блок «Инициализировать справочник текущим набором
    компонентов» с подтверждением (полная замена, старые недоступные исчезнут из
    каталога, но ссылки в конфигурациях сохранятся как «недоступен»).

**Конфигуратор и карточки** (`CustomConfig.tsx`, `PcCard.tsx`, `ReadyPCs.tsx`,
`AutoResult.tsx`, `ConfigPartsTable.tsx`, `ComponentPicker.tsx`):
- `ComponentPicker` не должен предлагать деактивированные (`is_active = 0` /
  `available === false`) компоненты.
- `ConfigPartsTable` и карточки: если `ConfigPart` несёт маркер недоступности,
  вместо названия/цены выводится строка «**Компонент более недоступен для заказа**».

### 6. Логика валидации и заказа

`src/lib/compatibility.ts`:
- `isConfigComplete`/`validateConfig` — если категория выбрана, но её компонент
  недоступен/отсутствует, считать сборку **неполной** (добавить релевантный
  issue/флаг), чтобы «Оформить заказ» и «Сохранить» были заблокированы до замены.
- `configStats` считает сумму/TDP **только по доступным** компонентам.

`src/screens/Checkout.tsx`, `InstallmentCheckout.tsx`:
- сервер уже защищает (`requireCustomer`), но дополнительно не блочить клиент —
  достаточно запретить переход, если сборка неполная (защита есть через
  `complete` на `CustomConfig`).

## Валидация

1. `npm run typecheck` — клиентский и серверный TS.
2. `npm run test:unit:cov` — порог покрытия comptatibility.ts / format.ts / redact.ts
   (99%). Новая логика недоступности в `compatibility.ts` должна быть покрыта
   юнит-тестами в `tests/unit/compatibility.test.ts`. Если `vendor`/`parts`-DAO
   покроется юнит-тестами — новые модули добавить в gate не обязательно, но для
   `compatibility.ts` обязателен.
3. `npm run db:init` и `npm run db:seed` — проверить миграцию на существующем
   `db/confi.db` (символ `user_version=6`, появление `vendor`, колонок
   `vendor_id`/`is_available`, FK `ON DELETE SET NULL`).
4. `npm run test:smoke` и `npm run test:regression` — убедиться, что новые
   маршруты/вкладки не сломали существующие сценарии (profile, roles, browse,
   checkout, custom-config).
5. Новые E2E-сценарии в `tests/regression/`:
   - продавец/админ создаёт компонент с полной картой совместимости → он появляется
     в конфигураторе;
   - деактивация компонента → он больше не выбирается, а сохранённая конфигурация,
     где он был, показывает «Компонент более недоступен для заказа»;
   - полная переинициализация справочника админом → отсутствующий компонент в
     старой конфигурации отображается как недоступный, заказ заблокирован;
   - запрет добавления несовместимых/пустых карточек реквизитов.

## Риски и оговорки

- **Пересоздание `part`** в миграции затронет FK `config_part`/`ready_pc_part`
  (пересоздаются вместе). Соблюдать тот же транзакционный рецепт и `PRAGMA
  foreign_key_check`, что в `migrateSellerBrandDescription`.
- **`ON DELETE SET NULL`** означает, что `config_part.part_id` может быть NULL —
  все читающие места (`configPartsFor`, `readyPcWithParts`, `partsByIds`) должны
  это учитывать и помечать как недоступный, а не молча отбрасывать.
- **Регистронезависимость вендоров** — `getOrCreateVendor` должен нормализовать
  регистр (COLLATE NOCASE на `vendor.name` или приведение к lower в коде).
- **Сочетание `is_active` и `is_available`** необходимо документировать: в каталоге
  показываются только `is_active = 1`; «недоступен для заказа» — это
  `is_active = 0` **или** `is_available = 0` **или** отсутствие строки.
- **Полная переинициализация удаляет вендоров/компоненты**, не использованные в
  новых сборках; их цена/название в старых конфигурациях недоступна — поэтому UI
  должен адекватно отображать отсутствие (без попытки вычислить старую цену).

## Порядок задач

1. `db/schema.sql` — `vendor`, `is_available`, `vendor_id`, FK `ON DELETE SET NULL`,
   `user_version = 6`.
2. `db/migrate.ts` — `migrateVendorAndAvailability` (идемпотентная, пересоздание
   `part`/`config_part`/`ready_pc_part`, заполнение `vendor` из `brand`).
3. Подключить миграцию в `db/init.js`, `db/seed.js`, `src/server/db.ts`,
   `tests/helpers/testDb.ts`.
4. `src/server/repository/vendor.ts` — `VendorRepository`.
5. `src/server/repository/types.ts` — `Vendor*`, `PartRow/Dto` расширения.
6. `src/server/repository/catalog.ts` — `createPart`/`updatePart`/`deactivatePart`,
   корректный `listParts`/`partsByIds` с учётом недоступности.
7. `src/server/repository/user-data.ts` — `configPartsFor` с маркером недоступности.
8. `src/server/index.ts` — маршруты `vendors`, `components`, `catalog/initialize`,
   гвард `requireSellerOrAdmin`.
9. `src/types/index.ts`, `src/lib/api.ts` — типы и клиентские функции.
10. `src/lib/compatibility.ts` — недоступные категории → сборка неполная, price/TDP
    только по доступным.
11. UI `Profile.tsx` + новый экран вкладки «Компоненты» (форма по категориям,
    инициализация админом).
12. UI `ComponentPicker`/`ConfigPartsTable`/карточки — фильтрация недоступных и
    отображение «Компонент более недоступен для заказа».
13. Юнит-тесты `tests/unit/compatibility.test.ts`; E2E-сценарии в
    `tests/regression/`.
14. Обновить `README.md` (роли/вкладки/команды/схема, `user_version=6`).