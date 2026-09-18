# План: прайс-листы продавцов + сквозная переоценка по активному прайсу

## Контекст и цель

У каждого продавца появляются собственные **прайс-листы**: продавец добавляет в них
компоненты из справочника (`part`) и выставляет на них цену. Прайс-листов может быть
несколько, но активен в каждый момент ровно один. Раздел «Прайс-листы» добавляется в
профиль продавца (операции: создать / переименовать / выбрать активным / удалить, а в
самом прайсе — добавить деталь с ценой, удалить деталь, изменить цену, «Добавить
компоненты из справочника» — мультивыбор).

Ключевое архитектурное изменение: **цена убирается из каталога `part` полностью**.
Все цены живут только в позициях прайс-листов `price_list_item`. Это ломает сквозную
логику (цены сейчас читаются из `Part.price` во всех экранах), поэтому приложение
переезжает на **выбор продавца + серверную подстановку цены из его активного прайса**.

Со стороны конфигуратора/готовых ПК: пользователь выбирает продавца (селектор на
страницах каталога), и всё ценообразование (кастомные сборки, автоподбор, готовые ПК)
строится из активного прайс-листа выбранного продавца. Готовые ПК переносятся продавцу
по умолчанию **ConfiГУРЕ** и привязаны через `seller_id`.

## Принятые решения (интервью)

1. **Источник цены** — отдельная таблица `price_list_item`; `part.price_kopecks` полностью удаляется. Каталог `part.price` больше не существует.
2. **Без продавца** — сейчас всегда есть выбор продавца; по умолчанию **ConfiГУРА** (`usr-seller`, `user@company.com`). Гостевой просмотр без продавца и «что показывать гостю/клиенту без выбора» — отложено, решим позже.
3. **Сохранённые конфигурации** — снимок цены в `config_part.price_kopecks` (для кастомных/auto).
4. **Схема БД** — `price_list` (price_list_id, seller_id, name, is_active, created_at) + `price_list_item` (price_list_id, part_id, price_kopecks).
5. **Готовые ПК** — привязка через `ready_pc.seller_id`; все 4 существующих (Confi Office/Gaming/Pro/Value) → `usr-seller`.
6. **Продавец по умолчанию** — использовать существующий `usr-seller` (не создавать нового).
7. **Селектор продавца** — на страницах каталога («Готовые ПК», «Конфигуратор», «Автоподбор»); список — все аккаунты роли `seller` (GET /api/sellers).
8. **Активный прайс** — автоснятие флага у старого при активации нового; первый созданный прайс продавца становится активным.
9. **Удаление активного прайса** — разрешено; активным становится самый свежий из оставшихся (created_at), иначе продавец остаётся без активного (его товары недоступны).
10. **Редактирование** — переименование прайс-листа + операции с элементами (добавить/удалить/изменить цену/мультивыбор добавления из справочника).
11. **«Добавить компоненты из справочника» (мультивыбор)** — список отсутствующих в прайсе деталей каталога с чек-боксами + чек-бокс «добавить все»; выбранные добавляются ценой 0/пусто. Заменяет прежний `addAllMissing`.
12. **Цена 0/пусто = недоступно** — деталь с ценой 0 или отсутствующая в активном прайсе недоступна для заказа.
13. **Где применяется цена** — сервер принимает `sellerId` (в parts/ready/catalog/auto) и возвращает детали с ценой активного прайса данного продавца.
14. **Права** — управляет прайс-листами владелец-продавец или admin (как seller_brand).
15. **Готовые ПК пересчитываются** по активному прайсу продавца (не фикс цена).
16. **Миграция существующих данных** — заполнить `config_part.price_kopecks` снимком из старой `part.price_kopecks` до удаления колонки.
17. **Правило -5% (для кастомных и auto)** — при просмотре сохранённой конфигурации `source='custom'`/`'auto'` сравниваем снимок цены (`config_part.price_kopecks`) с актуальной ценой в **активном прайсе продавца**, у которого собрана конфигурация. Если различие **по модулю** больше 5% (`|snapshot − current| / current > 0.05`), помечаем «Цена может быть неактуальной» — и для конкретного компонента, и для всей сборки.
18. **`config.seller_id`** — конфигурация хранит продавца, из прайса которого собрана (для сравнения -5% и переоценки готовых). Новые сохраняются с seller_id выбранного продавца; существующим миграция ставит `usr-seller`.
19. **Готовые сборки в профиле живые** — сохранённые конфигурации `source='ready'` всегда переоцениваются по активному прайсу продавца (`config.seller_id`), без снимка и без пометки -5%.

