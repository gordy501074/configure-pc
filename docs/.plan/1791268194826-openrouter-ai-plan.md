# План: подключение OpenRouter (AI) — фото и краткое описание компонента

## Цель

Добавить в Confi переиспользуемый серверный слой для вызовов OpenRouter.ai и первые две задачи
в форме компонента (`/profile/components`, роли `seller`/`admin`):

1. **Поиск фото компонента** в веб через модель + скачивание найденного изображения в
   `uploads/` и запись в `part.image_url`.
2. **Краткое описание компонента** (1–2 предложения, RU) для карточки → новое поле `part.description`.

Архитектура закладывается так, чтобы этот же слой использовался для других AI-задач.

## Утверждённые решения

- **Транспорт:** официальный `@openrouter/sdk` (гибрид — SDK поверх прокси). При заданном
  `OPENROUTER_PROXY`/`HTTPS_PROXY` SDK получает кастомный `HTTPClient`/`fetcher` с `undici` `ProxyAgent`.
  Без прокси — нативный fetch SDK.
- **Результаты:** `part.description` (новое поле) + скачивание картинки в `uploads/` → существующее
  `part.image_url`. Отдельной таблицы нет.
- **Запуск:** только в форме компонента, две кнопки («Найти фото (AI)», «Описание (AI)»). Без массовых операций.
- **API:** синхронный JSON (не SSE).

## Опорные факты по коду

- `@openrouter/sdk` ESM-only, совместим с Node 18/20/22; `new OpenRouter({ apiKey, httpClient, serverURL, httpReferer, appTitle })`;
  `HTTPClient` принимает кастомный `fetcher`; `chat.send(...)` умеет `stream`.
- В Confi **нет** загрузчика `.env`: сервер читает только `process.env` (`src/server/index.ts:35,1550`, `src/server/db.ts:12`).
- Загрузки изображений уже есть: `POST /api/uploads` (data-URL → файл в `uploads/`, magic-bytes, ≤5 МБ),
  раздача `/api/uploads/<file>`, `part.image_url` прокинут через DAO/API/клиент (`PartImage.tsx`).
- Поля `description` у `part` **нет**; схема `db/schema.sql` — `user_version=11`.
- Миграции — идемпотентные функции в `db/migrate.ts`, вызываются из `db/init.js`, `db/seed.js`,
  `src/server/db.ts`, `tests/helpers/testDb.ts`.
- `CreatePartInput`/`UpdatePartInput` — `src/server/repository/catalog.ts:17,29`; `PartRow`/`PartDto`/`partToDto` — `src/server/repository/types.ts:62,79,289`; клиент — `src/lib/api.ts:56,71`.
- Форма компонента — `src/screens/ProfileComponents.tsx` (`FormState`, `ComponentForm`, `handleSave`).
- Запуск dev — `scripts/dev-app.mjs` (`node --experimental-strip-types src/server/index.ts`), Vite прокси `/api → :8787`.

## Задачи

1. **Зависимости и `.env`**
   - `npm i @openrouter/sdk dotenv` (+ `undici` — только для прокси-режима; при отсутствии прокси не импортируется).
   - В начале `src/server/index.ts` добавить `import "dotenv/config";` (до чтения `process.env`).
   - `.gitignore`: добавить `.env` (учесть `.env.*`; при необходимости `!.env.example`).
   - Создать `.env.example` с пустыми значениями: `OPENROUTER_API_KEY=`, `OPENROUTER_MODEL=`,
     `OPENROUTER_IMAGE_MODEL=`, `OPENROUTER_APP_URL=`, `OPENROUTER_TITLE=`, `HTTPS_PROXY=`/`HTTP_PROXY=`.
   - Обновить `README.md`: переменные окружения, запуск, где взять ключ.

