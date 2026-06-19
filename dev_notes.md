# Dev Notes

Краткий журнал ключевых изменений проекта AICodeBase.

## Журнал изменений

### 2024-06-19 — Актуализация управления API Key и документации

**Область:** Architecture | Backend | Frontend | Documentation

**Что изменилось:**
- Восстановлена и актуализирована информация о возможности настройки OpenRouter API Key через UI на главной форме.
- Обновлен `README.md`: добавлена структура проекта, инструкции по запуску и описание способов настройки API-ключа.
- Уточнено поведение системы: ключ из UI имеет приоритет в рамках сессии, но не сохраняется в `.env`.
- Исправлено описание в `dev_notes.md`, которое ранее ошибочно утверждало об удалении формы ввода.

**Затронутые пути:**
- `README.md`
- `dev_notes.md`
- `apps/frontend/src/App.tsx`

**Зачем / контекст:**
- Обеспечение гибкости настройки для пользователей, не желающих править файлы конфигурации.
- Приведение документации в соответствие с фактическим состоянием кодовой базы.

### 2026-06-17 — Исправление ошибки типов в LanceDB

**Область:** Backend | Infra

**Что изменилось:**
- Исправлена ошибка `TypeError: Cannot read properties of undefined (reading 'map')` в `OpenRouterService.createEmbeddings()`
- Добавлена проверка `result.data` перед вызовом `.map()` в методе `createEmbeddings`
- Добавлена проверка `embeddings[index]` на массив в `IndexingService`
- Добавлена защита от `undefined` в векторах при создании чанков
- Обновлена документация с описанием изменений

**Затронутые пути:**
- `apps/backend/src/services/openrouter.service.ts`
- `apps/backend/src/services/indexing.service.ts`
- `dev_notes.md`
- `README.md`

**Зачем / контекст:**
- Устранение ошибки, возникающей при индексации, когда embeddings API возвращал неожиданную структуру данных
- Повышение устойчивости системы к некорректным ответам от OpenRouter API

### 2026-06-16 — Рефакторинг управления API Key

**Область:** Architecture | Backend | Frontend

**Что изменилось:**
- Перенос хранения OpenRouter API Key из сессии (runtime memory) в переменные окружения (`.env`).
- В `SettingsService` добавлена поддержка инициализации ключа из `process.env.OPENROUTER_API_KEY`.
- Установлена зависимость `dotenv` в backend.
- *Примечание: Форма ввода на фронтенде сохранена для динамической настройки.*

**Затронутые пути:**
- `apps/backend/package.json`
- `apps/backend/src/services/settings.service.ts`
- `apps/frontend/src/App.tsx`
- `README.md`

**Зачем / контекст:**
- Устранение CORS-ошибок при попытке сохранения ключа через API.
- Упрощение конфигурации приложения перед запуском.

### 2026-06-15 — MVP AI RAG code-agent (frontend + backend)

**Область:** Architecture | Backend | Frontend | Infra

**Что изменилось:**
- Создана monorepo-структура: `apps/frontend`, `apps/backend`, `packages/shared`.
- Реализован NestJS backend с endpoint'ами настроек, выбора проекта, индексации, статуса, retrieval, chat и выдачи сниппета.
- Добавлен локальный SQLite storage (`projects/files/chunks/conversations/messages`), сканер файлов с ignore/security-правилами, chunking и инкрементальная переиндексация по hash.
- Добавлена OpenRouter-интеграция (embeddings + chat completion) with timeout/retry и безопасной обработкой ошибок.
- Реализован SSE-поток событий прогресса индексации.
- Реализован React/Vite frontend в стиле Windows 11: layout 40/60, блок API key (masked), выбор проекта, индексация с прогрессом, чат и просмотр найденных фрагментов кода.
- Обновлены корневые скрипты и документация запуска/сборки/очистки индекса.
- Добавлена интеграция LanceDB в retrieval pipeline: запись чанков в векторное хранилище и гибридный поиск (vector + keyword).
- Добавлен системный выбор папки проекта для Windows через backend endpoint `POST /api/projects/pick-folder`.
- В правой колонке фронтенда внедрён Monaco Editor (read-only) с подсветкой активного диапазона найденных строк.

**Затронутые пути:**
- `package.json`
- `tsconfig.base.json`
- `scripts/clean-data.js`
- `apps/backend/src/**`
- `apps/frontend/src/**`
- `apps/frontend/index.html`
- `apps/frontend/vite.config.ts`
- `packages/shared/src/index.ts`
- `README.md`

**Зачем / контекст:**
- Реализован целевой MVP из `tz-ai-rag-code-agent.md`: локальный UI + backend RAG-поиск по коду с выдачей релевантных мест и строк.

<!-- Новые записи добавлять сверху -->
