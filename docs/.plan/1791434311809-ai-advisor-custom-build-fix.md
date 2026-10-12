# План: AI-бот — кастомная сборка со списком, ценой и устойчивый ответ

## 1. Цель

Починить два дефекта AI-бота подбора (`/auto` → вкладка «Подбор с помощью AI-бота»):

1. **Кастомная сборка недостижима.** `recommend()` всегда отдаёт готовую сборку, если в
   каталоге есть хоть одна валидная, поэтому запрос «список компонентов + общая стоимость»
   кастомной сборки никогда не выполняется.
2. **«Иногда не отвечает».** Если модель не дописала служебный JSON-конверт (или он не
   распарсился), ход завершается без рекомендации; резервный `chatJson`-вызов на извлечение
   требований, заложенный в исходном плане, не реализован.

## 2. Зафиксированные решения (по итогам уточнений)

| Вопрос | Решение |
| --- | --- |
| Когда предлагать кастом | **Детерминированный жёсткий фит.** Готовая предлагается ТОЛЬКО если она валидна, укладывается в бюджет (перерасход ≤ ×1.15) **и** совпадает назначение (`pc.usage === usage` или `pc.usage === "universal"`). Иначе — кастом. LLM на выбор не влияет. |
| Порог перерасхода | **×1.15** (жёсткий). |
| Нет бюджета | Кастом по назначению/интересам (движок использует дефолтный расчётный бюджет). Готовая без бюджета не предлагается. |
| «Не отвечает» | **Резервный `chatJson`**: при отсутствии/непарсимости конверта — второй дешёвый вызов на извлечение `{requirements, ready}` по той же истории. |
| Формат выдачи кастома | **Карточка + текстовый список.** Сервер детерминированно добавляет текстовый блок (строки «Категория — Название — Цена», «Итого: X ₽») в ответ как `delta`; рядом UI рендерит существующую карточку `ConfigPartsTable`. |

## 3. Диагноз (доказательства)

- `src/lib/aiAdvisor.ts:352-362` (`recommend`): `if (ready) return {kind:"ready"}` — кастом
  ветка ниже недостижима, пока `rankReadyBuilds` возвращает не-`null`. А он возвращает
  не-`null` для первой валидной сборки (скор стартует с `-Infinity`, `aiAdvisor.ts:178-202`).
- Сид содержит 5 валидных готовых сборок (`src/data/mock.ts:669-786`), значит кастом не
  предлагается практически никогда.
- `src/server/ai/pc-advisor.ts:191-195`: при `envelope === null` → `{event:"done"}` без
  рекомендации. Фолбэка нет.
- Карточка кастома уже готова: `src/screens/AutoChat.tsx:277-313` (`ConfigPartsTable` +
  `formatPrice(configStats.totalPrice)`); менять разметку не требуется.

## 4. Изменения по файлам

### `src/lib/aiAdvisor.ts` (движок; самодостаточен, покрыт юнитами)

1. Импортировать `CATEGORY_LABELS` из `./format.ts` (у `format.ts` нет проблемных импортов —
   безопасно для `node:test` и для NodeNext-сервера; использовать расширение `.ts`).
2. Добавить константу `const READY_BUDGET_TOLERANCE = 1.15;`.
3. Добавить экспортируемый предикат:
   ```ts
   export function readyBuildFits(pc: ReadyPc, req: AdvisorRequirements): boolean {
     if (pc.valid === false || pc.price <= 0) return false;
     if (req.budget === undefined) return false;                 // нет бюджета → не готовая
     if (pc.price > req.budget * READY_BUDGET_TOLERANCE) return false;
     const usage = usageFromInterests(req);
     return pc.usage === usage || pc.usage === "universal";
   }
   ```
4. Переписать `recommend(req, catalog)`:
   ```ts
   const fitting = catalog.ready.filter((pc) => readyBuildFits(pc, req));
   const ready = rankReadyBuilds(fitting, req);
   if (ready) return { kind: "ready", readyPc: ready, summary: readySummary(ready) };
   const config = buildAdvisorConfig(req, catalog);
   return { kind: "custom", config, summary: advisorTitle(req, config.usage) };
   ```
   (`rankReadyBuilds` уже сам фильтрует `valid`/`price`, повторный фильтр безвреден.)
5. Добавить детерминированный форматтер кастома:
   ```ts
   export function formatConfigText(config: Config): string {
     const fmt = (v: number) => new Intl.NumberFormat("ru-RU").format(v) + " ₽";
     const lines = config.parts.map(({ category, part }) => {
       const label = CATEGORY_LABELS[category] ?? category;
       return part ? `• ${label}: ${part.name} — ${fmt(part.price ?? 0)}`
                   : `• ${label}: недоступен`;
     });
     const total = config.parts.reduce((s, p) => s + (p.part?.price ?? 0), 0);
     return `Состав сборки:\n${lines.join("\n")}\nИтого: ${fmt(total)}.`;
   }
   ```

### `src/server/ai/openrouter.ts`

6. Добавить необязательный `signal?: AbortSignal` в `ChatInput` (`openrouter.ts:165-172`).
7. В `chatComplete` прокидывать сигнал в SDK:
   `client.chat.send({ chatRequest: {...} }, input.signal ? { signal: input.signal } : undefined)`.
   `chatJson<T>` использует `chatComplete`, поэтому фолбэк автоматически прерывается по дедлайну.

### `src/server/ai/pc-advisor.ts`