2. **Переиспользуемый AI-клиент `src/server/ai/openrouter.ts`**
   - `isAiConfigured(): boolean` — есть ли `OPENROUTER_API_KEY`.
   - `getClient(): OpenRouter` — ленивый singleton; `apiKey`, `httpReferer` (`OPENROUTER_APP_URL`, по умолчанию `http://localhost:5173`), `appTitle` (`OPENROUTER_TITLE`, по умолчанию `Confi`).
   - Прокси: если `HTTPS_PROXY||HTTP_PROXY` заданы — собрать агента. **Проверено (Node 24 + SDK 1.4.22 + undici):** нельзя передавать SDK-`Request` напрямую в `undici.fetch(req, {dispatcher})` (двойной realm → «Failed to parse URL») и нельзя `fetch(req, {dispatcher})` (Node игнорирует `dispatcher` → идёт напрямую). Рабочий приём — реконструкция: `fetcher(req) = undici.fetch(req.url, { method, headers, body, dispatcher })` с буфером тела (только для не-GET/HEAD). Проверено: `models.list` возвращает реальные модели, `chat.send` доходит до API (401 с фиктивным ключом, а не IP-403).
   - `getTextModel()`/`getImageModel()` из env с дефолтами.
   - Обобщённый `chatJson<T>({ system, user, model, temperature })` — non-stream `chat.send`, парсит JSON из ответа (устойчиво к ```json-обёрткам), бросает понятную ошибку при неуспехе. Ключ **никогда** не логируется.
   - Таймаут (напр. 30–60 c) и ретрай не более 1–2 раз на сетевые ошибки.

3. **Сервис задач `src/server/ai/component-ai.ts`**
   - `describeComponent(input): Promise<string>` — system-промпт (RU, 1–2 предложения, без выдуманных цифр, только переданные name/category/specs); возвращает текст.
   - `findComponentImage(input): Promise<string>` — запрос к модели с включённым веб-поиском (плагин), инструкция вернуть JSON `{ candidates: string[] }` с прямыми URL изображений товара; сервер перебирает кандидатов: `https` → HEAD/GET с `content-type: image/*` и лимитом ≤5 МБ → проверка magic-bytes (переиспользовать `matchesMagic`/логику из `index.ts`) → сохранить в `uploads/` тем же неймингом, что `POST /api/uploads` → вернуть `/api/uploads/<file>`.
   - **SSRF-защита при скачивании:** только `https`, запрет private/loopback/link-local/metadata адресов (после DNS-резолва), лимит редиректов (≤3), таймаут, лимит размера.
   - **Проверка на этапе реализации:** точное имя поля веб-плагина в типах `@openrouter/sdk` (`plugins`/`web_search_options`). Если SDK-типы не содержат плагин — использовать типизированный `chat.send` с приведением или fallback на «image generation»-модель; зафиксировать выбранный вариант и дефолтную модель в `.env.example`.

4. **Схема и DAO (`description`)**
   - `db/schema.sql`: добавить `description TEXT` в `part`; поднять `PRAGMA user_version = 12`.
   - `db/migrate.ts`: `migratePartDescription(db)` — идемпотентно (`PRAGMA table_info(part)`; `ALTER TABLE part ADD COLUMN description TEXT`), nullable → STRICT-совместимо.
   - Вызвать миграцию в `db/init.js`, `db/seed.js`, `src/server/db.ts`, `tests/helpers/testDb.ts`.
   - `src/server/repository/types.ts`: `PartRow.description: string | null`, `PartDto.description?: string`, включить в `partToDto`.
   - `src/server/repository/catalog.ts`: `CreatePartInput.description?`, `UpdatePartInput.description?`; включить `description` в INSERT/UPDATE (`createPart`, `updatePart`).
   - `db/seed.js`: `insertPart` — добавить `description` (по умолчанию `null`), не ломая upsert.

5. **API-эндпоинты (сервер) — гвард `requireSellerOrAdmin`**
   - `POST /api/ai/component-description` body `{ category, name, brand, specs }` → `{ description }`.
   - `POST /api/ai/component-image` body тот же → `{ url }` (уже сохранённый файл).
   - Нет ключа → `503 { error: "ai_not_configured" }`; ошибка OpenRouter → `502 { error: "ai_failed" }`; валидация тела → `400`.
   - В `POST /api/components` и `PATCH /api/components/:id`: читать `body.description` (строка → trim; пустая → `null`), прокидывать в DAO (по аналогии с `image`).

6. **Клиентский API и типы**
   - `src/lib/api.ts`: `PartApi.description?`, `mapPart` → `Part.description`; добавить `description` в типы create/update; новые `generateComponentDescription(input)` и `findComponentImage(input)`.
   - `src/types/index.ts`: `Part.description?: string`.

7. **UI формы `src/screens/ProfileComponents.tsx`**
   - `FormState`: `description: string` (в `BLANK` — `""`); `openEdit` — `p.description ?? ""`.
   - Поле-`Textarea` «Краткое описание (для карточки)».
   - Кнопки рядом с полями: «Найти фото (AI)» и «Описание (AI)» — `type="button"`, состояние `loading`,
     при успехе `set("image", url)` / `set("description", text)`, ошибки — через `useToast`.
   - `handleSave`: передавать `description: form.description.trim() || ""` (очистка `""` → `null` на сервере).
   - Кнопки disabled при пустом имени/вендоре; недоступны, если AI не сконфигурирован (можно вернуть флаг в `/api/health` или обрабатывать `503` тостом).

8. **Показ описания (по желанию, минимально)**
   - Вывести `description` в `ComponentPicker` и карточке слота `CustomConfig` под названием (если задано).
   - Вне области: генерация описаний/фото для `ready_pc`.

## Критерии приёмки

- Продавец/админ в форме компонента нажимает «Описание (AI)» → поле заполняется кратким RU-описанием; сохраняется в `part.description` и возвращается API.
- Кнопка «Найти фото (AI)» находит валидное изображение, скачивает в `uploads/`, поле фото заполняется; карточка показывает миниатюру.
- При отсутствии `OPENROUTER_API_KEY` эндпоинты дают `503`, UI показывает понятную ошибку (без фейковых данных).
- Гость/клиент получают `403` на `/api/ai/*`; ключ никогда не попадает на фронтенд и в логи.
- Некорректный/слишком большой/не-изображение URL кандидата не сохраняется; перебор идёт к следующему кандидату.
- Миграция идемпотентна на существующей БД (`user_version` 11→12), повторный запуск не ломает данные.

## Валидация

- `npm run typecheck` и `npm run test:typecheck`.
- `npm run test:unit` — без регрессий; добавить unit-тесты на (а) парсинг JSON-ответа модели, (б) SSRF-валидацию URL и magic-bytes.
- `npm run test:regression` (+ расширить `tests/regression/components.spec.ts`): `403` для клиента на `/api/ai/*`, `503` без ключа, `POST/PATCH /api/components` принимает и сохраняет `description`.
- Вручную: `npm start`, вход `user@company.com` → `/profile/components` → создать/редактировать компонент,
  нажать обе AI-кнопки, сохранить, проверить `/config` и модалку выбора.

## Риски и заметки

- **Надёжность и лицензии веб-картинок:** модель может вернуть недостоверные/битые URL; для демо
  перебираем кандидатов и валидируем. При необходимости позже заменить на генерацию изображения
  (модальность `image`) — слой задач это позволит.
- **SSRF:** скачивание произвольных URL — обязательны https-only, блок private/metadata IP, лимиты размера/редиректов/таймаута.
- **Незаверенная типизация плагина веб-поиска** в SDK — проверить на этапе реализации; предусмотреть fallback.
- **Прокси:** в окружении без прокси OpenRouter может отвечать `403` (как в dataset-analyzer) — тогда задать
  `HTTPS_PROXY`/`OPENROUTER_PROXY`; в остальных случаях прокси не нужен.
- **Гибрид проверен в этом окружении (2026-10-06):** прямой доступ → `403`, через `127.0.0.1:12334` → `200`.
  SDK-`models.list` и `chat.send` через кастомный fetcher доходят до API. Работает ТОЛЬКО стратегия реконструкции
  `Request` → `undici.fetch(url, { method, headers, body, dispatcher })`; варианты «напрямую Request в undici.fetch»
  и «глобальный fetch(..., {dispatcher})» не работают. `node:undici` в Node 24 недоступен как модуль → нужна
  зависимость `undici` (или `https-proxy-agent`).
- **Стоимость/латентность:** non-stream вызовы короткие; заложить таймаут и не блокировать UI (loading-состояния).
- **Безопасность ключа:** только `src/server`, через `dotenv`; в git — лишь `.env.example`.
- Существующие `createPart`/`updatePart` и `POST /api/components` не должны регрессировать по `image`/`compat`/`specs`.