# Рефакторинг модели совместимости справочника компонентов (Confi)

## Контекст

Справочник компонентов живёт в `src/data/mock.ts` (8 категорий), сeядится в SQLite
(`db/confi.db`, таблица `part`, колонка `compat_json`) через `db/seed.js` и
`tests/helpers/testDb.ts`. Движок совместимости — `src/lib/compatibility.ts`; автоподбор
— `src/lib/survey.ts`.

**Проблемы текущей модели:**
1. Маркеры механики «плоско» лежат на `Part`, но при персисте/отдаче перекладываются
   через 4 формы: плоские поля mock → `compat_json` (JSON) → `PartDto` (плоские) →
   клиентский `mapPart` (спред). Дублирование источника истины и риск рассинхрона.
2. PSU непоследовательно использует то `psuForm` (`psu-650`, `psu-600-sfx`), то `formFactor`
   (`psu-750/850/1000`). Движок читает только `psuForm` (`compatibility.ts:114`), поэтому
   seed/testDb вынуждены нормализовывать через `psuFormOf()`.
3. `baseWattage` и `includesCooler` объявлены (`src/types`, `PartApi`, `PartDto`) и проходят
   сквозь seed/API, но не влияют ни на одно правило совместимости.

**Решение (согласовано):** вложенный типизированный документ `Part.compat` (`PartCompat`)
как единая форма маркеров от mock → `compat_json` → API → клиент. Схема БД/контракт
меняются; формат `compat_json` получает версию (`{ v: 2, ... }`). Неиспользуемые
`baseWattage`/`includesCooler` удаляются. Нормализуется psu-форм-фактор (только `psuForm`).

---

## Задача 1. Единый тип `PartCompat` и доменная структура `Part`

**Файлы:** `src/types/index.ts`, `src/server/repository/types.ts`, `src/lib/api.ts`.

- В `src/types/index.ts` ввести:
  ```ts
  export type FormFactor = "ATX" | "mATX" | "ITX";
  export type RamType = "DDR4" | "DDR5";
  export type PsuForm = "ATX" | "SFX";

  export interface PartCompat {
    socket?: string;
    chipset?: string;
    ramType?: RamType;
    psuForm?: PsuForm;
    power?: number;              // только PSU
    formFactor?: FormFactor;     // MB / Case
    gpuLength?: number;          // GPU
    cpuCoolerMaxHeight?: number; // Case
    coolTdp?: number;            // Cooler
    sizeMm?: number;             // Cooler
    benches?: { label: string; score: number }[];
  }
  ```
- Убрать с `Part` плоские маркеры (`socket`, `chipset`, `ramType`, `psuForm`, `power`,
  `formFactor`, `gpuLength`, `cpuCoolerMaxHeight`, `coolTdp`, `sizeMm`, `benches`,
  `includesCooler`, `baseWattage`); добавить `compat: PartCompat`.
- `fieldOffset` на клиенте: добавить хелпер «compat из Part» не требуется — читать
  `part.compat.*`.

## Задача 2. Модель и нормализация PSU в mock-данных

**Файл:** `src/data/mock.ts`.

- У всех PSU убрать `formFactor`, оставить только `compat.psuForm` (`ATX` для 650/750/850/1000,
  `SFX` для `psu-600-sfx`).
- Все компоненты перевести с плоских маркеров на `compat: { ... }` (по категориям):
  - cpu: `compat.socket`, `compat.benches`
  - gpu: `compat.benches`, `compat.gpuLength`
  - motherboard: `compat.socket`, `compat.chipset`, `compat.ramType`, `compat.formFactor`
  - ram: `compat.ramType`
  - case: `compat.formFactor`, `compat.gpuLength`, `compat.cpuCoolerMaxHeight`
  - psu: `compat.psuForm`, `compat.power`
  - cooler: `compat.coolTdp`, `compat.sizeMm`
  - storage: `compat: {}` (маркеров нет)
- `benches` переносим в `compat.benches`. Поля-спеки `tdp`, `price`, `specs` остаются плоскими.

## Задача 3. Сервер: `part`-схема, seed и DAO

**Файлы:** `db/schema.sql`, `db/seed.js`, `tests/helpers/testDb.ts`, `src/server/repository/types.ts`.

- `db/schema.sql`: колонку `compat_json` комментарием пометить как хранилище `PartCompat`
  (формат JSON). Дополнительно `PRAGMA user_version` поднять до `5`.
- Удалить `psuFormOf()` из `db/seed.js` и `tests/helpers/testDb.ts` — `psuForm` теперь единственный
  вариант. `compatJson(p)` = `JSON.stringify({ v: 2, ...p.compat })`.
- В `src/server/repository/types.ts`:
  - `Compat` → переименовать/привести к доменному `PartCompat` (зеркало).
  - `PartRow.compat_json` остаётся строкой; `PartDto` получает `compat: PartCompat`
    (вместо плоских полей). Убрать `includesCooler`/`baseWattage`.
  - `partToDto()` парсит `compat_json`, отдаёт `compat` (v-флаг игнорируется при чтении;
    при отсутствии `v` или `compat` — деградировать к `{}`).
- `db/verify.js`/`db/verify.sql` и `db/backup.js` — только если затрагивают `compat_json`
  текстом (не затрагивают): оставить без изменений.

## Задача 4. Движок совместимости и автоподбор

**Файлы:** `src/lib/compatibility.ts`, `src/lib/survey.ts`.