## Область изменений

### БД и миграция (v7)

`db/schema.sql` → `user_version = 7`.

Новые таблицы:

```sql
CREATE TABLE IF NOT EXISTS price_list (
  price_list_id TEXT PRIMARY KEY,
  seller_id     TEXT NOT NULL,
  name          TEXT NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0,1)),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (seller_id, name),
  FOREIGN KEY (seller_id) REFERENCES user_account(user_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE IF NOT EXISTS price_list_item (
  price_list_id TEXT NOT NULL,
  part_id       TEXT,
  price_kopecks INTEGER NOT NULL DEFAULT 0 CHECK (price_kopecks >= 0),
  PRIMARY KEY (price_list_id, part_id),
  FOREIGN KEY (price_list_id) REFERENCES price_list(price_list_id) ON DELETE CASCADE,
  FOREIGN KEY (part_id) REFERENCES part(part_id) ON DELETE SET NULL
) STRICT, WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_price_list_seller ON price_list(seller_id);
CREATE INDEX IF NOT EXISTS idx_price_list_active ON price_list(seller_id, is_active);
CREATE INDEX IF NOT EXISTS idx_price_list_item_part ON price_list_item(part_id);
```

Изменения существующих таблиц:

- `part`: удалить колонку `price_kopecks` (и связанный CHECK).
- `config_part`: добавить колонку `price_kopecks INTEGER NOT NULL DEFAULT 0` — снимок цены на момент сборки (для custom/auto).
- `config`: добавить колонку `seller_id` (nullable FK → `user_account(user_id) ON DELETE SET NULL`) — продавец, из прайса которого собрана конфигурация.
- `ready_pc`: добавить колонку `seller_id` (nullable FK → `user_account(user_id) ON DELETE SET NULL`).

Новая идемпотентная миграция `db/migrate.ts::migratePriceLists` (rebase-рецепт для STRICT, как для v6):

1. Если таблицы `price_list`/`price_list_item` уже есть, `part` без `price_kopecks`, `config_part` с `price_kopecks`, `config.seller_id`, `ready_pc.seller_id` — no-op.
2. В транзакции (FK-less, temp-CREATE/INSERT/DROP/RENAME, `PRAGMA foreign_key_check`):
   - пересоздать `part` без `price_kopecks`;
   - пересоздать `config_part` с `price_kopecks`, заполнив снимок из **старой** `part.price_kopecks` (JOIN до удаления) — для всех конфигураций (источник готовых потом переоценится);
   - пересоздать `config` с `seller_id = 'usr-seller'` для всех строк;
   - пересоздать `ready_pc` с `seller_id = 'usr-seller'` для всех строк (перенос готовых ПК ConfiГУРЕ);
   - восстановить индексы (`idx_part_active` и т.д.).
   Вызывается из `db/init.js`, `db/seed.js`, `src/server/db.ts`, `tests/helpers/testDb.ts` (как остальные миграции).

Цена нулевая/пустая в `price_list_item.price_kopecks` = «недоступен для заказа» (см. решения).

### Backend — репозиторий

Новый файл `src/server/repository/price-list.ts` — `PriceListRepository`:

```ts
export interface PriceListItemDto { partId: string; price: number }   // rubles
export interface PriceListDto {
  id: string; name: string; isActive: boolean; createdAt: number;
  items: PriceListItemDto[];
}
export interface PriceListRepository {
  listPriceLists(sellerId: string): PriceListDto[];
  getPriceList(priceListId: string): PriceListDto | null;
  createPriceList(sellerId: string, name: string): PriceListDto;   // первый -> is_active=1
  renamePriceList(priceListId: string, name: string): PriceListDto | null;
  deletePriceList(priceListId: string): boolean;                  // активный: самый свежий становится активным
  setActivePriceList(priceListId: string): PriceListDto | null;   // снимает активность у прочих продавца
  upsertItem(priceListId: string, partId: string, price: number): PriceListDto | null; // insert/update позиции
  deleteItem(priceListId: string, partId: string): boolean;
  // Мультивыбор «Добавить компоненты из справочника»
  listMissingItems(sellerId: string, priceListId: string, includeInactive?: boolean): PartDto[];
  addItems(priceListId: string, partIds: string[]): { added: number };   // выбранные с ценой 0
  // резолв цен
  priceFor(priceListId: string, partId: string): number | null;
  activePriceListId(sellerId: string): string | null;
}
```

Правила:
- `createPriceList` — если у продавца 0 прайсов, is_active=1; иначе is_active=0.
- `setActivePriceList` — транзакцией: `UPDATE price_list SET is_active=0 WHERE seller_id=<seller>`, затем `UPDATE ... SET is_active=1 WHERE price_list_id=?` (сверяем seller).
- `deletePriceList` — удаляем; затем, если удалённый был активным, активируем самый свежий по `created_at` (`MAX(created_at)`).
- `listMissingItems` — детали каталога (`is_active=1`; админ может `includeInactive=1`), отсутствующие в `price_list_item` этого прайса. Возвращает как `PartDto` (без цены прайса) для отображения в мультивыборе.
- `addItems` — bulk-INSERT выбранных `partId` с `price_kopecks=0` (пропуская уже присутствующие). Возвращает число добавленных.
- `setActivePriceList`/`upsertItem`/`addItems` на несуществующем/чужом id — null/404.

### Backend — каталог: серверная подстановка цены из прайса

`catalog.ts` методы `listParts`, `getPart`, `listReadyPcs`, `getReadyPc`, `configPartsFor` (нужен резолв цены по прайсу). Добавляем параметр/контекст `sellerId`.

- `PartDto` больше не содержит `price` по умолчанию. Добавляем опциональный `price?: number` и `priceSet?: boolean`.
- Новая вспомогательная функция в репозитории: `attachPrices(parts, priceListId)` — берёт цены из `price_list_item` и проставляет `price` / `priceSet`. Детали без цены в прайсе или с ценой 0 → `available = false`.
- Если `priceListId` не передан, деталь приходит без цены (цена неопределена), `available` по-прежнему учитывает только `is_active`/`is_available`. Гостевой просмотр без цены — логика отложена (сейчас фронт по умолчанию выбирает ConfiГУРУ).
- `PartDto` `available` теперь = `isActive && isAvailable && (priceSet && price > 0)`, когда обязан прайс.

`ready_pc`:
- `listReadyPcs(sellerId?)`, `getReadyPc(id, sellerId?)` — возвращают только готовые выбранного продавца.
- `price` готовой ПК пересчитывается = сумма цен прайс-листов по деталям состава (не фиксированная `price_kopecks`). Позиция с ценой 0/отсутствующей → часть «недоступна».
- `ReadyPcDto.items` — позиции с применёнными ценами.

Конфигурации (`user-data.ts`):
- `configPartsFor(configId, sellerId?)`: для `source='ready'` цены подтягиваются ЖИВО из активного прайса `config.seller_id` (переоценка). Для `source='custom'|'auto'` возвращаются И снимок (`ConfigPartDto.price` из `config_part.price_kopecks`), И актуальная цена (`ConfigPartDto.currentPrice?` из `price_list_item` активного прайса `config.seller_id`) для пометки -5%.

