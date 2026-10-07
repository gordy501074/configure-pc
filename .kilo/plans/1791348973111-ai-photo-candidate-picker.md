# План: интерактивный выбор фото из кандидатов AI (не более 5)

## Цель

Сейчас при нажатии «Найти фото (AI)» сервер сам выбирает **первое** валидное изображение
из найденных страниц и возвращает один URL синхронным ответом. Нужно:

1. Скачивать **все** валидные кандидаты (не более 5) и давать пользователю выбрать одну
   фотографию для карточки компонента.
2. Сделать процесс **интерактивным**: показывать прогресс (метка фазы + миниатюры,
   появляющиеся по мере загрузки), **countdown** оставшегося времени и кнопку **Стоп**.
   Если найден ровно один кандидат — выбрать автоматически без модалки.

## Утверждённые решения

- **Транспорт.** Один `POST /api/ai/component-image` возвращает поток **NDJSON**
  (`application/x-ndjson`): строки-события прогресса. Клиент читает через `fetch` +
  `ReadableStream`; **отмена** — через `AbortController` (обрыв соединения; сервер
  обрабатывает `req/res` `close`). Без job-стора, без новых зависимостей. `EventSource`
  не подходит (не умеет POST/тело).
- **Countdown.** Сервер в первом событии отдаёт общий бюджет времени (`deadlineMs`,
  напр. 45 c). Клиент показывает обратный отсчёт от него. По достижении 0 сервер сам
  прекращает работу и шлёт `done`. Кнопка «Стоп» завершает раньше.
- **Остановка.** Прерывает оставшуюся работу; уже скачанные кандидаты сохраняются.
  Если ≥1 кандидат — открывается модалка с ними; если 0 — тост «Поиск остановлен».
- **UI.** Одна «живая» модалка `ImageCandidatePicker`, открывается по клику: countdown,
  статус/фаза, миниатюры появляются по мере загрузки и сразу выбираемы, кнопка «Стоп».
  Выбор миниатюры заполняет фото и очищает остальных.
- **Прогресс.** Фаза поиска страниц (один opaque non-stream вызов модели) — спиннер +
  метка фазы; далее по каждому скачанному кандидату — событие, миниатюра появляется.
  Никаких выдуманных процентов.
- **Один кандидат.** Если найден ровно 1 валидный — сразу `set("image", url)`, тост
  «Фото найдено», модалка не открывается (или закрывается мгновенно).
- **Неиспользованные файлы.** После выбора/при отмене невыбранные кандидаты удаляются
  best-effort эндпоинтом discard (только если на файл не ссылается ни один `part`).
- **Лимит.** Не более 5 кандидатов (по одному `og:image` на страницу, страниц ≤5).

## Опорные факты по коду