- `compatibility.ts`: все обращения к маркерам заменить на `part.compat.*`:
  - `cpu.compat.socket`, `motherboard.compat.socket`
  - `cpu.tdp` (остаётся плоским) vs `cooler.compat.coolTdp`
  - `motherboard.compat.ramType` vs `ram.compat.ramType`
  - рейтинг форм-фактора: `motherboard.compat.formFactor`, `pcCase.compat.formFactor`
  - `gpu.compat.gpuLength` vs `pcCase.compat.gpuLength`
  - `cooler.compat.sizeMm` (>100 башни) vs `pcCase.compat.cpuCoolerMaxHeight`
  - `psu.compat.power` vs Σ `tdp×1.6`
  - `psu.compat.psuForm !== "SFX"` при `pcCase.compat.formFactor === "ITX"`
- `survey.ts`: 
  - cpuPool по `p.compat.socket`
  - `m.socket` → `m.compat.socket`
  - `r.ramType` → `r.compat.ramType`, `chosen.motherboard.compat.ramType`
  - `c.formFactor` → `c.compat.formFactor`, `chosen.motherboard.compat.formFactor`
  - `p.power` → `p.compat.power`
  - `c.coolTdp` → `c.compat.coolTdp`
  - benches-скоры: `p.benches` → `p.compat.benches`

## Задача 5. Клиент: `PartApi`, `mapPart` и все потребители

**Файлы:** `src/lib/api.ts`, `src/components/shared/ComponentPicker.tsx` и любые UI, что читают маркеры.

- `PartApi` зеркалит `PartCompat` (без плоских полей).
- `mapPart` убирает спред compat-полей и переносит только `compat`.
- Пройтись по `grep` на `.socket`, `.ramType`, `.psuForm`, `.power`, `.formFactor`, `.gpuLength`,
  `.cpuCoolerMaxHeight`, `.coolTdp`, `.sizeMm`, `.benches`, `.includesCooler`, `.baseWattage`
  по `src/` и поправить все потребители на `part.compat.*` (включая `ComponentPicker`, если там
  есть чтение маркеров — проверяется grep'ом).

## Задача 6. Юнит- и E2E-тесты

**Файлы:** `tests/unit/compatibility.test.ts`, `tests/regression/custom-config.spec.ts` и др.,
что строят модели/полагаются на контракт.

- `compatibility.test.ts` работает с `components` из mock — перевести `cat()` и asserts на
  новую структуру (маркеры в `part.compat`). Логика правил не меняется, изменяются лишь пути доступа.
- Проверить E2E-кейсы в `custom-config.spec.ts` / `browse-configure.spec.ts`, что не используют
  плоские поля напрямую (обычно нет — идут через UI/API), при необходимости обновить.
- `grep` по `tests/` на `.socket|.ramType|.psuForm|.formFactor|compat` чтобы убедиться, что
  testDb/спеки не зависят от старой формы.

## Задача 7. Документация

**Файлы:** `README.md`, `doc/base_prompt_v3.txt` (если актуализируется), `db/schema.sql` (комменты), `src/types/index.ts` (JSDoc `PartCompat`).

- README: раздел «Живая проверка совместимости» (стр. ~14) и «Структура проекта» — упомянуть
  `Part.compat`; список маркеров привести к новой структуре; убрать упоминания
  `baseWattage`/`includesCooler`, если фигурируют.
- Привести JSDoc/комментарии «Compat markers ... reconstructed from compat_json» к новой форме.

---

## Порядок выполнения / риски

Выполнять строго по задачам 1→7 (структура-типы → данные → сервер → движок → клиент → тесты → docs).
Этапность важна, т.к. сервер/клиент зависят от доменного типа.

**Риски:**
- Поломка типов повсюду при вводе `Part.compat`; вероятно, `npm run typecheck` будет сыпать, пока
  не сойдутся тип → mock → сервер → клиент. Нормально для единой задачи.
- PSU-форм-фактор: если где-то (не seed) ещё читают `psu.formFactor` как psu-форм-фактор, это
  потеряется — grep `formFactor` по `src/`/`tests/` обязателен (см. Task 4/5/6).
- `compat_json` в существующих БД: старое содержимое (плоский объект без `v:2`) должно читаться
  устойчиво (парсер не падает на отсутствии полей). Чтение деградирует к `{}`; повторный seed
  перезапишет корректно. Backward-compat парсинг — в `partToDto`.

**Обучитель:** нет выхода для частичных изменений — нормализация атомарна по типу.

## Валидация

1. `npm run typecheck` — строки типов клиента и сервера.
2. `npm run db:seed` затем `npm run db:verify` — каталог сеется с вложенным compat; counts/FK чистые.
3. `npm run test:unit:cov` — юнит-покрытие `compatibility.ts` ≥99% (правила не меняются, но пути
   доступа да — тесты обязаны пройти).
4. `npm run test:smoke` (+ `test:regression` при желании) — ручной конфигуратор:
   блокировка несовместимых (сокет, DDR, форм-факторы, SFX-ITX), автоподбор.
5. `npm run server` + `curl`/`GET /api/parts` — в JSON ответа должен присутствовать `compat`
   (вложенный) и отсутствовать прежние плоские маркеры.

## Вне области видимости
- Новые правила совместимости (storage↔MB M.2/SATA, GPU↔коннекторы, BIOS-совместимость CPU).
- Изменение wire-контракта на уровне отдельных колонок БД (маркеры остаются упакованы в `compat_json`).
- Рендер-изменения UI.