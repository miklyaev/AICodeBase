# Dev Notes

Краткий журнал ключевых изменений проекта AICodeBase.

## Журнал изменений

### 2026-06-15 — MVP AI RAG code-agent (frontend + backend)

**Область:** Architecture | Backend | Frontend | Infra

**Что изменилось:**
- Создана monorepo-структура: `apps/frontend`, `apps/backend`, `packages/shared`.
- Реализован NestJS backend с endpoint’ами настроек, выбора проекта, индексации, статуса, retrieval, chat и выдачи сниппета.
- Добавлен локальный SQLite storage (`projects/files/chunks/conversations/messages`), сканер файлов с ignore/security-правилами, chunking и инкрементальная переиндексация по hash.
- Добавлена OpenRouter-интеграция (embeddings + chat completion) с timeout/retry и безопасной обработкой ошибок.
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
