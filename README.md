# AI CodeBase Agent (RAG)

Интеллектуальная система для анализа локальных кодовых баз с использованием RAG (Retrieval-Augmented Generation).

## Архитектура

Проект построен по принципу монорепозитория:
- **`apps/backend`**: NestJS-приложение, индексирующее код, хранящее векторы в LanceDB и метаданные в SQLite; `LlmService` взаимодействует с OpenAI-compatible API.
- **`apps/frontend`**: React-приложение (Vite) в стиле Windows 11 с интеграцией Monaco Editor.
- **`packages/shared`**: Общие типы и утилиты.

## Настройка окружения и API

Backend загружает и сохраняет `apps/backend/.env` независимо от текущей рабочей директории; образец — `apps/backend/.env.example`. Корневой `.env` не используется. Перед первым запуском создайте конфиг, не перезаписывая существующий файл и значения:

```powershell
if (-not (Test-Path apps/backend/.env)) { Copy-Item apps/backend/.env.example apps/backend/.env }
```

В `apps/backend/.env` задаются переменные:

```dotenv
ADMIN_LOGIN=admin
ADMIN_PASSWORD=
LLM_API_KEY=
LLM_BASE_URL=https://polza.ai/api/v1
LLM_CHAT_MODEL=openai/gpt-4.1
LLM_EMBEDDING_MODEL=perplexity/pplx-embed-v1-4b
```

`ADMIN_PASSWORD` и `LLM_API_KEY` оставляются пустыми до ручной настройки. Установите уникальный безопасный пароль администратора до входа: пустые логин или пароль запрещают авторизацию. Корневой `password.txt` остаётся gitignored источником локального пароля администратора; задайте пароль в `ADMIN_PASSWORD` файла `apps/backend/.env`. API-ключ настраивает только администратор через пункт «Настройка API» в header после входа. При создании конфигурации существующие значения не перезаписываются; старые `OPENROUTER_*` переменные автоматически не мигрируются. Ключ не возвращается API и не сохраняется в браузерном хранилище.

Для настройки/смены ключа администратор входит с `ADMIN_LOGIN` и `ADMIN_PASSWORD`; обычный пользователь видит только статус наличия ключа и сообщение обратиться к администратору.

Контракт API настроек:
- `GET /api/settings/status` → `{hasApiKey}`.
- `POST /api/settings/admin/login` с `{login,password}` → `{token,expiresAt}`, где `expiresAt` — Unix epoch в миллисекундах.
- `POST /api/settings/admin/logout` с `Authorization: Bearer <token>` → `{success:true}`.
- `POST /api/settings/api-key` с Bearer token и `{apiKey}` → `{success:true}`.
- `GET /api/settings/indexes/status` с Bearer token → `{embeddingModel,storedEmbeddingModel,requiresReset,indexedProjects,indexedChunks}`.
- `POST /api/settings/indexes/reset` с Bearer token и `{confirm:true}` → `{success:true}`; во время любой активной индексации отвечает HTTP 409.

Раздел администратора «Индексы» показывает статус и запускает только явный двухшаговый сброс с подтверждением/отменой и предупреждением о необходимости переиндексации. Fingerprint `{baseUrl,embeddingModel}` хранится в SQLite; смена base URL/модели (в том числе той же размерности) и legacy-индексы без metadata требуют сброса. Сбрасываются общая LanceDB chunks table/schema и cache, а также SQLite `files`/`chunks` всех проектов; `projects`, `conversations`, `messages` и история сохраняются, проекты переводятся в `idle`, `lastIndexedAt` становится `null`. Автоматического удаления нет.

Token — случайный bearer token, хранится только в runtime-памяти frontend/backend, действует 1 час, не сохраняется в browser storage и аннулируется при logout или restart backend. Попытки входа ограничиваются. API key и пароль не возвращаются в ответах API; token выдаётся только при успешном входе администратора.

`npm run clean:data` может удалить локальные данные и историю: используйте эту команду только после проверки содержимого и при осознанной необходимости.

## Запуск проекта

### Предварительные требования
- Node.js 18 или новее
- npm

### Установка зависимостей
```powershell
npm install
```

### Запуск в режиме разработки

Откройте два отдельных терминала PowerShell в корне репозитория. В первом запустите backend командой `npm run dev` (корневой скрипт запускает только backend). Во втором запустите frontend командой `npm run dev:frontend`.

### Проверки и production-сборка

TypeScript-проверки:

```powershell
npx tsc --noEmit -p apps/backend/tsconfig.json
npx tsc --noEmit -p apps/frontend/tsconfig.json
```

Тесты:

```powershell
npm run test:run --workspace @aicodebase/backend
npm run test:run --workspace @aicodebase/frontend -- --config src/__tests__/vitest.config.ts
```

Для браузерной проверки с настоящим Polza API см. [инструкцию E2E](scripts/e2e/README.md).
Она использует отдельную тестовую БД, сохраняет ключ в `apps/backend/.env` и выполняет платные запросы.
Последний обезличенный результат: `reports/e2e/latest.json`.
Проверка переноса конфигурации, сброса индексов и высоты полей без платных запросов описана там же; её результат — `reports/e2e/maintenance.json`.

Обычная production-сборка из корня:

```powershell
npm run build
```

### Production и Docker

Для production HTTPS обязателен для входа администратора и передачи API-ключа. Храните `apps/backend/.env` вне Git и ограничьте права доступа к нему backend-процессом. Администраторская авторизация защищает настройки и ключ, но не превращает основной чат и остальные операции приложения в многопользовательски защищённые: ACL не добавляется, приложение остаётся доверенным локальным RAG-инструментом. Целевой Docker bind mount: `./apps/backend/.env:/app/apps/backend/.env` с доступом на чтение и запись. На обычной файловой системе запись выполняется атомарной заменой файла; при single-file Docker bind mount применяется запись на месте с резервной копией и восстановлением при ошибке, поэтому абсолютная атомарность для этого сценария не гарантируется. Сам Docker-конфиг здесь не изменён.


## Основные возможности
- Гибридный поиск по коду (семантический + полнотекстовый).
- Индексация локальных директорий.
- Чат с контекстом вашего кода.
- Просмотр файлов через встроенный Monaco Editor.
- Отдельная администраторская панель настройки LLM API.

## Как попробовать
1. Администратор входит в пункт «Настройка API» в header и вводит API-ключ; обычный пользователь видит статус и указание обратиться к администратору.
2. Выберите папку исследуемого проекта.
3. Нажмите «Индексировать» и дождитесь завершения.
4. Задайте вопрос по коду и нажмите «Отправить».
5. Выбирайте релевантные ответы и смотрите код в Monaco Editor.
