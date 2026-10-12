# План: фото компонента из профиля продавца в карточке Конфигуратора

## Цель

Продавец и админ в профиле (вкладка «Компоненты») могут прикрепить к компоненту фото с диска
(PNG/JPEG/WebP/GIF, до 5 МБ) и удалить его. Фото сохраняется на сервере и отображается в
Конфигураторе: в карточке выбранного слота категории и в списке выбора компонента
(`ComponentPicker`). Все фото нормируются CSS к квадрату 64×64 (`object-fit: cover`) — размеры
карточек не меняются. Админ дополнительно в разделе «Администрирование» просматривает и удаляет
неиспользуемые загруженные фото.

## Что уже есть (не переделывать)

- Схема: `part.image_url TEXT` (`db/schema.sql`) — миграция не нужна.
- DAO/типы: `CreatePartInput.imageUrl`, `UpdatePartInput.imageUrl`, `partToDto` → `image`
  (`src/server/repository/*`).
- `POST /api/components` уже читает `body.image` → `imageUrl` (`src/server/index.ts:838`).
- Клиент: `PartApi.image` → `mapPart` → `Part.image` (`src/lib/api.ts`).
- `CreatePartInput`/`UpdatePartInput` в `src/lib/api.ts` уже содержат `image?`.

Выводы: бэкенд-плумбинг есть; отсутствуют (а) загрузка файла, (б) раздача статики,
(в) UI загрузки/предпросмотра, (г) рендер изображения, (д) `PATCH` не сохраняет `image`.

## Решения (утверждены)

1. **Хранение**: файл на диске в `uploads/` (корень репозитория, переопределяется `UPLOADS_DIR`),
   раздача статикой по `/api/uploads/<file>`; в `part.image_url` — относительный путь
   `/api/uploads/<file>`.
2. **Форматы/лимит**: PNG, JPEG, WebP, GIF; до 5 МБ. Проверка по MIME/расширению и «магическим
   байтам».
3. **Места вывода**: карточка слота в `CustomConfig` + список `ComponentPicker`.
4. **Нормирование**: CSS-квадрат 64×64, `object-fit: cover`, плейсхолдер-иконка при отсутствии фото.
5. **Готовые сборки** (`ready_pc.image_url`) — вне области задачи.

## Задачи

1. **Каталог загрузок и статика (сервер)**
   - В `src/server/index.ts` вычислить `root` (как в `src/server/db.ts`: `dirname(fileURLToPath(import.meta.url))` → `..`, `..`) и
     `UPLOADS_DIR = process.env.UPLOADS_DIR ?? join(root, "uploads")`; `mkdirSync(UPLOADS_DIR, { recursive: true })`.
   - Добавить `app.use("/api/uploads", express.static(UPLOADS_DIR, { fallthrough: true, maxAge: "1h" }))`
     до объявления API-маршрутов. Vite-прокси `/api` уже покрывает этот путь в dev и в Playwright.
   - Поднять лимит тела: `app.use(express.json({ limit: "8mb" }))` (base64 от 5 МБ ≈ 6.7 МБ).
2. **Эндпоинт загрузки `POST /api/uploads` (seller/admin)**
   - Гард `requireSellerOrAdmin(req, res)`.
   - Принять JSON `{ filename?: string; dataUrl: string }` (data-URL `data:image/...;base64,...`).
   - Валидировать: разрешённые MIME (`image/png`, `image/jpeg`, `image/webp`, `image/gif`);
     размер декодированного буфера ≤ 5 МБ; сигнатуру (magic bytes) каждого формата.
     Ошибки → `400 { error: "invalid_file_type" | "file_too_large" | "invalid_file" }`.
   - Сгенерировать безопасное имя `upload-<timestamp>-<random>.<ext>` (расширение из MIME, не из
     пользовательского имени) и записать файл.
   - Вернуть `201 { url: "/api/uploads/<file>" }`.
   - Небольшой локальный helper декодирования data-URL и проверки magic bytes (без новых зависимостей).
