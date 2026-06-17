# AICodeBase

Локальное MVP-приложение для RAG-поиска по кодовой базе:

- `apps/backend` — NestJS API (сканирование, индексация, retrieval, chat, системный выбор папки);
- `apps/frontend` — React + Vite UI (layout 40/60, чат, Monaco viewer и просмотр кода);
- `packages/shared` — общие типы;
- `data/` — локальные runtime-данные (SQLite/индекс), в git не коммитятся.

## Требования

- Node.js 20+
- npm 10+

## Установка

```bash
npm install
```

## Запуск в разработке

Запуск backend (порт `3001`, только localhost):

```bash
npm run dev:backend
```

Запуск frontend (порт `5173`):

```bash
npm run dev:frontend
```

Открой в браузере `http://127.0.0.1:5173`.

## Настройка OpenRouter API key

1. Создайте файл `.env` в директории `apps/backend/`.
2. Добавьте в него ваш ключ: `OPENROUTER_API_KEY=ваш_ключ`.
3. Перезапустите backend. Ключ будет автоматически подхвачен из переменных окружения.

## Базовый flow

1. Введи путь к папке проекта.
2. Нажми **Выбрать через диалог** (Windows) или укажи путь вручную.
3. Нажми **Выбрать папку проекта**.
4. Нажми **Индексировать**.
5. После статуса `ready` отправляй вопросы в чат.
6. Кликабельные ссылки в сообщениях открывают соответствующие фрагменты кода справа (Monaco с подсветкой диапазона строк).

## Очистка локального индекса

```bash
npm run clean:data
```

Также можно очистить индекс выбранного проекта из UI кнопкой **Очистить индекс**.

## Production build

```bash
npm run build
```

Сборка проходит для всех пакетов:

- `@aicodebase/shared`
- `@aicodebase/backend`
- `@aicodebase/frontend`

## Реализованные API endpoints (MVP)

- `POST /api/settings/openrouter-key`
- `GET /api/settings/status`
- `POST /api/projects/pick-folder`
- `POST /api/projects/select`
- `POST /api/projects/index`
- `POST /api/projects/clear-index`
- `GET /api/projects/:projectId/status`
- `GET /api/projects/events?projectId=...` (SSE)
- `GET /api/search`
- `POST /api/chat/message`
- `GET /api/files/snippet`

## Известные проблемы и исправления

### 2026-06-17 — Ошибка типов при индексации

**Ошибка:** `TypeError: Cannot read properties of undefined (reading 'map')`

**Описание:** Ошибка возникала в `OpenRouterService.createEmbeddings()` при попытке вызвать `.map()` на `undefined`, если API возвращал неожиданную структуру данных.

**Решение:**
- Добавлена проверка `result.data` перед вызовом `.map()` в методе `createEmbeddings`
- Добавлена проверка `embeddings[index]` на массив в `IndexingService`
- Добавлена защита от `undefined` в векторах при создании чанков
- Обновлена документация с описанием изменений

**Затронутые файлы:**
- `apps/backend/src/services/openrouter.service.ts`
- `apps/backend/src/services/indexing.service.ts`

**Последствия:** Повышена устойчивость системы к некорректным ответам от OpenRouter API.
