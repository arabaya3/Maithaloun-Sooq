# syntax=docker/dockerfile:1
# MAYTHA self-hosted image. Targets: "runner" (the site) and "migrator" (applies database migrations).
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS source
COPY . .

# Runs drizzle migrations against DATABASE_URL (needs APPLY_DB_MIGRATIONS=1), then exits.
FROM source AS migrator
CMD ["sh", "-c", "pnpm exec tsx tools/migrate-database.ts && pnpm exec tsx tools/ensure-order-contact-columns.ts"]

# Built without runtime secrets: storefront pages render on first request and are then cached (ISR).
FROM source AS builder
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY=""
ENV NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY NODE_OPTIONS=--max-old-space-size=1536
RUN pnpm exec next build --webpack

FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
RUN groupadd -g 1001 app && useradd -u 1001 -g app -m app && mkdir -p /data/media && chown -R app:app /data
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder --chown=app:app /app/public ./public
USER app
EXPOSE 3000
CMD ["node", "server.js"]