8. Добавить функцию резервного извлечения (использует существующий `chatJson`):
   ```ts
   async function extractRequirementsFallback(messages, signal) {
     const transcript = messages
       .map((m) => `${m.role === "user" ? "Пользователь" : "Ассистент"}: ${m.content}`)
       .join("\n");
     const system = "Ты извлекаешь структурированные требования из диалога подбора ПК. "
       + "Верни СТРОГО JSON {\"requirements\":{...},\"ready\":bool}. Не выдумывай данные.";
     return chatJson<{ requirements?: unknown; ready?: boolean }>({
       system, user: transcript, model: getChatModel(), temperature: 0, signal,
     });
   }
   ```
   Импортировать `chatJson` из `./openrouter.ts`.
9. В `streamAdvisorReply` после стрима: если `envelope === null` и не было abort —
   вызвать `extractRequirementsFallback(input.messages, deadlineController.signal)` внутри
   `try/catch` (ошибку игнорировать → просто `{event:"done"}`). Результат использовать как
   `envelope` (тот же путь нормализации).
10. Перед выдачей рекомендации: если `visible` пуст, эмитить короткий детерминированный
    `delta`-лид («Готово! Вот подобранная конфигурация:»).
11. В ветке `custom`: перед событием `recommendation` эмитить
    `{event:"delta", text:"\n\n" + formatConfigText(rec.config)}`, затем событие
    `recommendation` (структура события не меняется — UI уже умеет рендерить карточку).
    Сохранить существующий гвард `rec.config.parts.length === 0` → `{event:"done"}`.

### `src/types/index.ts`

Изменений не требуется (событие `recommendation` уже поддерживает `config`+`summary`).

### `src/screens/AutoChat.tsx`

Изменений логики не требуется; проверить, что текстовый `delta` со списком попадает в
пузырь, а карточка рендерится (уже реализовано, `AutoChat.tsx:277-313`).

## 5. Тесты

### `tests/unit/aiAdvisor.test.ts`
- Обновить кейсы `recommend` под новую семантику:
  - бюджет + совпадающее назначение в пределах ×1.15 → `ready`;
  - перерасход > ×1.15 → `custom`;
  - назначение не совпадает (`gaming` при бюджете под офис) → `custom`;
  - `req.budget === undefined` → `custom`.
- Добавить кейсы `readyBuildFits` (валидность, отсутствие бюджета, граница ровно ×1.15,
  `universal`).
- Добавить кейсы `formatConfigText`: содержит по строке на каждый слот, метки категорий,
  «Итого»-строку и суммарную цену.

### `tests/regression/ai-advisor.spec.ts`
- Новый кейс: замокать NDJSON-поток с `recommendation.kind="custom"` и `config` (8 частей,
  цены > 0) + `delta`-блок со списком; проверить, что в `role="log"` виден список компонентов
  и «Итого», а карточка «Рекомендация готова» показывает `ConfigPartsTable` и общую цену,
  и есть кнопка «Открыть / оформить».
- Существующие кейсы (ready-recommendation, envelope, 503/429) должны остаться зелёными.

### Гейты
- `test:unit:cov` (`aiAdvisor.ts` в include; держать 100% строк по новым функциям).
- `test:typecheck`, `typecheck`, `build`.
- `test:regression`.

## 6. Риски и митигации

| Риск | Митигация |
| --- | --- |
| Жёсткий фит слишком часто уходит в кастом | Порог ×1.15 и совпадение назначения/universal — по решению пользователя; поведение детерминировано и покрыто юнитами, порог — одна константа. |
| Резервный `chatJson` удваивает стоимость хода | Вызывается ТОЛЬКО при отсутствии конверта; модель `getChatModel()`, `temperature:0`, ограничен тем же дедлайном 45 с и сигналом. |
| `signal` в `chatComplete` меняет поведение существующих вызовов | Параметр необязательный; при отсутствии — прежний путь (`client.chat.send(obj)`). |
| Текстовый список дублирует карточку | По решению пользователя — осознанное дублирование; список попадает и в контекст следующего хода LLM. |
| Цены/наличие | Список строится только по данным активного прайса, уже отфильтрованным в загрузчике каталога. |

## 7. Порядок работ

1. `src/lib/aiAdvisor.ts`: `readyBuildFits`, новая `recommend`, `formatConfigText`, импорт `CATEGORY_LABELS`.
2. `src/server/ai/openrouter.ts`: `signal` в `ChatInput` + проброс в SDK.
3. `src/server/ai/pc-advisor.ts`: `extractRequirementsFallback`, пустой-лид, `delta`-список для кастома.
4. Обновить/добавить юнит-тесты `tests/unit/aiAdvisor.test.ts`.
5. Добавить регресс-тест кастома в `tests/regression/ai-advisor.spec.ts` (опц. дополнить README).
6. Прогнать гейты: `test:unit:cov`, `test:typecheck`, `typecheck`, `build`, `test:regression`.

## 8. Критерии готовности

1. При требованиях, где готовая не укладывается в бюджет ×1.15 или назначение не совпало,
   бот выдаёт **кастомную** сборку: текстовый список компонентов + «Итого: X ₽» и карточку с
   `ConfigPartsTable` и общей стоимостью.
2. Готовая предлагается только при жёстком совпадении (бюджет ≤ ×1.15 и назначение/universal).
3. Без бюджета — кастом по интересам с конкретным составом и ценой.
4. Если модель не прислала конверт, резервный `chatJson` извлекает требования и выполняет
   п.1–3 (без «пустого» ответа); при провале обоих — корректный `done`/`error`, без зависания.
5. Гейты `test:unit:cov`, `test:typecheck`, `typecheck`, `build`, `test:regression` — зелёные.