- `src/server/ai/component-ai.ts`
  - `findComponentImage(input, uploadsDir)` (95–135): модель отдаёт до 5 URL **страниц**
    товара (`{"pages":[...]}`, system 99–111), цикл 120–130 берёт **первый** успешный:
    `fetchPageImageUrl` → `downloadAndSaveImage` → `return url`.
  - `fetchPageImageUrl` (268–306) — SSRF-валидированный фетч HTML → `extractOgImage`.
  - `extractOgImage` (309–324).
  - `downloadAndSaveImage` (172–223) — безопасная загрузка (https, public-IP, ≤3 редиректа,
    таймаут 15 c, ≤5 МБ, content-type image/*, magic-bytes) → `/api/uploads/<file>`.
  - Уже есть `AbortController` (117), `IMAGE_SEARCH_DEADLINE_MS = 30_000` (27).
- `src/server/ai/openrouter.ts`
  - `chatComplete` (179–214) — **non-streaming** вызов (`stream: false`), таймаут
    `REQUEST_TIMEOUT_MS = 90_000` (26), ретраи `MAX_RETRIES = 1`. Фаза поиска страниц —
    один такой вызов, поэтому её внутренний прогресс недоступен.
  - `isAiConfigured` (47), `AiNotConfiguredError`, `AiRequestError`.
- `src/server/index.ts`
  - `POST /api/ai/component-image` (258–272) → `findComponentImage` → `{ url }`; нет URL → 502.
  - `POST /api/components` (966–993), `PATCH /api/components/:id` (995–1067): `image` →
    `image_url`; удаление заменённого файла, если на него больше никто не ссылается (1060–1065).
  - `safeUploadPath` (176–183), `deleteUploadByUrl` (186–196), `uploadReferences()` (1122–1133).
  - Admin delete/prune (1163–1207). `parseAiBody` (220–230), `sendAiError` (232–241),
    `requireSellerOrAdmin`.
  - У `ai/component-ai.ts` уже есть `AbortController` — новый стриминг переиспользует
    `AbortSignal` в `fetchPageImageUrl`/`downloadAndSaveImage` (они принимают `outerSignal`).
- `src/lib/api.ts`
  - `req<T>` (27–52) — обычный JSON `fetch`, не подходит для стрима (читает `res.json()`).
  - `findComponentImage(input): Promise<string>` (824–830).
- `src/screens/ProfileComponents.tsx`
  - `handleAiImage` (387–402): `const url = await findComponentImage(aiInput()); set("image", url); toast("Фото найдено")`.
  - Состояние `aiBusy: null | "description" | "image"` (191); поле фото в `ComponentForm`
    (782–815): `PartImage` + file input + кнопка «Найти фото (AI)» (797–806) + «Удалить фото».
- UI-паттерны: `src/components/ui/Modal.tsx`, `src/components/shared/ComponentPicker.tsx`,
  `PartImage.tsx`. Vite-прокси `/api → :8787` (`vite.config.ts:15`) — стрим проходит
  (без буферизации по умолчанию; при необходимости слать heartbeat-комментарии).
- Тесты: `tests/regression/components.spec.ts` — 403 (193–201), 503 без ключа (203–229),
  персистенция description (231+). Успешный фото-ответ сейчас не тестируется, поэтому
  менять формат безопасно. Playwright `request.post` не читает стрим — для discard-тестов
  используем обычный JSON-эндпоинт.

## Протокол стрима (события NDJSON)

Каждая строка — отдельный JSON-объект; порядок:

- `{ "event": "start", "deadlineMs": 45000 }` — первым; клиент запускает countdown.
- `{ "event": "phase", "phase": "search_pages" }` — идёт поиск страниц моделью
  (фронт: спиннер + «Ищу страницы товара…»).
- `{ "event": "phase", "phase": "download", "pages": N }` — началась загрузка (N страниц).
- `{ "event": "candidate", "url": "/api/uploads/<file>", "index": K }` — кандидат скачан
  (фронт: добавляет миниатюру, K из 5).
- `{ "event": "done", "urls": [...] }` — завершение (успех/дедлайн/стоп). `urls` —
  все валидные кандидаты (0..5).
- `{ "event": "error", "error": "ai_not_configured" | "ai_failed" }` — ошибка.
  При `ai_not_configured` соединение закрывается сразу (клиент мапит на тост).

Если соединение оборвано клиентом (`req`/`res` `close`, `req.destroyed`), сервер
абортит `AbortController` и прекращает загрузку; уже скачанные файлы остаются (клиент
их сохранит и покажет, либо удалит через discard).

## Задачи

### 1. Сервер: стриминг кандидатов (`src/server/ai/component-ai.ts`)
- Добавить `streamComponentImages(input, uploadsDir, opts): AsyncGenerator<ImageEvent>`
  (или колбэк-вариант `onEvent`), где `ImageEvent` — объединение из протокола выше.
  Логика на базе текущей 95–135, но:
  - Сначала отдаёт `start`/`phase: search_pages`, затем вызывает `chatJson` для страниц.
  - Перебирает страницы (лимит `MAX_IMAGE_CANDIDATES = 5`), для каждой:
    `phase: download` (один раз, с числом страниц), затем `fetchPageImageUrl` →
    `downloadAndSaveImage` → `yield { event: "candidate", url, index }`. Дедуп по URL.
  - Общий `AbortController` + `deadlineMs` (вынести константу, поднять до ~45 c, т.к.
    качается до 5 файлов). Абсолютный дедлайн: таймер абортит signal и завершает цикл.
  - Принимать внешний `AbortSignal` (обрыв соединения) — комбинировать через
    `AbortSignal.any([...])`.
  - Всегда завершать `done` с накопленным массивом (на дедлайне/стопе — что успели).
- Оставить/удалить `findComponentImage`; предпочтительно заменить вызов в эндпоинте новым
  генератором. Учесть покрытие `tests/unit/ssrf.test.ts` (импортирует `extractOgImage`) —
  его не трогать.

### 2. Сервер: эндпоинт стрима (`src/server/index.ts`)
- `POST /api/ai/component-image` (258–272): гварды как сейчас (`requireSellerOrAdmin`,
  `parseAiBody`, `invalid_input`, `isAiConfigured` → 503).
  - Выставить заголовки: `Content-Type: application/x-ndjson; charset=utf-8`,
    `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`,
    затем `res.flushHeaders?.()`.
  - Писать события строками `JSON.stringify(ev) + "\n"`; `res.flush()` после каждого,
    если доступно (Express 5/Node).
  - Слушать `req.on("close", …)` (и `res.on("close", …)`): если соединение оборвано до
    `done`, абортить внутренний контроллер.
  - По завершении `res.end()`. Ошибки: `ai_not_configured` → событие `error`; прочие —
    `error: ai_failed`. Не бросать необработанные промисы.
- Новый `POST /api/ai/component-image/discard` (обычный JSON, `requireSellerOrAdmin`):
  тело `{ urls: string[] }`; валидировать префикс `/api/uploads/`; для каждого URL
  пропустить, если на файл ссылается `part` (`SELECT 1 FROM part WHERE image_url = ? LIMIT 1`),
  иначе `deleteUploadByUrl(url)`. Best-effort, `{ ok: true }`.
- `POST/PATCH /api/components` не менять — выбранный кандидат сохраняется как обычный `image`.

### 3. Клиентский API (`src/lib/api.ts`)
- Добавить `streamComponentImages(input, { signal, onEvent }): Promise<string[]>`:
  - `fetch(`${BASE}/ai/component-image`, { method: "POST", headers, body, signal })`.
  - Если `!res.ok` (не 200) — прочитать JSON и бросить `Error(error)` как `req` (для
    случая, когда стрим не стартовал: 400/403/503).
  - Получить `res.body!.getReader()`, декодировать `TextDecoder`, буферизовать по `\n`,
    парсить каждое событие; вызывать `onEvent(ev)`; накапливать `candidate.url`.
  - Возвращать итоговый массив `urls` из `done` (или накопленный при обрыве).
- Добавить `discardComponentImages(urls: string[]): Promise<void>` →
  `POST /ai/component-image/discard`.
- `findComponentImage` заменить/удалить по факту использования.

### 4. UI: живая модалка `src/components/shared/ImageCandidatePicker.tsx`
- Пропсы: `{ open, onClose, onSelect, onStop, status, phase, deadlineMs, candidates, error }`.
  - `status`: `"searching" | "done" | "error"`.
  - `candidates`: массив `{ url, index }` (по мере поступления).
  - `deadlineMs`: бюджет; внутри — локальный countdown (тикает `setInterval` 1 c от
    момента `start`, показывает «Осталось ~Ns»), обнуление → вызвать `onStop` (или
    дождаться серверного `done`).
  - Кнопка «Стоп» — пока `status === "searching"`; клик → `onStop()` (аборт fetch).
- Сетка миниатюр (до 5) на базе `PartImage` (`zoomable={false}`); клик по картинке —
  `onSelect(url)`. Пока пусто — `Skeleton`/спиннер + текст фазы.
- По завершении без кандидатов — сообщение «Ничего не найдено» + «Закрыть».
- `Modal` по умолчанию `sm:max-w-lg`; при желании добавить необязательный `className`.

### 5. UI-оркестрация (`src/screens/ProfileComponents.tsx`)
- Состояния: `pickerOpen`, `imageStatus`, `imagePhase`, `imageDeadlineMs`,
  `imageCandidates: {url,index}[]`, `imageError`, `abortRef` (`useRef<AbortController>`).
- `handleAiImage`:
  - Валидация имени/вендора как сейчас; `aiBusy = "image"`.
  - `abortRef.current = new AbortController()`; открыть модалку (`pickerOpen=true`,
    `status="searching"`, очистить кандидатов/ошибку).
  - `await streamComponentImages(aiInput(), { signal, onEvent })`:
    - `start` → `setImageDeadlineMs(ev.deadlineMs)`; `phase` → `setImagePhase`;
    - `candidate` → добавить в `imageCandidates`;
    - `done` → `setImageCandidates(ev.urls)`; `error` → `setImageError`.
  - После: `aiBusy = null`. Если `urls.length === 1` → `set("image", urls[0])`,
    закрыть модалку, тост «Фото найдено». Если `> 1` → `status="done"`, оставить модалку
    для выбора. Если `0` → `status="done"` (или `error` при ошибке) с сообщением.
  - Ошибки `ai_not_configured`/`ai_failed` → `handleAiError` (тост) и закрыть модалку.
- `handlePickCandidate(url)`: `set("image", url)`, закрыть, тост «Фото найдено»,
  `void discardComponentImages(остальные)`.
- `handleStopSearch()`: `abortRef.current?.abort()`; дождаться/использовать уже
  собранных кандидатов; если ≥1 → оставить модалку с ними (status `done`), иначе
  закрыть с тостом «Поиск остановлен».
- `handleClosePicker()` (крестик/бэкдроп): аборт незавершённого поиска; если кандидаты
  не выбраны — `void discardComponentImages(all)`.
- Отрисовать `<ImageCandidatePicker …/>` рядом с модалкой формы.
- Существующие «Удалить фото»/ручную загрузку/`handleImageFile` не трогать.
- Обновить `ComponentForm`-пропсы/кнопку «Найти фото (AI)» при необходимости только для
  состояния `loading` (модалка берёт прогресс на себя).

### 6. Тесты и документация
- `tests/regression/components.spec.ts`: 403/503 не ломать. Добавить:
  - `POST /api/ai/component-image/discard` — клиент → 403; пустой/невалидный `urls`
    не удаляет; неиспользуемый `/api/uploads/<file>` удаляется, используемый — нет.
  - `503` для `component-image` остаётся (стрим не стартует → обычный JSON-ответ до
    установки заголовков стрима; **важно**: проверку `isAiConfigured` делать ДО
    `flushHeaders`, чтобы 503 был обычным JSON).
- Unit (опционально): чистая функция-парсер NDJSON-чанков (неполные строки, несколько
  событий в одном чанке) — если выносится отдельно.
- `README.md` (AI-раздел ~246): описать поток NDJSON, события, countdown/стоп и
  discard-эндпоинт.

## Пограничные случаи и failure modes
- 0 кандидатов → модалка «Ничего не найдено», тост/сообщение; `502` больше не нужен для
  «пусто», но эндпоинт стрима возвращает `done` с `[]`.
- 1 кандидат → без модалки/с мгновенным закрытием.
- Обрыв соединения (закрытие вкладки/навигация) → сервер абортит загрузку; orphan-файлы
  подчищает discard (если клиент успел) или admin prune.
- Дедлайн истёк → сервер шлёт `done` с уже найденными; UI останавливает countdown.
- `ai_not_configured` → 503 **до** старта стрима (обычный JSON), UI-тост.
- Прокси/буферизация: `X-Accel-Buffering: no` + `res.flush()`; при необходимости — heartbeat.
- Повторный запуск при открытых кандидатах → прежние удаляются через discard.

## Валидация
- `npm run typecheck` и `npm run test:typecheck`.
- `npm run test:unit` — без регрессий (в т.ч. `ssrf.test.ts`).
- `npm run test:regression` — AI 403/503 проходят; новый тест discard.
- Вручную: `npm start`, `user@company.com` → `/profile/components` → компонент →
  «Найти фото (AI)»: видеть countdown, появляющиеся миниатюры, «Стоп» прерывает и
  сохраняет найденное; выбор миниатюры заполняет `PartImage`; закрытие без выбора и
  повторный запуск не копят orphan-файлы; Admin → «Загруженные фото» чист.
- Проверить стрим через dev-прокси Vite (не буферизуется).

## Вне области
- Массовые операции/`ready_pc`, генерация изображений, изменение SSRF/лимитов загрузки,
  re-discovery страниц сверх 5, сохранение кандидатов между перезагрузками (job-store),
  перевод на SSE/WebSocket.