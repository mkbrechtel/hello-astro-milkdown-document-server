FROM node:20-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl sqlite3 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production PORT=4321 HOST=0.0.0.0 DATABASE_PATH=/app/data/app.sqlite
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/server ./src/server
COPY --from=build /app/server.mjs ./server.mjs
COPY --from=build /app/package.json ./package.json
VOLUME ["/app/data"]
EXPOSE 4321
CMD ["node", "server.mjs"]