### Backend — индекс.ts (маршруты)

- `GET /api/sellers` — список продавцов (id, name, company) — публичный, для селектора.
- `GET /api/parts[?category=][&includeInactive=1][&sellerId=]` — принимает `sellerId`, применяет прайс.
- `GET /api/ready[?sellerId=]`, `GET /api/ready/:id[?sellerId=]` — при `sellerId` готовые ПК этого продавца с переоценкой по прайсу.
- `GET /api/catalog` (используется автоподбором через `fetchCatalog`) — добавить `sellerId`.
- Конфигурации: `GET /api/configs[?userId=][&sellerId=]` и `GET /api/configs/:id` теперь возвращают для каждой part `price` (снимок для custom/auto, живая для ready) и `currentPrice` (для custom/auto).
- Прайс-листы (владелец или admin, аналог `sellerBrandActor` → `priceListActor`):
  - `GET /api/seller/:id/price-lists`
  - `POST /api/seller/:id/price-lists` (body: `{ name }`)
  - `PATCH /api/seller/:id/price-lists/:listId` (body: `{ name }`)
  - `DELETE /api/seller/:id/price-lists/:listId`
  - `POST /api/seller/:id/price-lists/:listId/activate`
  - `PUT /api/seller/:id/price-lists/:listId/items/:partId` (body `{ price }`) — добавить/изменить цену
  - `DELETE /api/seller/:id/price-lists/:listId/items/:partId`
  - `GET /api/seller/:id/price-lists/:listId/items/missing[?includeInactive=]` — список отсутствующих деталей (мультивыбор)
  - `POST /api/seller/:id/price-lists/:listId/items/bulk` (body `{ partIds: string[] }`) — добавление выбранных с ценой 0
- Обновить `createPart`/`updatePart`/`initializeCatalog`: убрать чтение/запись `price`. `CreatePartInput`/`UpdatePartInput` лишаются `priceKopecks`. `initializeCatalog` больше не пишет цену.

### Клиент — типы (`src/types/index.ts`)

- `Part`: убрать `price: number` (обязательный). Добавить `price?: number` и `priceSet?: boolean`.
- `ConfigPart`: добавить `price?: number` (снимок/живая для ready) и `currentPrice?: number` (актуальная цена из прайса; для пометки -5%).
- `Config`: добавить `sellerId?: string`.
- `ReadyPc`: `price` теперь вычисляется сервером (остаётся `price: number`), источник — прайс.
- Новые: `PriceList`, `PriceListItem`, `SellerSummary` (`{ id, name, company? }`).
- `SellerBrand` не трогаем.

### Клиент — чистая логика (юнит-тестируемая)

Новая функция в `src/lib/compatibility.ts` (или `format.ts`): `isPriceStale(snapshot, current): boolean` — `src > 0 && current > 0 && |snapshot − current| / current > 0.05`. Используется для пометки «Цена может быть неактуальной». Покрывается юнит-тестами (гейт `test:unit:cov`).

### Клиент — API (`src/lib/api.ts`)

- `fetchSellerSummaries(): Promise<SellerSummary[]>`.
- `fetchParts(category, includeInactive, sellerId)`, `fetchReadyPcs(sellerId)`, `fetchReadyPc(id, sellerId)`, `fetchCatalog(sellerId)` — прокинуть `sellerId` в query.
- Конфигурации: `fetchConfigs(userId, sellerId)` — передавать `sellerId` для живых/актуальных цен; маппинг `price`/`currentPrice`.
- Прайс-листы: `fetchPriceLists(sellerId)`, `createPriceList(sellerId, name)`, `renamePriceList(...)`, `deletePriceList(...)`, `setActivePriceList(...)`, `upsertPriceListItem(...)`, `deletePriceListItem(...)`, `fetchPriceListMissing(...)`, `addPriceListItems(priceListId, partIds)`.
- Маппинги DTO↔domain с учётом `price?/priceSet/currentPrice/sellerId`.

