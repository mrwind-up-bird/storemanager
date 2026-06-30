# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# q·records storemanager — multi-stage, non-root, Next.js standalone image.
#
#   deps    → install the full dependency tree (frozen lockfile)
#   builder → `next build` (standalone) + esbuild-compile migrate/seed/worker to
#             SELF-CONTAINED .cjs bundles (pg / pg-boss / nodemailer are NOT traced
#             into .next/standalone because no Next route imports them, so the
#             scripts must NOT rely on the standalone node_modules — they bundle
#             every dependency in).
#   runner  → slim runtime: standalone server + static + the 3 cjs bundles +
#             drizzle SQL + entrypoints. Runs as the non-root `nextjs` user.
#
# Deploy model: CI builds & pushes this image; servers only `docker compose up`.
# ─────────────────────────────────────────────────────────────────────────────

# ──────────────────── Stage 1: deps ────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.28.1 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ──────────────────── Stage 2: builder ────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.28.1 --activate
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# This project self-hosts fonts via next/font/local (no public/ assets), so `public/` may
# not exist in the repo. Ensure it does so the runner COPY of /app/public always succeeds.
RUN mkdir -p public

# Build-time env so `next build` can evaluate `@/env` (imported transitively by the
# auth route handler) WITHOUT any developer's local `.env`. These are dummy-but-VALID
# placeholders — only NEXT_PUBLIC_* would be inlined into client bundles, and there are
# none, so none of these leak. Runtime values come from compose `env_file` instead.
# Note: ROOT_DOMAIN is fixed to `localhost` to match the compose runtime value (edge
# middleware may inline process.env.ROOT_DOMAIN at build time).
ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production \
    DATABASE_URL=postgresql://qr_app:build@localhost:5432/qrecords \
    DATABASE_OWNER_URL=postgresql://qr_owner:build@localhost:5432/qrecords \
    PGBOSS_DATABASE_URL=postgresql://qr_owner:build@localhost:5432/qrecords \
    ROOT_DOMAIN=localhost \
    APP_PROTOCOL=http \
    APP_PORT=3000 \
    AUTH_SECRET=build-time-placeholder-auth-secret-min-32-chars \
    ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= \
    ENCRYPTION_KEY_ID=v1 \
    MAIL_DRIVER=console \
    MAIL_HOST=localhost \
    MAIL_PORT=1025 \
    MAIL_FROM=noreply@localhost \
    DISCOGS_CONSUMER_KEY=build-time-placeholder-discogs-key \
    DISCOGS_CONSUMER_SECRET=build-time-placeholder-discogs-secret

# Next.js standalone output (.next/standalone/server.js + traced node_modules).
RUN pnpm build

# Compile the runtime helper scripts to fully self-contained CJS bundles.
#  - NO --packages=external: pg-boss (worker) and nodemailer (seed mail) are not part of
#    the Next standalone trace, so bundling everything in is what makes them runnable in
#    the slim runner.
#  - --alias:server-only stubs the `server-only` import guard (provisioning/db/tenant pull
#    it in). Without this, esbuild resolves it to the package's throwing index.js and the
#    bundle crashes on load. We do NOT use --conditions=react-server (that swaps in React's
#    server build, which lacks createContext and breaks next/navigation's module init).
#  - Entrypoints exec via `require('<file>').<fn>()` because esbuild's cjs format leaves
#    `import.meta.url` empty, defeating the scripts' own `import.meta` "run if main" guards.
RUN pnpm exec esbuild src/db/migrate.ts   --bundle --platform=node --format=cjs --alias:server-only=./docker/stubs/server-only.js --outfile=dist/migrate.cjs \
 && pnpm exec esbuild scripts/seed.ts     --bundle --platform=node --format=cjs --alias:server-only=./docker/stubs/server-only.js --outfile=dist/seed.cjs \
 && pnpm exec esbuild src/worker/index.ts --bundle --platform=node --format=cjs --alias:server-only=./docker/stubs/server-only.js --outfile=dist/worker.cjs

# ──────────────────── Stage 3: runner ────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# Next.js standalone server + static assets + public dir.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Self-contained runtime scripts (migrate / seed / worker).
COPY --from=builder --chown=nextjs:nodejs /app/dist/migrate.cjs ./migrate.cjs
COPY --from=builder --chown=nextjs:nodejs /app/dist/seed.cjs    ./seed.cjs
COPY --from=builder --chown=nextjs:nodejs /app/dist/worker.cjs  ./worker.cjs

# Drizzle migration SQL — migrate.cjs reads `${process.cwd()}/drizzle` at runtime (cwd=/app).
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle

# Entrypoints (chmod + chown before dropping to non-root).
COPY docker/entrypoint-web.sh    ./entrypoint-web.sh
COPY docker/entrypoint-worker.sh ./entrypoint-worker.sh
RUN chmod 0755 ./entrypoint-web.sh ./entrypoint-worker.sh \
 && chown nextjs:nodejs ./entrypoint-web.sh ./entrypoint-worker.sh

USER nextjs
EXPOSE 3000
# Default command — overridden by the migrate/seed/worker compose services.
CMD ["/app/entrypoint-web.sh"]
