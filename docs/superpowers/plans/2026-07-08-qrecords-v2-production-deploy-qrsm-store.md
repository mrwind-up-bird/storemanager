# qrsm.store Production Deploy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the v2 storemanager to the shared nyxCore host behind Traefik on `qrsm.store`, with its own pgvector Postgres, a GHCR image-pull git pipeline, real Stripe/OpenAI/Discogs, an internal mail relay, a superadmin-only bootstrap, and a coming-soon splash on the root.

**Architecture:** A dedicated `docker-compose.prod.yml` (own `db` + `migrate`/`web`/`worker`/`splash`/`bootstrap`) joins the external `nyxcore_nyxcore-net`. CI already builds+pushes the Next-standalone image to GHCR; a new `deploy` job rsyncs the deploy bundle and runs `docker compose pull && up -d` over SSH, health-gated. Wildcard `*.qrsm.store` TLS is issued by the existing Traefik `letsencrypt` (Hetzner DNS-01) resolver.

**Tech Stack:** Next.js 15 standalone · Drizzle · pg-boss · pgvector/pgvector:pg17 · Traefik v2/v3 · docker-mailserver · GitHub Actions · GHCR · Vitest + @testcontainers/postgresql.

**Spec:** `docs/superpowers/specs/2026-07-08-qrecords-v2-production-deploy-qrsm-store-design.md`

## Global Constraints

- **Base branch:** `feat/deploy-qrsm-store`, based on `feat/v2-slice7-…` (needs pgvector + embeddings; NOT on `main` yet). Deploy goes live only when this reaches `main`.
- **Node 22 · pnpm 10.28.1** (`corepack prepare pnpm@10.28.1`).
- **Image ref:** `ghcr.io/mrwind-up-bird/storemanager` (lowercase; = `github.repository`). Compose pins `:${IMAGE_TAG:-latest}`.
- **Network:** external `nyxcore_nyxcore-net` (compose alias `nyxcore-net`).
- **Runtime env (prod):** `ROOT_DOMAIN=qrsm.store`, `APP_PROTOCOL=https`, `APP_PORT=443`, `TRUST_PROXY=1`. `src/env.ts` `parseEnv()` is fail-closed on boot.
- **No host port bindings** in the prod compose (Traefik reaches services over the docker network). **Never `down -v`** in prod.
- **Postgres:** `pgvector/pgvector:pg17`; roles `qr_owner` (BYPASSRLS, migrations) / `qr_app` (NOBYPASSRLS, RLS-bound); init `01-roles.sql` + `02-extensions.sql` (`CREATE EXTENSION vector`).
- **Traefik:** resolver `letsencrypt`; middlewares `security-headers@file,gzip-compress@file`; wildcard cert `main=qrsm.store, sans=*.qrsm.store`; app router = single-label `HostRegexp`, priority 1; splash router = `Host(qrsm.store)||Host(www.qrsm.store)`, priority 100.
- **Deploy trigger:** push to `main` (+ `workflow_dispatch`); image-pull only, never build on server.
- **Secrets:** only in server `/opt/q-records-storemanager/.env` (rsync `--exclude` / never sent) + GH encrypted secrets. GHCR pull auth is a **one-time server-side `docker login`**, not a pipeline secret.
- **Bootstrap:** superadmin only. The E2E fixture seed (`scripts/seed.ts`) is **never** run in production.
- **Commit style:** end messages with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Platform-admin library (superadmin upsert + password guard)

A pure, env-agnostic helper the production bootstrap reuses — mirrors `ensurePlatformUser` in `scripts/seed.ts` but non-destructive (insert-if-missing) and testable in isolation.

**Files:**
- Create: `src/lib/platformAdmin.ts`
- Test: `tests/platform-admin.test.ts`

**Interfaces:**
- Produces:
  - `assertStrongAdminPassword(password: string | undefined): asserts password is string` — throws if unset or `< 12` chars.
  - `ensurePlatformAdmin(ownerPool: Pool, args: { email: string; password: string }): Promise<{ created: boolean }>` — inserts a `platform_users` row if the email is absent; leaves an existing row untouched.
- Consumes: `hashPassword` from `src/lib/password.ts`; `platformUsers` from `src/db/schema.ts`; `setupTestDatabase` from `tests/helpers/db.ts`.

- [ ] **Step 1: Write the failing test**

Create `tests/platform-admin.test.ts`:

```ts
import { Pool } from 'pg';
import bcryptjs from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestDatabase, type TestDatabase } from './helpers/db';
import { assertStrongAdminPassword, ensurePlatformAdmin } from '@/lib/platformAdmin';

describe('assertStrongAdminPassword', () => {
  it('throws when password is missing', () => {
    expect(() => assertStrongAdminPassword(undefined)).toThrow(/PLATFORM_ADMIN_PASSWORD/);
  });
  it('throws when password is shorter than 12 chars', () => {
    expect(() => assertStrongAdminPassword('short')).toThrow(/12/);
  });
  it('passes for a strong password', () => {
    expect(() => assertStrongAdminPassword('a-strong-password-123')).not.toThrow();
  });
});

describe('ensurePlatformAdmin (integration)', () => {
  let tdb: TestDatabase;
  let pool: Pool;

  beforeAll(async () => {
    tdb = await setupTestDatabase();
    pool = new Pool({ connectionString: tdb.ownerUrl, max: 1 });
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await tdb?.teardown();
  });

  it('creates the superadmin with a bcrypt-hashed password, idempotently', async () => {
    const email = 'super@qrsm.store';
    const password = 'a-strong-password-123';

    const first = await ensurePlatformAdmin(pool, { email, password });
    expect(first.created).toBe(true);

    const rows = await pool.query('SELECT email, password FROM platform_users WHERE email = $1', [email]);
    expect(rows.rowCount).toBe(1);
    expect(await bcryptjs.compare(password, rows.rows[0].password)).toBe(true);

    // Second run must NOT create a duplicate and must leave the existing row untouched.
    const second = await ensurePlatformAdmin(pool, { email, password: 'different-but-ignored-pw' });
    expect(second.created).toBe(false);
    const after = await pool.query('SELECT password FROM platform_users WHERE email = $1', [email]);
    expect(after.rowCount).toBe(1);
    expect(await bcryptjs.compare(password, after.rows[0].password)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/platform-admin.test.ts`