### Клиент — применение в экранах

- **Селектор продавца** — новый компонент `SellerPicker` (в шапке каталога, рядом с фильтрами; в конфигураторе — рядом со «Сводка»). Хранит выбранный `sellerId` в состоянии (по умолчанию ConfiГУРА — `usr-seller`; при пустом каталоге продавцов — fallback). Передаёт `sellerId` во все запросы и в сохраняемую конфигурацию.
- **CustomConfig / ComponentPicker / AutoResult / AutoSelect** — все `fetch*` с `sellerId`; `ComponentPicker` берёт цену из `Part.price` (уже подставлена сервером). Только детали с `priceSet && price>0` и `available` — выбираемы.
- **ReadyPCs / PcCard** — фильтры + карточки под выбранным продавцом; цены и «недоступно» из прайса.
- **CustomConfig**:
  - `selectPart`/`removePart` — цены берутся из `Part`.
  - `handleSave`/`checkout` — при формировании `config.parts` сохранять снимок цены `ConfigPart.price = part.price` и `config.sellerId`; сервер пишет `config_part.price_kopecks`.
  - `complete` — требует `priceSet && price>0` (конфигурация неполна без цены).

### Клиент — профиль покупателя (`Profile.tsx`, вкладка «Конфигурации»)

- Для загрузки `fetchConfigs(user.id, sellerId)` — `sellerId` можно брать из выбранного селектора или из `config.sellerId` (приоритет: выбранный продавец).
- **Кастомные/auto** (`source='custom'|'auto'`): показываем снимок цены. Для каждой части сравнить `part.price` (снимок) с `part.currentPrice` через `isPriceStale`: если true — бейдж **«Цена может быть неактуальной»** у компонента. Если хотя бы одна часть stale — тот же бейдж у ВСЕЙ сборки (рядом с итогом).
- **Готовые** (`source='ready'`): цены всегда переоценены по активному прайсу (живые), без снимка и без пометки -5%.
- `ConfigPartsTable` — поддержать опциональные бейджи «неактуально» для конкретной строки.

### Клиент — профиль продавца (`Profile.tsx` + новый `ProfilePriceLists.tsx`)

- В `tabsForRole('seller')`: «Бренды», **«Прайс-листы»**, «Компоненты». Для админа тоже добавить «Прайс-листы».
- Новый экран `ProfilePriceLists` (аналог `ProfileComponents`):
  - список прайс-листов продавца с бейджем «Активный» и суммарным числом позиций;
  - действия: «Активировать», «Переименовать», «Удалить», «Создать прайс-лист»;
  - при открытии прайса — таблица позиций (Компонент, Категория, Цена, Действия) + «Добавить компонент» (тип бля price) + **«Добавить компоненты из справочника»** + «Редактировать цену».
  - **«Добавить компоненты из справочника»**: открывает диалог со списком отсутствующих деталей (`fetchPriceListMissing`) с чек-боксами + чек-бокс **«Добавить все»**; по «Добавить» — `addPriceListItems(priceListId, выбранные partIds)`; после добавления цены у новых позиций 0/пусто.
  - Компонент единичного добавления выбирается из справочника (`fetchParts(undefined,true)` для owner) в модалке.

### Сеттинг / продавец по умолчанию

В `db/seed.js`, `tests/helpers/testDb.ts`, `src/server/db.ts`:

- Создать ConfiГУРЕ активный прайс-лист «Основной», содержащий **все** детали каталога с ценами из `mock.ts` (`part.price`). После этого `part` полностью без `price_kopecks`.
- `ready_pc` всех готовых привязать к `usr-seller` (в seed/`tests` готовые уже с `seller_id`).
- Убедиться, что `verify.sql` обновлён: убрать `part_price_kopecks`, добавить проверки `price_list`/`price_list_item`/`config_part.price`/`config.seller_id`/`ready_pc.seller_id`.

