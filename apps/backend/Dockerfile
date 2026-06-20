FROM node:20-alpine AS builder

WORKDIR /app

# Копируем файлы манифестов для установки зависимостей
COPY package.json package-lock.json* ./
COPY apps/backend/package.json ./apps/backend/
COPY packages/shared/package.json ./packages/shared/

# Устанавливаем зависимости
RUN npm install

# Копируем исходный код
COPY . .

# Собираем shared пакет и бэкенд
RUN npm run build --workspace @aicodebase/shared
RUN npm run build --workspace @aicodebase/backend

# Финальный образ
FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/backend/package.json ./apps/backend/
COPY --from=builder /app/apps/backend/dist ./apps/backend/dist
COPY --from=builder /app/packages/shared ./packages/shared

EXPOSE 3000

CMD ["npm", "run", "start", "--workspace", "@aicodebase/backend"]