3. **Починить `PATCH /api/components/:id`**
   - Сейчас `body.image` игнорируется. Добавить:
     - `if (body.image !== undefined) patch.imageUrl = typeof body.image === "string" && body.image.trim() ? body.image.trim() : null;`
     - Пробрасывается в `catalog.updatePart` (там `patch.imageUrl` уже поддержан).
   - При замене/очистке изображения best-effort удалять прежний файл, если он начинается с `/api/uploads/`
     (иначе `null`), чтобы не копить сироты. Ошибку удаления игнорировать.
4. **Клиентский API (`src/lib/api.ts`)**
   - Добавить `uploadPartImage(dataUrl: string): Promise<string>` → `POST /uploads`, возвращает `url`.
   - Убедиться, что `createPart`/`updatePart` прокидывают `image` (уже есть в типах, поле должно
     заполняться в `ProfileComponents`).
5. **UI загрузки в `src/screens/ProfileComponents.tsx`**
   - Добавить `image: string` в `FormState` и `BLANK` (`""`).
   - В `openEdit`: `image: p.image ?? ""`.
   - В форме (`ComponentForm`) добавить поле «Фото компонента»:
     - `<input type="file" accept="image/png,image/jpeg,image/webp,image/gif">`;
     - при выборе: клиентская проверка типа и размера (≤5 МБ) → `FileReader.readAsDataURL` →
       `uploadPartImage(dataUrl)` → положить `url` в `form.image`;
     - предпросмотр через общий компонент `PartImage` (см. п.6) и кнопка «Удалить фото».
     - `alt`/aria: доступная подпись; поле не обязательное.
   - В `handleSave` включить `image: form.image || undefined` в payload для `createPart`/`updatePart`.
   - Ошибки загрузки показывать через `useToast` (не блокировать сохранение остальных полей).
6. **Общий компонент отображения `src/components/shared/PartImage.tsx`**
   - Props: `image?: string`, `alt: string`, `className?: string`.
   - Фиксированный контейнер `size-16 shrink-0 overflow-hidden rounded-md border bg-muted`
     (`64×64`), внутри `img` с `h-full w-full object-fit: cover` и `loading="lazy"`.
   - Нет `image` или `onError` → плейсхолдер-иконка (`lucide-react` `ImageOff`/`Package`),
     тот же размер, чтобы карточка не «прыгала».
7. **Интеграция рендера**
   - `src/screens/CustomConfig.tsx`: в карточке слота, рядом с названием/TDP выбранного компонента,
     вывести `<PartImage image={part.image} alt={part.name} />`.
   - `src/components/shared/ComponentPicker.tsx`: в строке каждой позиции добавить миниатюру
     `<PartImage image={p.image} alt={p.name} />` слева от названия.
   - Разметку строк сделать `items-center` и сохранить поведение блокировки/цены.
8. **Админ: просмотр и удаление неиспользуемых фото**
   - **Сервер (в `src/server/index.ts`, только `requireAdmin`)**:
     - `GET /api/admin/uploads` → список файлов в `UPLOADS_DIR`:
       `{ file, url, size, modifiedAt, used, partId?, partName? }[]`.
       `used` = есть `part.image_url` с этим url; `partId`/`partName` — первая ссылающаяся позиция.
       Ссылки берём из БД: `SELECT part_id, name, image_url FROM part WHERE image_url LIKE '/api/uploads/%'`.
     - `DELETE /api/admin/uploads/:file` → удалить файл. Имя валидируется (только basename, без `..`,
       расширение из allowlist). Если файл используется → `409 { error: "file_in_use" }`.
       Иначе `204`. Неизвестный файл → `404`.
     - `POST /api/admin/uploads/prune` → удалить **все** неиспользуемые файлы; вернуть
       `{ deleted: number, freedBytes: number }` (основное действие кнопки «Удалить неиспользуемые»).
     - Best-effort: игнорировать гонки (файл уже удалён), вернуть фактический счётчик.
   - **UI (`src/screens/Admin.tsx`, раздел «Администрирование», под таблицей пользователей)** —
     новая секция «Загруженные фото»:
     - кнопка «Обновить» и «Удалить неиспользуемые» (вызывает `prune`, с подтверждением в `Modal`);
     - список/таблица: миниатюра (фиксированный квадрат 64×64, `object-fit: cover`), имя файла,
       размер, дата, бейдж «Используется» (с названием компонента) / «Не используется»;
     - у неиспользуемых — кнопка «Удалить» (по одному); у используемых — кнопка disabled с подсказкой;
     - состояния загрузки/пустой список через `EmptyState`.
   - **Клиентский API (`src/lib/api.ts`)**: `fetchUploads()`, `deleteUpload(file)`, `pruneUploads()`.
   - Секция рендерится и в standalone `/admin`, и во вкладке профиля (Admin `embedded`).
