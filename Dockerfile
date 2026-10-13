# Confi — образ прототипа (Node 24 + SQLite). Один контейнер: собранный SPA + API.
# Express сам раздаёт `dist/` в production (см. src/server/index.ts).
#
# Сборка:   docker build -t confi:latest .
# Запуск:   docker run -p 127.0.0.1:8787:8787 -v confi-db:/data -v confi-uploads:/app/uploads confi:latest
# Compose:  docker compose up --build -d
#
# Тома:  /data (SQLite) и /app/uploads (фото компонентов).

# ---- build: компилируем натив better-sqlite3, собираем SPA ----
FROM node:24-slim AS build
WORKDIR /app
# python3/make/g++ нужны node-gyp для сборки better-sqlite3 из исходников.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
# Убираем devDependencies: в runtime остаются только production-модули
# (нативный better-sqlite3 остаётся уже собранным под этот же базовый образ).
RUN npm prune --omit=dev

# ---- runtime: только рантайм-зависимости + собранные артефакты ----
FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# data volume с БД и каталог загрузок вынесены под /data и /app/uploads
ENV DB_PATH=/data/confi.db
# quarantine-лог seed пишется в /tmp (каталог образа /app/db только для чтения)
ENV DB_QUARANTINE=/tmp/confi-quarantine-part.log
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist
# db/ остаётся в образе (schema.sql + migrate.ts нужны серверу в рантайме),
# а файл БД живёт отдельно (DB_PATH=/data/confi.db) и не перекрывается томом.
COPY --from=build /app/db ./db
COPY --from=build /app/src ./src
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/tsconfig*.json ./
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
    && mkdir -p /data /app/uploads \
    && chown -R node:node /data /app/uploads
EXPOSE 8787
VOLUME ["/data", "/app/uploads"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=5 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
USER node
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "--experimental-strip-types", "src/server/index.ts"]