### Комплект тестов

- **Юнит**: `isPriceStale` (>5% по модулю, краевые ровно 5%, 0/пустые цены); прайсовое ценообразование — резолв цены, `priceSet`/недоступность при 0/отсутствии в прайсе, `listMissingItems`/`addItems` (bulk, «добавить все»), смена активности, снимок цены.
- **E2E** `tests/regression/price-lists.spec.ts`: CRUD прайса, активация, мультивыбор «Добавить компоненты из справочника» (чек-боксы + «добавить все»), цены в конфигураторе/заказе, недоступность при отсутствии детали, пометка «Цена может быть неактуальной» (>5%) для кастомной сборки и компонента, живые цены для готовой сборки в профиле.

## Риски и открытые вопросы

- **Гостевой просмотр цены без выбора продавца** — отложен. Клиент по умолчанию подставляет `usr-seller`, поэтому публичной страницы без цены при нормальном сценарии нет, но требуется аккуратная обработка `price===undefined` в отрисовке (не ронять), т.к. сервер может вернуть деталь без прайса.
- **Снимок цены в `config_part` + правило -5%**: снимок для custom/auto нужен именно для сравнения. Изменение активного прайса продавца не меняет снимок, но меняет `currentPrice`, что триггерит пометку при >5% — это ожидаемо.
- **Готовые сборки в профиле живые** (`source='ready'`): их цена зависит от активного прайса на момент просмотра; деталь, пропавшая из прайса, станет «недоступна».
- **Заказы** (`order_item.price_kopecks`) уже хранят снимок — не трогаем.
- **Раздел «Готовые сборки»** полностью (CRUD продавца) — вне зоны, только перенос существующих и привязка `seller_id`.
- **Права**: админ управляет прайсами любого продавца только через `/api/seller/:id/price-lists` (owner-or-admin).

## Порядок реализации

1. `db/schema.sql` (v7) + `db/migrate.ts::migratePriceLists` (пересоздать `part`/`config_part`/`config`/`ready_pc`, добавить `price_list*`).
2. Репо-слой: `price-list.ts` (новый) + правки `catalog.ts`/`user-data.ts` (резолв цены, переоценка ready, снимок+currentPrice, убрать price).
3. `index.ts`: маршруты прайс-листов (вкл. missing/bulk), `/sellers`, `sellerId` в каталогах и конфигах, убрать price из компонент.
4. `types/index.ts` + `isPriceStale` в `compatibility.ts` + `api.ts` (клиент).
5. `useSeller`/`SellerPicker` + правки `CustomConfig`, `ComponentPicker`, `AutoResult`, `AutoSelect`, `ReadyPCs`, `PcCard`, `Checkout`, `saveConfigAction`/`saveConfigRemote`.
6. `Profile.tsx` (вкладка «Конфигурации»): снимок vs currentPrice (-5%), готовые живые; `ProfilePriceLists.tsx` и вкладка прайс-листов у продавца/админа.
7. `db/seed.js`, `tests/helpers/testDb.ts`, `db/verify.sql` — ConfiГУРА активный прайс с ценами из mock, `config.seller_id`/`ready.seller_id`.
8. Юнит + e2e тесты; обновить существующие тесты, что ссылаются на `price_kopecks` в part.

## Валидация

- `npm run typecheck` (клиент+сервер).
- `npm run db:init` / `npm run db:verify` (миграция чиста, FK ok).
- `npm run test:unit:cov` (`isPriceStale` + прайсовые чистые функции).
- `npm run test:regression` — новые прайс-тесты + существующие не сломаны.
- Ручной: продавец ConfiГУРА → вкладка «Прайс-листы» → CRUD + мультивыбор; выбор продавца на /ready → переоценка; кастом с ценой → снимок в профиле → пометка -5% при изменении прайса; готовая сборка в профиле → живые цены.