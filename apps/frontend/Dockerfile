# Этап сборки
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
COPY apps/frontend/package.json ./apps/frontend/
COPY packages/shared/package.json ./packages/shared/

RUN npm install

COPY . .

RUN npm run build --workspace @aicodebase/shared
RUN npm run build --workspace @aicodebase/frontend

# Этап раздачи
FROM nginx:stable-alpine

# Копируем собранные файлы фронтенда
COPY --from=builder /app/apps/frontend/dist /usr/share/nginx/html

# Копируем конфиг для внутреннего nginx
COPY apps/frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
