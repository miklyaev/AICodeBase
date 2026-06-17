# План исправления ошибки типов в LanceDB

## Проблема
Ошибка `TypeError: Cannot read properties of undefined (reading 'map')` возникает в методе `createEmbeddings` класса `OpenRouterService` при попытке вызвать `.map()` на `undefined`.

## Причины
1. **В `openrouter.service.ts`**: Метод `createEmbeddings` не проверяет, что `result.data` существует перед вызовом `.map()`
2. **В `indexing.service.ts`**: Нет проверки, что `embeddings` не `undefined` перед использованием `embeddings[index]`

## Решения

### 1. Исправить `openrouter.service.ts`
- Добавить проверку `result.data` перед вызовом `.map()`
- Вернуть пустой массив `[]` в случае ошибки или отсутствия данных
- Добавить проверку `item.embedding` на массив

### 2. Исправить `indexing.service.ts`
- Добавить проверку `embeddings` перед использованием
- Убедиться, что длина `embeddings` соответствует количеству чанков
- Добавить проверку `embeddings[index]` на массив

### 3. Обновить документацию
- Добавить раздел "Известные проблемы и исправления" в `dev_notes.md`
- Обновить раздел "Архитектура" в `README.md` с описанием обработки ошибок

## Порядок действий
1. Исправить `openrouter.service.ts` — добавить проверку `result.data`
2. Исправить `indexing.service.ts` — добавить проверку `embeddings`
3. Проверить, что типы полей в `LanceChunkRow` соответствуют данным
4. Обновить документацию в `dev_notes.md` и `README.md`

## Результаты
✅ Исправлен `openrouter.service.ts` — добавлены проверки `result.data`, `item.embedding` и обработка пустых массивов
✅ Исправлен `indexing.service.ts` — добавлены проверки `embeddings[index]` на массив
✅ Обновлена документация в `dev_notes.md` с описанием исправления
✅ Обновлена документация в `README.md` с разделом "Известные проблемы и исправления"

## Измененные файлы
- `apps/backend/src/services/openrouter.service.ts`
- `apps/backend/src/services/indexing.service.ts`
- `dev_notes.md`
- `README.md`
