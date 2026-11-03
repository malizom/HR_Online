# One image, two entrypoints (doc 01 §2): web (default) and jobs (`node --import tsx jobs/run.ts`).
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
# Web: Next.js standalone server
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
# Jobs + migrations: source and full node_modules (tsx, drizzle-kit)
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/package.json /app/tsconfig.json /app/drizzle.config.ts ./
COPY --from=build --chown=app:app /app/db ./db
COPY --from=build --chown=app:app /app/lib ./lib
COPY --from=build --chown=app:app /app/modules ./modules
COPY --from=build --chown=app:app /app/jobs ./jobs
COPY --from=build --chown=app:app /app/scripts ./scripts
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