Expected: FAIL — `Cannot find module '@/lib/platformAdmin'` / `assertStrongAdminPassword is not a function`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/platformAdmin.ts`:

```ts
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import * as schema from '@/db/schema';
import { hashPassword } from '@/lib/password';

const MIN_ADMIN_PASSWORD_LENGTH = 12;

/**
 * Fail-closed guard for the production platform-admin password. Throws (does not return)
 * when the password is absent or too weak, so the bootstrap one-shot never creates a
 * guessable superadmin.
 */
export function assertStrongAdminPassword(password: string | undefined): asserts password is string {
  if (!password || password.length < MIN_ADMIN_PASSWORD_LENGTH) {
    throw new Error(
      `PLATFORM_ADMIN_PASSWORD must be set and at least ${MIN_ADMIN_PASSWORD_LENGTH} characters long.`,
    );
  }
}

/**
 * Idempotent, NON-destructive platform superadmin bootstrap. Inserts one `platform_users`
 * row (bcrypt-hashed password) when the email is absent; if a row already exists it is left
 * untouched (a re-run never resets a password the operator may have changed via the UI).
 * Reuses the exact table + hashing contract of scripts/seed.ts::ensurePlatformUser, minus any
 * fixture/tenant data.
 */
export async function ensurePlatformAdmin(
  ownerPool: Pool,
  args: { email: string; password: string },
): Promise<{ created: boolean }> {
  const db = drizzle(ownerPool, { schema });

  const existing = await db
    .select({ id: schema.platformUsers.id })
    .from(schema.platformUsers)
    .where(eq(schema.platformUsers.email, args.email))
    .limit(1);

  if (existing.length > 0 && existing[0]) {
    return { created: false };
  }

  await db
    .insert(schema.platformUsers)
    .values({ email: args.email, password: await hashPassword(args.password) });

  return { created: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/platform-admin.test.ts`
Expected: PASS (4 tests; the integration one boots a pgvector container — allow ~1 min).

- [ ] **Step 5: Commit**

```bash
git add src/lib/platformAdmin.ts tests/platform-admin.test.ts
git commit -m "feat(deploy): platform-admin upsert lib + password guard (superadmin bootstrap core)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Production bootstrap script + Docker image wiring

Thin env wrapper around Task 1, compiled into the runtime image like the other `.cjs` helpers.

**Files:**
- Create: `scripts/bootstrap-prod.ts`
- Modify: `Dockerfile` (builder esbuild block; runner COPY)
- Modify: `package.json:scripts` (add `bootstrap:prod`)

**Interfaces:**
- Consumes: `env` from `src/env.ts`; `ensurePlatformAdmin`, `assertStrongAdminPassword` from `src/lib/platformAdmin.ts`.
- Produces: a runnable `/app/bootstrap-prod.cjs` (compose `bootstrap` service, Task 4).

- [ ] **Step 1: Write the bootstrap script**

Create `scripts/bootstrap-prod.ts` (relative imports, matching `scripts/seed.ts`):

```ts
// Must be first: loads .env into process.env before any src/* imports.
import 'dotenv/config';

import { Pool } from 'pg';
import { env } from '../src/env';
import { assertStrongAdminPassword, ensurePlatformAdmin } from '../src/lib/platformAdmin';

async function main(): Promise<void> {
  const email = process.env['PLATFORM_ADMIN_EMAIL'];
  const password = process.env['PLATFORM_ADMIN_PASSWORD'];

  if (!email) throw new Error('PLATFORM_ADMIN_EMAIL must be set.');
  assertStrongAdminPassword(password);

  const pool = new Pool({ connectionString: env.DATABASE_OWNER_URL, max: 1 });
  try {
    const { created } = await ensurePlatformAdmin(pool, { email, password });
    const loginUrl = `${env.APP_PROTOCOL}://admin.${env.ROOT_DOMAIN}`;
    console.log(
      created
        ? `[bootstrap] Platform superadmin "${email}" created. Login at ${loginUrl}`
        : `[bootstrap] Platform superadmin "${email}" already exists — no change. Login at ${loginUrl}`,
    );
  } finally {
    await pool.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('[bootstrap] FAILED:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
```

- [ ] **Step 2: Verify it bundles (esbuild sanity)**

Run:
```bash
pnpm exec esbuild scripts/bootstrap-prod.ts --bundle --platform=node --format=cjs \
  --alias:server-only=./docker/stubs/server-only.js --outfile=/tmp/bootstrap-prod.cjs \
  && test -s /tmp/bootstrap-prod.cjs && echo "BUNDLE OK"
```
Expected: `BUNDLE OK` (no unresolved-import errors).

- [ ] **Step 3: Wire the bundle into the Dockerfile**

In `Dockerfile`, extend the esbuild block. Change:

```dockerfile
 && pnpm exec esbuild scripts/embeddings-backfill.ts --bundle --platform=node --format=cjs --alias:server-only=./docker/stubs/server-only.js --outfile=dist/embeddings-backfill.cjs
```

to:

```dockerfile
 && pnpm exec esbuild scripts/embeddings-backfill.ts --bundle --platform=node --format=cjs --alias:server-only=./docker/stubs/server-only.js --outfile=dist/embeddings-backfill.cjs \
 && pnpm exec esbuild scripts/bootstrap-prod.ts        --bundle --platform=node --format=cjs --alias:server-only=./docker/stubs/server-only.js --outfile=dist/bootstrap-prod.cjs
```

Then add the runner COPY right after the embeddings-backfill COPY:

```dockerfile
COPY --from=builder --chown=nextjs:nodejs /app/dist/embeddings-backfill.cjs ./embeddings-backfill.cjs
COPY --from=builder --chown=nextjs:nodejs /app/dist/bootstrap-prod.cjs       ./bootstrap-prod.cjs
```

- [ ] **Step 4: Add the npm script**

In `package.json`, under `"scripts"`, add after `"embeddings:backfill"`:

```json
    "embeddings:backfill": "tsx scripts/embeddings-backfill.ts",
    "bootstrap:prod": "tsx scripts/bootstrap-prod.ts"
```

- [ ] **Step 5: Verify the image builds and contains the bundle**

Run:
```bash
docker build -t qrsm-bootstrap-check . \
  && docker run --rm --entrypoint sh qrsm-bootstrap-check -c 'test -s /app/bootstrap-prod.cjs && echo "IN IMAGE OK"'
```
Expected: `IN IMAGE OK`.

- [ ] **Step 6: Commit**

```bash
git add scripts/bootstrap-prod.ts Dockerfile package.json
git commit -m "feat(deploy): production superadmin bootstrap script + image wiring

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Internal mail relay — env-gated insecure STARTTLS

`docker-mailserver:25` may advertise STARTTLS with a self-signed cert; nodemailer's default `rejectUnauthorized:true` would then reject the upgrade and credential mail would throw. Add an off-by-default `MAIL_SMTP_INSECURE` that skips STARTTLS for the in-network relay only. Zero behavior change when unset (dev/E2E unaffected).

> **As-built deviation (verified during execution):** (1) The pure `mailpitTransportOptions` builder was extracted into its own env-free module `src/lib/email/smtpOptions.ts` — importing it from `mailpit.ts` would eagerly load `@/env`, whose `parseEnv` throws at import in the test process (the codebase convention, per `tests/helpers/db.ts`, is to never statically import env-loading modules in a spec). The test imports the pure module. (2) The return type is `SMTPTransport.Options` (`import type SMTPTransport from 'nodemailer/lib/smtp-transport'`), not `Parameters<typeof nodemailer.createTransport>[0]` — the latter resolves to the base `TransportOptions` union which lacks `host`/`port` and fails typecheck.

**Files:**
- Modify: `src/env.ts` (Mail section)
- Modify: `src/lib/email/mailpit.ts`
- Test: `tests/email-mailpit.test.ts`

**Interfaces:**
- Produces: `mailpitTransportOptions(cfg: { host: string; port: number; insecure: boolean }): TransportConfig` (exported from `src/lib/email/mailpit.ts`), where `TransportConfig = Parameters<typeof nodemailer.createTransport>[0]`.
- Consumes: `env.MAIL_SMTP_INSECURE` (`'0' | '1'`, default `'0'`).

- [ ] **Step 1: Write the failing test**

Create `tests/email-mailpit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mailpitTransportOptions } from '@/lib/email/mailpit';

describe('mailpitTransportOptions', () => {
  it('defaults to plain SMTP with opportunistic TLS (secure:false, no overrides)', () => {
    const opts = mailpitTransportOptions({ host: 'mailpit', port: 1025, insecure: false }) as Record<string, unknown>;
    expect(opts.host).toBe('mailpit');
    expect(opts.port).toBe(1025);
    expect(opts.secure).toBe(false);
    expect(opts.ignoreTLS).toBeUndefined();
    expect(opts.tls).toBeUndefined();
  });

  it('skips STARTTLS and self-signed validation for the internal relay when insecure', () => {
    const opts = mailpitTransportOptions({ host: 'mailserver', port: 25, insecure: true }) as Record<string, unknown>;
    expect(opts.host).toBe('mailserver');
    expect(opts.port).toBe(25);
    expect(opts.secure).toBe(false);
    expect(opts.ignoreTLS).toBe(true);
    expect(opts.tls).toEqual({ rejectUnauthorized: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/email-mailpit.test.ts`
Expected: FAIL — `mailpitTransportOptions is not a function`.

- [ ] **Step 3: Add the env key**

In `src/env.ts`, in the `// ── Mail ──` block, immediately after the `MAIL_FROM` field, add:

```ts
  /**
   * Internal-relay escape hatch. '1' → the mailpit adapter skips STARTTLS and self-signed
   * cert validation (ignoreTLS + rejectUnauthorized:false), for the in-network mailserver hop
   * ONLY. Default '0' — dev/E2E and any real TLS relay are unaffected.
   */
  MAIL_SMTP_INSECURE: z.enum(['0', '1']).default('0'),
```

- [ ] **Step 4: Refactor the adapter to use a pure options builder**

Replace the body of `src/lib/email/mailpit.ts` with:

```ts
import nodemailer from 'nodemailer';
import { env } from '@/env';
import type { EmailAdapter, EmailMessage } from './index';

type TransportConfig = Parameters<typeof nodemailer.createTransport>[0];

/**
 * Pure builder for the SMTP transport options. Plain SMTP (secure:false) by default — this
 * adapter doubles as the internal docker-mailserver relay. When `insecure`, STARTTLS is skipped
 * and self-signed validation disabled (internal hop only; see env.MAIL_SMTP_INSECURE).
 */
export function mailpitTransportOptions(cfg: {
  host: string;
  port: number;
  insecure: boolean;
}): TransportConfig {
  return {
    host: cfg.host,
    port: cfg.port,
    secure: false,
    ...(cfg.insecure ? { ignoreTLS: true, tls: { rejectUnauthorized: false } } : {}),
  };
}

export function createMailpitEmailAdapter(): EmailAdapter {
  // One transporter per adapter instance; no auth (Mailpit dev server / internal relay).
  const transporter = nodemailer.createTransport(
    mailpitTransportOptions({
      host: env.MAIL_HOST,
      port: env.MAIL_PORT,
      insecure: env.MAIL_SMTP_INSECURE === '1',
    }),
  );

  return {
    async send(msg: EmailMessage): Promise<void> {
      await transporter.sendMail({
        from: env.MAIL_FROM,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      });
    },
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test -- tests/email-mailpit.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Guard against env-shape regressions**

Run: `pnpm test -- tests/env-billing.test.ts && pnpm typecheck`
Expected: PASS (adding an optional-with-default key is backward compatible).

- [ ] **Step 7: Commit**

```bash
git add src/env.ts src/lib/email/mailpit.ts tests/email-mailpit.test.ts
git commit -m "feat(deploy): MAIL_SMTP_INSECURE relay option (off by default)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Production compose + env template

**Files:**
- Create: `docker-compose.prod.yml`
- Create: `.env.prod.example`

**Interfaces:**
- Consumes: the GHCR image (Task 2 wiring), `docker/postgres/init/*.sql` (existing), `splash/` (Task 5).
- Produces: services `db`, `migrate`, `web`, `worker`, `splash`, `bootstrap`; the exact env keys the deploy `.env` must define (documented in `.env.prod.example`).

- [ ] **Step 1: Write the production compose**

Create `docker-compose.prod.yml`:

```yaml
# q·records storemanager — PRODUCTION stack for qrsm.store on the shared nyxcore host.
# Image-pull model: CI builds & pushes to GHCR; this file only pulls & runs.
# Deploy dir: /opt/q-records-storemanager  ·  secrets: ./.env (server-only, NOT in git)
#
#   docker login ghcr.io                                              # one-time, on the server
#   IMAGE_TAG=<sha> docker compose -f docker-compose.prod.yml pull
#   IMAGE_TAG=<sha> docker compose -f docker-compose.prod.yml up -d --remove-orphans
#   docker compose -f docker-compose.prod.yml --profile bootstrap run --rm bootstrap   # once
#
# Traefik HostRegexp below is v3 syntax. For Traefik v2 use:
#   traefik.http.routers.qrsm-web.rule: "HostRegexp(`{sub:[a-z0-9-]+}.qrsm.store`)"

x-app-image: &app-image ghcr.io/mrwind-up-bird/storemanager:${IMAGE_TAG:-latest}

x-logging: &default-logging
  driver: json-file
  options:
    max-size: "10m"
    max-file: "3"

services:
  db:
    image: pgvector/pgvector:pg17
    container_name: qrsm-db
    restart: unless-stopped
    environment:
      POSTGRES_DB: qrecords
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in .env}
      # Consumed by docker/postgres/init/01-roles.sql. MUST match the URLs in .env.
      QR_OWNER_PASSWORD: ${QR_OWNER_PASSWORD:?set QR_OWNER_PASSWORD in .env}
      QR_APP_PASSWORD: ${QR_APP_PASSWORD:?set QR_APP_PASSWORD in .env}
    volumes:
      - ./docker/postgres/init:/docker-entrypoint-initdb.d:ro
      - qrsm_db_data:/var/lib/postgresql/data
    networks: [nyxcore-net]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d qrecords"]
      interval: 5s
      timeout: 5s
      retries: 12
      start_period: 10s
    logging: *default-logging
    deploy:
      resources:
        limits: { cpus: "1.0", memory: 1G }
        reservations: { cpus: "0.1", memory: 256M }

  migrate:
    image: *app-image
    container_name: qrsm-migrate
    # migrate.cjs is a self-contained cjs bundle; invoke runMigrations() explicitly.
    command:
      - node
      - -e
      - require('/app/migrate.cjs').runMigrations().then(()=>process.exit(0)).catch((e)=>{console.error(e);process.exit(1)})
    env_file: .env
    environment:
      NODE_ENV: production
    depends_on:
      db: { condition: service_healthy }
    networks: [nyxcore-net]
    restart: "no"
    logging: *default-logging

  web:
    image: *app-image
    container_name: qrsm-web
    command: ["/app/entrypoint-web.sh"]
    env_file: .env
    environment:
      NODE_ENV: production
      PORT: "3000"
      HOSTNAME: "0.0.0.0"
    depends_on:
      migrate: { condition: service_completed_successfully }
      db: { condition: service_healthy }
    networks: [nyxcore-net]
    healthcheck:
      test: ["CMD-SHELL", "wget -q -O /dev/null http://127.0.0.1:3000/api/auth/session || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 12
      start_period: 20s
    restart: unless-stopped
    logging: *default-logging
    deploy:
      resources:
        limits: { cpus: "1.0", memory: 768M }
        reservations: { cpus: "0.1", memory: 192M }
    labels:
      traefik.enable: "true"
      traefik.docker.network: "nyxcore_nyxcore-net"
      # Every single-label *.qrsm.store host (tenants + admin) → the app.
      traefik.http.routers.qrsm-web.rule: "HostRegexp(`^[a-z0-9-]+\\.qrsm\\.store$`)"
      traefik.http.routers.qrsm-web.priority: "1"
      traefik.http.routers.qrsm-web.entrypoints: "websecure"
      traefik.http.routers.qrsm-web.tls: "true"
      traefik.http.routers.qrsm-web.tls.certresolver: "letsencrypt"
      traefik.http.routers.qrsm-web.tls.domains[0].main: "qrsm.store"
      traefik.http.routers.qrsm-web.tls.domains[0].sans: "*.qrsm.store"
      traefik.http.routers.qrsm-web.middlewares: "security-headers@file,gzip-compress@file"
      traefik.http.routers.qrsm-web.service: "qrsm-web-svc"
      traefik.http.services.qrsm-web-svc.loadbalancer.server.port: "3000"

  worker:
    image: *app-image
    container_name: qrsm-worker
    command: ["/app/entrypoint-worker.sh"]
    env_file: .env
    environment:
      NODE_ENV: production
    depends_on:
      migrate: { condition: service_completed_successfully }
      db: { condition: service_healthy }
    networks: [nyxcore-net]
    restart: unless-stopped
    logging: *default-logging
    deploy:
      resources:
        limits: { cpus: "0.5", memory: 512M }
        reservations: { cpus: "0.05", memory: 128M }

  splash:
    image: nginx:alpine
    container_name: qrsm-splash
    restart: unless-stopped
    volumes:
      - ./splash:/usr/share/nginx/html:ro
    networks: [nyxcore-net]
    logging: *default-logging
    labels:
      traefik.enable: "true"
      traefik.docker.network: "nyxcore_nyxcore-net"
      # Bare root + www → coming-soon. Priority 100 beats the web regexp for these two hosts.
      traefik.http.routers.qrsm-splash.rule: "Host(`qrsm.store`) || Host(`www.qrsm.store`)"
      traefik.http.routers.qrsm-splash.priority: "100"
      traefik.http.routers.qrsm-splash.entrypoints: "websecure"
      traefik.http.routers.qrsm-splash.tls: "true"
      traefik.http.routers.qrsm-splash.tls.certresolver: "letsencrypt"
      traefik.http.routers.qrsm-splash.tls.domains[0].main: "qrsm.store"
      traefik.http.routers.qrsm-splash.tls.domains[0].sans: "*.qrsm.store"
      traefik.http.routers.qrsm-splash.middlewares: "security-headers@file,gzip-compress@file"
      traefik.http.routers.qrsm-splash.service: "qrsm-splash-svc"
      traefik.http.services.qrsm-splash-svc.loadbalancer.server.port: "80"

  # One-shot superadmin bootstrap. Never runs on a plain `up` (profile-gated).
  bootstrap:
    image: *app-image
    container_name: qrsm-bootstrap
    profiles: ["bootstrap"]
    command: ["node", "/app/bootstrap-prod.cjs"]
    env_file: .env
    environment:
      NODE_ENV: production
    depends_on:
      migrate: { condition: service_completed_successfully }
      db: { condition: service_healthy }
    networks: [nyxcore-net]
    restart: "no"
    logging: *default-logging

networks:
  nyxcore-net:
    external: true
    name: nyxcore_nyxcore-net

volumes:
  qrsm_db_data:
```

- [ ] **Step 2: Write the env template**

Create `.env.prod.example`:

```bash
# ─────────────────────────────────────────────────────────────────────────────
# q·records storemanager — PRODUCTION env template for /opt/q-records-storemanager/.env
# Copy to `.env` on the server and fill every value. NEVER commit the real .env.
# The db passwords below MUST match QR_OWNER_PASSWORD / QR_APP_PASSWORD used by the
# db service (they seed docker/postgres/init/01-roles.sql on first init).
# ─────────────────────────────────────────────────────────────────────────────

NODE_ENV=production

# ── Domain / proxy ────────────────────────────────────────────
ROOT_DOMAIN=qrsm.store
APP_PROTOCOL=https
APP_PORT=443
TRUST_PROXY=1

# ── Database (db service on the compose network) ──────────────
POSTGRES_PASSWORD=CHANGE_ME_superuser
QR_OWNER_PASSWORD=CHANGE_ME_owner
QR_APP_PASSWORD=CHANGE_ME_app
DATABASE_URL=postgresql://qr_app:CHANGE_ME_app@db:5432/qrecords
DATABASE_OWNER_URL=postgresql://qr_owner:CHANGE_ME_owner@db:5432/qrecords
PGBOSS_DATABASE_URL=postgresql://qr_owner:CHANGE_ME_owner@db:5432/qrecords

# ── Auth.js (>=32 chars) ──────────────────────────────────────
AUTH_SECRET=CHANGE_ME_openssl_rand_base64_32

# ── Encryption (base64 of EXACTLY 32 bytes) ───────────────────
ENCRYPTION_KEY=CHANGE_ME_openssl_rand_base64_32
ENCRYPTION_KEY_ID=v1

# ── Mail → internal docker-mailserver relay ───────────────────
MAIL_DRIVER=mailpit
MAIL_HOST=mailserver
MAIL_PORT=25
MAIL_FROM=noreply@qrsm.store
# Set to 1 ONLY if the relay rejects nodemailer's STARTTLS (self-signed cert). Default 0.
MAIL_SMTP_INSECURE=0

# ── Discogs (real API) ────────────────────────────────────────
DISCOGS_DRIVER=http
DISCOGS_CONSUMER_KEY=CHANGE_ME
DISCOGS_CONSUMER_SECRET=CHANGE_ME
DISCOGS_API_URL=https://api.discogs.com
DISCOGS_USER_AGENT=QRecordsStoremanager/2.0 +https://qrsm.store

# ── Billing (Stripe test mode) ────────────────────────────────
BILLING_DRIVER=stripe
STRIPE_SECRET_KEY=sk_test_CHANGE_ME
STRIPE_WEBHOOK_SECRET=whsec_CHANGE_ME

# ── Embeddings / KI-Suche (OpenAI) ────────────────────────────
EMBEDDINGS_DRIVER=http
EMBEDDINGS_API_KEY=sk-CHANGE_ME
EMBEDDINGS_MODEL=text-embedding-3-small
EMBEDDINGS_API_URL=https://api.openai.com/v1

# ── Pool / timeouts ───────────────────────────────────────────
DB_POOL_MAX=10
DB_STATEMENT_TIMEOUT_MS=10000
DB_IDLE_TX_TIMEOUT_MS=10000

# ── Superadmin bootstrap (consumed only by `--profile bootstrap`) ──
PLATFORM_ADMIN_EMAIL=oli@qrsm.store
PLATFORM_ADMIN_PASSWORD=CHANGE_ME_min_12_chars
```

- [ ] **Step 3: Validate compose structure + interpolation**

Run (uses `.env.prod.example` as a dummy env-file just to validate interpolation; no containers start):
```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod.example config >/tmp/qrsm.rendered.yml \
  && grep -q "ghcr.io/mrwind-up-bird/storemanager:latest" /tmp/qrsm.rendered.yml \
  && grep -q "nyxcore_nyxcore-net" /tmp/qrsm.rendered.yml \
  && grep -q "qrsm-web-svc" /tmp/qrsm.rendered.yml \
  && ! grep -qE "^\s+ports:" /tmp/qrsm.rendered.yml \
  && echo "COMPOSE OK (valid, external net, no host ports)"
```
Expected: `COMPOSE OK (valid, external net, no host ports)`.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.prod.yml .env.prod.example
git commit -m "feat(deploy): production compose (own pgvector db + wildcard Traefik) + env template

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Coming-soon splash page

**Files:**
- Create: `splash/index.html`

**Interfaces:**
- Consumes: nothing. Served by the `splash` nginx service (Task 4) on `qrsm.store` / `www.qrsm.store`.

- [ ] **Step 1: Write the splash page**

Create `splash/index.html` (self-contained, no external assets):

```html
<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>q·records — bald verfügbar</title>
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      html, body { height: 100%; margin: 0; }
      body {
        display: grid; place-items: center;
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
        background: radial-gradient(80% 80% at 50% 0%, #1b1730, #0c0a14 70%);
        color: #ECECF0; text-align: center; padding: 24px;
      }
      .wrap { max-width: 560px; }
      .mark {
        display: inline-grid; place-items: center;
        width: 64px; height: 64px; border-radius: 16px;
        background: #ECECF0; color: #0c0a14;
        font-weight: 800; font-size: 30px; margin-bottom: 24px;
      }
      h1 { font-size: clamp(28px, 6vw, 44px); margin: 0 0 12px; letter-spacing: -0.02em; }
      p { color: #A9A6BC; font-size: 16px; line-height: 1.6; margin: 0 0 8px; }
      .kicker {
        font-family: ui-monospace, "SF Mono", Menlo, monospace;
        font-size: 12px; letter-spacing: 0.22em; text-transform: uppercase;
        color: #7A7690; margin-bottom: 16px;
      }
      a { color: #C66A4E; }
    </style>
  </head>
  <body>
    <main class="wrap">
      <div class="mark" aria-hidden="true">q</div>
      <div class="kicker">q·records storemanager</div>
      <h1>Bald verfügbar</h1>
      <p>Der Plattenladen-Manager für Ankauf, Inventar und Verkauf zieht gerade ein.</p>
      <p>Fragen? <a href="mailto:hello@qrsm.store">hello@qrsm.store</a></p>
    </main>
  </body>
</html>
```

- [ ] **Step 2: Verify it is well-formed and self-contained**

Run:
```bash
test -s splash/index.html \
  && ! grep -qiE 'src="https?://|href="https?://[^"]*\.(css|js)|cdn' splash/index.html \
  && echo "SPLASH OK (self-contained)"
```
Expected: `SPLASH OK (self-contained)`.

- [ ] **Step 3: Commit**

```bash
git add splash/index.html
git commit -m "feat(deploy): coming-soon splash for the qrsm.store root

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Deploy job (GHCR image-pull) in CI

Append a `deploy` job to the existing CI so it runs only after `build` (image pushed) and `e2e` pass on `main`.

**Files:**
- Modify: `.github/workflows/ci.yml` (add `workflow_dispatch` trigger + `deploy` job)

**Interfaces:**
- Consumes: the pushed image `ghcr.io/…:${{ github.sha }}` (build job), the deploy bundle in the checkout (`docker-compose.prod.yml`, `docker/postgres/init`, `splash/`).
- GH secrets: `DEPLOY_SSH_KEY` (required), `DEPLOY_HOST` (default `46.224.105.254`), optional `DEPLOY_USER` (default `root`), `DEPLOY_PORT` (default `22`). **No** GHCR token — the server holds a persistent `docker login` (runbook).

- [ ] **Step 1: Add the `workflow_dispatch` trigger**

In `.github/workflows/ci.yml`, change:

```yaml
on:
  push:
    branches: [main, 'feat/**']
  pull_request:
    branches: [main]
```

to:

```yaml
on:
  push:
    branches: [main, 'feat/**']
  pull_request:
    branches: [main]
  workflow_dispatch:
```

- [ ] **Step 2: Append the deploy job**

At the end of `.github/workflows/ci.yml`, add:

```yaml
  # ───────────────────────────── Deploy to qrsm.store (main only) ─────────────────────────────
  deploy:
    name: Deploy (GHCR pull + compose)
    runs-on: ubuntu-latest
    needs: [build, e2e]
    if: (github.event_name == 'push' || github.event_name == 'workflow_dispatch') && github.ref == 'refs/heads/main'
    environment: production
    concurrency:
      group: deploy-qrsm-store
      cancel-in-progress: false
    steps:
      - uses: actions/checkout@v4

      - name: Configure SSH
        env:
          DEPLOY_SSH_KEY: ${{ secrets.DEPLOY_SSH_KEY }}
          DEPLOY_HOST: ${{ secrets.DEPLOY_HOST }}
          DEPLOY_PORT: ${{ secrets.DEPLOY_PORT }}
        run: |
          set -euo pipefail
          install -m 700 -d ~/.ssh
          printf '%s\n' "$DEPLOY_SSH_KEY" > ~/.ssh/id_deploy
          chmod 600 ~/.ssh/id_deploy
          ssh-keyscan -p "${DEPLOY_PORT:-22}" -H "${DEPLOY_HOST:-46.224.105.254}" >> ~/.ssh/known_hosts 2>/dev/null

      - name: Rsync deploy bundle to server
        env:
          DEPLOY_HOST: ${{ secrets.DEPLOY_HOST }}
          DEPLOY_USER: ${{ secrets.DEPLOY_USER }}
          DEPLOY_PORT: ${{ secrets.DEPLOY_PORT }}
        run: |
          set -euo pipefail
          # Additive (no --delete), -R preserves the docker/postgres/init path. Server-only
          # files (.env, the db volume) are never sent and never removed.
          rsync -azR \
            -e "ssh -i ~/.ssh/id_deploy -p ${DEPLOY_PORT:-22}" \
            docker-compose.prod.yml docker/postgres/init splash \
            "${DEPLOY_USER:-root}@${DEPLOY_HOST:-46.224.105.254}:/opt/q-records-storemanager/"

      - name: Pull image, up, health-check
        env:
          DEPLOY_HOST: ${{ secrets.DEPLOY_HOST }}
          DEPLOY_USER: ${{ secrets.DEPLOY_USER }}
          DEPLOY_PORT: ${{ secrets.DEPLOY_PORT }}
          IMAGE_TAG: ${{ github.sha }}
        run: |
          set -euo pipefail
          ssh -i ~/.ssh/id_deploy -p "${DEPLOY_PORT:-22}" \
            "${DEPLOY_USER:-root}@${DEPLOY_HOST:-46.224.105.254}" \
            IMAGE_TAG="$IMAGE_TAG" 'bash -seuo pipefail' <<'REMOTE'
          cd /opt/q-records-storemanager
          export IMAGE_TAG="${IMAGE_TAG:-latest}"
          docker compose -f docker-compose.prod.yml pull
          docker compose -f docker-compose.prod.yml up -d --remove-orphans
          docker image prune -f >/dev/null 2>&1 || true
          for i in $(seq 1 20); do
            s="$(docker inspect -f '{{.State.Health.Status}}' qrsm-web 2>/dev/null || echo missing)"
            echo "health attempt $i: $s"
            [ "$s" = "healthy" ] && exit 0
            sleep 6
          done
          echo "qrsm-web did not become healthy in time" >&2
          docker logs --tail 80 qrsm-web || true
          exit 1
          REMOTE
```

- [ ] **Step 3: Validate the workflow YAML**

Run:
```bash
python3 -c "import yaml,sys; d=yaml.safe_load(open('.github/workflows/ci.yml')); assert 'deploy' in d['jobs']; assert d['jobs']['deploy']['needs']==['build','e2e']; print('CI YAML OK')"
```
Expected: `CI YAML OK`. (If `actionlint` is installed, also run `actionlint .github/workflows/ci.yml`.)

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci(deploy): GHCR image-pull deploy job for qrsm.store (main only, health-gated)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Operator runbook

**Files:**
- Create: `docs/RUNBOOK-qrsm-store.md`

**Interfaces:** documentation only — the ordered one-time bootstrap + DNS records + rollback.

- [ ] **Step 1: Write the runbook**

Create `docs/RUNBOOK-qrsm-store.md`:

````markdown
# RUNBOOK — q·records storemanager on qrsm.store

Server: `root@46.224.105.254` · Deploy dir: `/opt/q-records-storemanager` · Domain: `qrsm.store`
Spec: `docs/superpowers/specs/2026-07-08-qrecords-v2-production-deploy-qrsm-store-design.md`

## One-time bootstrap (ordered)

### 1. DNS (Hetzner DNS console)
Create the `qrsm.store` zone, then add:

```
A     qrsm.store        46.224.105.254
A     *.qrsm.store      46.224.105.254
```

Point the registrar's nameservers at the ones Hetzner lists for the zone. Verify:

```bash
dig +short demo.qrsm.store   # → 46.224.105.254
```

### 2. Mail records (SPF / DKIM / DMARC)
Generate DKIM on the server (docker-mailserver mints the record):

```bash
docker exec -ti mailserver setup config dkim domain qrsm.store   # default selector: mail
cat /tmp/docker-mailserver/opendkim/keys/qrsm.store/mail.txt      # the TXT value to publish
```

Publish in the Hetzner zone:

```
TXT   qrsm.store              v=spf1 ip4:46.224.105.254 -all
TXT   mail._domainkey.qrsm.store   <the p=... value from mail.txt>
TXT   _dmarc.qrsm.store       v=DMARC1; p=none; rua=mailto:postmaster@qrsm.store; adkim=r; aspf=r
# optional (receive / strict alignment); mailserver FQDN: `docker exec mailserver hostname -f`
MX    qrsm.store   10   mail.nyxcore.cloud
```

Tighten DMARC to `p=quarantine` then `p=reject` once SPF+DKIM report `pass`.

### 3. Traefik prerequisites (verify on server)
```bash
docker exec <traefik-container> traefik version     # v2 vs v3 → HostRegexp form (see compose comment)
```
- Confirm the resolver is named `letsencrypt` and its Hetzner DNS API token is authorized for `qrsm.store` (not scoped to nyxcore.cloud only). If scoped, extend the token and restart Traefik.
- Confirm `security-headers@file` and `gzip-compress@file` middlewares exist.

### 4. Registry + deploy access
```bash
# GHCR pull auth — persistent, server-side (a read-only PAT with read:packages):
echo <GHCR_READ_PAT> | docker login ghcr.io -u <github-user> --password-stdin
```
Add the CI deploy public key to `~/.ssh/authorized_keys`; set repo secrets `DEPLOY_SSH_KEY`, `DEPLOY_HOST=46.224.105.254` (+ optional `DEPLOY_USER`/`DEPLOY_PORT`).

### 5. Server dir + secrets
```bash
mkdir -p /opt/q-records-storemanager
cd /opt/q-records-storemanager
# copy .env.prod.example content into .env and fill every value:
#   openssl rand -base64 32   # AUTH_SECRET
#   openssl rand -base64 32   # ENCRYPTION_KEY (must decode to 32 bytes)
# real Stripe(test)/OpenAI/Discogs keys + a strong PLATFORM_ADMIN_PASSWORD (>=12 chars).
chmod 600 .env
```

Stripe: create a **test-mode** webhook at `https://admin.qrsm.store/api/billing/webhook`; put its signing secret in `STRIPE_WEBHOOK_SECRET`.

### 6. First deploy
Merge the branch to `main` (pipeline runs) or trigger `workflow_dispatch` from `main`. It rsyncs the bundle, pulls the image, `up -d`, and health-checks `qrsm-web`. Confirm Traefik issued the `*.qrsm.store` cert (watch Traefik logs).

### 7. Create the superadmin (one-time)
```bash
cd /opt/q-records-storemanager
docker compose -f docker-compose.prod.yml --profile bootstrap run --rm bootstrap
# → "[bootstrap] Platform superadmin ... created. Login at https://admin.qrsm.store"
```

### 8. Verify (acceptance)
```bash
curl -sI https://demo.qrsm.store | head -1         # 200/302, valid *.qrsm.store cert
curl -sI https://qrsm.store | head -1              # → splash (200)
docker logs qrsm-web | grep "database safety"      # "All database safety assertions passed"
```
Log into `https://admin.qrsm.store`, create the first real tenant, confirm `https://<slug>.qrsm.store` serves and the credential mail arrives from `noreply@qrsm.store` (headers: `spf=pass`, `dkim=pass`). If credential mail throws with a TLS/cert error, set `MAIL_SMTP_INSECURE=1` in `.env` and `docker compose -f docker-compose.prod.yml up -d web worker`.

## Redeploy
Push to `main` → the pipeline pulls the new `:${sha}` and `up -d` (migrations re-run idempotently).

## Rollback
```bash
cd /opt/q-records-storemanager
IMAGE_TAG=<previous-good-sha> docker compose -f docker-compose.prod.yml up -d web worker
```

## Backup (follow-up, recommended)
```bash
docker exec qrsm-db pg_dump -U postgres qrecords | gzip > qrecords-$(date +%F).sql.gz
```
````

- [ ] **Step 2: Commit**

```bash
git add docs/RUNBOOK-qrsm-store.md
git commit -m "docs(deploy): qrsm.store operator runbook (DNS/DKIM, bootstrap, rollback)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Final gate — build + full suite + compose validation

Per the project's final-review rule (build + full vitest before PR). No new code — a verification checkpoint.

**Files:** none (verification only).

- [ ] **Step 1: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 2: Full unit/integration suite**

Run: `pnpm test`
Expected: PASS (includes the new `platform-admin` + `email-mailpit` suites; the container suites run under the existing maxForks:4 cap).

- [ ] **Step 3: Host build sanity**

Run:
```bash
NEXT_TELEMETRY_DISABLED=1 DATABASE_URL=postgresql://qr_app:x@localhost:5432/qrecords \
DATABASE_OWNER_URL=postgresql://qr_owner:x@localhost:5432/qrecords \
PGBOSS_DATABASE_URL=postgresql://qr_owner:x@localhost:5432/qrecords \
ROOT_DOMAIN=localhost APP_PROTOCOL=http APP_PORT=3000 \
AUTH_SECRET=ci-build-placeholder-secret-min-32-characters \
ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= ENCRYPTION_KEY_ID=v1 \
MAIL_DRIVER=console MAIL_HOST=localhost MAIL_PORT=1025 MAIL_FROM=noreply@localhost \
pnpm build
```
Expected: `next build` succeeds.

- [ ] **Step 4: Production compose validates**

Run: `docker compose -f docker-compose.prod.yml --env-file .env.prod.example config >/dev/null && echo "PROD COMPOSE OK"`
Expected: `PROD COMPOSE OK`.

- [ ] **Step 5: Optional end-to-end dry run of the prod stack (fake drivers)**

> Local-only smoke test — do NOT commit the throwaway env. Proves migrate→web boot-guard→splash all come up from the prod compose without the real integrations.

```bash
cp .env.prod.example /tmp/qrsm.env
# in /tmp/qrsm.env: set ROOT_DOMAIN=localhost, all *_PASSWORD to a value, matching DATABASE_* URLs,
#   BILLING_DRIVER=fake, DISCOGS_DRIVER=fake, EMBEDDINGS_DRIVER=fake, real 32-byte ENCRYPTION_KEY.
IMAGE_TAG=latest docker compose -f docker-compose.prod.yml --env-file /tmp/qrsm.env up -d --build db migrate web splash --wait --wait-timeout 300
docker compose -f docker-compose.prod.yml --env-file /tmp/qrsm.env ps
docker compose -f docker-compose.prod.yml --env-file /tmp/qrsm.env --profile bootstrap run --rm -e PLATFORM_ADMIN_EMAIL=oli@localhost -e PLATFORM_ADMIN_PASSWORD=localtestpw123 bootstrap
docker compose -f docker-compose.prod.yml --env-file /tmp/qrsm.env down -v   # OK here: throwaway local stack
```
Expected: `web` reaches healthy; bootstrap logs "created".

- [ ] **Step 6: Push the branch**

```bash
git push -u origin feat/deploy-qrsm-store
```

Then open a PR into `main` (stacked on the Slice-7 work). Merging both to `main` triggers the first production deploy.

---

## Self-Review

**Spec coverage:** §3 topology → Task 4; §4 DNS/TLS/mail records → Task 7 (runbook); §5 Traefik routing → Task 4 labels; §6 compose → Task 4; §7 env → Task 4 (`.env.prod.example`) + Task 3 (`MAIL_SMTP_INSECURE`); §8 bootstrap → Tasks 1+2; §9 pipeline → Task 6 (with the server-side `docker login` improvement, replacing the `GHCR_PULL_TOKEN` secret in §9); §10 file inventory → all tasks; §11 runbook → Task 7; §12/§13/§14 security/verify/risks → Task 7 verify + runbook; §15 follow-ups → Task 7 backup note. All covered.

**Placeholder scan:** No TBD/TODO. `CHANGE_ME` markers appear only inside `.env.prod.example` (an intentional operator-fill template) and the runbook's `<...>` are genuine server-side lookups (Traefik container name, DKIM value, GHCR PAT) that cannot be known from the repo.

**Type consistency:** `ensurePlatformAdmin(ownerPool: Pool, { email, password })` → `{ created: boolean }` used identically in Task 2's wrapper and Task 1's test. `assertStrongAdminPassword` signature identical across lib/test/wrapper. `mailpitTransportOptions({host,port,insecure})` identical across adapter and test. `IMAGE_TAG` interpolation identical across compose (`${IMAGE_TAG:-latest}`) and the deploy job.