9. **Прочее**
   - `.gitignore`: добавить `uploads/`.
   - Тестовый сервер Playwright (`tests/helpers/testDb.ts` / `playwright.config.ts`): прокинуть
     `UPLOADS_DIR` на `.test-data/uploads`, чтобы не писать в рабочий каталог (`.test-data/` уже в
     `.gitignore`).
   - Обновить `README.md`: хранение изображений компонентов и раздача `/api/uploads`.

## Критерии приёмки

- Продавец/админ в `/profile/components` создаёт/редактирует компонент и прикрепляет фото
  PNG/JPEG/WebP/GIF; фото сохраняется (файл в `uploads/`, путь в `part.image_url`).
- Файлы >5 МБ и не-изображения отклоняются с понятной ошибкой, компонент не ломается.
- В `CustomConfig` у выбранного компонента виден квадрат 64×64; у компонента без фото — плейсхолдер;
  высота/ширина карточки одинакова с фото и без.
- В `ComponentPicker` у позиций видны миниатюры того же фиксированного размера.
- `PATCH` сохраняет и очищает фото; повторный вход в редактирование показывает актуальное фото.
- Гость/клиент не могут загружать (403 на `POST /api/uploads`).
- Админ в «Администрировании» видит список загруженных фото с признаком используемости, может
  удалить отдельный неиспользуемый файл и все неиспользуемые сразу; используемый файл удалить нельзя
  (409). После удаления файла карточка компонента показывает плейсхолдер.

## Валидация

- `npm run typecheck` (клиент + сервер) и `npm run test:typecheck`.
- `npm run test:unit` — без регрессий.
- Вручную: `npm start`, вход `user@company.com`, загрузка/удаление фото → проверка `/config` и
  модалки выбора; вход админом → проверка раздела «Загруженные фото».
- Добавить/расширить `tests/regression/components.spec.ts`: загрузка валидного файла через
  `POST /api/uploads` (продавец) → `201` и `url`; создание компонента с `image`; `403` для клиента на
  загрузку; отображение `img` в конфигураторе после выбора компонента. Прогон `npm run test:regression`.
- Добавить проверки `GET/DELETE /api/admin/uploads` и `POST /api/admin/uploads/prune`: админ видит
  `used=true` у привязанного файла, удаление используемого → `409`, удаление неиспользуемого → `204`,
  prune возвращает счётчик; клиент/продавец → `403`.

## Риски и заметки

- **Лимит тела запроса**: глобальный `8mb` упрощает, но увеличивает допустимый размер любого JSON;
  для демо приемлемо. Альтернатива — отдельный `express.json({ limit })` только на `/api/uploads`.
- **Осиротевшие файлы**: админский раздел закрывает эту проблему; автоматическая очистка при замене
  фото в компоненте остаётся best-effort.
- **Общие загрузки без владельца**: файлы не привязаны к продавцу — продавец может использовать файл,
  загруженный другим. Для демо осознанно; при необходимости позже добавить `owner_seller_id`.
- **Безопасность**: имя файла генерируется сервером, расширение — из allowlist; SVG сознательно
  исключён (XSS-риск). Для `GET/DELETE /api/admin/uploads/:file` имя — только basename и allowlist.
- **`initializeCatalog`** затирает `image` компонентов из `mock.ts` (там поля `image` нет → `null`);
  это существующее поведение, отдельно не меняем.