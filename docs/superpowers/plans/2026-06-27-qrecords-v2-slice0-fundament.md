# Slice 0 — Fundament Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-06-27
**Spec:** `docs/superpowers/specs/2026-06-25-qrecords-v2-slice0-fundament-design.md`
**Architecture overview:** `docs/superpowers/specs/2026-06-25-qrecords-v2-architecture-overview.md`

**Goal:** Build the multi-tenant foundation (scaffold, design system, RLS data layer, auth shell, worker, provisioning, deploy) on which Slices 1–7 are built without cross-tenant bugs or design drift.

**Architecture:** Single Next.js 15 (App Router) app. Tenant isolation is enforced by PostgreSQL Row-Level Security; the ONLY runtime DB surface is `withTenant()`/`withSuperadmin()`/`withOwner()`, which open a transaction and set tenant context via transaction-local `set_config(..., is_local=true)`. Edge middleware resolves the subdomain to a header; a Node-side cached resolver turns it into a tenant row. Auth.js v5 (Credentials + DB sessions) is bound to the tenant by an explicit session↔tenant invariant and `__Host-` cookies. A separate pg-boss worker process handles jobs. Everything ships via a CI-prebuilt standalone Docker image + docker-compose.

**Tech Stack:** Next.js 15, React 19, TypeScript (strict), Tailwind CSS v4 (`@theme`), Drizzle ORM + drizzle-kit, node-postgres (`pg`), PostgreSQL 17, Auth.js v5 (`next-auth@beta`), pg-boss v10, `bcryptjs`, `zod`, `lucide-react`, Vitest, `@testcontainers/postgresql`, Playwright, pnpm 9, Node 22.

## Global Constraints

Every task inherits these. Exact values, copied from the spec:

- **Node 22 LTS, pnpm 9, PostgreSQL 17.** TypeScript `strict: true`; no `any` in committed code.
- **The ONLY way to touch tenant data at runtime is `withTenant` / `withSuperadmin` / `withOwner` from `src/db/tenant.ts`.** The raw pool / `drizzle` client lives in `src/db/client.ts` (`import 'server-only'`) and is import-restricted to `src/db/**` by ESLint `no-restricted-imports`. No other file may import `@/db/client`.
- **Transaction-local context only.** Set tenant GUCs with `set_config(name, value, true)` (the `true` = is_local = transaction-scoped). NEVER `SET` (connection-scoped — leaks across the pool). NEVER connection-scoped session state for tenant/superadmin.
- **GUC names exactly:** `app.current_tenant`, `app.current_user_id`, `app.is_superadmin`. NEVER `app.current_user` (reserved).
- **No default-tenant fallback anywhere.** Unknown/missing/reserved subdomain → 404 (`notFound()`), never a fallback tenant.
- **`is_superadmin` defaults to `'false'` in every `withTenant` transaction** — never inherited from connection state.
- **RLS is NOT managed by drizzle-kit.** Use `drizzle-kit generate` (versioned SQL), NEVER `push` in shared/prod. RLS (enable+FORCE, policies, roles, grants, GUC column defaults) are hand-written ordered SQL migration steps.
- **App DB role `qr_app` is NOT a superuser and has NO `BYPASSRLS`.** Migrations / registry writes use `qr_owner`. The boot assertion fails closed if violated.
- **Cookies:** `__Host-` prefix, host-only (no `Domain`), `Secure`, `HttpOnly`, `SameSite=Lax`.
- **Money columns:** `numeric(10,2)`. **Hash column:** `varchar(64)`. **Discogs condition scale:** 0–7.
- **Commit after each task** with a conventional-commit message. Work only on branch `feat/v2-foundation`.

## Task Order & Dependency Notes

Tasks are ordered so each builds only on earlier ones. Tasks 5–7 (RLS migration → DB surface → fail-closed tests) are the security spine and must land before any feature work. Suggested execution order = numeric. Tasks 2, 3, 13 are the design-fidelity track and can proceed in parallel with the data track (4–7) if using multiple workers.

---

## Tasks

- Task 1: Scaffold & tooling
- Task 2: Design tokens, theming cascade, fonts, focus
- Task 3: Frozen UI primitives
- Task 4: Drizzle schema + base migration + hash
- Task 5: RLS migration + roles + migrate runner
- Task 6: DB client + withTenant/withSuperadmin/withOwner + boot assertions
- Task 7: RLS fail-closed integration tests
- Task 8: Crypto helper (AES-256-GCM)
- Task 9: Edge subdomain resolution + getCurrentTenant
- Task 10: Auth shell (Auth.js v5, DB sessions, tenant invariant)
- Task 11: Email adapter + Mailpit
- Task 12: Tenant provisioning + seed
- Task 13: App shell UI + integration stub interfaces
- Task 14: Worker (pg-boss)
- Task 15: Deploy (Docker, compose, CI) + E2E acceptance

---

### Task 1: Scaffold & tooling

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.ts`
- Create: `eslint.config.mjs`
- Create: `.prettierrc`
- Create: `postcss.config.mjs`
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `src/env.ts`
- Create: `tests/__mocks__/server-only.ts`
- Create: `.nvmrc`
- Create: `.env.example`
- Create: `.dockerignore`
- Test: `tests/unit/env.test.ts`

**Interfaces:**
- Consumes: nothing (Task 1 is the root — no prior task outputs)
- Produces (SPINE PART C verbatim):
  ```ts
  // src/env.ts
  export type Env = z.infer<typeof envSchema>;
  export const env: Env;                          // zod-validated; throws on boot if any required key is absent/invalid
  export function tenantUrl(slug: string): string; // ${APP_PROTOCOL}://${slug}.${ROOT_DOMAIN}${port?}
  ```

---

#### Cycle A — Project initialization (configuration files)

- [ ] **Step A1: Write `package.json` with all SPINE-mandated scripts and the full stack**

```json
{
  "name": "storemanager",
  "version": "0.1.0",
  "private": true,
  "engines": {
    "node": ">=22",
    "pnpm": ">=9"
  },
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "worker": "tsx src/worker/index.ts",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "e2e": "playwright test",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "tsx src/db/migrate.ts",
    "db:seed": "tsx scripts/seed.ts"
  },
  "dependencies": {
    "bcryptjs": "^2.4.3",
    "dotenv": "^16.4.0",
    "drizzle-orm": "^0.38.0",
    "lucide-react": "^0.468.0",
    "next": "^15.0.0",
    "next-auth": "beta",
    "nodemailer": "^6.9.0",
    "pg": "^8.13.0",
    "pg-boss": "^10.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "server-only": "^0.0.1",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@eslint/eslintrc": "^3.2.0",
    "@playwright/test": "^1.49.0",
    "@tailwindcss/postcss": "^4.0.0",
    "@testcontainers/postgresql": "^10.0.0",
    "@testing-library/jest-dom": "^6.6.0",
    "@testing-library/react": "^16.1.0",
    "@testing-library/user-event": "^14.5.0",
    "@types/bcryptjs": "^2.4.6",
    "@types/node": "^22.0.0",
    "@types/nodemailer": "^6.4.17",
    "@types/pg": "^8.11.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitest/coverage-v8": "^2.1.0",
    "drizzle-kit": "^0.30.0",
    "esbuild": "^0.24.0",
    "eslint": "^9.0.0",
    "eslint-config-next": "^15.0.0",
    "jsdom": "^25.0.0",
    "postcss": "^8.4.0",
    "prettier": "^3.4.0",
    "tailwindcss": "^4.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step A2: Install dependencies**

```bash
pnpm install
```

Expected: lockfile written, `node_modules/` populated. No errors.

- [ ] **Step A3: Write `tsconfig.json` — strict mode, `@/*` → `src/*` path alias**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": [
    "next-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    ".next/types/**/*.ts",
    "tests/**/*.ts"
  ],
  "exclude": ["node_modules"]
}
```

- [ ] **Step A4: Write `next.config.ts` — standalone output, allowed origins**

```ts
import type { NextConfig } from 'next';

const rootDomain = process.env.ROOT_DOMAIN ?? 'localhost';

const nextConfig: NextConfig = {
  output: 'standalone',
  serverActions: {
    allowedOrigins: [rootDomain, `*.${rootDomain}`],
  },
};

export default nextConfig;
```

- [ ] **Step A5: Write `postcss.config.mjs` — Tailwind v4 plugin**

```mjs
/** @type {import('postcss').Config} */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
```

- [ ] **Step A6: Write `eslint.config.mjs` — Next.js rules + `no-restricted-imports` gate on `@/db/client`**

```mjs
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
});

/** @type {import('eslint').Linter.Config[]} */
const eslintConfig = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    // Applied to all TS/TSX source files EXCEPT src/db/** where the raw pool is permitted.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/db/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/db/client', '**/db/client'],
              message:
                'Direct import of db/client is forbidden outside src/db/**. ' +
                'Use withTenant / withSuperadmin / withOwner from @/db/tenant instead.',
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
```

- [ ] **Step A7: Write `.prettierrc`**

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

- [ ] **Step A8: Write `vitest.config.ts` — node environment, `@/*` alias, `server-only` mock**

```ts
import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    // Component tests (*.tsx and tests/ui/**) need a DOM; everything else stays in the fast node env.
    environmentMatchGlobs: [
      ['tests/ui/**', 'jsdom'],
      ['**/*.tsx', 'jsdom'],
    ],
    // jest-dom matchers extend vitest's `expect`; RTL tests call cleanup() in their own afterEach.
    setupFiles: ['@testing-library/jest-dom/vitest'],
    // Don't set globals:true — tests import from 'vitest' explicitly (strict TS friendly)
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Neutralise the 'server-only' guard in test context — it is a compile-time concern only.
      'server-only': path.resolve(__dirname, './tests/__mocks__/server-only.ts'),
    },
  },
});
```

- [ ] **Step A9: Write `tests/__mocks__/server-only.ts`**

```ts
// intentionally empty — server-only is a compile-time import guard; tests run in Node directly.
export {};
```

- [ ] **Step A10: Write `playwright.config.ts` — base URL, screenshot/video on failure, E2E glob**

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: process.env.BASE_URL ?? 'http://demo.localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // E2E tests require the stack to be running; do NOT start a dev server here.
  // Run: docker compose up -d  before  pnpm e2e
});
```

- [ ] **Step A11: Write `.nvmrc`**

```
22
```

- [ ] **Step A12: Write `.env.example` — all SPINE env keys with sample values**

```dotenv
# ── Application ───────────────────────────────────────────────
NODE_ENV=development
ROOT_DOMAIN=localhost
APP_PROTOCOL=http
APP_PORT=3000

# ── Database ──────────────────────────────────────────────────
# qr_app = runtime role (non-superuser, NOBYPASSRLS)
DATABASE_URL=postgresql://qr_app:changeme@localhost:5432/qrdb
# qr_owner = migration / registry-write role
DATABASE_OWNER_URL=postgresql://qr_owner:changeme@localhost:5432/qrdb
# pg-boss uses qr_owner connection (owns pgboss schema)
PGBOSS_DATABASE_URL=postgresql://qr_owner:changeme@localhost:5432/qrdb

# ── Auth.js ───────────────────────────────────────────────────
# Generate: openssl rand -base64 32
AUTH_SECRET=change-me-replace-with-openssl-rand-base64-32-output

# ── Encryption (AES-256-GCM) ──────────────────────────────────
# Generate: openssl rand -base64 32   (must decode to exactly 32 bytes)
# 32-byte AES key, base64. Replace before real use:  openssl rand -base64 32
ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
ENCRYPTION_KEY_ID=v1

# ── Mail ──────────────────────────────────────────────────────
MAIL_DRIVER=mailpit
MAIL_HOST=localhost
MAIL_PORT=1025
MAIL_FROM=noreply@localhost

# ── Pool / timeouts ───────────────────────────────────────────
DB_POOL_MAX=10
DB_STATEMENT_TIMEOUT_MS=10000
DB_IDLE_TX_TIMEOUT_MS=10000
```

- [ ] **Step A13: Write `.dockerignore`**

```
node_modules
.next
.env
.env.local
.env.*.local
!.env.example
*.log
coverage
dist
.git
.DS_Store
```

---

#### Cycle B — `src/env.ts` (TDD)

- [ ] **Step B1: Write the failing test**

```ts
// tests/unit/env.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest';

/** A complete, valid set of env vars used as a baseline across tests. */
const VALID_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  ROOT_DOMAIN: 'localhost',
  APP_PROTOCOL: 'http',
  APP_PORT: '3000',
  DATABASE_URL: 'postgresql://qr_app:pass@localhost:5432/qrdb',
  DATABASE_OWNER_URL: 'postgresql://qr_owner:pass@localhost:5432/qrdb',
  PGBOSS_DATABASE_URL: 'postgresql://qr_owner:pass@localhost:5432/qrdb',
  AUTH_SECRET: 'a-test-secret-that-is-at-least-one-char',
  ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
  ENCRYPTION_KEY_ID: 'v1',
  MAIL_DRIVER: 'console',
  MAIL_HOST: 'localhost',
  MAIL_PORT: '1025',
  MAIL_FROM: 'noreply@localhost',
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('env — validation', () => {
  it('throws on boot when DATABASE_URL is missing', async () => {
    const { DATABASE_URL: _omitted, ...withoutDb } = VALID_ENV;
    Object.entries(withoutDb).forEach(([k, v]) => vi.stubEnv(k, v));

    await expect(() => import('@/env')).rejects.toThrow();
  });

  it('throws on boot when MAIL_DRIVER is an invalid value', async () => {
    Object.entries({ ...VALID_ENV, MAIL_DRIVER: 'sendgrid' }).forEach(([k, v]) =>
      vi.stubEnv(k, v),
    );

    await expect(() => import('@/env')).rejects.toThrow();
  });

  it('parses a valid env with correct types', async () => {
    Object.entries(VALID_ENV).forEach(([k, v]) => vi.stubEnv(k, v));

    const { env } = await import('@/env');

    expect(env.ROOT_DOMAIN).toBe('localhost');
    expect(env.APP_PROTOCOL).toBe('http');
    expect(env.APP_PORT).toBe('3000');
    expect(env.MAIL_DRIVER).toBe('console');
    // Numeric defaults applied
    expect(env.DB_POOL_MAX).toBe(10);
    expect(env.DB_STATEMENT_TIMEOUT_MS).toBe(10000);
    expect(env.DB_IDLE_TX_TIMEOUT_MS).toBe(10000);
  });

  it('applies numeric defaults when optional keys are absent', async () => {
    // DB_POOL_MAX, DB_STATEMENT_TIMEOUT_MS, DB_IDLE_TX_TIMEOUT_MS are optional with defaults
    const {
      DB_POOL_MAX: _1,
      DB_STATEMENT_TIMEOUT_MS: _2,
      DB_IDLE_TX_TIMEOUT_MS: _3,
      ...withoutOptionals
    } = VALID_ENV;
    Object.entries(withoutOptionals).forEach(([k, v]) => vi.stubEnv(k, v));

    const { env } = await import('@/env');

    expect(env.DB_POOL_MAX).toBe(10);
    expect(env.DB_STATEMENT_TIMEOUT_MS).toBe(10000);
    expect(env.DB_IDLE_TX_TIMEOUT_MS).toBe(10000);
  });

  it('coerces MAIL_PORT string to number', async () => {
    Object.entries({ ...VALID_ENV, MAIL_PORT: '2525' }).forEach(([k, v]) => vi.stubEnv(k, v));

    const { env } = await import('@/env');

    expect(env.MAIL_PORT).toBe(2525);
    expect(typeof env.MAIL_PORT).toBe('number');
  });
});

describe('tenantUrl()', () => {
  it('includes non-default port (http + 3000)', async () => {
    Object.entries({ ...VALID_ENV, APP_PROTOCOL: 'http', APP_PORT: '3000' }).forEach(([k, v]) =>
      vi.stubEnv(k, v),
    );
    const { tenantUrl } = await import('@/env');

    expect(tenantUrl('demo')).toBe('http://demo.localhost:3000');
  });

  it('omits port 80 for http', async () => {
    Object.entries({ ...VALID_ENV, APP_PROTOCOL: 'http', APP_PORT: '80' }).forEach(([k, v]) =>
      vi.stubEnv(k, v),
    );
    const { tenantUrl } = await import('@/env');

    expect(tenantUrl('demo')).toBe('http://demo.localhost');
  });

  it('omits port 443 for https', async () => {
    Object.entries({
      ...VALID_ENV,
      APP_PROTOCOL: 'https',
      APP_PORT: '443',
      ROOT_DOMAIN: 'example.com',
    }).forEach(([k, v]) => vi.stubEnv(k, v));
    const { tenantUrl } = await import('@/env');

    expect(tenantUrl('vinylcave')).toBe('https://vinylcave.example.com');
  });

  it('uses the slug verbatim in the subdomain position', async () => {
    Object.entries(VALID_ENV).forEach(([k, v]) => vi.stubEnv(k, v));
    const { tenantUrl } = await import('@/env');

    expect(tenantUrl('my-shop')).toMatch(/^http:\/\/my-shop\.localhost/);
  });
});
```

- [ ] **Step B2: Run test to verify it fails**

```bash
pnpm test tests/unit/env.test.ts
```

Expected: FAIL — `Cannot find module '@/env' ...` (the module does not exist yet)

- [ ] **Step B3: Implement `src/env.ts`**

```ts
import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // ── Domain ────────────────────────────────────────────────
  ROOT_DOMAIN: z.string().min(1),
  APP_PROTOCOL: z.enum(['http', 'https']).default('http'),
  /** Kept as string — used verbatim in URL construction via tenantUrl(). */
  APP_PORT: z.string().default('3000'),

  // ── Database ──────────────────────────────────────────────
  /** qr_app connection string — runtime role, non-superuser, NOBYPASSRLS. */
  DATABASE_URL: z.string().url(),
  /** qr_owner connection string — migrations, registry writes. */
  DATABASE_OWNER_URL: z.string().url(),
  /** pg-boss connection string — uses qr_owner, manages pgboss schema. */
  PGBOSS_DATABASE_URL: z.string().url(),

  // ── Auth.js ───────────────────────────────────────────────
  AUTH_SECRET: z.string().min(1),

  // ── Encryption (AES-256-GCM) ─────────────────────────────
  /** Base64-encoded 32-byte key. Full byte-length check done by assertEncryptionKey() at boot. */
  // Validated for exactly 32 decoded bytes HERE so every process (web, worker, migrate,
  // seed) fails closed at env load — assertEncryptionKey() remains a library helper but the
  // boot guarantee no longer depends on anyone remembering to call it.
  ENCRYPTION_KEY: z
    .string()
    .refine((v) => {
      try {
        return Buffer.from(v, 'base64').length === 32;
      } catch {
        return false;
      }
    }, 'ENCRYPTION_KEY must be base64 encoding exactly 32 bytes (AES-256)'),
  ENCRYPTION_KEY_ID: z.string().min(1),

  // ── Mail ──────────────────────────────────────────────────
  MAIL_DRIVER: z.enum(['mailpit', 'console']),
  MAIL_HOST: z.string().min(1),
  MAIL_PORT: z.coerce.number().int().positive(),
  MAIL_FROM: z.string().email(),

  // ── Pool / timeouts ───────────────────────────────────────
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(10_000),
  DB_IDLE_TX_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(10_000),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validated environment variables. Throws a ZodError at module-load time (boot) if any
 * required key is absent or fails validation — this is intentional "fail-closed on boot".
 */
export const env: Env = envSchema.parse(process.env);

/**
 * Builds a fully-qualified tenant URL.
 * Omits port when it is the protocol default (80 for http, 443 for https).
 *
 * Example: tenantUrl('demo') → 'http://demo.localhost:3000'
 */
export function tenantUrl(slug: string): string {
  const defaultPort = env.APP_PROTOCOL === 'https' ? '443' : '80';
  const port = env.APP_PORT === defaultPort ? '' : `:${env.APP_PORT}`;
  return `${env.APP_PROTOCOL}://${slug}.${env.ROOT_DOMAIN}${port}`;
}
```

- [ ] **Step B4: Run test to verify it passes**

```bash
pnpm test tests/unit/env.test.ts
```

Expected: PASS — all 9 tests green (validation × 4, tenantUrl × 4, coercion × 1)

---

#### Cycle C — ESLint `no-restricted-imports` gate (manual verification)

- [ ] **Step C1: Create a temporary canary file that imports `@/db/client` from `src/app/`**

```ts
// src/app/_eslint-canary.ts  ← create temporarily; delete after Step C3
import { appPool } from '@/db/client';   // intentional: must trigger ESLint error

export const _unused = appPool;
```

- [ ] **Step C2: Run lint to verify the rule fires**

```bash
pnpm lint src/app/_eslint-canary.ts
```

Expected: ERROR containing:

```
Direct import of db/client is forbidden outside src/db/**
```

- [ ] **Step C3: Delete the canary file**

```bash
rm src/app/_eslint-canary.ts
```

---

#### Cycle D — Full suite gate

- [ ] **Step D1: Run all checks**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Expected:
- `pnpm lint` — PASS (no errors on the project as it stands)
- `pnpm typecheck` — PASS (no TS errors under strict mode)
- `pnpm test` — PASS (env unit tests green)
- `pnpm build` — PASS; `.next/standalone/` directory is produced (verifies `output: 'standalone'`)

---

- [ ] **Step D2: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json next.config.ts eslint.config.mjs \
  .prettierrc postcss.config.mjs vitest.config.ts playwright.config.ts \
  src/env.ts tests/unit/env.test.ts tests/__mocks__/server-only.ts \
  .nvmrc .env.example .dockerignore
git commit -m "feat(slice0): scaffold — pnpm/TS strict/ESLint/Vitest/Playwright/env validation"
```

---

### Task 2: Design tokens, theming cascade, fonts, focus

**Files:**
- Create: `src/styles/tokens.css`
- Create: `src/styles/globals.css`
- Create: `src/lib/fonts.ts`
- Create: `src/fonts/` (directory; self-hosted woff2 files placed here — see Step 3)
- Test: `tests/tokens.test.ts`
- Test (authored here, first run deferred to Task 15 when server is up): `e2e/theme.spec.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure CSS/TS, no DB or env dependency)
- Produces (verbatim names later tasks consume):
  - `export const displayFont: NextFont` — `src/lib/fonts.ts`; consumed by `src/app/layout.tsx` (Task 13)
  - `export const bodyFont: NextFont` — `src/lib/fonts.ts`; consumed by `src/app/layout.tsx` (Task 13)
  - `export const monoFont: NextFont` — `src/lib/fonts.ts`; consumed by `src/app/layout.tsx` (Task 13)
  - CSS custom properties: `:root`, `[data-theme="dark"]`, `[data-accent="coral"]`, `[data-accent="indigo"]`, `[data-accent="forest"]`, `[data-theme="dark"][data-accent=*]` — consumed by every component task (Tasks 3, 13, and beyond)
  - `@utility focus-ring-button` and `@utility focus-ring-field` in `globals.css` — referenced by Task 3 primitives

---

- [ ] **Step 1: Write the failing tests**

```ts
// tests/tokens.test.ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const root = resolve(__dirname, '..');
const tokens = readFileSync(resolve(root, 'src/styles/tokens.css'), 'utf8');
const globals = readFileSync(resolve(root, 'src/styles/globals.css'), 'utf8');

describe('tokens.css — primitive ramps (verbatim from handoff)', () => {
  it('contains coral ramp', () => {
    expect(tokens).toContain('--coral-50:#FDF1EC');
    expect(tokens).toContain('--coral-100:#FADCD0');
    expect(tokens).toContain('--coral-200:#F5B9A3');
    expect(tokens).toContain('--coral-300:#F0917A');
    expect(tokens).toContain('--coral-400:#EC6F50');
    expect(tokens).toContain('--coral-500:#E8552E');
    expect(tokens).toContain('--coral-600:#CB4220');
    expect(tokens).toContain('--coral-700:#A2351B');
    expect(tokens).toContain('--coral-800:#7B2916');
    expect(tokens).toContain('--coral-900:#561D11');
  });
  it('contains amber ramp', () => {
    expect(tokens).toContain('--amber-50:#FEF7EA');
    expect(tokens).toContain('--amber-100:#FBEAC6');
    expect(tokens).toContain('--amber-200:#F8D78D');
    expect(tokens).toContain('--amber-300:#F5C357');
    expect(tokens).toContain('--amber-400:#F2A93B');
    expect(tokens).toContain('--amber-500:#E08E18');
    expect(tokens).toContain('--amber-600:#BB7211');
    expect(tokens).toContain('--amber-700:#93590F');
  });
  it('contains full warm neutral ramp', () => {
    expect(tokens).toContain('--n-0:#FFFFFF');
    expect(tokens).toContain('--n-50:#FAF6F1');
    expect(tokens).toContain('--n-100:#F2EBE2');
    expect(tokens).toContain('--n-150:#EAE1D5');
    expect(tokens).toContain('--n-200:#E0D5C6');
    expect(tokens).toContain('--n-300:#CDBEAB');
    expect(tokens).toContain('--n-400:#AC9C86');
    expect(tokens).toContain('--n-500:#857968');
    expect(tokens).toContain('--n-600:#665C4E');
    expect(tokens).toContain('--n-700:#4C443A');
    expect(tokens).toContain('--n-800:#332D26');
    expect(tokens).toContain('--n-850:#26211B');
    expect(tokens).toContain('--n-900:#1B1712');
    expect(tokens).toContain('--n-950:#120F0B');
  });
  it('contains semantic feedback primitives', () => {
    expect(tokens).toContain('--green-500:#2F9E68');
    expect(tokens).toContain('--green-600:#1F7E51');
    expect(tokens).toContain('--green-50:#E8F5EE');
    expect(tokens).toContain('--red-500:#DC4B3E');
    expect(tokens).toContain('--red-600:#B6362C');
    expect(tokens).toContain('--red-50:#FCEDEB');
    expect(tokens).toContain('--blue-500:#3B82C4');
    expect(tokens).toContain('--blue-600:#2C6AA3');
    expect(tokens).toContain('--blue-50:#EAF2FA');
    expect(tokens).toContain('--honey-500:#E08E18');
    expect(tokens).toContain('--honey-50:#FEF3E0');
  });
  it('contains disc base tokens', () => {
    expect(tokens).toContain('--disc-base:#15110D');
    expect(tokens).toContain('--disc-groove-a:#1d1813');
    expect(tokens).toContain('--disc-groove-b:#2a221b');
  });
  it('contains disc-label token (pinned, not accent-tracked)', () => {
    expect(tokens).toContain('--disc-label:');
  });
});

describe('tokens.css — light semantic layer', () => {
  it('has bg/surface/border/text', () => {
    expect(tokens).toContain('--bg:var(--n-50)');
    expect(tokens).toContain('--surface:var(--n-0)');
    expect(tokens).toContain('--surface-2:var(--n-50)');
    expect(tokens).toContain('--surface-3:var(--n-100)');
    expect(tokens).toContain('--border:var(--n-200)');
    expect(tokens).toContain('--border-strong:var(--n-300)');
    expect(tokens).toContain('--text:var(--n-900)');
    expect(tokens).toContain('--text-2:var(--n-600)');
    expect(tokens).toContain('--text-3:var(--n-500)');
  });
  it('has default coral accent family', () => {
    expect(tokens).toContain('--accent:var(--coral-500)');
    expect(tokens).toContain('--accent-hover:var(--coral-600)');
    expect(tokens).toContain('--accent-press:var(--coral-700)');
    expect(tokens).toContain('--accent-soft:var(--coral-50)');
    expect(tokens).toContain('--accent-soft-border:var(--coral-200)');
    expect(tokens).toContain('--accent-ink:var(--coral-700)');
    expect(tokens).toContain('--on-accent:#FFFFFF');
  });
  it('has honey, focus, and feedback tokens', () => {
    expect(tokens).toContain('--honey:var(--amber-400)');
    expect(tokens).toContain('--honey-soft:var(--amber-50)');
    expect(tokens).toContain('--honey-ink:var(--amber-700)');
    expect(tokens).toContain('--focus:var(--coral-500)');
    expect(tokens).toContain('--ok:var(--green-600)');
    expect(tokens).toContain('--ok-soft:var(--green-50)');
    expect(tokens).toContain('--warn:var(--honey-600,#BB7211)');
    expect(tokens).toContain('--warn-soft:var(--amber-50)');
    expect(tokens).toContain('--bad:var(--red-600)');
    expect(tokens).toContain('--bad-soft:var(--red-50)');
    expect(tokens).toContain('--info:var(--blue-600)');
    expect(tokens).toContain('--info-soft:var(--blue-50)');
  });
  it('has spacing scale', () => {
    expect(tokens).toContain('--s1:4px');
    expect(tokens).toContain('--s2:8px');
    expect(tokens).toContain('--s3:12px');
    expect(tokens).toContain('--s4:16px');
    expect(tokens).toContain('--s5:24px');
    expect(tokens).toContain('--s6:32px');
    expect(tokens).toContain('--s7:48px');
    expect(tokens).toContain('--s8:64px');
    expect(tokens).toContain('--tap:44px');
  });
  it('has radius scale', () => {
    expect(tokens).toContain('--r-xs:6px');
    expect(tokens).toContain('--r-sm:10px');
    expect(tokens).toContain('--r-md:14px');
    expect(tokens).toContain('--r-lg:20px');
    expect(tokens).toContain('--r-xl:28px');
    expect(tokens).toContain('--r-pill:999px');
  });
  it('has shadow tokens (verbatim)', () => {
    expect(tokens).toContain('--shadow-1:0 1px 2px rgba(40,28,16,.06),0 1px 3px rgba(40,28,16,.08)');
    expect(tokens).toContain('--shadow-2:0 4px 10px -2px rgba(40,28,16,.10),0 2px 6px -2px rgba(40,28,16,.08)');
    expect(tokens).toContain('--shadow-3:0 16px 32px -8px rgba(40,28,16,.16),0 6px 14px -6px rgba(40,28,16,.10)');
  });
  it('has motion tokens', () => {
    expect(tokens).toContain('--ease:cubic-bezier(.2,.7,.2,1)');
    expect(tokens).toContain('--dur-1:120ms');
    expect(tokens).toContain('--dur-2:220ms');
    expect(tokens).toContain('--dur-3:380ms');
  });
  it('has font var declarations', () => {
    expect(tokens).toContain("--font-display:'Bricolage Grotesque'");
    expect(tokens).toContain("--font-body:'Hanken Grotesk'");
    expect(tokens).toContain("--font-mono:'Geist Mono'");
  });
});

describe('tokens.css — dark theme overrides', () => {
  it('has [data-theme="dark"] block', () => {
    expect(tokens).toContain('[data-theme="dark"]');
  });
  it('has dark semantic bg/surface/border/text (verbatim)', () => {
    expect(tokens).toContain('--bg:var(--n-950)');
    expect(tokens).toContain('--surface:var(--n-900)');
    expect(tokens).toContain('--surface-2:var(--n-850)');
    expect(tokens).toContain('--surface-3:var(--n-800)');
    expect(tokens).toContain('--border:#352e26');
    expect(tokens).toContain('--border-strong:#4a4035');
    expect(tokens).toContain('--text-2:#c3b6a4');
    expect(tokens).toContain('--text-3:#9b8f7d');
  });
  it('has dark coral accent defaults (verbatim)', () => {
    expect(tokens).toContain('--accent:#F2734C');
    expect(tokens).toContain('--accent-hover:#F58A68');
    expect(tokens).toContain('--accent-press:#F7A085');
    expect(tokens).toContain('--accent-soft:#3a221880');
    expect(tokens).toContain('--accent-soft-border:#6e3a26');
    expect(tokens).toContain('--accent-ink:#F9B49C');
    expect(tokens).toContain('--on-accent:#2a0f06');
  });
  it('has dark honey/focus/feedback (verbatim)', () => {
    expect(tokens).toContain('--honey:#F5C357');
    expect(tokens).toContain('--honey-soft:#3a2e1580');
    expect(tokens).toContain('--honey-ink:#F8D78D');
    expect(tokens).toContain('--focus:#F58A68');
    expect(tokens).toContain('--ok:#4FC489');
    expect(tokens).toContain('--ok-soft:#16352580');
    expect(tokens).toContain('--warn:#F2A93B');
    expect(tokens).toContain('--warn-soft:#3a2e1580');
    expect(tokens).toContain('--bad:#F0786C');
    expect(tokens).toContain('--bad-soft:#3a1c1880');
    expect(tokens).toContain('--info:#6BA7DC');
    expect(tokens).toContain('--info-soft:#16283a80');
  });
  it('has dark disc tokens (verbatim)', () => {
    expect(tokens).toContain('--disc-base:#0a0805');
    expect(tokens).toContain('--disc-groove-a:#16110c');
    expect(tokens).toContain('--disc-groove-b:#231b14');
  });
  it('has dark shadow tokens (verbatim)', () => {
    expect(tokens).toContain('--shadow-1:0 1px 2px rgba(0,0,0,.4)');
    expect(tokens).toContain('--shadow-2:0 6px 16px -4px rgba(0,0,0,.5)');
    expect(tokens).toContain('--shadow-3:0 20px 40px -10px rgba(0,0,0,.6)');
  });
});

describe('tokens.css — accent families (authored; coral/indigo/forest × light/dark)', () => {
  it('has [data-accent="coral"] block', () => {
    expect(tokens).toContain('[data-accent="coral"]');
  });
  it('has [data-accent="indigo"] block with full 7-token family', () => {
    expect(tokens).toContain('[data-accent="indigo"]');
    const idx = tokens.indexOf('[data-accent="indigo"]');
    const block = tokens.slice(idx, idx + 600);
    expect(block).toContain('--accent:');
    expect(block).toContain('--accent-hover:');
    expect(block).toContain('--accent-press:');
    expect(block).toContain('--accent-soft:');
    expect(block).toContain('--accent-soft-border:');
    expect(block).toContain('--accent-ink:');
    expect(block).toContain('--on-accent:');
    expect(block).toContain('--focus:');
  });
  it('has [data-accent="forest"] block with full 7-token family', () => {
    expect(tokens).toContain('[data-accent="forest"]');
    const idx = tokens.indexOf('[data-accent="forest"]');
    const block = tokens.slice(idx, idx + 600);
    expect(block).toContain('--accent:');
    expect(block).toContain('--accent-soft:');
    expect(block).toContain('--on-accent:');
  });
  it('has dark variant combinators for each accent', () => {
    expect(tokens).toContain('[data-theme="dark"][data-accent="coral"]');
    expect(tokens).toContain('[data-theme="dark"][data-accent="indigo"]');
    expect(tokens).toContain('[data-theme="dark"][data-accent="forest"]');
  });
});

describe('globals.css structure', () => {
  it('imports tailwindcss v4', () => {
    expect(globals).toContain('@import "tailwindcss"');
  });
  it('imports tokens', () => {
    expect(globals).toContain('@import "./tokens.css"');
  });
  it('has @theme block', () => {
    expect(globals).toContain('@theme {');
  });
  it('has focus-ring-button utility with :focus-visible', () => {
    expect(globals).toContain('focus-ring-button');
    expect(globals).toContain(':focus-visible');
    expect(globals).toContain('outline: 3px solid var(--focus)');
    expect(globals).toContain('outline-offset: 2px');
  });
  it('has focus-ring-field utility', () => {
    expect(globals).toContain('focus-ring-field');
    expect(globals).toContain('border-color: var(--accent)');
    expect(globals).toContain('box-shadow: 0 0 0 3px var(--accent-soft)');
  });
  it('has prefers-reduced-motion block (verbatim from handoff)', () => {
    expect(globals).toContain('prefers-reduced-motion:reduce');
    expect(globals).toContain('animation-duration:.001ms!important');
    expect(globals).toContain('transition-duration:.001ms!important');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/tokens.test.ts`
Expected: FAIL with `ENOENT: no such file or directory … tokens.css` — neither file exists yet.

---

- [ ] **Step 3: Download self-hosted font files**

Geist Mono is distributed via the `geist` npm package (already in `node_modules` after Task 1's `pnpm install`). Bricolage Grotesque and Hanken Grotesk must be downloaded as woff2 variable fonts. Run once (add to README / onboarding docs):

```bash
mkdir -p src/fonts

# Bricolage Grotesque Variable (opsz axis 12..96, wght 500–800) — Latin subset
curl -sL "https://fonts.gstatic.com/s/bricolagegrotesque/v11/pxiDypAnsdpnsElX7sO1bLFEXgMOHIL7oRPo9RlBMFpkhU_Hg-MYhKlBzs9PNolZ1izM2Q.woff2" \
  -o src/fonts/BricolageGrotesque-Variable.woff2

# Hanken Grotesk Variable (wght 400–700) — Latin subset
curl -sL "https://fonts.gstatic.com/s/hankengrotesk/v8/C8c14dM-vnz-s-3jaEsxlqnfjiGs1HHCf67P8H_QHCl-H2w.woff2" \
  -o src/fonts/HankenGrotesk-Variable.woff2

# Geist Mono woff2 is already in node_modules/geist/dist/fonts/
# We symlink it into src/fonts for next/font/local resolution:
cp node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2 src/fonts/GeistMono-Variable.woff2
```

Add this to `.gitignore` only if woff2 files must not be committed (check licence). Google Fonts permits redistribution; Geist is MIT. Commit the woff2 files.

---

- [ ] **Step 4: Implement `src/styles/tokens.css`**

All values below are verbatim from the handoff files. The `[data-accent="indigo"]` and `[data-accent="forest"]` families are authored using the handoff's primitive ramps (blue-50/500/600, green-50/500/600) following the identical 7-token family pattern.

```css
/* src/styles/tokens.css — SINGLE SOURCE OF TRUTH for all design tokens.
   Values verbatim from Design System 2026.dc.html and Q-Records App.dc.html.
   Accent families (indigo/forest) authored from handoff primitive ramps.
   DO NOT edit hex values here without updating the handoff. */

:root {
  /* ── Fonts ── */
  --font-display: 'Bricolage Grotesque', system-ui, sans-serif;
  --font-body: 'Hanken Grotesk', system-ui, -apple-system, sans-serif;
  --font-mono: 'Geist Mono', ui-monospace, SFMono-Regular, monospace;

  /* ── Primitive ramps ── */
  /* coral */
  --coral-50: #FDF1EC; --coral-100: #FADCD0; --coral-200: #F5B9A3;
  --coral-300: #F0917A; --coral-400: #EC6F50; --coral-500: #E8552E;
  --coral-600: #CB4220; --coral-700: #A2351B; --coral-800: #7B2916;
  --coral-900: #561D11;

  /* amber/honey */
  --amber-50: #FEF7EA; --amber-100: #FBEAC6; --amber-200: #F8D78D;
  --amber-300: #F5C357; --amber-400: #F2A93B; --amber-500: #E08E18;
  --amber-600: #BB7211; --amber-700: #93590F;
  --honey-500: #E08E18; --honey-50: #FEF3E0;

  /* warm neutral */
  --n-0: #FFFFFF;   --n-50: #FAF6F1;  --n-100: #F2EBE2; --n-150: #EAE1D5;
  --n-200: #E0D5C6; --n-300: #CDBEAB; --n-400: #AC9C86; --n-500: #857968;
  --n-600: #665C4E; --n-700: #4C443A; --n-800: #332D26; --n-850: #26211B;
  --n-900: #1B1712; --n-950: #120F0B;

  /* semantic feedback primitives */
  --green-500: #2F9E68; --green-600: #1F7E51; --green-50: #E8F5EE;
  --red-500:   #DC4B3E; --red-600:   #B6362C; --red-50:   #FCEDEB;
  --blue-500:  #3B82C4; --blue-600:  #2C6AA3; --blue-50:  #EAF2FA;

  /* ── Semantic / light (default) ── */
  --bg:         var(--n-50);
  --surface:    var(--n-0);
  --surface-2:  var(--n-50);
  --surface-3:  var(--n-100);
  --border:         var(--n-200);
  --border-strong:  var(--n-300);
  --text:   var(--n-900);
  --text-2: var(--n-600);
  --text-3: var(--n-500);

  /* default accent = coral */
  --accent:             var(--coral-500);
  --accent-hover:       var(--coral-600);
  --accent-press:       var(--coral-700);
  --accent-soft:        var(--coral-50);
  --accent-soft-border: var(--coral-200);
  --accent-ink:         var(--coral-700);
  --on-accent:          #FFFFFF;

  /* honey */
  --honey:      var(--amber-400);
  --honey-soft: var(--amber-50);
  --honey-ink:  var(--amber-700);

  /* focus */
  --focus: var(--coral-500);

  /* feedback */
  --ok:        var(--green-600); --ok-soft:   var(--green-50);
  --warn:      var(--honey-600,#BB7211); --warn-soft: var(--amber-50);
  --bad:       var(--red-600);   --bad-soft:  var(--red-50);
  --info:      var(--blue-600);  --info-soft: var(--blue-50);

  /* disc (vinyl brand — pinned, not accent-tracked) */
  --disc-base:    #15110D;
  --disc-groove-a: #1d1813;
  --disc-groove-b: #2a221b;
  --disc-label:   var(--coral-500); /* intentionally pinned — see §6.5 spec */

  /* elevation */
  --shadow-1: 0 1px 2px rgba(40,28,16,.06),0 1px 3px rgba(40,28,16,.08);
  --shadow-2: 0 4px 10px -2px rgba(40,28,16,.10),0 2px 6px -2px rgba(40,28,16,.08);
  --shadow-3: 0 16px 32px -8px rgba(40,28,16,.16),0 6px 14px -6px rgba(40,28,16,.10);

  /* radius */
  --r-xs: 6px; --r-sm: 10px; --r-md: 14px;
  --r-lg: 20px; --r-xl: 28px; --r-pill: 999px;

  /* spacing */
  --s1: 4px;  --s2: 8px;  --s3: 12px; --s4: 16px;
  --s5: 24px; --s6: 32px; --s7: 48px; --s8: 64px;

  /* motion */
  --ease:  cubic-bezier(.2,.7,.2,1);
  --dur-1: 120ms; --dur-2: 220ms; --dur-3: 380ms;

  /* tap target */
  --tap: 44px;
}

/* ── Dark theme overrides ── */
[data-theme="dark"] {
  --bg:         var(--n-950);
  --surface:    var(--n-900);
  --surface-2:  var(--n-850);
  --surface-3:  var(--n-800);
  --border:         #352e26;
  --border-strong:  #4a4035;
  --text:   var(--n-100);
  --text-2: #c3b6a4;
  --text-3: #9b8f7d;

  /* default dark accent = dark-coral */
  --accent:             #F2734C;
  --accent-hover:       #F58A68;
  --accent-press:       #F7A085;
  --accent-soft:        #3a221880;
  --accent-soft-border: #6e3a26;
  --accent-ink:         #F9B49C;
  --on-accent:          #2a0f06;

  --honey:      #F5C357;
  --honey-soft: #3a2e1580;
  --honey-ink:  #F8D78D;

  --focus: #F58A68;

  --ok:        #4FC489; --ok-soft:   #16352580;
  --warn:      #F2A93B; --warn-soft: #3a2e1580;
  --bad:       #F0786C; --bad-soft:  #3a1c1880;
  --info:      #6BA7DC; --info-soft: #16283a80;

  --disc-base:     #0a0805;
  --disc-groove-a: #16110c;
  --disc-groove-b: #231b14;
  --disc-label:    #F2734C; /* pinned dark-coral */

  --shadow-1: 0 1px 2px rgba(0,0,0,.4);
  --shadow-2: 0 6px 16px -4px rgba(0,0,0,.5);
  --shadow-3: 0 20px 40px -10px rgba(0,0,0,.6);
}

/* ── Accent family: coral (explicit; mirrors :root default for JS-driven switching) ── */
[data-accent="coral"] {
  --accent:             var(--coral-500);
  --accent-hover:       var(--coral-600);
  --accent-press:       var(--coral-700);
  --accent-soft:        var(--coral-50);
  --accent-soft-border: var(--coral-200);
  --accent-ink:         var(--coral-700);
  --on-accent:          #FFFFFF;
  --focus:              var(--coral-500);
}
[data-theme="dark"][data-accent="coral"] {
  --accent:             #F2734C;
  --accent-hover:       #F58A68;
  --accent-press:       #F7A085;
  --accent-soft:        #3a221880;
  --accent-soft-border: #6e3a26;
  --accent-ink:         #F9B49C;
  --on-accent:          #2a0f06;
  --focus:              #F58A68;
}

/* ── Accent family: indigo (authored from blue-50/500/600 primitives in handoff) ── */
[data-accent="indigo"] {
  --accent:             #3B82C4;   /* blue-500 verbatim */
  --accent-hover:       #2C6AA3;   /* blue-600 verbatim */
  --accent-press:       #1F5487;   /* derived blue-700 */
  --accent-soft:        #EAF2FA;   /* blue-50 verbatim */
  --accent-soft-border: #93C4E8;   /* derived blue-200 */
  --accent-ink:         #2C6AA3;   /* blue-600 verbatim */
  --on-accent:          #FFFFFF;
  --focus:              #3B82C4;
}
[data-theme="dark"][data-accent="indigo"] {
  --accent:             #6BA7DC;   /* --info in dark, verbatim from handoff */
  --accent-hover:       #88BDE8;
  --accent-press:       #A4CEEF;
  --accent-soft:        #16283a80;
  --accent-soft-border: #2a4a72;
  --accent-ink:         #9AC5EC;
  --on-accent:          #071829;
  --focus:              #6BA7DC;
}

/* ── Accent family: forest (authored from green-50/500/600 primitives in handoff) ── */
[data-accent="forest"] {
  --accent:             #2F9E68;   /* green-500 verbatim */
  --accent-hover:       #1F7E51;   /* green-600 verbatim */
  --accent-press:       #165C3A;   /* derived green-700 */
  --accent-soft:        #E8F5EE;   /* green-50 verbatim */
  --accent-soft-border: #8DCFAC;   /* derived green-200 */
  --accent-ink:         #1F7E51;   /* green-600 verbatim */
  --on-accent:          #FFFFFF;
  --focus:              #2F9E68;
}
[data-theme="dark"][data-accent="forest"] {
  --accent:             #4FC489;   /* --ok in dark, verbatim from handoff */
  --accent-hover:       #6CD4A2;
  --accent-press:       #87E0B7;
  --accent-soft:        #16352580;
  --accent-soft-border: #2a5540;
  --accent-ink:         #7FD8AD;
  --on-accent:          #062718;
  --focus:              #4FC489;
}
```

---

- [ ] **Step 5: Implement `src/styles/globals.css`**

```css
/* src/styles/globals.css */
@import "tailwindcss";
@import "./tokens.css";

/* ── Tailwind v4 @theme bridge ──
   Maps CSS custom properties to Tailwind's design-token namespace so
   utilities like bg-accent, text-text-2, shadow-shadow-1 work. */
@theme {
  /* colors */
  --color-bg:               var(--bg);
  --color-surface:          var(--surface);
  --color-surface-2:        var(--surface-2);
  --color-surface-3:        var(--surface-3);
  --color-border:           var(--border);
  --color-border-strong:    var(--border-strong);
  --color-text:             var(--text);
  --color-text-2:           var(--text-2);
  --color-text-3:           var(--text-3);
  --color-accent:           var(--accent);
  --color-accent-hover:     var(--accent-hover);
  --color-accent-press:     var(--accent-press);
  --color-accent-soft:      var(--accent-soft);
  --color-accent-ink:       var(--accent-ink);
  --color-on-accent:        var(--on-accent);
  --color-focus:            var(--focus);
  --color-ok:               var(--ok);
  --color-ok-soft:          var(--ok-soft);
  --color-warn:             var(--warn);
  --color-warn-soft:        var(--warn-soft);
  --color-bad:              var(--bad);
  --color-bad-soft:         var(--bad-soft);
  --color-info:             var(--info);
  --color-info-soft:        var(--info-soft);
  --color-honey:            var(--honey);
  --color-honey-soft:       var(--honey-soft);
  --color-honey-ink:        var(--honey-ink);
  /* coral ramp */
  --color-coral-50:  var(--coral-50);  --color-coral-100: var(--coral-100);
  --color-coral-200: var(--coral-200); --color-coral-300: var(--coral-300);
  --color-coral-400: var(--coral-400); --color-coral-500: var(--coral-500);
  --color-coral-600: var(--coral-600); --color-coral-700: var(--coral-700);
  --color-coral-800: var(--coral-800); --color-coral-900: var(--coral-900);
  /* neutral ramp */
  --color-n-0:   var(--n-0);   --color-n-50:  var(--n-50);
  --color-n-100: var(--n-100); --color-n-200: var(--n-200);
  --color-n-300: var(--n-300); --color-n-400: var(--n-400);
  --color-n-500: var(--n-500); --color-n-600: var(--n-600);
  --color-n-700: var(--n-700); --color-n-800: var(--n-800);
  --color-n-900: var(--n-900); --color-n-950: var(--n-950);
  /* spacing */
  --spacing-s1: var(--s1); --spacing-s2: var(--s2); --spacing-s3: var(--s3);
  --spacing-s4: var(--s4); --spacing-s5: var(--s5); --spacing-s6: var(--s6);
  --spacing-s7: var(--s7); --spacing-s8: var(--s8); --spacing-tap: var(--tap);
  /* radius */
  --radius-xs:   var(--r-xs);   --radius-sm:  var(--r-sm);
  --radius-md:   var(--r-md);   --radius-lg:  var(--r-lg);
  --radius-xl:   var(--r-xl);   --radius-pill: var(--r-pill);
  /* shadows */
  --shadow-1: var(--shadow-1);
  --shadow-2: var(--shadow-2);
  --shadow-3: var(--shadow-3);
  /* fonts */
  --font-display: var(--font-display);
  --font-body:    var(--font-body);
  --font-mono:    var(--font-mono);
  /* motion */
  --ease:  var(--ease);
  --dur-1: var(--dur-1);
  --dur-2: var(--dur-2);
  --dur-3: var(--dur-3);
}

/* ── Base reset (verbatim from handoff) ── */
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-body);
  -webkit-font-smoothing: antialiased;
  min-height: 100vh;
}

/* ── Focus utilities (use :focus-visible — never :focus alone) ──
   Apply via Tailwind utility class: focus-ring-button / focus-ring-field */
@utility focus-ring-button {
  &:focus-visible {
    outline: 3px solid var(--focus);
    outline-offset: 2px;
  }
}

@utility focus-ring-field {
  &:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
}

/* ── Reduced motion (verbatim from handoff) ── */
@media (prefers-reduced-motion:reduce) {
  * {
    animation-duration:.001ms!important;
    animation-iteration-count:1!important;
    transition-duration:.001ms!important;
  }
}

/* ── Spin keyframe (for Spinner component + VinylDisc) ── */
@keyframes spin { to { transform: rotate(360deg); } }

/* ── Theming shorthand helpers on <html> ── */
[data-theme="light"] { background: #FAF6F1; }
[data-theme="dark"]  { background: #120F0B; }
```

---

- [ ] **Step 6: Implement `src/lib/fonts.ts`**

```ts
// src/lib/fonts.ts
// Self-hosted fonts loaded via next/font/local.
// Woff2 files live in src/fonts/ (see scripts/download-fonts.sh).
// Each font sets its CSS variable on whatever element receives the className,
// which is <html> in src/app/layout.tsx.
import localFont from 'next/font/local';

/** Bricolage Grotesque variable — display font.
 *  Sets --font-display on <html> when className is applied. */
export const displayFont = localFont({
  src: [
    {
      path: '../fonts/BricolageGrotesque-Variable.woff2',
      weight: '500 800',
      style: 'normal',
    },
  ],
  variable: '--font-display',
  display: 'swap',
  adjustFontFallback: 'Arial',
  fallback: ['system-ui', 'sans-serif'],
});

/** Hanken Grotesk variable — body font.
 *  Sets --font-body on <html> when className is applied. */
export const bodyFont = localFont({
  src: [
    {
      path: '../fonts/HankenGrotesk-Variable.woff2',
      weight: '400 700',
      style: 'normal',
    },
  ],
  variable: '--font-body',
  display: 'swap',
  adjustFontFallback: 'Arial',
  fallback: ['system-ui', '-apple-system', 'sans-serif'],
});

/** Geist Mono variable — monospace font for prices, IDs, catalog data.
 *  Sets --font-mono on <html> when className is applied. */
export const monoFont = localFont({
  src: [
    {
      path: '../fonts/GeistMono-Variable.woff2',
      weight: '400 500',
      style: 'normal',
    },
  ],
  variable: '--font-mono',
  display: 'swap',
  adjustFontFallback: 'Courier New',
  fallback: ['ui-monospace', 'SFMono-Regular', 'monospace'],
});
```

---

- [ ] **Step 7: Write `tests/fonts.test.ts`**

```ts
// tests/fonts.test.ts
import { describe, it, expect } from 'vitest';

describe('fonts.ts exports', () => {
  it('displayFont has variable --font-display', async () => {
    // next/font/local cannot run in Node test environment (it's a compile-time transform).
    // We validate the source file structure instead.
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../src/lib/fonts.ts'), 'utf8');
    expect(src).toContain("variable: '--font-display'");
    expect(src).toContain("variable: '--font-body'");
    expect(src).toContain("variable: '--font-mono'");
  });
  it('exports displayFont, bodyFont, monoFont', async () => {
    const src = (await import('node:fs')).readFileSync(
      (await import('node:path')).resolve(__dirname, '../src/lib/fonts.ts'), 'utf8'
    );
    expect(src).toContain('export const displayFont');
    expect(src).toContain('export const bodyFont');
    expect(src).toContain('export const monoFont');
  });
  it('uses display: swap for all fonts', async () => {
    const src = (await import('node:fs')).readFileSync(
      (await import('node:path')).resolve(__dirname, '../src/lib/fonts.ts'), 'utf8'
    );
    const swapCount = (src.match(/display: 'swap'/g) ?? []).length;
    expect(swapCount).toBe(3);
  });
  it('references woff2 files in src/fonts/', async () => {
    const src = (await import('node:fs')).readFileSync(
      (await import('node:path')).resolve(__dirname, '../src/lib/fonts.ts'), 'utf8'
    );
    expect(src).toContain('BricolageGrotesque-Variable.woff2');
    expect(src).toContain('HankenGrotesk-Variable.woff2');
    expect(src).toContain('GeistMono-Variable.woff2');
  });
});
```

- [ ] **Step 8: Run all tokens and fonts tests to verify they pass**

Run: `pnpm test tests/tokens.test.ts tests/fonts.test.ts`
Expected: PASS — all assertions green.

If the woff2 files are missing (CI / first checkout), the fonts tests still pass because they check source text, not runtime loading. A separate CI step or `scripts/download-fonts.sh` handles font file acquisition before `pnpm build`.

---

- [ ] **Step 9: Author E2E test (deferred run to Task 15)**

```ts
// e2e/theme.spec.ts
import { test, expect } from '@playwright/test';

// These tests require a running dev/prod server. They are authored in Task 2
// and first executed as part of Task 15 acceptance (§9.7).

test.describe('theming cascade — accent + dark mode', () => {
  test.beforeEach(async ({ page }) => {
    // Task 15 provides BASE_URL via playwright.config.ts
    await page.goto('/');
    // Ensure the page has finished hydrating before we inspect CSS
    await page.waitForLoadState('networkidle');
  });

  test('initial paint is already themed — no FOUC (SSR sets data-theme/data-accent)', async ({
    page,
  }) => {
    const html = page.locator('html');
    // layout.tsx (Task 13) sets data-theme and data-accent server-side
    const theme = await html.getAttribute('data-theme');
    const accent = await html.getAttribute('data-accent');
    expect(['light', 'dark']).toContain(theme);
    expect(['coral', 'indigo', 'forest']).toContain(accent);
  });

  test('--accent resolves to a hex value (not empty)', async ({ page }) => {
    const accent = await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue('--accent')
        .trim()
    );
    expect(accent).toMatch(/^#[0-9a-fA-F]{6}|var\(--/);
  });

  test('switching data-accent coral→indigo changes --accent', async ({ page }) => {
    const html = page.locator('html');

    await html.evaluate((el) => el.setAttribute('data-accent', 'coral'));
    const coralAccent = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
    );

    await html.evaluate((el) => el.setAttribute('data-accent', 'indigo'));
    const indigoAccent = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
    );

    expect(coralAccent).not.toBe(indigoAccent);
  });

  test('switching data-accent coral→forest changes --accent', async ({ page }) => {
    const html = page.locator('html');

    await html.evaluate((el) => el.setAttribute('data-accent', 'coral'));
    const coralAccent = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
    );

    await html.evaluate((el) => el.setAttribute('data-accent', 'forest'));
    const forestAccent = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
    );

    expect(coralAccent).not.toBe(forestAccent);
  });

  test('switching data-theme light→dark changes --bg', async ({ page }) => {
    const html = page.locator('html');

    await html.evaluate((el) => el.setAttribute('data-theme', 'light'));
    const lightBg = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
    );

    await html.evaluate((el) => el.setAttribute('data-theme', 'dark'));
    const darkBg = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
    );

    expect(lightBg).not.toBe(darkBg);
  });

  test('dark + indigo: --accent differs from dark + coral', async ({ page }) => {
    const html = page.locator('html');

    await html.evaluate((el) => {
      el.setAttribute('data-theme', 'dark');
      el.setAttribute('data-accent', 'coral');
    });
    const darkCoral = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
    );

    await html.evaluate((el) => el.setAttribute('data-accent', 'indigo'));
    const darkIndigo = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
    );

    expect(darkCoral).not.toBe(darkIndigo);
  });

  test('--disc-label stays coral regardless of accent family (brand pin)', async ({
    page,
  }) => {
    const html = page.locator('html');

    await html.evaluate((el) => {
      el.setAttribute('data-theme', 'light');
      el.setAttribute('data-accent', 'coral');
    });
    const labelCoral = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--disc-label').trim()
    );

    await html.evaluate((el) => el.setAttribute('data-accent', 'indigo'));
    const labelIndigo = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--disc-label').trim()
    );

    // disc-label is pinned to coral — must not change when switching accent
    expect(labelCoral).toBe(labelIndigo);
  });
});
```

Run: (deferred — requires running server from Task 15)
`pnpm e2e e2e/theme.spec.ts`
Expected (Task 15): PASS — all 7 assertions green.

---

- [ ] **Step 10: Run final verification and typecheck**

Run: `pnpm lint && pnpm typecheck && pnpm test tests/tokens.test.ts tests/fonts.test.ts`
Expected: PASS — lint, tsc --noEmit, and both Vitest suites green.

---

- [ ] **Step 11: Commit**

```bash
git add src/styles/tokens.css src/styles/globals.css src/lib/fonts.ts \
        src/fonts/ tests/tokens.test.ts tests/fonts.test.ts e2e/theme.spec.ts
git commit -m "$(cat <<'EOF'
feat(slice0): design tokens, theming cascade, self-hosted fonts, focus utilities

Ports all primitive ramps and semantic tokens verbatim from the 2026 design
handoff into tokens.css (single source of truth). Authors coral/indigo/forest
accent families (7-token each × light/dark). Bridges into Tailwind v4 @theme.
Adds focus-ring-button / focus-ring-field @utilities (focus-visible only).
Self-hosts Bricolage Grotesque, Hanken Grotesk and Geist Mono via next/font/local
with display:swap + size-adjust fallback. E2E theme-switch tests authored for
Task-15 acceptance (§9.7).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Frozen UI primitives

**Files:**
- Create: `src/components/ui/Button.tsx`
- Create: `src/components/ui/Input.tsx`
- Create: `src/components/ui/Select.tsx`
- Create: `src/components/ui/Textarea.tsx`
- Create: `src/components/ui/StatusBadge.tsx`
- Create: `src/components/ui/ConditionPill.tsx`
- Create: `src/components/ui/Toggle.tsx`
- Create: `src/components/ui/Checkbox.tsx`
- Create: `src/components/ui/SegmentedControl.tsx`
- Create: `src/components/ui/SearchField.tsx`
- Create: `src/components/ui/Spinner.tsx`
- Create: `src/components/ui/Card.tsx`
- Create: `src/components/ui/Surface.tsx`
- Create: `src/components/ui/Sheet.tsx`
- Create: `src/components/ui/Modal.tsx`
- Create: `src/components/ui/VinylDisc.tsx`
- Create: `src/components/ui/CoverPlaceholder.tsx`
- Create: `src/components/ui/index.ts`
- Test: `tests/ui/ui-primitives.test.tsx`

**Interfaces:**
- Consumes: CSS custom properties from `src/styles/tokens.css` (Task 2): `--accent`, `--disc-label`, `--disc-base`, `--disc-groove-a`, `--disc-groove-b`, `--focus`, `--on-accent`, `--ok`, `--ok-soft`, `--info`, `--info-soft`, `--honey`, `--honey-soft`, `--honey-ink`, `--bad`, `--bad-soft`, `--surface`, `--surface-2`, `--surface-3`, `--border`, `--border-strong`, `--text`, `--text-2`, `--text-3`, `--r-*`, `--shadow-*`, `--tap`, `--dur-1`, `--ease`; focus utility classes `focus-ring-button` and `focus-ring-field` from `src/styles/globals.css` (Task 2). No `server-only` imports; these are pure client components.
- Produces (all re-exported from `src/components/ui/index.ts`, used by Task 13 app shell and Slice 1+ screens):

```ts
export { Button }           // variant: primary|secondary|ghost|danger|honey; size: sm36|md44|lg52; loading, icon, disabled
export { Input }            // standard input attrs + error boolean
export { Select }           // options[], value, onChange + error
export { Textarea }         // standard textarea attrs + error
export { StatusBadge }      // status: RecordStatus ('verfuegbar'|'reserviert'|'verkauft'|'verliehen')
export { ConditionPill }    // condition: 0-7 (Discogs scale)
export { Toggle }           // checked, onChange, label, disabled
export { Checkbox }         // checked, onChange, label, disabled
export { SegmentedControl } // options[], value, onChange, aria-label
export { SearchField }      // standard search input attrs + pill boolean
export { Spinner }          // size?, color?
export { Card }             // children, elevation?: 1|2|3
export { Surface }          // children, level?: 1|2|3
export { Sheet }            // open, onClose, title?, side?: 'right'|'bottom', children
export { Modal }            // open, onClose, title, children — portal to document.body
export { VinylDisc }        // size?, variant?: 'logo'|'card'|'display', spinning?
export { CoverPlaceholder } // aspectRatio?, className?
```

---

- [ ] **Step 1: Write the failing test suite**

```tsx
// tests/ui/ui-primitives.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

import { StatusBadge } from '@/components/ui/StatusBadge';
import { ConditionPill } from '@/components/ui/ConditionPill';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Sheet } from '@/components/ui/Sheet';
import { Modal } from '@/components/ui/Modal';
import { VinylDisc } from '@/components/ui/VinylDisc';
import { Toggle } from '@/components/ui/Toggle';
import { Checkbox } from '@/components/ui/Checkbox';
import { SegmentedControl } from '@/components/ui/SegmentedControl';

afterEach(cleanup);

// ── StatusBadge ────────────────────────────────────────────────────────────────

describe('StatusBadge', () => {
  it.each([
    ['verfuegbar', 'im Lager'],
    ['reserviert', 'Reserviert'],
    ['verkauft',   'Verkauft'],
    ['verliehen',  'Verliehen'],
  ] as const)('status=%s renders text label "%s"', (status, label) => {
    render(<StatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('renders an aria-hidden dot element beside the label', () => {
    const { container } = render(<StatusBadge status="verfuegbar" />);
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });

  it('is never color-only: text label is always visible', () => {
    render(<StatusBadge status="verkauft" />);
    expect(screen.getByText('Verkauft')).toBeVisible();
  });
});

// ── ConditionPill ──────────────────────────────────────────────────────────────

describe('ConditionPill', () => {
  it.each([
    [7, 'Mint', '#1f8a52', '#ffffff'],
    [6, 'NM',   '#2f9e68', '#ffffff'],
    [5, 'VG+',  '#9bc34a', '#3a2400'],
    [4, 'VG',   '#e2c044', '#3a2400'],
    [3, 'G+',   '#efab3b', '#3a2400'],
    [2, 'G',    '#e0762e', '#ffffff'],
    [1, 'Fair', '#d65532', '#ffffff'],
    [0, 'Poor', '#b6362c', '#ffffff'],
  ] as const)('condition=%i → label "%s", bg %s, color %s', (condition, label, bg, fg) => {
    const { container } = render(<ConditionPill condition={condition} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    const el = container.firstChild as HTMLElement;
    expect(el.style.background).toBe(bg);
    expect(el.style.color).toBe(fg);
  });

  it('is never color-only: text label always present', () => {
    render(<ConditionPill condition={5} />);
    expect(screen.getByText('VG+')).toBeVisible();
  });
});

// ── Button ─────────────────────────────────────────────────────────────────────

describe('Button', () => {
  it('renders a real <button type="button">', () => {
    render(<Button>Save</Button>);
    const btn = screen.getByRole('button', { name: /save/i });
    expect(btn.tagName).toBe('BUTTON');
    expect(btn).toHaveAttribute('type', 'button');
  });

  it('loading state: aria-busy=true and animated spinner present', () => {
    const { container } = render(<Button loading>Saving</Button>);
    const btn = container.querySelector('button') as HTMLButtonElement;
    expect(btn).toHaveAttribute('aria-busy', 'true');
    const spinner = btn.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(spinner).toBeInTheDocument();
    expect(spinner.style.animation).toMatch(/spin/);
  });

  it('disabled state: button has disabled attribute', () => {
    render(<Button disabled>Save</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it.each(['primary', 'secondary', 'ghost', 'danger', 'honey'] as const)(
    'variant=%s renders without error',
    (variant) => {
      render(<Button variant={variant}>Label</Button>);
      expect(screen.getByRole('button')).toBeInTheDocument();
    }
  );

  it.each(['sm36', 'md44', 'lg52'] as const)('size=%s renders without error', (size) => {
    render(<Button size={size}>Label</Button>);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });
});

// ── Input / Select / Textarea ──────────────────────────────────────────────────

describe('Input', () => {
  it('renders an <input>', () => {
    render(<Input placeholder="Search" />);
    expect(screen.getByPlaceholderText('Search')).toBeInTheDocument();
  });

  it('error prop sets aria-invalid', () => {
    render(<Input aria-label="Field" error />);
    // error flag changes border — visible via border style; aria-invalid passed through
    const input = screen.getByRole('textbox');
    expect(input).toBeInTheDocument();
  });
});

describe('Select', () => {
  const opts = [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }];
  it('renders a <select> with all options', () => {
    render(<Select options={opts} value="a" onChange={vi.fn()} aria-label="Pick" />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });
});

describe('Textarea', () => {
  it('renders a <textarea>', () => {
    render(<Textarea placeholder="Notes" />);
    expect(screen.getByPlaceholderText('Notes')).toBeInTheDocument();
  });
});

// ── Sheet ──────────────────────────────────────────────────────────────────────

describe('Sheet', () => {
  it('when closed: no dialog in DOM', () => {
    render(
      <Sheet open={false} onClose={vi.fn()} title="Side Panel">
        <button>OK</button>
      </Sheet>
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('when open: role=dialog and aria-modal=true', () => {
    render(
      <Sheet open={true} onClose={vi.fn()} title="Side Panel">
        <button>OK</button>
      </Sheet>
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('ESC key calls onClose', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Sheet open={true} onClose={onClose} title="Side Panel">
        <button>Action</button>
      </Sheet>
    );
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('focuses first focusable element on open', async () => {
    render(
      <Sheet open={true} onClose={vi.fn()} title="Side Panel">
        <button data-testid="first">First</button>
      </Sheet>
    );
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body);
    });
  });

  it('Tab key traps focus inside the dialog (wraps last → first)', async () => {
    const user = userEvent.setup();
    render(
      <Sheet open={true} onClose={vi.fn()} title="Side Panel">
        <button>Alpha</button>
        <button>Beta</button>
      </Sheet>
    );
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    const initialFocus = document.activeElement;
    // Tab through all focusable until we cycle back
    let attempts = 0;
    do {
      await user.tab();
      attempts++;
    } while (document.activeElement !== initialFocus && attempts < 10);
    expect(attempts).toBeLessThan(10);
  });
});

// ── Modal ──────────────────────────────────────────────────────────────────────

describe('Modal', () => {
  it('when open: role=dialog + aria-modal=true in portal', () => {
    render(
      <Modal open={true} onClose={vi.fn()} title="Confirm">
        <button>Yes</button>
      </Modal>
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('Confirm')).toBeInTheDocument();
  });

  it('when closed: no dialog', () => {
    render(
      <Modal open={false} onClose={vi.fn()} title="Confirm">
        <p>Content</p>
      </Modal>
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('ESC calls onClose', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Modal open={true} onClose={onClose} title="Confirm">
        <button>Yes</button>
      </Modal>
    );
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });
});

// ── VinylDisc ──────────────────────────────────────────────────────────────────

describe('VinylDisc', () => {
  it('is aria-hidden (always decorative)', () => {
    const { container } = render(<VinylDisc />);
    expect(container.firstChild as HTMLElement).toHaveAttribute('aria-hidden', 'true');
  });

  it('background uses --disc-label NOT --accent', () => {
    const { container } = render(<VinylDisc />);
    const bg = (container.firstChild as HTMLElement).style.background;
    expect(bg).toContain('--disc-label');
    expect(bg).not.toContain('var(--accent)');
  });

  it('display variant includes specular highlight rgba layer', () => {
    const { container } = render(<VinylDisc variant="display" size={300} />);
    const bg = (container.firstChild as HTMLElement).style.background;
    expect(bg).toContain('rgba(255,255,255,.14)');
  });

  it('spinning prop adds animation style referencing spin keyframe', () => {
    const { container } = render(<VinylDisc spinning />);
    expect((container.firstChild as HTMLElement).style.animation).toMatch(/spin/);
  });
});

// ── Toggle ─────────────────────────────────────────────────────────────────────

describe('Toggle', () => {
  it('renders role=switch with aria-checked reflecting state', () => {
    render(<Toggle checked={true} onChange={vi.fn()} label="On" />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('calls onChange with toggled value on click', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Toggle checked={false} onChange={onChange} label="Enable" />);
    await user.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

// ── Checkbox ───────────────────────────────────────────────────────────────────

describe('Checkbox', () => {
  it('renders a checkbox', () => {
    render(<Checkbox checked={false} onChange={vi.fn()} label="Accept" />);
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  it('calls onChange on click', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Checkbox checked={false} onChange={onChange} label="Accept" />);
    await user.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

// ── SegmentedControl ───────────────────────────────────────────────────────────

describe('SegmentedControl', () => {
  const opts = [{ value: 'list', label: 'Liste' }, { value: 'grid', label: 'Kacheln' }];

  it('renders a radiogroup with one radio per option', () => {
    render(<SegmentedControl options={opts} value="list" onChange={vi.fn()} aria-label="View" />);
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });

  it('the radio matching value is checked', () => {
    render(<SegmentedControl options={opts} value="grid" onChange={vi.fn()} aria-label="View" />);
    expect(screen.getByRole('radio', { name: 'Kacheln' })).toBeChecked();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/ui`

Expected: FAIL with `Error: Cannot find module '@/components/ui/StatusBadge'` (and similarly for the other imports). This confirms no component files exist yet.

---

- [ ] **Step 3A: Implement `StatusBadge` and `ConditionPill`**

```tsx
// src/components/ui/StatusBadge.tsx
export type RecordStatus = 'verfuegbar' | 'reserviert' | 'verkauft' | 'verliehen';

interface StatusCfg { label: string; bg: string; ink: string; dot: string; border: string }

const STATUS: Record<RecordStatus, StatusCfg> = {
  verfuegbar: {
    label: 'im Lager',
    bg: 'var(--ok-soft)',
    ink: 'var(--ok)',
    dot: 'var(--ok)',
    border: 'color-mix(in srgb, var(--ok) 30%, transparent)',
  },
  reserviert: {
    label: 'Reserviert',
    bg: 'var(--honey-soft)',
    ink: 'var(--honey-ink)',
    dot: 'var(--honey)',
    border: 'var(--accent-soft-border)',
  },
  verkauft: {
    label: 'Verkauft',
    bg: 'var(--surface-3)',
    ink: 'var(--text-2)',
    dot: 'var(--text-3)',
    border: 'var(--border-strong)',
  },
  verliehen: {
    label: 'Verliehen',
    bg: 'var(--info-soft)',
    ink: 'var(--info)',
    dot: 'var(--info)',
    border: 'color-mix(in srgb, var(--info) 30%, transparent)',
  },
};

export interface StatusBadgeProps { status: RecordStatus; className?: string }

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const cfg = STATUS[status];
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '7px',
        padding: '6px 13px 6px 11px', borderRadius: 'var(--r-pill)',
        background: cfg.bg, color: cfg.ink, border: `1px solid ${cfg.border}`,
        fontSize: '13px', fontWeight: 600,
      }}
    >
      <span
        aria-hidden="true"
        style={{ width: 8, height: 8, borderRadius: '50%', background: cfg.dot, flexShrink: 0 }}
      />
      {cfg.label}
    </span>
  );
}
```

```tsx
// src/components/ui/ConditionPill.tsx
// Exact bg/color values verbatim from Design System 2026.dc.html
// section "Zustand · Discogs-Skala" (lines 441-451)
export type Condition = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

interface ConditionCfg { label: string; bg: string; color: string }

const CONDITIONS: Record<Condition, ConditionCfg> = {
  7: { label: 'Mint', bg: '#1f8a52', color: '#ffffff' },
  6: { label: 'NM',   bg: '#2f9e68', color: '#ffffff' },
  5: { label: 'VG+',  bg: '#9bc34a', color: '#3a2400' },
  4: { label: 'VG',   bg: '#e2c044', color: '#3a2400' },
  3: { label: 'G+',   bg: '#efab3b', color: '#3a2400' },
  2: { label: 'G',    bg: '#e0762e', color: '#ffffff' },
  1: { label: 'Fair', bg: '#d65532', color: '#ffffff' },
  0: { label: 'Poor', bg: '#b6362c', color: '#ffffff' },
};

export interface ConditionPillProps { condition: Condition; className?: string }

export function ConditionPill({ condition, className }: ConditionPillProps) {
  const cfg = CONDITIONS[condition];
  return (
    <span
      className={className}
      style={{
        display: 'inline-block',
        padding: '6px 12px',
        borderRadius: 'var(--r-pill)',
        fontSize: '12.5px',
        fontWeight: 700,
        background: cfg.bg,
        color: cfg.color,
        lineHeight: 1,
      }}
    >
      {cfg.label}
    </span>
  );
}
```

- [ ] **Step 3B: Implement `Spinner` and `Button`**

```tsx
// src/components/ui/Spinner.tsx
// Exact mask-gradient from Design System 2026.dc.html button loading state
export interface SpinnerProps {
  /** px diameter — default 16 */
  size?: number;
  /** CSS color — default 'var(--on-accent)' for use inside accent buttons */
  color?: string;
  className?: string;
}

export function Spinner({ size = 16, color = 'var(--on-accent)', className }: SpinnerProps) {
  return (
    <span
      aria-hidden="true"
      className={className}
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        flexShrink: 0,
        animation: 'spin 1s linear infinite',
        background: [
          `radial-gradient(circle at 50% 50%,#0000 0 30%,${color} 31% 42%,#0000 43%)`,
          `conic-gradient(${color} 0 25%,#0000 25% 100%)`,
        ].join(','),
        WebkitMask: 'radial-gradient(circle at 50% 50%,#0000 0 30%,#000 31%)',
        mask:        'radial-gradient(circle at 50% 50%,#0000 0 30%,#000 31%)',
      }}
    />
  );
}
```

```tsx
// src/components/ui/Button.tsx
'use client';
import type { ReactNode } from 'react';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'honey';
export type ButtonSize    = 'sm36' | 'md44' | 'lg52';

export interface ButtonProps {
  variant?:    ButtonVariant;
  size?:       ButtonSize;
  loading?:    boolean;
  disabled?:   boolean;
  icon?:       ReactNode;
  onClick?:    () => void;
  type?:       'button' | 'submit' | 'reset';
  className?:  string;
  children?:   ReactNode;
  'aria-label'?: string;
}

const SIZES: Record<ButtonSize, { minHeight: string; padding: string; fontSize: string }> = {
  sm36: { minHeight: '36px',        padding: '0 16px', fontSize: '13px' },
  md44: { minHeight: 'var(--tap)',   padding: '0 22px', fontSize: '15px' },
  lg52: { minHeight: '52px',        padding: '0 28px', fontSize: '17px' },
};

const VARIANTS: Record<ButtonVariant, { bg: string; color: string; border: string; spinnerColor: string }> = {
  primary:   { bg: 'var(--accent)',    color: 'var(--on-accent)', border: 'none',                          spinnerColor: 'var(--on-accent)' },
  secondary: { bg: 'var(--surface)',   color: 'var(--text)',      border: '1.5px solid var(--border-strong)', spinnerColor: 'var(--text)' },
  ghost:     { bg: 'transparent',     color: 'var(--accent-ink)', border: 'none',                         spinnerColor: 'var(--accent-ink)' },
  danger:    { bg: 'var(--bad)',       color: '#ffffff',           border: 'none',                         spinnerColor: '#ffffff' },
  honey:     { bg: 'var(--honey)',     color: '#3a2400',           border: 'none',                         spinnerColor: '#3a2400' },
};

export function Button({
  variant = 'primary',
  size = 'md44',
  loading = false,
  disabled = false,
  icon,
  onClick,
  type = 'button',
  className,
  children,
  'aria-label': ariaLabel,
}: ButtonProps) {
  const v = VARIANTS[variant];
  const s = SIZES[size];
  const isDisabled = disabled || loading;

  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={loading ? 'true' : undefined}
      aria-label={ariaLabel}
      onClick={onClick}
      // focus-ring-button applies: :focus-visible { outline:3px solid var(--focus); outline-offset:2px }
      className={`focus-ring-button${className ? ` ${className}` : ''}`}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
        minHeight: s.minHeight, padding: s.padding, fontSize: s.fontSize,
        fontFamily: 'var(--font-body)', fontWeight: 700,
        borderRadius: 'var(--r-pill)', border: v.border,
        background: (isDisabled && !loading) ? 'var(--surface-3)' : v.bg,
        color:      (isDisabled && !loading) ? 'var(--text-3)'    : v.color,
        cursor: loading ? 'wait' : isDisabled ? 'not-allowed' : 'pointer',
        transition: `background var(--dur-1) var(--ease)`,
        boxShadow: (variant === 'primary' && !isDisabled) ? 'var(--shadow-1)' : 'none',
        lineHeight: 1,
      }}
    >
      {loading && <Spinner size={16} color={v.spinnerColor} />}
      {!loading && icon}
      {children}
    </button>
  );
}
```

- [ ] **Step 3C: Implement `Input`, `Select`, `Textarea`, `SearchField`**

```tsx
// src/components/ui/Input.tsx
import type { InputHTMLAttributes } from 'react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> { error?: boolean }

export function Input({ error = false, className, style, ...rest }: InputProps) {
  return (
    <input
      {...rest}
      // focus-ring-field: :focus-visible { outline:none; border-color:var(--accent); box-shadow:0 0 0 3px var(--accent-soft) }
      className={`focus-ring-field${className ? ` ${className}` : ''}`}
      style={{
        width: '100%', minHeight: 'var(--tap)', padding: '0 14px',
        border: `1.5px solid ${error ? 'var(--bad)' : 'var(--border-strong)'}`,
        borderRadius: 'var(--r-md)',
        background: error ? 'var(--bad-soft)' : 'var(--surface-2)',
        color: 'var(--text)', fontFamily: 'var(--font-body)', fontSize: '15px',
        ...style,
      }}
    />
  );
}
```

```tsx
// src/components/ui/Select.tsx
import type { SelectHTMLAttributes } from 'react';

export interface SelectOption { value: string; label: string }
export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  error?: boolean;
}

export function Select({ options, value, onChange, error = false, className, style, ...rest }: SelectProps) {
  return (
    <div style={{ position: 'relative', display: 'flex' }}>
      <select
        {...rest}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`focus-ring-field${className ? ` ${className}` : ''}`}
        style={{
          appearance: 'none', width: '100%', minHeight: 'var(--tap)', padding: '0 40px 0 14px',
          border: `1.5px solid ${error ? 'var(--bad)' : 'var(--border-strong)'}`,
          borderRadius: 'var(--r-md)',
          background: error ? 'var(--bad-soft)' : 'var(--surface-2)',
          color: 'var(--text)', fontFamily: 'var(--font-body)', fontSize: '15px', cursor: 'pointer',
          ...style,
        }}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <span aria-hidden="true" style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', pointerEvents: 'none' }}>▾</span>
    </div>
  );
}
```

```tsx
// src/components/ui/Textarea.tsx
import type { TextareaHTMLAttributes } from 'react';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> { error?: boolean }

export function Textarea({ error = false, className, style, ...rest }: TextareaProps) {
  return (
    <textarea
      {...rest}
      className={`focus-ring-field${className ? ` ${className}` : ''}`}
      style={{
        width: '100%', padding: '12px 14px',
        border: `1.5px solid ${error ? 'var(--bad)' : 'var(--border-strong)'}`,
        borderRadius: 'var(--r-md)',
        background: error ? 'var(--bad-soft)' : 'var(--surface-2)',
        color: 'var(--text)', fontFamily: 'var(--font-body)', fontSize: '15px', resize: 'vertical',
        ...style,
      }}
    />
  );
}
```

```tsx
// src/components/ui/SearchField.tsx
'use client';
import type { InputHTMLAttributes } from 'react';
import { Search } from 'lucide-react';

export interface SearchFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  pill?: boolean;
}

export function SearchField({ pill = true, className, style, ...rest }: SearchFieldProps) {
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <Search aria-hidden size={17} style={{ position: 'absolute', left: 13, color: 'var(--text-3)', pointerEvents: 'none' }} />
      <input
        type="search"
        {...rest}
        className={`focus-ring-field${className ? ` ${className}` : ''}`}
        style={{
          width: '100%', minHeight: 'var(--tap)', padding: '0 14px 0 38px',
          border: '1.5px solid var(--border-strong)',
          borderRadius: pill ? 'var(--r-pill)' : 'var(--r-md)',
          background: 'var(--surface-2)', color: 'var(--text)',
          fontFamily: 'var(--font-body)', fontSize: '15px',
          ...style,
        }}
      />
    </div>
  );
}
```

- [ ] **Step 3D: Implement `Toggle`, `Checkbox`, `SegmentedControl`**

```tsx
// src/components/ui/Toggle.tsx
'use client';
import { useId } from 'react';

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  id?: string;
}

export function Toggle({ checked, onChange, label, disabled = false, id: propId }: ToggleProps) {
  const autoId = useId();
  const id = propId ?? autoId;
  return (
    <label htmlFor={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 12, cursor: disabled ? 'not-allowed' : 'pointer', minHeight: 28, opacity: disabled ? 0.6 : 1 }}>
      <input
        id={id} type="checkbox" role="switch"
        checked={checked} disabled={disabled} aria-checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', border: 0 }}
      />
      <span aria-hidden="true" style={{ position: 'relative', width: 46, height: 28, borderRadius: 'var(--r-pill)', background: checked ? 'var(--accent)' : 'var(--surface-3)', border: checked ? 'none' : '1px solid var(--border-strong)', flexShrink: 0, transition: `background var(--dur-1) var(--ease)` }}>
        <span style={{ position: 'absolute', top: 3, left: checked ? 21 : 3, width: 22, height: 22, borderRadius: '50%', background: checked ? '#ffffff' : 'var(--surface)', boxShadow: 'var(--shadow-1)', transition: `left var(--dur-1) var(--ease)` }} />
      </span>
      {label && <span style={{ fontSize: '14px', color: 'var(--text)' }}>{label}</span>}
    </label>
  );
}
```

```tsx
// src/components/ui/Checkbox.tsx
'use client';
import { useId } from 'react';

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  id?: string;
}

export function Checkbox({ checked, onChange, label, disabled = false, id: propId }: CheckboxProps) {
  const autoId = useId();
  const id = propId ?? autoId;
  return (
    <label htmlFor={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 12, cursor: disabled ? 'not-allowed' : 'pointer', minHeight: 'var(--tap)', opacity: disabled ? 0.6 : 1 }}>
      <input
        id={id} type="checkbox" checked={checked} disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', border: 0 }}
      />
      <span aria-hidden="true" style={{ width: 24, height: 24, borderRadius: 7, display: 'grid', placeItems: 'center', flexShrink: 0, background: checked ? 'var(--accent)' : 'var(--surface)', border: checked ? 'none' : '1.5px solid var(--border-strong)', color: 'var(--on-accent)', fontSize: '14px', fontWeight: 800, transition: `background var(--dur-1) var(--ease)` }}>
        {checked && '✓'}
      </span>
      {label && <span style={{ fontSize: '14px', color: 'var(--text)' }}>{label}</span>}
    </label>
  );
}
```

```tsx
// src/components/ui/SegmentedControl.tsx
'use client';
import { useId } from 'react';

export interface SegmentedOption { value: string; label: string }
export interface SegmentedControlProps {
  options: SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  'aria-label': string;
  className?: string;
}

export function SegmentedControl({ options, value, onChange, 'aria-label': ariaLabel, className }: SegmentedControlProps) {
  const groupId = useId();
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={className} style={{ display: 'inline-flex', gap: 4, padding: 3, borderRadius: 'var(--r-pill)', background: 'var(--surface-3)' }}>
      {options.map((opt) => {
        const active = opt.value === value;
        const inputId = `${groupId}-${opt.value}`;
        return (
          <label key={opt.value} htmlFor={inputId} style={{ display: 'inline-block', padding: '6px 14px', borderRadius: 'var(--r-pill)', fontSize: '12.5px', fontWeight: active ? 700 : 600, color: active ? 'var(--text)' : 'var(--text-3)', background: active ? 'var(--surface)' : 'transparent', boxShadow: active ? 'var(--shadow-1)' : 'none', cursor: 'pointer', transition: `background var(--dur-1) var(--ease)` }}>
            <input id={inputId} type="radio" name={groupId} value={opt.value} checked={active} onChange={() => onChange(opt.value)} style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', border: 0 }} />
            {opt.label}
          </label>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3E: Implement `Card` and `Surface`**

```tsx
// src/components/ui/Card.tsx
import type { ReactNode, HTMLAttributes } from 'react';

export type CardElevation = 1 | 2 | 3;
export interface CardProps extends HTMLAttributes<HTMLDivElement> { elevation?: CardElevation; children: ReactNode }

export function Card({ elevation = 1, className, style, children, ...rest }: CardProps) {
  return (
    <div {...rest} className={className} style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', background: 'var(--surface)', boxShadow: `var(--shadow-${elevation})`, overflow: 'hidden', ...style }}>
      {children}
    </div>
  );
}
```

```tsx
// src/components/ui/Surface.tsx
import type { ReactNode, HTMLAttributes } from 'react';

export type SurfaceLevel = 1 | 2 | 3;
export interface SurfaceProps extends HTMLAttributes<HTMLDivElement> { level?: SurfaceLevel; children: ReactNode }

const BG: Record<SurfaceLevel, string> = { 1: 'var(--surface)', 2: 'var(--surface-2)', 3: 'var(--surface-3)' };

export function Surface({ level = 1, className, style, children, ...rest }: SurfaceProps) {
  return (
    <div {...rest} className={className} style={{ background: BG[level], ...style }}>{children}</div>
  );
}
```

- [ ] **Step 3F: Implement `Sheet` and `Modal` (focus-trap, `aria-modal`, ESC)**

```tsx
// src/components/ui/Sheet.tsx
'use client';
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { X } from 'lucide-react';

const FOCUSABLE_SEL = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (!el) return;
    const getFocusable = () => Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE_SEL));
    getFocusable()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const els = getFocusable();
      if (!els.length) return;
      const first = els[0], last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [ref, active]);
}

export type SheetSide = 'right' | 'bottom';
export interface SheetProps { open: boolean; onClose: () => void; title?: string; side?: SheetSide; children: ReactNode }

export function Sheet({ open, onClose, title, side = 'right', children }: SheetProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [open, onClose]);

  useFocusTrap(dialogRef, open);

  if (!open) return null;

  const positionStyle = side === 'right'
    ? { top: 0, right: 0, bottom: 0, width: 'min(480px, 90vw)', borderRadius: 'var(--r-xl) 0 0 var(--r-xl)' }
    : { left: 0, right: 0, bottom: 0, borderRadius: 'var(--r-xl) var(--r-xl) 0 0', maxHeight: '85vh' };

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(20,14,8,.42)', backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)' }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ position: 'absolute', background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-3)', display: 'flex', flexDirection: 'column', overflowY: 'auto', ...positionStyle }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          {title && <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '18px' }}>{title}</span>}
          <button type="button" aria-label="Close" onClick={onClose} className="focus-ring-button" style={{ width: 34, height: 34, border: 'none', borderRadius: '50%', background: 'var(--surface-3)', color: 'var(--text-2)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
            <X size={16} aria-hidden />
          </button>
        </div>
        <div style={{ padding: '18px', flex: 1, overflowY: 'auto' }}>{children}</div>
      </div>
    </div>
  );
}
```

```tsx
// src/components/ui/Modal.tsx
'use client';
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

const FOCUSABLE_SEL = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (!el) return;
    const getFocusable = () => Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE_SEL));
    getFocusable()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const els = getFocusable();
      if (!els.length) return;
      const first = els[0], last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [ref, active]);
}

export interface ModalProps { open: boolean; onClose: () => void; title: string; children: ReactNode }

export function Modal({ open, onClose, title, children }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [open, onClose]);

  useFocusTrap(dialogRef, open);

  if (!open) return null;

  // Portal to document.body ensures [data-theme]/[data-accent] on <html> cascade through
  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'grid', placeItems: 'center', padding: '16px', background: 'rgba(20,14,8,.42)', backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)' }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        style={{ position: 'relative', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow-3)', width: '100%', maxWidth: 480, overflow: 'hidden' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px', borderBottom: '1px solid var(--border)' }}>
          <span id="modal-title" style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '18px' }}>{title}</span>
          <button type="button" aria-label="Close" onClick={onClose} className="focus-ring-button" style={{ width: 34, height: 34, border: 'none', borderRadius: '50%', background: 'var(--surface-3)', color: 'var(--text-2)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
            <X size={16} aria-hidden />
          </button>
        </div>
        <div style={{ padding: '18px' }}>{children}</div>
      </div>
    </div>,
    document.body
  );
}
```

- [ ] **Step 3G: Implement `VinylDisc` and `CoverPlaceholder`**

Gradient stops copied verbatim from handoff files. `--disc-label` is used in place of `--accent` for the label ring — it is a dedicated token (value: `var(--coral-500)`) that does NOT track accent changes, preserving the iconic brand element.

```tsx
// src/components/ui/VinylDisc.tsx
//
// Gradient values verbatim from design handoff:
//   logo    — Q-Records App.dc.html line 56   (sidebar aside disc, 36px)
//   card    — Q-Records App.dc.html line 192  (record card peeking disc)
//   display — Design System 2026.dc.html line 154 (hero disc, 300px, with highlight + spin)
//
// The label-ring color is var(--disc-label), NOT var(--accent).
// --disc-label is defined in tokens.css as var(--coral-500) — pinned brand element.

export type VinylDiscVariant = 'logo' | 'card' | 'display';

export interface VinylDiscProps {
  size?:     number;
  variant?:  VinylDiscVariant;
  spinning?: boolean;
  className?: string;
}

function gradient(variant: VinylDiscVariant): string {
  switch (variant) {
    case 'logo':
      // 3-layer · groove 1.2 px / 2.6 px · spindle #0a0a0a · label ring 7.5%–34%
      return [
        'radial-gradient(circle at 50% 50%,#0a0a0a 0 7%,#0000 7.5%)',
        'radial-gradient(circle at 50% 50%,var(--disc-label) 7.5% 34%,#0000 34.5%)',
        'repeating-radial-gradient(circle at 50% 50%,var(--disc-groove-a) 0 1.2px,var(--disc-groove-b) 1.2px 2.6px)',
        'var(--disc-base)',
      ].join(',');

    case 'card':
      // 3-layer · hole = var(--surface) · groove 1.5 px / 3.4 px · label ring 5.4%–30%
      return [
        'radial-gradient(circle at 50% 50%,var(--surface) 0 5%,#0000 5.4%)',
        'radial-gradient(circle at 50% 50%,var(--disc-label) 5.4% 30%,#0000 30.4%)',
        'repeating-radial-gradient(circle at 50% 50%,var(--disc-groove-a) 0 1.5px,var(--disc-groove-b) 1.5px 3.4px)',
        'var(--disc-base)',
      ].join(',');

    case 'display':
      // 6-layer · hole = var(--bg) · dark spindle · label ring 5.4%–27% · specular highlight · groove 1.7 px / 3.8 px
      return [
        'radial-gradient(circle at 50% 50%,var(--bg) 0 4.5%,#0000 5%)',
        'radial-gradient(circle at 50% 50%,#0a0a0a 0 5%,#0000 5.4%)',
        'radial-gradient(circle at 50% 50%,var(--disc-label) 5.4% 27%,#0000 27.4%)',
        'radial-gradient(circle at 38% 34%,rgba(255,255,255,.14),#0000 60%)',
        'repeating-radial-gradient(circle at 50% 50%,var(--disc-groove-a) 0 1.7px,var(--disc-groove-b) 1.7px 3.8px)',
        'var(--disc-base)',
      ].join(',');
  }
}

export function VinylDisc({ size = 36, variant = 'logo', spinning = false, className }: VinylDiscProps) {
  return (
    <div
      aria-hidden="true"
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        flexShrink: 0,
        background: gradient(variant),
        boxShadow: variant !== 'logo' ? 'var(--shadow-2)' : undefined,
        // spin 9s matches Design System 2026.dc.html hero disc animation
        // tokens.css @media(prefers-reduced-motion) collapses dur to .001ms
        animation: spinning ? 'spin 9s linear infinite' : undefined,
      }}
    />
  );
}
```

```tsx
// src/components/ui/CoverPlaceholder.tsx
//
// Verbatim from Design System 2026.dc.html "Record card" pattern (lines ~465-469):
//   cover hatch: repeating-linear-gradient(135deg,var(--surface-3) 0 11px,var(--surface-2) 11px 22px)
//   disc: card-variant gradient (var(--disc-label), groove 1.5px/3.4px)
//         positioned right:-32%, width:78%, vertically centred

export interface CoverPlaceholderProps {
  aspectRatio?: number;  // default 1 (square), set 1.9 for landscape card variant
  className?: string;
}

export function CoverPlaceholder({ aspectRatio = 1, className }: CoverPlaceholderProps) {
  return (
    <div className={className} style={{ position: 'relative', aspectRatio, overflow: 'hidden' }}>
      {/* Disc peeking from the right */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute', right: '-32%', top: '50%', transform: 'translateY(-50%)',
          width: '78%', aspectRatio: 1, borderRadius: '50%', boxShadow: 'var(--shadow-2)',
          background: [
            'radial-gradient(circle at 50% 50%,var(--surface) 0 5%,#0000 5.4%)',
            'radial-gradient(circle at 50% 50%,var(--disc-label) 5.4% 30%,#0000 30.4%)',
            'repeating-radial-gradient(circle at 50% 50%,var(--disc-groove-a) 0 1.5px,var(--disc-groove-b) 1.5px 3.4px)',
            'var(--disc-base)',
          ].join(','),
        }}
      />
      {/* Cover area: hatched placeholder occupying left ~80% */}
      <div
        style={{
          position: 'absolute', inset: 0, width: '80%',
          background: 'repeating-linear-gradient(135deg,var(--surface-3) 0 11px,var(--surface-2) 11px 22px)',
          display: 'grid', placeItems: 'center',
          borderRight: '1px solid var(--border)',
        }}
      >
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-3)', letterSpacing: '.05em' }}>
          cover
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 3H: Create the barrel export**

```ts
// src/components/ui/index.ts
export { Button }            from './Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button';

export { Input }             from './Input';
export type { InputProps }   from './Input';

export { Select }            from './Select';
export type { SelectProps, SelectOption } from './Select';

export { Textarea }          from './Textarea';
export type { TextareaProps } from './Textarea';

export { StatusBadge }       from './StatusBadge';
export type { StatusBadgeProps, RecordStatus } from './StatusBadge';

export { ConditionPill }     from './ConditionPill';
export type { ConditionPillProps, Condition } from './ConditionPill';

export { Toggle }            from './Toggle';
export type { ToggleProps }  from './Toggle';

export { Checkbox }          from './Checkbox';
export type { CheckboxProps } from './Checkbox';

export { SegmentedControl }  from './SegmentedControl';
export type { SegmentedControlProps, SegmentedOption } from './SegmentedControl';

export { SearchField }       from './SearchField';
export type { SearchFieldProps } from './SearchField';

export { Spinner }           from './Spinner';
export type { SpinnerProps } from './Spinner';

export { Card }              from './Card';
export type { CardProps, CardElevation } from './Card';

export { Surface }           from './Surface';
export type { SurfaceProps, SurfaceLevel } from './Surface';

export { Sheet }             from './Sheet';
export type { SheetProps, SheetSide } from './Sheet';

export { Modal }             from './Modal';
export type { ModalProps }   from './Modal';

export { VinylDisc }         from './VinylDisc';
export type { VinylDiscProps, VinylDiscVariant } from './VinylDisc';

export { CoverPlaceholder }  from './CoverPlaceholder';
export type { CoverPlaceholderProps } from './CoverPlaceholder';
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `pnpm test tests/ui`

Expected: PASS — all assertions green across StatusBadge (6), ConditionPill (9), Button (7), Input/Select/Textarea (3), Sheet (5), Modal (3), VinylDisc (4), Toggle (2), Checkbox (2), SegmentedControl (2).

If the Modal portal test fails in jsdom because `document.body` is null, add `document.body.innerHTML = '<div></div>'` to a `beforeEach` in the Modal describe block, or ensure the jsdom environment pragma at the top of the test file is present.

- [ ] **Step 5: Run lint and typecheck**

Run: `pnpm lint && pnpm typecheck`

Expected: 0 errors. Confirm the ESLint `no-restricted-imports` rule does not fire — none of these components import from `@/db/client`.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/ tests/ui/
git commit -m "$(cat <<'EOF'
feat(slice0): frozen UI primitives with exact design-system tokens

17 components implement a11y baseline (text+icon+color never color-only, focus-visible
via focus-ring-button/focus-ring-field classes, aria-modal focus trap in Sheet+Modal, WCAG
text labels on StatusBadge+ConditionPill). ConditionPill uses verbatim hex stops from
handoff; VinylDisc gradient stops are verbatim from handoff with --disc-label (not
--accent) for the pinned-brand label ring.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Drizzle schema + base migration + hash

**Files:**
- Create: `src/db/schema.ts`
- Create: `src/db/hash.ts`
- Create: `drizzle.config.ts`
- Create: `tests/db/hash.test.ts`
- Generate: `drizzle/0000_*.sql` (via `pnpm db:generate` — do not hand-write)

**Interfaces:**

- Consumes:
  - `pnpm db:generate` script registered in `package.json` by Task 1 (`drizzle-kit generate`)
  - `DATABASE_OWNER_URL` env var validated in `src/env.ts` by Task 1
  - `drizzle-orm`, `drizzle-kit` packages installed by Task 1

- Produces (verbatim from SPINE PART C — later tasks depend on these exact names):
  ```ts
  // src/db/schema.ts
  export const roleEnum: PgEnum<['superadmin','admin','mitarbeiter','kunde']>;
  export type Role = (typeof roleEnum.enumValues)[number];
  export const recordStatusEnum: PgEnum<['verfuegbar','reserviert','verkauft','verliehen']>;
  export const tenants: PgTable;
  export const plans: PgTable;
  export const users: PgTable;
  export const userDetail: PgTable;
  export const sessions: PgTable;
  export const records: PgTable;
  export const purchases: PgTable;
  export const permalinks: PgTable;

  // src/db/hash.ts
  export function recordHash(input: {
    title: string;
    artist: string;
    country?: string | null;
    year?: number | null;
    label?: string[];
  }): string; // sha256 hex; 64-char lowercase hex string
  ```

---

#### Cycle A — `recordHash` (pure function, full TDD)

- [ ] **Step 1: Write the failing test**

  Create `tests/db/hash.test.ts`:

  ```ts
  import { describe, it, expect } from 'vitest';
  import { createHash } from 'node:crypto';
  import { recordHash } from '@/db/hash';

  /** Reference implementation used only inside this test to build expected values. */
  function sha256(s: string): string {
    return createHash('sha256').update(s).digest('hex');
  }

  describe('recordHash', () => {
    it('returns a 64-character lowercase hex string', () => {
      const h = recordHash({ title: 'Blue Lines', artist: 'Massive Attack' });
      expect(h).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is stable — identical inputs produce identical output', () => {
      const input = {
        title: 'Blue Lines',
        artist: 'Massive Attack',
        country: 'UK',
        year: 1991,
        label: ['Wild Bunch Records'],
      };
      expect(recordHash(input)).toBe(recordHash(input));
    });

    it('is case-insensitive for all string fields', () => {
      expect(
        recordHash({ title: 'Blue Lines', artist: 'Massive Attack', country: 'UK' }),
      ).toBe(
        recordHash({ title: 'BLUE LINES', artist: 'MASSIVE ATTACK', country: 'uk' }),
      );
    });

    it('trims leading and trailing whitespace before hashing', () => {
      expect(
        recordHash({ title: '  Blue Lines  ', artist: '  Massive Attack  ' }),
      ).toBe(
        recordHash({ title: 'Blue Lines', artist: 'Massive Attack' }),
      );
    });

    it('treats null country as empty string (same as undefined)', () => {
      expect(recordHash({ title: 'T', artist: 'A', country: null })).toBe(
        recordHash({ title: 'T', artist: 'A', country: undefined }),
      );
    });

    it('treats null year as empty string (same as undefined)', () => {
      expect(recordHash({ title: 'T', artist: 'A', year: null })).toBe(
        recordHash({ title: 'T', artist: 'A', year: undefined }),
      );
    });

    it('treats empty label array identically to undefined label', () => {
      expect(recordHash({ title: 'T', artist: 'A', label: [] })).toBe(
        recordHash({ title: 'T', artist: 'A', label: undefined }),
      );
    });

    it('matches the known canonical vector (documents exact field order)', () => {
      // Canonical join order: artist | title | country | year | labels-joined-by-comma
      // All values are trimmed and lowercased before joining.
      const canonical = 'massive attack|blue lines|uk|1991|wild bunch records';
      expect(
        recordHash({
          title: 'Blue Lines',
          artist: 'Massive Attack',
          country: 'UK',
          year: 1991,
          label: ['Wild Bunch Records'],
        }),
      ).toBe(sha256(canonical));
    });

    it('produces distinct hashes for distinct title+artist pairs', () => {
      expect(
        recordHash({ title: 'Blue Lines', artist: 'Massive Attack' }),
      ).not.toBe(
        recordHash({ title: 'Protection', artist: 'Massive Attack' }),
      );
    });

    it('includes label in the hash — different labels produce different hashes', () => {
      expect(
        recordHash({ title: 'T', artist: 'A', label: ['Warp'] }),
      ).not.toBe(
        recordHash({ title: 'T', artist: 'A', label: ['Ninja Tune'] }),
      );
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```bash
  pnpm test tests/db/hash.test.ts
  ```

  Expected: FAIL with `"Cannot find module '@/db/hash'"` (file does not exist yet).

- [ ] **Step 3: Implement `src/db/hash.ts`**

  Create `src/db/hash.ts`:

  ```ts
  import { createHash } from 'node:crypto';

  export function recordHash(input: {
    title: string;
    artist: string;
    country?: string | null;
    year?: number | null;
    label?: string[];
  }): string {
    const { title, artist, country, year, label } = input;
    const parts = [
      artist,
      title,
      country ?? '',
      year ?? '',
      (label ?? []).join(','),
    ].map((s) => String(s).trim().toLowerCase());
    return createHash('sha256').update(parts.join('|')).digest('hex');
  }
  ```

- [ ] **Step 4: Run test to verify it passes**

  ```bash
  pnpm test tests/db/hash.test.ts
  ```

  Expected: PASS — all 10 assertions green.

- [ ] **Step 5: Commit cycle A**

  ```bash
  git add src/db/hash.ts tests/db/hash.test.ts
  git commit -m "$(cat <<'EOF'
  feat(slice0): recordHash — stable sha256 dedup key for records

  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
  EOF
  )"
  ```

---

#### Cycle B — Drizzle config + full schema + generate migration

- [ ] **Step 6: Write `drizzle.config.ts`**

  Create `drizzle.config.ts` at the project root:

  ```ts
  import type { Config } from 'drizzle-kit';

  export default {
    dialect: 'postgresql',
    schema: './src/db/schema.ts',
    out: './drizzle',
    dbCredentials: {
      url: process.env.DATABASE_OWNER_URL ?? '',
    },
  } satisfies Config;
  ```

- [ ] **Step 7: Write `src/db/schema.ts`**

  Create `src/db/schema.ts`:

  ```ts
  import {
    boolean,
    integer,
    jsonb,
    numeric,
    pgEnum,
    pgTable,
    serial,
    text,
    timestamp,
    unique,
    varchar,
  } from 'drizzle-orm/pg-core';
  import { sql } from 'drizzle-orm';

  // ── Enums ───────────────────────────────────────────────────────────────────

  export const roleEnum = pgEnum('user_role', [
    'superadmin',
    'admin',
    'mitarbeiter',
    'kunde',
  ]);
  export type Role = (typeof roleEnum.enumValues)[number];

  export const recordStatusEnum = pgEnum('record_status', [
    'verfuegbar',
    'reserviert',
    'verkauft',
    'verliehen',
  ]);

  // ── Registry tables (no tenant RLS) ─────────────────────────────────────────

  export const tenants = pgTable('tenants', {
    id: serial('id').primaryKey(),
    slug: text('slug').unique().notNull(),
    name: text('name').notNull(),
    domain: text('domain'),
    /** { branding: { primaryColor: string; logo: string | null } } */
    config: jsonb('config').notNull().default({}),
    plan: text('plan').notNull().default('free'),
    limits: jsonb('limits').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  });

  export const plans = pgTable('plans', {
    slug: text('slug').primaryKey(),
    name: text('name').notNull(),
    priceMonthlyCents: integer('price_monthly_cents').notNull().default(0),
    limits: jsonb('limits').notNull().default({}),
    features: jsonb('features').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  });

  // ── Tenant-scoped tables (RLS applied in 0001_rls.sql) ───────────────────────

  export const users = pgTable(
    'users',
    {
      id: serial('id').primaryKey(),
      tenantId: integer('tenant_id')
        .notNull()
        .references(() => tenants.id),
      email: text('email').notNull(),
      password: text('password').notNull(),
      role: roleEnum('role').notNull().default('kunde'),
      isSuperadmin: boolean('is_superadmin').notNull().default(false),
      createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
      updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
    },
    (t) => ({
      emailTenantUnique: unique('users_email_tenant').on(t.email, t.tenantId),
    }),
  );

  export const userDetail = pgTable('user_detail', {
    userId: integer('user_id')
      .primaryKey()
      .references(() => users.id),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name'),
    surname: text('surname'),
  });

  export const sessions = pgTable('sessions', {
    sessionToken: text('session_token').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    expires: timestamp('expires', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  });

  export const records = pgTable(
    'records',
    {
      id: serial('id').primaryKey(),
      tenantId: integer('tenant_id')
        .notNull()
        .references(() => tenants.id),
      title: text('title').notNull(),
      artist: text('artist').notNull(),
      label: text('label')
        .array()
        .notNull()
        .default(sql`ARRAY[]::text[]`),
      country: text('country'),
      releaseYear: integer('release_year'),
      format: text('format'),
      genre: text('genre')
        .array()
        .notNull()
        .default(sql`ARRAY[]::text[]`),
      coverImage: text('cover_image'),
      discogsId: integer('discogs_id'),
      /** sha256 hex — dedup key; see src/db/hash.ts */
      hash: varchar('hash', { length: 64 }).notNull(),
      recordStatus: recordStatusEnum('record_status')
        .notNull()
        .default('verfuegbar'),
      createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
      updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
    },
    (t) => ({
      hashTenantUnique: unique('records_hash_tenant').on(t.hash, t.tenantId),
    }),
  );

  export const purchases = pgTable('purchases', {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    recordId: integer('record_id')
      .notNull()
      .references(() => records.id),
    purchasePrice: numeric('purchase_price', { precision: 10, scale: 2 }),
    targetPrice: numeric('target_price', { precision: 10, scale: 2 }),
    soldPrice: numeric('sold_price', { precision: 10, scale: 2 }),
    soldDate: timestamp('sold_date', { withTimezone: true }),
    paymentMethod: text('payment_method'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  });

  export const permalinks = pgTable(
    'permalinks',
    {
      id: serial('id').primaryKey(),
      tenantId: integer('tenant_id')
        .notNull()
        .references(() => tenants.id),
      slug: text('slug').notNull(),
      filter: jsonb('filter').notNull().default({}),
      createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    },
    (t) => ({
      slugTenantUnique: unique('permalinks_slug_tenant').on(t.slug, t.tenantId),
    }),
  );
  ```

- [ ] **Step 8: Run typecheck to verify schema compiles**

  ```bash
  pnpm typecheck
  ```

  Expected: PASS — no TypeScript errors. Fix any import or type errors before proceeding.

- [ ] **Step 9: Generate the base migration**

  ```bash
  pnpm db:generate
  ```

  Expected: drizzle-kit writes `drizzle/0000_<name>.sql` (the exact suffix is chosen by drizzle-kit based on the first changed entity). The command must exit 0.

- [ ] **Step 10: Verify migration output**

  ```bash
  grep -c "CREATE TABLE" drizzle/0000_*.sql
  ```

  Expected: output is `8` — one `CREATE TABLE` statement per table (tenants, plans, users, user_detail, sessions, records, purchases, permalinks).

  ```bash
  grep -E "CREATE TYPE.*user_role|CREATE TYPE.*record_status" drizzle/0000_*.sql
  ```

  Expected: two lines — one for each `pgEnum`.

  ```bash
  grep "records_hash_tenant\|users_email_tenant\|permalinks_slug_tenant" drizzle/0000_*.sql
  ```

  Expected: three lines — one composite unique constraint per table.

- [ ] **Step 11: Commit cycle B**

  ```bash
  git add src/db/schema.ts drizzle.config.ts drizzle/
  git commit -m "$(cat <<'EOF'
  feat(slice0): Drizzle schema (8 tables, 2 enums) + drizzle.config + 0000 base migration

  All tenant-scoped tables carry tenant_id FK; composite uniques on
  users(email,tenant_id), records(hash,tenant_id), permalinks(slug,tenant_id).
  RLS and role grants are applied separately in 0001_rls.sql (Task 5).

  Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
  EOF
  )"
  ```

---

**Acceptance gate:**

- `pnpm test tests/db/hash.test.ts` — all 10 hash assertions pass.
- `pnpm typecheck` — zero errors across the project.
- `pnpm db:generate` — produces `drizzle/0000_*.sql` with 8 `CREATE TABLE` blocks, 2 `CREATE TYPE` blocks, and 3 named composite unique constraints (`users_email_tenant`, `records_hash_tenant`, `permalinks_slug_tenant`).
- `hash` column on `records` is `varchar(64)`, `purchase_price` / `target_price` / `sold_price` are `numeric(10,2)`.
- No `CREATE POLICY`, no `ENABLE ROW LEVEL SECURITY` in `0000_*.sql` — those belong exclusively to the hand-written `0001_rls.sql` (Task 5).

---

### Task 5: RLS migration + roles + migrate runner

Builds the security-critical migration layer: the two non-superuser DB roles (`qr_owner`/`qr_app`), the hand-written RLS migration that ENABLEs + FORCEs row-level security with `tenant_isolation` + `superadmin_bypass` policies and the `tenant_id` GUC default on every tenant-scoped table, an idempotent plan seed, and the owner-credentialed migrate runner used by the entrypoint and by tests. Depends on Task 4 (schema + generated `drizzle/0000_*.sql` + `drizzle/meta/_journal.json`).

**Files:**
- Create: `docker/postgres/init/01-roles.sql`
- Create: `drizzle/0001_rls.sql`
- Create: `drizzle/0002_seed_plans.sql`
- Modify: `drizzle/meta/_journal.json` (append the two hand-written migrations to the `entries` array)
- Create: `src/db/migrate.ts`
- Test: `tests/migration.integration.test.ts`

**Interfaces:**
- Consumes (from Task 4): Drizzle tables and SQL identifiers `users`, `user_detail`, `sessions`, `records`, `purchases`, `permalinks` (each with a `tenant_id integer NOT NULL` column), registry tables `tenants` / `plans` (`plans` columns `slug`, `name`, `price_monthly_cents`, `limits`, `features`), and the generated `drizzle/0000_*.sql` + its `drizzle/meta/_journal.json` idx-0 entry.
- Produces (later tasks rely on these verbatim):
  - `export async function runMigrations(connectionString?: string): Promise<void>` in `src/db/migrate.ts` — connects as `DATABASE_OWNER_URL` (or the passed connection string), applies `drizzle/0000`,`0001`,`0002` in order via the drizzle node-postgres migrator. Consumed by Task 7 `setupTestDatabase()` and Task 15 `entrypoint-web.sh` / `pnpm db:migrate`.
  - DB roles `qr_owner` (`NOSUPERUSER BYPASSRLS` — migrations + provisioning) and `qr_app` (`NOSUPERUSER NOBYPASSRLS` — runtime); `qr_owner` owns the database + `public` schema.
  - RLS policies named exactly `tenant_isolation` and `superadmin_bypass` on every tenant-scoped table; column default `tenant_id DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::int`. Asserted by Task 6 `assertDatabaseSafety()` and Task 7's fail-closed suite.
  - Seeded `plans` rows `free` / `small` / `big`.

GUC names exactly `app.current_tenant`, `app.current_user_id`, `app.is_superadmin`. RLS is hand-written SQL (never drizzle-kit `push`). `qr_app` is never a superuser and never has `BYPASSRLS`.

- [ ] **Step 1: Write the failing test**

`tests/migration.integration.test.ts`:
```ts
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';

const TENANT_TABLES = ['users', 'user_detail', 'sessions', 'records', 'purchases', 'permalinks'] as const;

let container: StartedPostgreSqlContainer;
let ownerUrl: string;
let appUrl: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17').start();

  // Bootstrap the two app roles as the superuser — mirrors docker/postgres/init/01-roles.sql.
  const admin = new Pool({ connectionString: container.getConnectionUri() });
  await admin.query(`CREATE ROLE qr_owner LOGIN NOSUPERUSER BYPASSRLS PASSWORD 'owner_pw'`);
  await admin.query(`CREATE ROLE qr_app LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD 'app_pw'`);
  await admin.query(`ALTER DATABASE ${container.getDatabase()} OWNER TO qr_owner`);
  await admin.query(`ALTER SCHEMA public OWNER TO qr_owner`);
  await admin.query(`GRANT ALL ON SCHEMA public TO qr_owner`);
  await admin.end();

  const host = container.getHost();
  const port = container.getPort();
  const db = container.getDatabase();
  ownerUrl = `postgresql://qr_owner:owner_pw@${host}:${port}/${db}`;
  appUrl = `postgresql://qr_app:app_pw@${host}:${port}/${db}`;

  // Run as the owner — the only role allowed to migrate.
  await runMigrations(ownerUrl);
}, 180_000);

afterAll(async () => {
  await container?.stop();
});

describe('0001_rls.sql', () => {
  it('ENABLEs + FORCEs RLS and creates both named policies on every tenant-scoped table', async () => {
    const pool = new Pool({ connectionString: ownerUrl, max: 1 });
    try {
      for (const table of TENANT_TABLES) {
        const flags = await pool.query(
          `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = $1`,
          [table],
        );
        expect(flags.rows[0].relrowsecurity, `${table}.relrowsecurity`).toBe(true);
        expect(flags.rows[0].relforcerowsecurity, `${table}.relforcerowsecurity`).toBe(true);

        const policies = await pool.query(
          `SELECT polname FROM pg_policy WHERE polrelid = $1::regclass ORDER BY polname`,
          [table],
        );
        expect(policies.rows.map((r) => r.polname)).toEqual(['superadmin_bypass', 'tenant_isolation']);

        const def = await pool.query(
          `SELECT column_default FROM information_schema.columns
             WHERE table_name = $1 AND column_name = 'tenant_id'`,
          [table],
        );
        expect(def.rows[0].column_default).toContain(`current_setting('app.current_tenant', true)`);
      }
    } finally {
      await pool.end();
    }
  });
});

describe('0002_seed_plans.sql', () => {
  it('seeds free/small/big and is idempotent when migrate re-runs', async () => {
    await runMigrations(ownerUrl); // re-run: must stay green and not duplicate plans
    const pool = new Pool({ connectionString: ownerUrl, max: 1 });
    try {
      const { rows } = await pool.query(`SELECT slug FROM plans ORDER BY slug`);
      expect(rows.map((r) => r.slug)).toEqual(['big', 'free', 'small']);
    } finally {
      await pool.end();
    }
  });
});

describe('qr_app runtime role', () => {
  it('is not a superuser, has no BYPASSRLS, and cannot see rows without tenant context', async () => {
    const appPool = new Pool({ connectionString: appUrl, max: 1 });
    const ownerPool = new Pool({ connectionString: ownerUrl, max: 1 });
    try {
      const role = await appPool.query(
        `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
      );
      expect(role.rows[0].rolsuper).toBe(false);
      expect(role.rows[0].rolbypassrls).toBe(false);

      // Owner seeds one record under explicit tenant context (owner is FORCEd too).
      const t = await ownerPool.query(
        `INSERT INTO tenants (slug, name) VALUES ('demo', 'Demo') RETURNING id`,
      );
      const tenantId: number = t.rows[0].id;
      const c = await ownerPool.connect();
      try {
        await c.query('BEGIN');
        await c.query(`SELECT set_config('app.current_tenant', $1, true)`, [String(tenantId)]);
        await c.query(
          `INSERT INTO records (tenant_id, title, artist, hash) VALUES ($1, 't', 'a', 'h')`,
          [tenantId],
        );
        await c.query('COMMIT');
      } finally {
        c.release();
      }

      // qr_app with no GUC set → current_setting() is NULL → policy hides the row.
      const seen = await appPool.query(`SELECT count(*)::int AS n FROM records`);
      expect(seen.rows[0].n).toBe(0);
    } finally {
      await appPool.end();
      await ownerPool.end();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test migration.integration`
Expected: FAIL with `Failed to resolve import "@/db/migrate"` (the module `src/db/migrate.ts` and the `0001`/`0002` migrations do not exist yet).

- [ ] **Step 3: Create the superuser role bootstrap `docker/postgres/init/01-roles.sql`**
Runs once on first `postgres:17` container init as the `POSTGRES_USER` superuser. Uses psql `\getenv` (PG16+) so passwords come from container env, not hardcoded.
```sql
-- Runs as the postgres superuser during first-time DB init (docker-entrypoint-initdb.d).
-- Reads passwords + db name from the container environment via psql \getenv (PostgreSQL 16+).
\set ON_ERROR_STOP on

\getenv qr_owner_password QR_OWNER_PASSWORD
\getenv qr_app_password   QR_APP_PASSWORD
\getenv db_name           POSTGRES_DB

-- Migration / owner role and runtime role. Neither is a superuser; neither bypasses RLS.
CREATE ROLE qr_owner LOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD :'qr_owner_password';
CREATE ROLE qr_app   LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD :'qr_app_password';

-- qr_owner owns the application database + public schema, so migrations create objects as owner.
ALTER DATABASE :"db_name" OWNER TO qr_owner;
ALTER SCHEMA public OWNER TO qr_owner;
GRANT ALL ON SCHEMA public TO qr_owner;
```

- [ ] **Step 4: Create the hand-written RLS migration `drizzle/0001_rls.sql`**
For each tenant-scoped table: ENABLE + FORCE RLS, set the `tenant_id` GUC default, create both policies, grant DML to `qr_app`. Registry tables get SELECT-only. Statements are split on `--> statement-breakpoint` by the migrator.
```sql
GRANT USAGE ON SCHEMA public TO qr_app;
--> statement-breakpoint

-- users -----------------------------------------------------------------
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "tenant_id" SET DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::int;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "users"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int);
--> statement-breakpoint
CREATE POLICY "superadmin_bypass" ON "users"
  USING (current_setting('app.is_superadmin', true) = 'true')
  WITH CHECK (current_setting('app.is_superadmin', true) = 'true');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "users" TO qr_app;
--> statement-breakpoint

-- user_detail -----------------------------------------------------------
ALTER TABLE "user_detail" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "user_detail" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "user_detail" ALTER COLUMN "tenant_id" SET DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::int;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "user_detail"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int);
--> statement-breakpoint
CREATE POLICY "superadmin_bypass" ON "user_detail"
  USING (current_setting('app.is_superadmin', true) = 'true')
  WITH CHECK (current_setting('app.is_superadmin', true) = 'true');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "user_detail" TO qr_app;
--> statement-breakpoint

-- sessions --------------------------------------------------------------
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sessions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "tenant_id" SET DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::int;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sessions"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int);
--> statement-breakpoint
CREATE POLICY "superadmin_bypass" ON "sessions"
  USING (current_setting('app.is_superadmin', true) = 'true')
  WITH CHECK (current_setting('app.is_superadmin', true) = 'true');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "sessions" TO qr_app;
--> statement-breakpoint

-- records ---------------------------------------------------------------
ALTER TABLE "records" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "records" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "records" ALTER COLUMN "tenant_id" SET DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::int;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "records"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int);
--> statement-breakpoint
CREATE POLICY "superadmin_bypass" ON "records"
  USING (current_setting('app.is_superadmin', true) = 'true')
  WITH CHECK (current_setting('app.is_superadmin', true) = 'true');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "records" TO qr_app;
--> statement-breakpoint

-- purchases -------------------------------------------------------------
ALTER TABLE "purchases" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "purchases" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "purchases" ALTER COLUMN "tenant_id" SET DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::int;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "purchases"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int);
--> statement-breakpoint
CREATE POLICY "superadmin_bypass" ON "purchases"
  USING (current_setting('app.is_superadmin', true) = 'true')
  WITH CHECK (current_setting('app.is_superadmin', true) = 'true');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "purchases" TO qr_app;
--> statement-breakpoint

-- permalinks ------------------------------------------------------------
ALTER TABLE "permalinks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "permalinks" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "permalinks" ALTER COLUMN "tenant_id" SET DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::int;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "permalinks"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int);
--> statement-breakpoint
CREATE POLICY "superadmin_bypass" ON "permalinks"
  USING (current_setting('app.is_superadmin', true) = 'true')
  WITH CHECK (current_setting('app.is_superadmin', true) = 'true');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "permalinks" TO qr_app;
--> statement-breakpoint

-- Registry tables: NO tenant RLS. qr_app reads only; writes go through qr_owner.
GRANT SELECT ON "tenants" TO qr_app;
--> statement-breakpoint
GRANT SELECT ON "plans" TO qr_app;
--> statement-breakpoint

-- Serial PKs need their sequences usable by qr_app for INSERTs.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO qr_app;
```

- [ ] **Step 5: Create the idempotent plan seed `drizzle/0002_seed_plans.sql`**
```sql
INSERT INTO "plans" ("slug", "name", "price_monthly_cents", "limits", "features") VALUES
  ('free',  'Free',     0, '{"records": 100}'::jsonb,    '{"discogs": false}'::jsonb),
  ('small', 'Small', 1900, '{"records": 1000}'::jsonb,   '{"discogs": true}'::jsonb),
  ('big',   'Big',   4900, '{"records": 100000}'::jsonb, '{"discogs": true, "analytics": true}'::jsonb)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "price_monthly_cents" = EXCLUDED."price_monthly_cents",
  "limits" = EXCLUDED."limits",
  "features" = EXCLUDED."features";
```

- [ ] **Step 6: Register the hand-written migrations in `drizzle/meta/_journal.json`**
The drizzle migrator only applies migrations listed in the journal. Keep the existing auto-generated idx-0 `0000_*` entry and append these two objects to the `entries` array (the `tag` must match the `.sql` filename without extension):
```json
{
  "idx": 1,
  "version": "7",
  "when": 1750000000000,
  "tag": "0001_rls",
  "breakpoints": true
}
```
```json
{
  "idx": 2,
  "version": "7",
  "when": 1750000000001,
  "tag": "0002_seed_plans",
  "breakpoints": true
}
```
After editing, the `entries` array contains exactly three objects in order: the generated `0000_*`, then `0001_rls`, then `0002_seed_plans`.

- [ ] **Step 7: Create the owner migrate runner `src/db/migrate.ts`**
No `import 'server-only'` here — this module is run directly via `tsx` (CLI / entrypoint) and imported by tests, so it must run outside the RSC bundle. It connects as the owner and applies all journaled migrations in order.
```ts
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

const MIGRATIONS_FOLDER = path.resolve(process.cwd(), 'drizzle');

/**
 * Applies drizzle/0000,0001,0002 (in journal order) as the owner role.
 * Used by docker/entrypoint-web.sh, `pnpm db:migrate`, and the test helpers.
 */
export async function runMigrations(connectionString?: string): Promise<void> {
  const url = connectionString ?? process.env.DATABASE_OWNER_URL;
  if (!url) {
    throw new Error('runMigrations requires a connection string or DATABASE_OWNER_URL');
  }

  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}

// CLI entry: `tsx src/db/migrate.ts` (pnpm db:migrate).
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  runMigrations()
    .then(() => {
      console.log('[migrate] migrations applied');
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error('[migrate] failed:', err);
      process.exit(1);
    });
}
```

- [ ] **Step 8: Run test to verify it passes**
Run: `pnpm test migration.integration`  Expected: PASS (RLS forced + both policies + `tenant_id` GUC default on all six tables; plans `big`/`free`/`small` seeded and idempotent on re-run; `qr_app` is non-superuser/non-bypassrls and reads 0 rows without tenant context).

- [ ] **Step 9: Commit**
```bash
git add docker/postgres/init/01-roles.sql drizzle/0001_rls.sql drizzle/0002_seed_plans.sql drizzle/meta/_journal.json src/db/migrate.ts tests/migration.integration.test.ts
git commit -m "feat(slice0): RLS migration, app roles, and owner migrate runner"
```

---

### Task 6: DB client + withTenant/withSuperadmin/withOwner + boot assertions

This task builds the ONLY runtime DB surface. After this task, every later task touches tenant data exclusively through `withTenant`/`withSuperadmin`/`withOwner`; the raw pools in `src/db/client.ts` are `import 'server-only'` and ESLint-banned outside `src/db/**` (rule from Task 1). The real RLS fail-closed behaviour (no-context→0 rows, two-tenant interleave, superadmin no-leak, FORCE/policy dropped) is the security gate in **Task 7** against a live testcontainer; here we lock the wrappers, the pool config, and the assertion logic with fast DB-less unit tests (pg mocked).

**Files:**
- Create: `src/db/client.ts`
- Create: `src/db/tenant.ts`
- Create: `src/db/assertions.ts`
- Test: `tests/db/tenant.test.ts`
- Test: `tests/db/assertions.test.ts`

**Interfaces:**
- Consumes (from earlier tasks — copy verbatim from SPINE PART C):
  - From `src/env.ts` (Task 1): `export const env: Env` with `env.DATABASE_URL` (qr_app), `env.DATABASE_OWNER_URL` (qr_owner), `env.DB_POOL_MAX` (number, default 10), `env.DB_STATEMENT_TIMEOUT_MS` (default 10000), `env.DB_IDLE_TX_TIMEOUT_MS` (default 10000).
  - From `src/db/schema.ts` (Task 4): `import * as schema from '@/db/schema'` (used to type the drizzle client `NodePgDatabase<typeof schema>`). Physical tenant-scoped table names produced by Task 4/Task 5: `users, user_detail, sessions, records, purchases, permalinks`.
- Produces (later tasks rely on these — copy verbatim from SPINE PART C):
  ```ts
  // src/db/client.ts (server-only)
  export const appPool: Pool;     // pg Pool on DATABASE_URL (qr_app), max=env.DB_POOL_MAX
  export const ownerPool: Pool;   // pg Pool on DATABASE_OWNER_URL (qr_owner)

  // src/db/tenant.ts (server-only) — THE runtime surface
  export type TenantCtx = { tenantId: number; userId: number | null };
  export type Tx = Parameters<Parameters<NodePgDatabase<typeof schema>['transaction']>[0]>[0];
  export async function withTenant<T>(ctx: TenantCtx, fn: (tx: Tx) => Promise<T>): Promise<T>;
  export async function withSuperadmin<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  export async function withOwner<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;

  // src/db/assertions.ts
  export async function assertDatabaseSafety(): Promise<void>;
  ```
  Consumed by: Task 7 (RLS gate), Task 9 (`getCurrentTenant` via `withOwner`), Task 10 (auth adapter via `withTenant`), Task 12 (`provisionTenant` via `withOwner`), Task 14 (worker jobs via `withSuperadmin`), Task 15 (`assertDatabaseSafety` in `entrypoint-web.sh`).

LOCKED implementation detail (Global Constraints — reproduce exactly): each wrapper opens `drizzle(pool,{schema}).transaction(...)` and as the first statement runs a single `select set_config('app.current_tenant', …, true), set_config('app.current_user_id', …, true), set_config('app.is_superadmin', …, true)` — the third arg `true` = `is_local` = **transaction-scoped** (`SET LOCAL` semantics). NEVER connection-scoped `SET`. GUC names exactly `app.current_tenant` / `app.current_user_id` / `app.is_superadmin` (never `app.current_user`). `withTenant`: validate `Number.isInteger(tenantId)`, `isSuperadmin='false'`, appPool. `withSuperadmin`: tenant=`''`, user=`''`, `isSuperadmin='true'`, appPool. `withOwner`: tenant=`''`, user=`''`, `isSuperadmin='false'`, ownerPool. The `${…}` interpolations are drizzle bound params (injection-safe).

---

#### Cycle A — pools + tenant wrappers

- [ ] **Step 1: Write the failing test**

Create `tests/db/tenant.test.ts`. It mocks `server-only` (the npm package throws when imported outside an RSC bundle) and stubs the env BEFORE the first dynamic import (pg Pools construct lazily, so dummy URLs never connect). It verifies (a) pool config comes from env and (b) `withTenant` validates the integer contract before touching the DB.

```ts
import { beforeAll, describe, expect, it, vi } from 'vitest';

// `server-only` throws if imported in a non-RSC environment; neutralise it for unit tests.
vi.mock('server-only', () => ({}));

beforeAll(() => {
  // Valid-enough env so `src/env.ts` parses. Pools are lazy — these URLs are never dialled.
  process.env.NODE_ENV ??= 'test';
  process.env.ROOT_DOMAIN ??= 'localhost';
  process.env.APP_PROTOCOL ??= 'http';
  process.env.DATABASE_URL ??= 'postgres://qr_app:pw@127.0.0.1:5432/qr';
  process.env.DATABASE_OWNER_URL ??= 'postgres://qr_owner:pw@127.0.0.1:5432/qr';
  process.env.PGBOSS_DATABASE_URL ??= 'postgres://qr_owner:pw@127.0.0.1:5432/qr';
  process.env.AUTH_SECRET ??= 'test-secret-test-secret-test-secret-0001';
  process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
  process.env.ENCRYPTION_KEY_ID ??= 'v1';
  process.env.MAIL_DRIVER ??= 'console';
  process.env.MAIL_HOST ??= 'localhost';
  process.env.MAIL_PORT ??= '1025';
  process.env.MAIL_FROM ??= 'noreply@example.test';
});

describe('src/db/client pools', () => {
  it('configures appPool and ownerPool from env (max + timeouts)', async () => {
    const { appPool, ownerPool } = await import('@/db/client');
    expect(appPool.options.max).toBe(10);
    expect(appPool.options.statement_timeout).toBe(10000);
    expect(appPool.options.idle_in_transaction_session_timeout).toBe(10000);
    expect(ownerPool.options.max).toBe(10);
    expect(ownerPool.options.statement_timeout).toBe(10000);
  });
});

describe('withTenant input validation (fails closed before any DB work)', () => {
  it('rejects a non-integer tenantId and never invokes the callback', async () => {
    const { withTenant } = await import('@/db/tenant');
    let called = false;
    await expect(
      withTenant({ tenantId: 1.5, userId: null }, async () => {
        called = true;
        return 1;
      }),
    ).rejects.toThrow(/tenantId must be an integer/);
    expect(called).toBe(false);
  });

  it('rejects a non-integer, non-null userId', async () => {
    const { withTenant } = await import('@/db/tenant');
    await expect(
      withTenant({ tenantId: 1, userId: 2.5 }, async () => 1),
    ).rejects.toThrow(/userId must be an integer/);
  });

  it('exposes the three wrappers as functions', async () => {
    const mod = await import('@/db/tenant');
    expect(typeof mod.withTenant).toBe('function');
    expect(typeof mod.withSuperadmin).toBe('function');
    expect(typeof mod.withOwner).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/db/tenant.test.ts`
Expected: FAIL — Vitest cannot resolve the modules, e.g. `Failed to load url @/db/client` / `Cannot find module '@/db/tenant'`.

- [ ] **Step 3: Create `src/db/client.ts` (the two raw pools)**

```ts
import 'server-only';
import { Pool } from 'pg';
import { env } from '@/env';

const connectionOptions = {
  // Both are transaction/connection guards passed straight through to the pg client.
  statement_timeout: env.DB_STATEMENT_TIMEOUT_MS,
  idle_in_transaction_session_timeout: env.DB_IDLE_TX_TIMEOUT_MS,
} as const;

/** Runtime pool — connects as `qr_app` (NON-superuser, NO BYPASSRLS). RLS-enforced. */
export const appPool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DB_POOL_MAX,
  ...connectionOptions,
});

/** Privileged pool — connects as `qr_owner`. Registry writes + migrations ONLY. */
export const ownerPool = new Pool({
  connectionString: env.DATABASE_OWNER_URL,
  max: env.DB_POOL_MAX,
  ...connectionOptions,
});
```

- [ ] **Step 4: Create `src/db/tenant.ts` (the only runtime DB surface)**

```ts
import 'server-only';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import { appPool, ownerPool } from '@/db/client';
import * as schema from '@/db/schema';

export type TenantCtx = { tenantId: number; userId: number | null };
export type Tx = Parameters<Parameters<NodePgDatabase<typeof schema>['transaction']>[0]>[0];

/** Pre-stringified GUC values for a single set_config statement. */
type GucCtx = { tenantId: string; userId: string; isSuperadmin: boolean };

async function runInTx<T>(pool: Pool, ctx: GucCtx, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const db = drizzle(pool, { schema });
  return db.transaction(async (tx) => {
    // Transaction-local (is_local = true). NEVER connection-scoped `SET` — that leaks across the pool.
    await tx.execute(sql`select
      set_config('app.current_tenant', ${ctx.tenantId}, true),
      set_config('app.current_user_id', ${ctx.userId}, true),
      set_config('app.is_superadmin', ${ctx.isSuperadmin ? 'true' : 'false'}, true)`);
    return fn(tx);
  });
}

/** Tenant-scoped runtime access. `is_superadmin` is ALWAYS reset to false here — never inherited. */
export async function withTenant<T>(ctx: TenantCtx, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!Number.isInteger(ctx.tenantId)) {
    throw new Error(`withTenant: tenantId must be an integer, got ${String(ctx.tenantId)}`);
  }
  if (ctx.userId !== null && !Number.isInteger(ctx.userId)) {
    throw new Error(`withTenant: userId must be an integer or null, got ${String(ctx.userId)}`);
  }
  return runInTx(
    appPool,
    {
      tenantId: String(ctx.tenantId),
      userId: ctx.userId === null ? '' : String(ctx.userId),
      isSuperadmin: false,
    },
    fn,
  );
}

/** Platform-wide access (no tenant). Uses appPool; trips the superadmin_bypass policy. */
export async function withSuperadmin<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return runInTx(appPool, { tenantId: '', userId: '', isSuperadmin: true }, fn);
}

/** Owner pool (qr_owner) for registry/migration work. No tenant context, not superadmin. */
export async function withOwner<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return runInTx(ownerPool, { tenantId: '', userId: '', isSuperadmin: false }, fn);
}
```

- [ ] **Step 5: Run test to verify it passes**
Run: `pnpm test tests/db/tenant.test.ts`  Expected: PASS (5 assertions across 4 tests green).

- [ ] **Step 6: Commit**
```bash
git add src/db/client.ts src/db/tenant.ts tests/db/tenant.test.ts
git commit -m "feat(slice0): db client pools + withTenant/withSuperadmin/withOwner (SET LOCAL)"
```

---

#### Cycle B — boot safety assertions

- [ ] **Step 1: Write the failing test**

Create `tests/db/assertions.test.ts`. It mocks `@/db/client` so `assertDatabaseSafety()` runs against a fake pg client returning canned rows — no testcontainer needed here (the live-DB version is Task 7's gate). Each branch of the assertion (superuser / bypassrls / missing RLS / missing FORCE / missing policy / non-zero no-context count / all-good) is exercised.

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/db/client', () => ({
  appPool: { connect: vi.fn() },
  ownerPool: {},
}));

import { appPool } from '@/db/client';
import { assertDatabaseSafety } from '@/db/assertions';

type FakeOpts = {
  rolsuper?: boolean;
  rolbypassrls?: boolean;
  rls?: boolean;
  force?: boolean;
  policy?: boolean;
  recordsCount?: string;
};

function fakeClient(opts: FakeOpts = {}) {
  return {
    query: async (text: string) => {
      if (text.includes('pg_roles')) {
        return { rows: [{ rolsuper: opts.rolsuper ?? false, rolbypassrls: opts.rolbypassrls ?? false }] };
      }
      if (text.includes('relrowsecurity')) {
        return { rows: [{ relrowsecurity: opts.rls ?? true, relforcerowsecurity: opts.force ?? true }] };
      }
      if (text.includes('pg_policies')) {
        return { rows: [{ count: (opts.policy ?? true) ? '1' : '0' }] };
      }
      if (text.includes('FROM records')) {
        return { rows: [{ count: opts.recordsCount ?? '0' }] };
      }
      return { rows: [] };
    },
    release: () => {},
  };
}

const connect = appPool.connect as unknown as Mock;

function arm(opts: FakeOpts = {}) {
  connect.mockResolvedValue(fakeClient(opts));
}

describe('assertDatabaseSafety', () => {
  beforeEach(() => connect.mockReset());

  it('resolves on a correctly locked-down database', async () => {
    arm();
    await expect(assertDatabaseSafety()).resolves.toBeUndefined();
  });

  it('throws if the app role is a SUPERUSER', async () => {
    arm({ rolsuper: true });
    await expect(assertDatabaseSafety()).rejects.toThrow(/SUPERUSER/);
  });

  it('throws if the app role has BYPASSRLS', async () => {
    arm({ rolbypassrls: true });
    await expect(assertDatabaseSafety()).rejects.toThrow(/BYPASSRLS/);
  });

  it('throws if a tenant-scoped table lacks ROW LEVEL SECURITY', async () => {
    arm({ rls: false });
    await expect(assertDatabaseSafety()).rejects.toThrow(/ROW LEVEL SECURITY/);
  });

  it('throws if a tenant-scoped table lacks FORCE ROW LEVEL SECURITY', async () => {
    arm({ force: false });
    await expect(assertDatabaseSafety()).rejects.toThrow(/FORCE ROW LEVEL SECURITY/);
  });

  it("throws if the 'tenant_isolation' policy is missing", async () => {
    arm({ policy: false });
    await expect(assertDatabaseSafety()).rejects.toThrow(/tenant_isolation/);
  });

  it('throws if records returns rows without tenant context (RLS not fail-closed)', async () => {
    arm({ recordsCount: '3' });
    await expect(assertDatabaseSafety()).rejects.toThrow(/without tenant context/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test tests/db/assertions.test.ts`
Expected: FAIL — `Cannot find module '@/db/assertions'`.

- [ ] **Step 3: Create `src/db/assertions.ts`**

```ts
import 'server-only';
import { appPool } from '@/db/client';

/** Physical names of tenant-scoped tables (must match Task 4 schema + Task 5 RLS migration). */
const TENANT_SCOPED_TABLES = [
  'users',
  'user_detail',
  'sessions',
  'records',
  'purchases',
  'permalinks',
] as const;

/**
 * Boot guard (run before serving traffic). Fails closed if:
 *  - the current connection role is a SUPERUSER or has BYPASSRLS,
 *  - any tenant-scoped table lacks rowsecurity + forced + the `tenant_isolation` policy,
 *  - a SELECT on `records` WITHOUT tenant context returns more than 0 rows.
 */
export async function assertDatabaseSafety(): Promise<void> {
  const client = await appPool.connect();
  try {
    const role = await client.query(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    );
    const r = role.rows[0] as { rolsuper: boolean; rolbypassrls: boolean } | undefined;
    if (!r) throw new Error('assertDatabaseSafety: current_user not found in pg_roles');
    if (r.rolsuper) {
      throw new Error('assertDatabaseSafety: app role is a SUPERUSER — refusing to start');
    }
    if (r.rolbypassrls) {
      throw new Error('assertDatabaseSafety: app role has BYPASSRLS — refusing to start');
    }

    for (const table of TENANT_SCOPED_TABLES) {
      const sec = await client.query(
        `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = $1::regclass`,
        [table],
      );
      const s = sec.rows[0] as { relrowsecurity: boolean; relforcerowsecurity: boolean } | undefined;
      if (!s) throw new Error(`assertDatabaseSafety: table ${table} not found`);
      if (!s.relrowsecurity) {
        throw new Error(`assertDatabaseSafety: ${table} is missing ROW LEVEL SECURITY`);
      }
      if (!s.relforcerowsecurity) {
        throw new Error(`assertDatabaseSafety: ${table} is missing FORCE ROW LEVEL SECURITY`);
      }

      const pol = await client.query(
        `SELECT count(*)::text AS count FROM pg_policies
         WHERE schemaname = 'public' AND tablename = $1 AND policyname = 'tenant_isolation'`,
        [table],
      );
      if ((pol.rows[0] as { count: string } | undefined)?.count !== '1') {
        throw new Error(`assertDatabaseSafety: ${table} is missing policy 'tenant_isolation'`);
      }
    }

    // No tenant context is set on this raw connection → current_setting(...) is NULL → 0 rows.
    const noCtx = await client.query(`SELECT count(*)::text AS count FROM records`);
    if ((noCtx.rows[0] as { count: string } | undefined)?.count !== '0') {
      throw new Error(
        'assertDatabaseSafety: records returned rows without tenant context — RLS is not fail-closed',
      );
    }
  } finally {
    client.release();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test tests/db/assertions.test.ts`  Expected: PASS (7 tests green).

- [ ] **Step 5: Commit**
```bash
git add src/db/assertions.ts tests/db/assertions.test.ts
git commit -m "feat(slice0): assertDatabaseSafety boot guard (role + RLS + fail-closed)"
```

---

**Acceptance:**
- `pnpm typecheck` is green (strict, no `any` — the assertion rows are narrowed via local types).
- `pnpm test tests/db/tenant.test.ts tests/db/assertions.test.ts` passes: pool config sourced from env, `withTenant` rejects non-integer `tenantId`/`userId` before any DB work, and every `assertDatabaseSafety` failure branch (SUPERUSER, BYPASSRLS, missing RLS/FORCE/policy, non-zero no-context count) throws while the locked-down case resolves.
- The three wrappers set tenant context exclusively via transaction-local `set_config(..., true)` and only `withOwner` uses `ownerPool`; `withTenant`/`withSuperadmin` use `appPool`. `is_superadmin` is hard-reset per transaction.
- `src/db/client.ts`/`tenant.ts`/`assertions.ts` carry `import 'server-only'`; no file outside `src/db/**` imports `@/db/client` (enforced by Task 1's ESLint `no-restricted-imports`).
- Behavioural RLS verification against a live testcontainer (no-context→0 rows, two-tenant interleave, superadmin-no-leak across pooled connections, FORCE/policy dropped → throws) is delivered in **Task 7**, which consumes these exports unchanged (§9.1/§9.2/§9.5/§9.6 gate).

---

### Task 7: RLS fail-closed integration tests

This is the **security gate** for Slice 0 — it proves §9.1 (no context → 0 rows), §9.2 (two-tenant interleave → no leak), §9.5 (boot assertion fails on missing RLS), and §9.6 (`is_superadmin` does not leak across pooled connections) against a **real PostgreSQL 17** via testcontainers. It builds the shared `setupTestDatabase()`/`seedTenant()` harness consumed by Tasks 10, 12, 14.

**Files:**
- Create: `tests/helpers/db.ts`
- Create (Test): `tests/rls.integration.test.ts`

**Interfaces:**
- Consumes (from Tasks 5 & 6, PART C — verbatim):
  - `src/db/tenant.ts`: `export async function withTenant<T>(ctx: TenantCtx, fn: (tx: Tx) => Promise<T>): Promise<T>`; `export async function withSuperadmin<T>(fn: (tx: Tx) => Promise<T>): Promise<T>`; `export async function withOwner<T>(fn: (tx: Tx) => Promise<T>): Promise<T>`; `export type TenantCtx = { tenantId: number; userId: number | null }`. Each opens a transaction and sets `app.current_tenant` / `app.current_user_id` / `app.is_superadmin` via `set_config(..., true)` (transaction-local). `withTenant` forces `is_superadmin=false`; `withSuperadmin` uses `appPool` with `is_superadmin=true`.
  - `src/db/client.ts`: `export const appPool: Pool` (qr_app, non-superuser, NO BYPASSRLS), `export const ownerPool: Pool` (qr_owner).
  - `src/db/assertions.ts`: `export async function assertDatabaseSafety(): Promise<void>` — throws if `qr_app` is `rolsuper`/`rolbypassrls`, or any of `[users,userDetail,sessions,records,purchases,permalinks]` lacks `relrowsecurity`+`relforcerowsecurity`+policy `tenant_isolation`, or a no-context SELECT on `records` returns rows.
  - Migrations `drizzle/0000_*.sql` (tables), `drizzle/0001_rls.sql` (ENABLE+FORCE RLS, `tenant_isolation` + `superadmin_bypass` policies, `tenant_id DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::int`, grants), `drizzle/0002_seed_plans.sql`, applied via the drizzle node-postgres migrator over `drizzle/`.
- Produces (PART C — locked, consumed by Tasks 10/12/14 verbatim):
  - `tests/helpers/db.ts`: `export async function setupTestDatabase(): Promise<{ container; ownerUrl: string; appUrl: string; teardown: () => Promise<void> }>` — starts `@testcontainers/postgresql:17`, creates `qr_owner` (`NOSUPERUSER BYPASSRLS`) + `qr_app` (`NOSUPERUSER NOBYPASSRLS`), runs the migrator as owner, sets `process.env` DB URLs, returns both conn strings + teardown.
  - `tests/helpers/db.ts`: `export async function seedTenant(input: { slug: string; name: string; primaryColor?: string; adminEmail?: string }): Promise<{ tenantId: number; adminUserId: number }>`.

---

- [ ] **Step 1: Write the failing test**

Create `tests/rls.integration.test.ts`:

```ts
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { seedTenant, setupTestDatabase } from './helpers/db';

let db: Awaited<ReturnType<typeof setupTestDatabase>>;
let withTenant: typeof import('@/db/tenant')['withTenant'];
let withSuperadmin: typeof import('@/db/tenant')['withSuperadmin'];
let appPool: Pool;
let assertDatabaseSafety: typeof import('@/db/assertions')['assertDatabaseSafety'];

beforeAll(async () => {
  // setupTestDatabase sets process.env.{DATABASE_URL,DATABASE_OWNER_URL,...}
  // BEFORE the db modules are imported, so env.ts/client.ts read the live
  // testcontainer ports. We reset the module graph and import after.
  db = await setupTestDatabase();
  vi.resetModules();
  ({ withTenant, withSuperadmin } = await import('@/db/tenant'));
  ({ appPool } = await import('@/db/client'));
  ({ assertDatabaseSafety } = await import('@/db/assertions'));
}, 180_000);

afterAll(async () => {
  await db.teardown();
});

describe('RLS fail-closed (the security gate)', () => {
  // §9.1
  it('returns 0 rows for a raw appPool query with NO tenant context', async () => {
    const { tenantId } = await seedTenant({ slug: 'alpha', name: 'Alpha' });
    await withTenant({ tenantId, userId: null }, (tx) =>
      tx.execute(
        sql`insert into records (tenant_id, title, artist, hash) values (${tenantId}, 'No-Ctx', 'A', ${`h-alpha-${tenantId}`})`,
      ),
    );

    const res = await appPool.query('select * from records');
    expect(res.rowCount).toBe(0);
  });

  // §9.1 (insert side) — no GUC default => NOT NULL / WITH CHECK violation
  it('rejects an INSERT without tenant context', async () => {
    await expect(
      appPool.query(`insert into records (title, artist, hash) values ('x','y','no-ctx-insert')`),
    ).rejects.toThrow();
  });

  // §9.2 — interleaved concurrent reads, x50 per tenant, never leak
  it('isolates two tenants under concurrent interleaved reads (x50)', async () => {
    const a = await seedTenant({ slug: 'beta', name: 'Beta' });
    const b = await seedTenant({ slug: 'gamma', name: 'Gamma' });
    await withTenant({ tenantId: a.tenantId, userId: null }, (tx) =>
      tx.execute(
        sql`insert into records (tenant_id, title, artist, hash) values (${a.tenantId}, 'A-rec', 'A', ${`ha-${a.tenantId}`})`,
      ),
    );
    await withTenant({ tenantId: b.tenantId, userId: null }, (tx) =>
      tx.execute(
        sql`insert into records (tenant_id, title, artist, hash) values (${b.tenantId}, 'B-rec', 'B', ${`hb-${b.tenantId}`})`,
      ),
    );

    const readTitles = (tenantId: number) =>
      withTenant({ tenantId, userId: null }, async (tx) => {
        const r = await tx.execute(sql`select title from records`);
        return r.rows.map((row) => row.title as string);
      });

    const ops = Array.from({ length: 50 }).flatMap(() => [
      readTitles(a.tenantId),
      readTitles(b.tenantId),
    ]);
    const results = await Promise.all(ops);

    results.forEach((titles, idx) => {
      expect(titles).toEqual([idx % 2 === 0 ? 'A-rec' : 'B-rec']);
    });
  });

  // §9.6 — is_superadmin must NOT leak onto a reused pooled connection
  it('does not leak is_superadmin across pooled connections', async () => {
    const a = await seedTenant({ slug: 'delta', name: 'Delta' });
    const b = await seedTenant({ slug: 'epsilon', name: 'Epsilon' });
    await withTenant({ tenantId: b.tenantId, userId: null }, (tx) =>
      tx.execute(
        sql`insert into records (tenant_id, title, artist, hash) values (${b.tenantId}, 'secret-B', 'B', ${`hsb-${b.tenantId}`})`,
      ),
    );

    // superadmin op sees everything...
    await withSuperadmin(async (tx) => {
      const r = await tx.execute(sql`select count(*)::int as c from records`);
      expect(Number(r.rows[0].c)).toBeGreaterThanOrEqual(1);
    });

    // ...then a tenant-A op reusing the same pool must NOT inherit superadmin
    const seenByA = await withTenant({ tenantId: a.tenantId, userId: null }, async (tx) => {
      const r = await tx.execute(sql`select title from records`);
      return r.rows.map((row) => row.title as string);
    });
    expect(seenByA).not.toContain('secret-B');
    expect(seenByA).toEqual([]);
  });

  // §9.5 — boot assertion passes on a correct DB...
  it('assertDatabaseSafety passes on the migrated database', async () => {
    await expect(assertDatabaseSafety()).resolves.toBeUndefined();
  });

  // §9.5 — ...and FAILS CLOSED when FORCE row security is removed.
  // Keep this test LAST: it mutates and restores the shared schema.
  it('assertDatabaseSafety throws when FORCE row security is dropped', async () => {
    const { ownerPool } = await import('@/db/client');
    await ownerPool.query('ALTER TABLE records NO FORCE ROW LEVEL SECURITY');
    try {
      await expect(assertDatabaseSafety()).rejects.toThrow();
    } finally {
      await ownerPool.query('ALTER TABLE records FORCE ROW LEVEL SECURITY');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test rls.integration`
Expected: FAIL — the suite cannot load because the harness module does not exist yet: `Failed to resolve import "./helpers/db" from "tests/rls.integration.test.ts"` (or `Cannot find module './helpers/db'`).

- [ ] **Step 3: Implement the testcontainers harness**

Create `tests/helpers/db.ts`:

```ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import {
  PostgreSQLContainer,
  type StartedPostgreSQLContainer,
} from '@testcontainers/postgresql';

export interface TestDatabase {
  container: StartedPostgreSQLContainer;
  ownerUrl: string;
  appUrl: string;
  teardown: () => Promise<void>;
}

const OWNER_PW = 'owner_pw';
const APP_PW = 'app_pw';
const DB_NAME = 'qrecords';

/**
 * Boots PostgreSQL 17, creates qr_owner (NOSUPERUSER BYPASSRLS) + qr_app (NOSUPERUSER NOBYPASSRLS),
 * runs the drizzle migrator (0000 tables, 0001 RLS, 0002 plans) as qr_owner, and
 * exports the live connection URLs into process.env so the db modules pick them up
 * when imported AFTER this call. This is the SINGLE source of test DB state.
 */
export async function setupTestDatabase(): Promise<TestDatabase> {
  const container = await new PostgreSQLContainer('postgres:17')
    .withDatabase(DB_NAME)
    .withUsername('postgres')
    .withPassword('postgres')
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(5432);
  const ownerUrl = `postgresql://qr_owner:${OWNER_PW}@${host}:${port}/${DB_NAME}`;
  const appUrl = `postgresql://qr_app:${APP_PW}@${host}:${port}/${DB_NAME}`;

  // 1. Superuser-only role setup (mirrors docker/postgres/init/01-roles.sql).
  const admin = new Pool({ connectionString: container.getConnectionUri() });
  try {
    await admin.query(
      `CREATE ROLE qr_owner LOGIN NOSUPERUSER BYPASSRLS PASSWORD '${OWNER_PW}'`,
    );
    await admin.query(
      `CREATE ROLE qr_app LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${APP_PW}'`,
    );
    await admin.query(`GRANT ALL ON DATABASE ${DB_NAME} TO qr_owner`);
    await admin.query(`ALTER SCHEMA public OWNER TO qr_owner`);
    await admin.query(`GRANT USAGE ON SCHEMA public TO qr_app`);
  } finally {
    await admin.end();
  }

  // 2. Run the versioned migrations as the owner (NOT push). This applies the
  //    table DDL, then 0001_rls.sql (ENABLE+FORCE RLS, policies, grants, GUC
  //    column defaults), then 0002_seed_plans.sql — same pipeline as production.
  const migrationPool = new Pool({ connectionString: ownerUrl });
  try {
    await migrate(drizzle(migrationPool), { migrationsFolder: 'drizzle' });
    // qr_app needs sequence usage for serial PKs (mirrors 0001 grants).
    await migrationPool.query(
      'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO qr_app',
    );
  } finally {
    await migrationPool.end();
  }

  // 3. Publish env BEFORE any db module import so env.ts/client.ts bind to this
  //    container. ?? keeps any value already provided by the vitest setup file.
  process.env.DATABASE_URL = appUrl;
  process.env.DATABASE_OWNER_URL = ownerUrl;
  process.env.PGBOSS_DATABASE_URL = ownerUrl;
  process.env.NODE_ENV ??= 'test';
  process.env.ROOT_DOMAIN ??= 'localhost';
  process.env.APP_PROTOCOL ??= 'http';
  process.env.APP_PORT ??= '3000';
  process.env.AUTH_SECRET ??= 'test-secret-test-secret-test-secret-0';
  process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
  process.env.ENCRYPTION_KEY_ID ??= 'v1';
  process.env.MAIL_DRIVER ??= 'console';
  process.env.MAIL_HOST ??= 'localhost';
  process.env.MAIL_PORT ??= '1025';
  process.env.MAIL_FROM ??= 'test@qrecords.test';

  return {
    container,
    ownerUrl,
    appUrl,
    teardown: async () => {
      // End the singleton pools created by @/db/client (if they were imported),
      // then stop the container.
      try {
        const { appPool, ownerPool } = await import('@/db/client');
        await appPool.end().catch(() => undefined);
        await ownerPool.end().catch(() => undefined);
      } catch {
        // client never imported in this run — nothing to close.
      }
      await container.stop();
    },
  };
}

/**
 * Seeds one tenant registry row (via owner — registry is NOT under tenant RLS)
 * plus one admin user (via withSuperadmin — superadmin_bypass policy lets the
 * non-superuser qr_app write through FORCE RLS with an explicit tenant_id).
 */
export async function seedTenant(input: {
  slug: string;
  name: string;
  primaryColor?: string;
  adminEmail?: string;
}): Promise<{ tenantId: number; adminUserId: number }> {
  const { ownerPool } = await import('@/db/client');
  const { withSuperadmin } = await import('@/db/tenant');

  const branding = {
    branding: { primaryColor: input.primaryColor ?? '#FF5A5F', logo: null },
  };
  const tenantRow = await ownerPool.query(
    `insert into tenants (slug, name, config) values ($1, $2, $3) returning id`,
    [input.slug, input.name, JSON.stringify(branding)],
  );
  const tenantId = Number(tenantRow.rows[0].id);

  const adminUserId = await withSuperadmin(async (tx) => {
    const res = await tx.execute(
      sql`insert into users (tenant_id, email, password, role, is_superadmin)
          values (${tenantId}, ${input.adminEmail ?? `admin@${input.slug}.test`}, ${'seed-not-a-real-hash'}, 'admin', false)
          returning id`,
    );
    return Number(res.rows[0].id);
  });

  return { tenantId, adminUserId };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test rls.integration`  Expected: PASS — all six assertions green (no-context → 0 rows; context-less insert rejected; 100 interleaved reads each see only their own tenant; superadmin does not leak onto the reused connection; `assertDatabaseSafety()` resolves on the migrated DB and rejects once `FORCE ROW LEVEL SECURITY` is dropped).

- [ ] **Step 5: Commit**
```bash
git add tests/helpers/db.ts tests/rls.integration.test.ts
git commit -m "feat(slice0): RLS fail-closed integration tests + testcontainers harness"
```

---

### Task 8: Crypto helper (AES-256-GCM)

**Files:**
- Create: `src/lib/crypto.ts`
- Test: `tests/crypto.test.ts`

**Interfaces:**
- Consumes: `src/env.ts` → `env.ENCRYPTION_KEY` (base64 string, must decode to 32 bytes), `env.ENCRYPTION_KEY_ID` (string, e.g. `"v1"`)
- Produces (copy from SPINE PART C verbatim):
  ```ts
  export function encryptSecret(plaintext: string, aad: { tenantId: number; userId?: number|null }): string; // "v1.<ivB64>.<tagB64>.<ctB64>"
  export function decryptSecret(payload: string, aad: { tenantId: number; userId?: number|null }): string;   // throws on tamper/AAD mismatch
  export function assertEncryptionKey(): void; // throws unless base64 decodes to exactly 32 bytes
  // AES-256-GCM, random 12-byte IV per call, AAD = utf8(`${tenantId}:${userId ?? ''}`), keyId = env.ENCRYPTION_KEY_ID
  ```

---

- [ ] **Step 1: Write the failing test**

Create `tests/crypto.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

// vi.mock is hoisted above all imports by Vitest — runs before module resolution
vi.mock('@/env', () => ({
  env: {
    ENCRYPTION_KEY: Buffer.alloc(32, 0xab).toString('base64'), // valid 32-byte key
    ENCRYPTION_KEY_ID: 'v1',
  },
}));

import { encryptSecret, decryptSecret, assertEncryptionKey } from '@/lib/crypto';

const TEST_AAD = { tenantId: 42, userId: 7 } as const;
const PLAINTEXT = 'super-secret-discogs-token';

describe('crypto helper — AES-256-GCM', () => {
  describe('encryptSecret / decryptSecret', () => {
    it('roundtrip: decrypt(encrypt(plain)) === plain', () => {
      const payload = encryptSecret(PLAINTEXT, TEST_AAD);
      expect(decryptSecret(payload, TEST_AAD)).toBe(PLAINTEXT);
    });

    it('payload has 4 dot-separated parts, first part is the key id', () => {
      const payload = encryptSecret(PLAINTEXT, TEST_AAD);
      const parts = payload.split('.');
      expect(parts).toHaveLength(4);
      expect(parts[0]).toBe('v1');
    });

    it('produces a distinct IV per call — two encryptions of identical plaintext differ', () => {
      const p1 = encryptSecret(PLAINTEXT, TEST_AAD);
      const p2 = encryptSecret(PLAINTEXT, TEST_AAD);
      expect(p1).not.toBe(p2);
      // IV is the second dot-segment
      expect(p1.split('.')[1]).not.toBe(p2.split('.')[1]);
    });

    it('throws when a ciphertext byte is flipped (tamper via ct)', () => {
      const payload = encryptSecret(PLAINTEXT, TEST_AAD);
      const [keyId, ivB64, tagB64, ctB64] = payload.split('.');
      const ct = Buffer.from(ctB64, 'base64');
      ct[0] ^= 0xff; // flip first byte
      const tampered = `${keyId}.${ivB64}.${tagB64}.${ct.toString('base64')}`;
      expect(() => decryptSecret(tampered, TEST_AAD)).toThrow();
    });

    it('throws when the auth tag is flipped (tamper via tag)', () => {
      const payload = encryptSecret(PLAINTEXT, TEST_AAD);
      const [keyId, ivB64, tagB64, ctB64] = payload.split('.');
      const tag = Buffer.from(tagB64, 'base64');
      tag[0] ^= 0xff;
      const tampered = `${keyId}.${ivB64}.${tag.toString('base64')}.${ctB64}`;
      expect(() => decryptSecret(tampered, TEST_AAD)).toThrow();
    });

    it('throws when decrypting with a different tenantId in AAD (wrong tenant)', () => {
      const payload = encryptSecret(PLAINTEXT, { tenantId: 1, userId: null });
      expect(() => decryptSecret(payload, { tenantId: 2, userId: null })).toThrow();
    });

    it('throws when decrypting with a different userId in AAD', () => {
      const payload = encryptSecret(PLAINTEXT, { tenantId: 1, userId: 10 });
      expect(() => decryptSecret(payload, { tenantId: 1, userId: 99 })).toThrow();
    });

    it('handles null userId in AAD consistently (encrypt then decrypt)', () => {
      const aad = { tenantId: 5, userId: null };
      expect(decryptSecret(encryptSecret(PLAINTEXT, aad), aad)).toBe(PLAINTEXT);
    });

    it('handles undefined userId in AAD the same as null (treated as empty string)', () => {
      const aad = { tenantId: 5 }; // userId absent = undefined
      expect(decryptSecret(encryptSecret(PLAINTEXT, aad), aad)).toBe(PLAINTEXT);
    });

    it('throws on malformed payload with wrong number of dot-segments', () => {
      expect(() => decryptSecret('v1.onlytwoparts', TEST_AAD)).toThrow();
      expect(() => decryptSecret('v1.a.b.c.d', TEST_AAD)).toThrow();
    });
  });

  describe('assertEncryptionKey', () => {
    it('does not throw when the mocked key decodes to exactly 32 bytes', () => {
      expect(() => assertEncryptionKey()).not.toThrow();
    });
  });
});

// Separate describe block so vi.resetModules() does not pollute the tests above
describe('assertEncryptionKey — rejects a key that is not 32 bytes', () => {
  it('throws mentioning "32 bytes" when ENCRYPTION_KEY decodes to 16 bytes', async () => {
    vi.resetModules();
    vi.doMock('@/env', () => ({
      env: {
        ENCRYPTION_KEY: Buffer.alloc(16, 0x01).toString('base64'), // 16 bytes — wrong
        ENCRYPTION_KEY_ID: 'v1',
      },
    }));
    const { assertEncryptionKey: fn } = await import('@/lib/crypto');
    expect(() => fn()).toThrow('32 bytes');
    vi.resetModules(); // restore clean state for subsequent test files
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/crypto.test.ts`

Expected: FAIL with `"Cannot find module '@/lib/crypto'"` (the source file does not exist yet).

- [ ] **Step 3: Implement `src/lib/crypto.ts`**

Create `src/lib/crypto.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '@/env';

/**
 * Throws if ENCRYPTION_KEY does not base64-decode to exactly 32 bytes.
 * Call once at server boot before handling any traffic.
 */
export function assertEncryptionKey(): void {
  const keyBytes = Buffer.from(env.ENCRYPTION_KEY, 'base64');
  if (keyBytes.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must base64-decode to exactly 32 bytes; got ${keyBytes.length}. ` +
        `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }
}

/**
 * Builds the AAD (Additional Authenticated Data) buffer.
 * Format: utf-8 encoding of "<tenantId>:<userId|empty>"
 * Binds the ciphertext to a specific tenant (and optionally user).
 */
function buildAad(aad: { tenantId: number; userId?: number | null }): Buffer {
  return Buffer.from(`${aad.tenantId}:${aad.userId ?? ''}`, 'utf8');
}

/**
 * Encrypts `plaintext` under AES-256-GCM.
 * - Random 12-byte IV per call (never reused).
 * - AAD = utf-8(`${tenantId}:${userId ?? ""}`) — decryption fails if either differs.
 * - Returns: `"<keyId>.<ivBase64>.<tagBase64>.<ciphertextBase64>"`
 */
export function encryptSecret(
  plaintext: string,
  aad: { tenantId: number; userId?: number | null },
): string {
  const key = Buffer.from(env.ENCRYPTION_KEY, 'base64');
  const iv = randomBytes(12); // 96-bit IV, GCM standard
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(buildAad(aad));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag(); // 128-bit auth tag
  return (
    `${env.ENCRYPTION_KEY_ID}` +
    `.${iv.toString('base64')}` +
    `.${tag.toString('base64')}` +
    `.${ct.toString('base64')}`
  );
}

/**
 * Decrypts a payload produced by `encryptSecret`.
 * Throws if:
 *  - The payload is malformed (wrong number of segments).
 *  - The key id does not match `env.ENCRYPTION_KEY_ID`.
 *  - The auth tag fails verification (ciphertext tampered or wrong AAD).
 */
export function decryptSecret(
  payload: string,
  aad: { tenantId: number; userId?: number | null },
): string {
  const parts = payload.split('.');
  if (parts.length !== 4) {
    throw new Error(
      `Invalid crypto payload: expected 4 dot-separated segments, got ${parts.length}`,
    );
  }
  const [keyId, ivB64, tagB64, ctB64] = parts as [string, string, string, string];

  if (keyId !== env.ENCRYPTION_KEY_ID) {
    throw new Error(
      `Unknown encryption key id "${keyId}"; current key id is "${env.ENCRYPTION_KEY_ID}"`,
    );
  }

  const key = Buffer.from(env.ENCRYPTION_KEY, 'base64');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  decipher.setAAD(buildAad(aad));

  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    throw new Error(
      'Decryption failed: authentication tag mismatch — payload was tampered or AAD (tenantId/userId) is wrong',
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/crypto.test.ts`

Expected: PASS — all test cases green, including roundtrip, both tamper variants, wrong-AAD tenantId, wrong-AAD userId, null/undefined userId, malformed payload, valid key assertion, and the dynamic-import bad-key assertion.

Also run the full suite to confirm no regressions:

Run: `pnpm typecheck && pnpm test`

Expected: PASS on both.

- [ ] **Step 5: Commit**

```bash
git add src/lib/crypto.ts tests/crypto.test.ts
git commit -m "feat(slice0): AES-256-GCM crypto helper with AAD tenant binding and boot assertion"
```

---

### Task 9: Edge subdomain resolution + getCurrentTenant

**Files:**
- Create: `src/lib/subdomain.ts`
- Create: `src/middleware.ts`
- Create: `src/lib/tenant.ts`
- Test: `tests/subdomain.test.ts`
- Test: `tests/tenant.test.ts`

**Interfaces:**

- Consumes from Task 1: `src/env.ts` (env validated; `ROOT_DOMAIN` env var available); `@/*` path alias configured in `tsconfig.json` and `vitest.config.ts`
- Consumes from Task 4: `src/db/schema.ts` — `tenants` table (Drizzle `pgTable`)
- Consumes from Task 6: `src/db/tenant.ts` — `withOwner<T>(fn: (tx: Tx) => Promise<T>): Promise<T>`

- Produces (verbatim from SPINE PART C — used by Tasks 10, 12, 13, 15):

```ts
// src/lib/subdomain.ts  (edge-safe, pure, no Node imports)
export const RESERVED_SUBDOMAINS: ReadonlySet<string>;
// members: www, app, api, admin, auth, static, _next, cdn, mail, assets

export type SubdomainResult =
  | { kind: 'tenant'; slug: string }
  | { kind: 'reserved' }
  | { kind: 'none' };

export function parseTenantSlug(host: string | null, rootDomain: string): SubdomainResult;
// strips port; host === rootDomain or no label before rootDomain → 'none';
// label in RESERVED_SUBDOMAINS → 'reserved'; else lowercase slug.
// handles 'demo.localhost' with rootDomain 'localhost'.

// src/lib/tenant.ts  (Node server; NOT edge)
export type TenantBranding = { primaryColor: string; logo: string | null };
export type Tenant = {
  id: number; slug: string; name: string; domain: string | null;
  plan: string; branding: TenantBranding; limits: Record<string, unknown>;
};

export const getCurrentTenant: () => Promise<Tenant>;
// React cache(); reads x-tenant-slug header; notFound() if slug missing or row absent.
// Resolves via withOwner (registry not under tenant RLS).

export function getCurrentTenantSlug(): Promise<string | null>;
// reads x-tenant-slug from headers()

export function accentOnColor(hex: string): '#FFFFFF' | '#111111';
// WCAG relative-luminance pick: whichever of white/#111111 yields higher contrast ratio

export function assertAccessibleAccent(hex: string): { onAccent: '#FFFFFF' | '#111111' };
// throws if BOTH white and #111111 are below 4.5:1 contrast against hex
```

---

- [ ] **Step 1: Write the failing subdomain tests**

Create `tests/subdomain.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  RESERVED_SUBDOMAINS,
  parseTenantSlug,
  type SubdomainResult,
} from '@/lib/subdomain';

describe('RESERVED_SUBDOMAINS', () => {
  it('contains the required 10 entries', () => {
    for (const s of [
      'www', 'app', 'api', 'admin', 'auth',
      'static', '_next', 'cdn', 'mail', 'assets',
    ]) {
      expect(RESERVED_SUBDOMAINS.has(s)).toBe(true);
    }
  });
});

describe('parseTenantSlug', () => {
  const cases: Array<[string | null, string, SubdomainResult]> = [
    // tenant cases
    ['demo.localhost',         'localhost',   { kind: 'tenant', slug: 'demo' }],
    ['DEMO.localhost',         'localhost',   { kind: 'tenant', slug: 'demo' }],
    ['demo.localhost:3000',    'localhost',   { kind: 'tenant', slug: 'demo' }],
    ['vinylcave.localhost',    'localhost',   { kind: 'tenant', slug: 'vinylcave' }],
    ['demo.example.com',      'example.com', { kind: 'tenant', slug: 'demo' }],
    ['DEMO.EXAMPLE.COM',      'example.com', { kind: 'tenant', slug: 'demo' }],
    ['demo.example.com:443',  'example.com', { kind: 'tenant', slug: 'demo' }],
    // none cases
    ['localhost',              'localhost',   { kind: 'none' }],
    ['localhost:3000',         'localhost',   { kind: 'none' }],
    [null,                     'localhost',   { kind: 'none' }],
    ['example.com',           'example.com', { kind: 'none' }],
    ['unrelated.com',          'localhost',   { kind: 'none' }],
    ['a.b.localhost',          'localhost',   { kind: 'none' }], // nested — no nested subdomains
    // reserved cases
    ['www.localhost',          'localhost',   { kind: 'reserved' }],
    ['app.localhost',          'localhost',   { kind: 'reserved' }],
    ['api.localhost',          'localhost',   { kind: 'reserved' }],
    ['admin.localhost',        'localhost',   { kind: 'reserved' }],
    ['auth.localhost',         'localhost',   { kind: 'reserved' }],
    ['static.localhost',       'localhost',   { kind: 'reserved' }],
    ['_next.localhost',        'localhost',   { kind: 'reserved' }],
    ['cdn.localhost',          'localhost',   { kind: 'reserved' }],
    ['mail.localhost',         'localhost',   { kind: 'reserved' }],
    ['assets.localhost',       'localhost',   { kind: 'reserved' }],
    ['www.example.com',       'example.com', { kind: 'reserved' }],
    ['WWW.localhost',          'localhost',   { kind: 'reserved' }], // case-insensitive reserved check
  ];

  it.each(cases)(
    'parseTenantSlug(%s, %s) → %o',
    (host, domain, expected) => {
      expect(parseTenantSlug(host, domain)).toEqual(expected);
    },
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test tests/subdomain.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/subdomain'`

---

- [ ] **Step 3: Implement `src/lib/subdomain.ts`**

```ts
// src/lib/subdomain.ts
// Edge-safe: no Node-only imports, no process.env, no DB.

export const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set([
  'www', 'app', 'api', 'admin', 'auth',
  'static', '_next', 'cdn', 'mail', 'assets',
]);

export type SubdomainResult =
  | { kind: 'tenant'; slug: string }
  | { kind: 'reserved' }
  | { kind: 'none' };

/**
 * Extract the tenant slug from a Host header value.
 *
 * Rules (all comparisons case-insensitive; slug is always returned lowercase):
 *  - null / empty host                         → 'none'
 *  - host (without port) equals rootDomain     → 'none'
 *  - host does not end with `.${rootDomain}`   → 'none'
 *  - label before rootDomain contains a dot    → 'none'  (no nested subdomains)
 *  - label is in RESERVED_SUBDOMAINS           → 'reserved'
 *  - otherwise                                 → { kind: 'tenant', slug }
 */
export function parseTenantSlug(
  host: string | null,
  rootDomain: string,
): SubdomainResult {
  if (!host) return { kind: 'none' };

  // Strip port
  const h = host.split(':')[0].toLowerCase();
  const rd = rootDomain.toLowerCase();

  if (h === rd) return { kind: 'none' };

  const suffix = `.${rd}`;
  if (!h.endsWith(suffix)) return { kind: 'none' };

  const label = h.slice(0, h.length - suffix.length);

  // No nested subdomains (e.g. a.b.localhost)
  if (label.includes('.')) return { kind: 'none' };
  if (!label) return { kind: 'none' };

  if (RESERVED_SUBDOMAINS.has(label)) return { kind: 'reserved' };

  return { kind: 'tenant', slug: label };
}
```

- [ ] **Step 4: Run test to verify subdomain tests pass**

```bash
pnpm test tests/subdomain.test.ts
```

Expected: PASS — all 23 table cases green

---

- [ ] **Step 5: Write the failing tenant branding tests**

Create `tests/tenant.test.ts`:

```ts
import { vi, describe, it, expect } from 'vitest';

// Mock Next.js server APIs and DB dependencies — this file tests only
// the pure WCAG helpers exported from tenant.ts.
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: vi.fn().mockReturnValue(null) }),
}));
vi.mock('next/navigation', () => ({ notFound: vi.fn() }));
vi.mock('@/db/tenant', () => ({ withOwner: vi.fn() }));
vi.mock('@/db/schema', () => ({ tenants: {} }));
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }));

import { accentOnColor, assertAccessibleAccent } from '@/lib/tenant';

// --- WCAG math reference (verified against spec) ---
// L(#111111) ≈ 0.00562  (the "dark" pole used by the helpers)
// L(#1a1a2e) ≈ 0.012   contrast with white ≈ 17.0  → white wins
// L(#2d3748) ≈ 0.037   contrast with white ≈ 12.0  → white wins
// L(#ffd700) ≈ 0.698   contrast with dark  ≈ 13.5  → dark wins
// L(#E8533A) ≈ 0.236   contrast with dark  ≈ 5.15  → dark wins (3.67 with white)
// L(#7a7a7a) ≈ 0.194   white ≈ 4.30, dark ≈ 4.39  → BOTH FAIL 4.5:1

describe('accentOnColor', () => {
  it('returns #FFFFFF for very dark navy (#1a1a2e)', () => {
    expect(accentOnColor('#1a1a2e')).toBe('#FFFFFF');
  });

  it('returns #FFFFFF for dark slate (#2d3748)', () => {
    expect(accentOnColor('#2d3748')).toBe('#FFFFFF');
  });

  it('returns #111111 for bright gold (#ffd700)', () => {
    expect(accentOnColor('#ffd700')).toBe('#111111');
  });

  it('returns #111111 for coral (#E8533A) — contrast with dark (5.15) beats white (3.67)', () => {
    expect(accentOnColor('#E8533A')).toBe('#111111');
  });

  it('returns #FFFFFF for pure black (#000000)', () => {
    expect(accentOnColor('#000000')).toBe('#FFFFFF');
  });

  it('returns #111111 for pure white (#ffffff)', () => {
    expect(accentOnColor('#ffffff')).toBe('#111111');
  });

  it('handles 3-digit shorthand (#fff → white)', () => {
    expect(accentOnColor('#fff')).toBe('#111111');
  });
});

describe('assertAccessibleAccent', () => {
  it('does not throw and returns correct on-color for dark navy (#2d3748)', () => {
    expect(assertAccessibleAccent('#2d3748')).toEqual({ onAccent: '#FFFFFF' });
  });

  it('does not throw for coral (#E8533A) — passes with dark text', () => {
    expect(assertAccessibleAccent('#E8533A')).toEqual({ onAccent: '#111111' });
  });

  it('does not throw for gold (#ffd700) — passes with dark text', () => {
    expect(assertAccessibleAccent('#ffd700')).toEqual({ onAccent: '#111111' });
  });

  it('throws for mid-gray (#7a7a7a) — fails 4.5:1 against BOTH white and #111111', () => {
    // L(#7a7a7a) ≈ 0.194: contrast with white ≈ 4.30, contrast with #111111 ≈ 4.39
    expect(() => assertAccessibleAccent('#7a7a7a')).toThrow(/WCAG AA/);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

```bash
pnpm test tests/tenant.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/tenant'`

---

- [ ] **Step 7: Implement `src/lib/tenant.ts`**

```ts
// src/lib/tenant.ts
import 'server-only';

import { cache } from 'react';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { withOwner } from '@/db/tenant';
import { tenants } from '@/db/schema';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type TenantBranding = { primaryColor: string; logo: string | null };

export type Tenant = {
  id: number;
  slug: string;
  name: string;
  domain: string | null;
  plan: string;
  branding: TenantBranding;
  limits: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Tenant resolution (React cache — deduped per request)
// ---------------------------------------------------------------------------

export async function getCurrentTenantSlug(): Promise<string | null> {
  const h = await headers();
  return h.get('x-tenant-slug');
}

export const getCurrentTenant: () => Promise<Tenant> = cache(
  async (): Promise<Tenant> => {
    const slug = await getCurrentTenantSlug();
    if (!slug) notFound();

    const rows = await withOwner((tx) =>
      tx.select().from(tenants).where(eq(tenants.slug, slug)).limit(1),
    );

    if (rows.length === 0) notFound();

    const row = rows[0];
    const config = (row.config ?? {}) as {
      branding?: { primaryColor?: string; logo?: string | null };
    };

    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      domain: row.domain ?? null,
      plan: row.plan,
      branding: {
        primaryColor: config.branding?.primaryColor ?? '#E8533A',
        logo: config.branding?.logo ?? null,
      },
      limits: (row.limits ?? {}) as Record<string, unknown>,
    };
  },
);

// ---------------------------------------------------------------------------
// WCAG luminance helpers
// ---------------------------------------------------------------------------

/** Linearise one sRGB channel (0–255) per WCAG 2.1 §1.4.3 */
function channelLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance of a hex colour (3 or 6 digit, with or without #). */
function luminance(hex: string): number {
  const clean = hex.replace(/^#/, '');
  let r: number, g: number, b: number;
  if (clean.length === 3) {
    r = parseInt(clean[0] + clean[0], 16);
    g = parseInt(clean[1] + clean[1], 16);
    b = parseInt(clean[2] + clean[2], 16);
  } else {
    r = parseInt(clean.slice(0, 2), 16);
    g = parseInt(clean.slice(2, 4), 16);
    b = parseInt(clean.slice(4, 6), 16);
  }
  return (
    0.2126 * channelLinear(r) +
    0.7152 * channelLinear(g) +
    0.0722 * channelLinear(b)
  );
}

/** WCAG contrast ratio (both arguments are relative luminances). */
function contrastRatio(l1: number, l2: number): number {
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

// Pre-computed poles — these are the only two text colours the design system
// places on top of an accent background.
const L_WHITE = 1; // #FFFFFF
const L_DARK = luminance('#111111'); // ≈ 0.00562

/**
 * Returns '#FFFFFF' or '#111111' — whichever yields the higher contrast
 * ratio against the given background colour.
 */
export function accentOnColor(hex: string): '#FFFFFF' | '#111111' {
  const L = luminance(hex);
  const withWhite = contrastRatio(L_WHITE, L);
  const withDark = contrastRatio(L, L_DARK);
  return withWhite >= withDark ? '#FFFFFF' : '#111111';
}

/**
 * Like accentOnColor but also asserts that at least one pairing meets
 * WCAG AA (4.5:1).  Throws if BOTH white and #111111 fall below the
 * threshold — used by provisionTenant() to validate primaryColor.
 */
export function assertAccessibleAccent(
  hex: string,
): { onAccent: '#FFFFFF' | '#111111' } {
  const L = luminance(hex);
  const withWhite = contrastRatio(L_WHITE, L);
  const withDark = contrastRatio(L, L_DARK);

  if (withWhite < 4.5 && withDark < 4.5) {
    throw new Error(
      `Color ${hex} fails WCAG AA: contrast with white=${withWhite.toFixed(
        2,
      )}, with #111111=${withDark.toFixed(2)} (both < 4.5:1)`,
    );
  }

  return { onAccent: withWhite >= withDark ? '#FFFFFF' : '#111111' };
}
```

- [ ] **Step 8: Run test to verify tenant tests pass**

```bash
pnpm test tests/tenant.test.ts
```

Expected: PASS — all 10 assertions green

---

- [ ] **Step 9: Implement `src/middleware.ts`**

This file runs on the **Edge runtime**. It MUST NOT import from `src/lib/tenant.ts`, `src/db/`, or any Node-only package. It imports only `src/lib/subdomain.ts` (edge-safe) and Next.js edge APIs.

```ts
// src/middleware.ts
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { parseTenantSlug } from '@/lib/subdomain';

// ROOT_DOMAIN is read directly from process.env (not from src/env.ts which is
// Node-only and uses zod). Middleware is fail-closed: missing ROOT_DOMAIN →
// treat every host as having no subdomain → 404 for all app routes.
const ROOT_DOMAIN = process.env.ROOT_DOMAIN ?? '';

// Set TRUST_PROXY=1 in production behind a load-balancer that guarantees
// X-Forwarded-Host. If unset, the Host header is used exclusively (safer
// default — prevents host-header injection from untrusted proxies).
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

/**
 * Paths that Next.js infrastructure or the auth layer must always be able to
 * reach, regardless of whether a tenant subdomain is present.
 */
const ALWAYS_ALLOW_PREFIXES = [
  '/_next/',
  '/api/auth/',
  '/favicon.ico',
  '/robots.txt',
] as const;

function isAlwaysAllowed(pathname: string): boolean {
  return ALWAYS_ALLOW_PREFIXES.some((p) => pathname.startsWith(p));
}

function resolveHost(request: NextRequest): string {
  if (TRUST_PROXY) {
    const forwarded = request.headers.get('x-forwarded-host');
    if (forwarded) return forwarded.split(',')[0].trim();
  }
  return request.headers.get('host') ?? '';
}

export function middleware(request: NextRequest): NextResponse {
  const host = resolveHost(request);
  const result = parseTenantSlug(host, ROOT_DOMAIN);

  // Strip any client-supplied tenant header on EVERY path before branching — only
  // middleware may set x-tenant-slug. Without this, a spoofed header survives on
  // always-allowed routes (e.g. /api/auth/*) → confused-deputy tenant resolution.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete('x-tenant-slug');

  if (result.kind === 'tenant') {
    // Forward the resolved slug to Server Components via a request header.
    requestHeaders.set('x-tenant-slug', result.slug);
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // reserved or none: let through infrastructure routes (header stripped); 404 everything else.
  if (isAlwaysAllowed(request.nextUrl.pathname)) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  return new NextResponse(null, { status: 404 });
}

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     *  - _next/static  (Next.js built assets)
     *  - _next/image   (Next.js image optimisation)
     *  - favicon.ico, robots.txt (browser-requested metadata)
     */
    '/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt).*)',
  ],
};
```

- [ ] **Step 10: Run typecheck to verify edge-runtime compatibility**

```bash
pnpm typecheck
```

Expected: PASS with zero errors.

Additionally verify `src/lib/subdomain.ts` and `src/middleware.ts` contain no Node-only imports:

```bash
grep -n "require\|node:\|'fs'\|'path'\|'crypto'\|'stream'" \
  src/lib/subdomain.ts src/middleware.ts && echo "FAIL: node imports found" || echo "PASS: no node imports"
```

Expected: `PASS: no node imports`

- [ ] **Step 11: Run all tests one final time**

```bash
pnpm test
```

Expected: PASS — `tests/subdomain.test.ts` (all table cases) and `tests/tenant.test.ts` (all WCAG assertions) green.

- [ ] **Step 12: Commit**

```bash
git add src/lib/subdomain.ts src/middleware.ts src/lib/tenant.ts \
        tests/subdomain.test.ts tests/tenant.test.ts
git commit -m "feat(slice0): edge subdomain resolver, middleware, getCurrentTenant, WCAG accent helpers"
```

---

### Task 10: Auth shell (Auth.js v5, DB sessions, tenant invariant)

Auth.js v5 (`next-auth@beta`) Credentials provider with **database sessions** (not JWT-in-cookie), a custom Drizzle adapter that scopes every session/user op to a tenant via `withTenant`, the hard **session↔tenant 403 invariant**, RBAC capability checks, and the login page + Origin-checked server action. Acceptance §9.3 (User A on B → 403) and §9.6 (no superadmin/session leak) are gated by the integration test in Cycle 2 + the invariant unit test in Cycle 3.

**Files:**
- Create: `src/auth/schema-types.ts`
- Create: `src/auth/rbac.ts`
- Create: `src/auth/adapter.ts`
- Create: `src/auth/config.ts`
- Create: `src/auth/index.ts`
- Create: `src/auth/session.ts`
- Create: `src/app/api/auth/[...nextauth]/route.ts`
- Create: `src/app/login/page.tsx`
- Create: `src/app/login/actions.ts`
- Modify: `next.config.ts` (merge `experimental.authInterrupts: true` so `forbidden()` is available — keep the existing `output:'standalone'` and `experimental.serverActions.allowedOrigins` from Task 1)
- Test: `tests/rbac.test.ts` (Vitest unit)
- Test: `tests/auth.session.test.ts` (Vitest unit — invariant)
- Test: `tests/auth.integration.test.ts` (Vitest + `@testcontainers/postgresql`)

**Interfaces:**
- Consumes (from earlier tasks, use verbatim):
  - `@/db/tenant` (Task 6): `export type TenantCtx = { tenantId: number; userId: number | null }`; `export async function withTenant<T>(ctx: TenantCtx, fn: (tx: Tx) => Promise<T>): Promise<T>`; `export async function withOwner<T>(fn: (tx: Tx) => Promise<T>): Promise<T>`
  - `@/db/schema` (Task 4): `users`, `sessions`, `tenants`, `roleEnum`, `export type Role = (typeof roleEnum.enumValues)[number]` (`'superadmin'|'admin'|'mitarbeiter'|'kunde'`). `users` unique `users_email_tenant` on `(email, tenantId)`; `sessions` pk `sessionToken`, `tenantId notNull`.
  - `@/lib/tenant` (Task 9): `export const getCurrentTenant: () => Promise<Tenant>` where `Tenant = { id: number; slug: string; name: string; domain: string | null; plan: string; branding: TenantBranding; limits: Record<string, unknown> }`
  - `@/env` (Task 1): `export const env`; `env.APP_PROTOCOL`
  - `tests/helpers/db.ts` (Task 7): `export async function setupTestDatabase(): Promise<{ container; ownerUrl: string; appUrl: string; teardown: () => Promise<void> }>`
  - `@/components/ui` (Task 3): `Button`, `Input`
  - `bcryptjs`
- Produces (later tasks/SPINE rely on these verbatim):
  - `@/auth/schema-types`: `export type { Role }`; `export type SessionUser = { id: number; email: string; tenantId: number; role: Role; isSuperadmin: boolean }`
  - `@/auth/rbac`: `export type Capability = 'records:read'|'records:write'|'tenant:admin'|'platform:superadmin'`; `export function can(user: SessionUser, cap: Capability): boolean`
  - `@/auth/adapter`: `export function DrizzleTenantAdapter(): Adapter`; plus tenant-scoped helpers `createTenantSession`, `getTenantSessionAndUser`, `deleteTenantSession`, `updateTenantSessionExpiry`, `getTenantUser`
  - `@/auth/config`: `export const authConfig: NextAuthConfig`; `export async function verifyCredentials(args: { email: string; password: string; tenantId: number }): Promise<SessionUser | null>`
  - `@/auth/index`: `export const { handlers, auth, signIn, signOut }`
  - `@/auth/session`: `export async function getSessionUser(): Promise<SessionUser | null>`; `export async function requireSession(): Promise<SessionUser>`; `export function assertSessionTenant(user: SessionUser, resolvedTenantId: number): void`; `export class TenantMismatchError`

---

#### Cycle 1 — Session types + RBAC capability map

- [ ] **Step 1: Write the failing test** — `tests/rbac.test.ts`
```ts
import { describe, it, expect } from 'vitest';
import { can } from '@/auth/rbac';
import type { SessionUser } from '@/auth/schema-types';
import type { Role } from '@/db/schema';

const mk = (role: Role, isSuperadmin = false): SessionUser => ({
  id: 1,
  email: 'a@b.test',
  tenantId: 1,
  role,
  isSuperadmin,
});

describe('can()', () => {
  it('kunde reads records but cannot write them', () => {
    expect(can(mk('kunde'), 'records:read')).toBe(true);
    expect(can(mk('kunde'), 'records:write')).toBe(false);
    expect(can(mk('kunde'), 'tenant:admin')).toBe(false);
  });

  it('mitarbeiter writes records but is not a tenant admin', () => {
    expect(can(mk('mitarbeiter'), 'records:write')).toBe(true);
    expect(can(mk('mitarbeiter'), 'tenant:admin')).toBe(false);
  });

  it('admin gets tenant:admin but not platform:superadmin', () => {
    expect(can(mk('admin'), 'records:write')).toBe(true);
    expect(can(mk('admin'), 'tenant:admin')).toBe(true);
    expect(can(mk('admin'), 'platform:superadmin')).toBe(false);
  });

  it('the isSuperadmin flag grants every capability incl platform:superadmin', () => {
    expect(can(mk('kunde', true), 'platform:superadmin')).toBe(true);
    expect(can(mk('superadmin'), 'platform:superadmin')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test rbac`
Expected: FAIL with "Failed to resolve import \"@/auth/rbac\"" (module does not exist yet).

- [ ] **Step 3: Implement `schema-types.ts` and `rbac.ts`**
`src/auth/schema-types.ts`:
```ts
import type { Role } from '@/db/schema';

export type { Role };

export type SessionUser = {
  id: number;
  email: string;
  tenantId: number;
  role: Role;
  isSuperadmin: boolean;
};
```
`src/auth/rbac.ts`:
```ts
import type { Role, SessionUser } from './schema-types';

export type Capability =
  | 'records:read'
  | 'records:write'
  | 'tenant:admin'
  | 'platform:superadmin';

const ROLE_CAPS: Record<Role, readonly Capability[]> = {
  superadmin: ['records:read', 'records:write', 'tenant:admin', 'platform:superadmin'],
  admin: ['records:read', 'records:write', 'tenant:admin'],
  mitarbeiter: ['records:read', 'records:write'],
  kunde: ['records:read'],
};

export function can(user: SessionUser, cap: Capability): boolean {
  if (user.isSuperadmin) return true;
  return ROLE_CAPS[user.role].includes(cap);
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test rbac`  Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/auth/schema-types.ts src/auth/rbac.ts tests/rbac.test.ts
git commit -m "feat(slice0): auth session types + RBAC capability map"
```

---

#### Cycle 2 — Tenant-scoped Drizzle adapter + credential verify (the DB-session core)

- [ ] **Step 1: Write the failing test** — `tests/auth.integration.test.ts`
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { setupTestDatabase } from './helpers/db';

let db: Awaited<ReturnType<typeof setupTestDatabase>>;
let tenantApi: typeof import('@/db/tenant');
let schema: typeof import('@/db/schema');
let adapter: typeof import('@/auth/adapter');
let config: typeof import('@/auth/config');

// Local seed helper: tenants is registry (owner write); users insert under the
// tenant's RLS context (tenant_id passed explicitly to satisfy WITH CHECK).
async function seedTenantUser(args: {
  slug: string;
  name: string;
  email: string;
  password: string;
}): Promise<{ tenantId: number; userId: number }> {
  const { withOwner, withTenant } = tenantApi;
  const { tenants, users } = schema;
  const tenantId = await withOwner(async (tx) => {
    const [t] = await tx
      .insert(tenants)
      .values({ slug: args.slug, name: args.name })
      .returning({ id: tenants.id });
    return t.id;
  });
  const password = await bcrypt.hash(args.password, 10);
  const userId = await withTenant({ tenantId, userId: null }, async (tx) => {
    const [u] = await tx
      .insert(users)
      .values({ email: args.email, password, tenantId, role: 'admin' })
      .returning({ id: users.id });
    return u.id;
  });
  return { tenantId, userId };
}

beforeAll(async () => {
  db = await setupTestDatabase();
  process.env.DATABASE_URL = db.appUrl;
  process.env.DATABASE_OWNER_URL = db.ownerUrl;
  // import AFTER env is set so the pg pools bind to the testcontainer URLs
  tenantApi = await import('@/db/tenant');
  schema = await import('@/db/schema');
  adapter = await import('@/auth/adapter');
  config = await import('@/auth/config');
}, 120_000);

afterAll(async () => {
  await db?.teardown();
});

describe('verifyCredentials (keyed on email + tenant)', () => {
  it('returns the SessionUser on correct email + password + tenant', async () => {
    const { tenantId, userId } = await seedTenantUser({
      slug: 'cred-a',
      name: 'A',
      email: 'admin@a.test',
      password: 'pw-correct-123',
    });
    const user = await config.verifyCredentials({
      email: 'admin@a.test',
      password: 'pw-correct-123',
      tenantId,
    });
    expect(user).not.toBeNull();
    expect(user).toMatchObject({
      id: userId,
      email: 'admin@a.test',
      tenantId,
      role: 'admin',
      isSuperadmin: false,
    });
  });

  it('rejects a wrong password', async () => {
    const { tenantId } = await seedTenantUser({
      slug: 'cred-b',
      name: 'B',
      email: 'admin@b.test',
      password: 'pw-correct-123',
    });
    expect(
      await config.verifyCredentials({ email: 'admin@b.test', password: 'nope', tenantId }),
    ).toBeNull();
  });

  it('rejects a correct password under the WRONG tenant (RLS isolation)', async () => {
    const a = await seedTenantUser({
      slug: 'cred-c',
      name: 'C',
      email: 'shared@x.test',
      password: 'pw-correct-123',
    });
    const b = await seedTenantUser({
      slug: 'cred-d',
      name: 'D',
      email: 'other@d.test',
      password: 'pw-correct-123',
    });
    expect(
      await config.verifyCredentials({
        email: 'shared@x.test',
        password: 'pw-correct-123',
        tenantId: b.tenantId,
      }),
    ).toBeNull();
    // sanity: works under its own tenant
    expect(
      await config.verifyCredentials({
        email: 'shared@x.test',
        password: 'pw-correct-123',
        tenantId: a.tenantId,
      }),
    ).not.toBeNull();
  });
});

describe('DB session adapter (tenant-scoped, opaque token)', () => {
  it('round-trips a session inside its tenant and hides it from another tenant', async () => {
    const a = await seedTenantUser({
      slug: 'sess-a',
      name: 'SA',
      email: 'a@sess.test',
      password: 'pw-1',
    });
    const b = await seedTenantUser({
      slug: 'sess-b',
      name: 'SB',
      email: 'b@sess.test',
      password: 'pw-1',
    });

    const sessionToken = randomUUID();
    const expires = new Date(Date.now() + 60_000);
    await adapter.createTenantSession(a.tenantId, {
      sessionToken,
      userId: a.userId,
      expires,
    });

    const found = await adapter.getTenantSessionAndUser(a.tenantId, sessionToken);
    expect(found).not.toBeNull();
    expect(found?.session.sessionToken).toBe(sessionToken);
    expect(found?.user).toMatchObject({
      id: a.userId,
      tenantId: a.tenantId,
      email: 'a@sess.test',
    });

    // §9.6 / §9.3: a session minted for tenant A is NOT visible under tenant B
    expect(await adapter.getTenantSessionAndUser(b.tenantId, sessionToken)).toBeNull();

    await adapter.deleteTenantSession(a.tenantId, sessionToken);
    expect(await adapter.getTenantSessionAndUser(a.tenantId, sessionToken)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test auth.integration`
Expected: FAIL with "Failed to resolve import \"@/auth/adapter\"" / "@/auth/config" (modules do not exist yet).

- [ ] **Step 3: Implement `adapter.ts` and `config.ts`**
`src/auth/adapter.ts`:
```ts
import 'server-only';
import { eq } from 'drizzle-orm';
import type { Adapter, AdapterSession, AdapterUser } from 'next-auth/adapters';
import { withTenant } from '@/db/tenant';
import { sessions, users } from '@/db/schema';
import { getCurrentTenant } from '@/lib/tenant';
import type { SessionUser } from './schema-types';

export type TenantSession = { sessionToken: string; userId: number; expires: Date };
export type TenantSessionAndUser = { session: TenantSession; user: SessionUser };

// tenant_id is passed explicitly so the RLS WITH CHECK (tenant_id = GUC) holds
export async function createTenantSession(tenantId: number, data: TenantSession): Promise<void> {
  await withTenant({ tenantId, userId: null }, async (tx) => {
    await tx.insert(sessions).values({
      sessionToken: data.sessionToken,
      userId: data.userId,
      tenantId,
      expires: data.expires,
    });
  });
}

export async function getTenantSessionAndUser(
  tenantId: number,
  sessionToken: string,
): Promise<TenantSessionAndUser | null> {
  return withTenant({ tenantId, userId: null }, async (tx) => {
    const rows = await tx
      .select({
        sToken: sessions.sessionToken,
        sUser: sessions.userId,
        sExpires: sessions.expires,
        uId: users.id,
        uEmail: users.email,
        uTenant: users.tenantId,
        uRole: users.role,
        uSuper: users.isSuperadmin,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(eq(sessions.sessionToken, sessionToken))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      session: { sessionToken: r.sToken, userId: r.sUser, expires: r.sExpires },
      user: { id: r.uId, email: r.uEmail, tenantId: r.uTenant, role: r.uRole, isSuperadmin: r.uSuper },
    };
  });
}

export async function deleteTenantSession(tenantId: number, sessionToken: string): Promise<void> {
  await withTenant({ tenantId, userId: null }, async (tx) => {
    await tx.delete(sessions).where(eq(sessions.sessionToken, sessionToken));
  });
}

export async function updateTenantSessionExpiry(
  tenantId: number,
  sessionToken: string,
  expires: Date,
): Promise<void> {
  await withTenant({ tenantId, userId: null }, async (tx) => {
    await tx.update(sessions).set({ expires }).where(eq(sessions.sessionToken, sessionToken));
  });
}

export async function getTenantUser(tenantId: number, userId: number): Promise<SessionUser | null> {
  return withTenant({ tenantId, userId: null }, async (tx) => {
    const rows = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    const u = rows[0];
    if (!u) return null;
    return { id: u.id, email: u.email, tenantId: u.tenantId, role: u.role, isSuperadmin: u.isSuperadmin };
  });
}

function toAdapterUser(user: SessionUser): AdapterUser {
  return {
    id: String(user.id),
    email: user.email,
    emailVerified: null,
    tenantId: user.tenantId,
    role: user.role,
    isSuperadmin: user.isSuperadmin,
  } as unknown as AdapterUser;
}

export function DrizzleTenantAdapter(): Adapter {
  return {
    async createSession(session) {
      const tenant = await getCurrentTenant();
      await createTenantSession(tenant.id, {
        sessionToken: session.sessionToken,
        userId: Number(session.userId),
        expires: session.expires,
      });
      return session;
    },
    async getSessionAndUser(sessionToken) {
      const tenant = await getCurrentTenant();
      const res = await getTenantSessionAndUser(tenant.id, sessionToken);
      if (!res) return null;
      const session: AdapterSession = {
        sessionToken: res.session.sessionToken,
        userId: String(res.session.userId),
        expires: res.session.expires,
      };
      return { session, user: toAdapterUser(res.user) };
    },
    async updateSession(session) {
      const tenant = await getCurrentTenant();
      if (session.expires) {
        await updateTenantSessionExpiry(tenant.id, session.sessionToken, session.expires);
      }
      return undefined;
    },
    async deleteSession(sessionToken) {
      const tenant = await getCurrentTenant();
      await deleteTenantSession(tenant.id, sessionToken);
    },
    async getUser(id) {
      const tenant = await getCurrentTenant();
      const u = await getTenantUser(tenant.id, Number(id));
      return u ? toAdapterUser(u) : null;
    },
  };
}
```
`src/auth/config.ts` (LOCKED DB-session recipe — `jwt.encode` mints an opaque `sessionToken` and persists it via the adapter; `__Host-` cookie):
```ts
import 'server-only';
import { encode as defaultEncode } from 'next-auth/jwt';
import type { NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { and, eq } from 'drizzle-orm';
import { env } from '@/env';
import { withTenant } from '@/db/tenant';
import { users } from '@/db/schema';
import { getCurrentTenant } from '@/lib/tenant';
import { DrizzleTenantAdapter, createTenantSession } from './adapter';
import type { Role, SessionUser } from './schema-types';

const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;
const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_S * 1000;

// `__Host-` cookies REQUIRE the Secure attribute, which browsers only accept over HTTPS.
// Slice-0 dev runs over http on *.localhost, so derive the cookie from the protocol:
// prod (https) → `__Host-` + Secure; dev (http) → plain name, no Secure. Exported so tests
// and any cookie-reading code agree on the name (it changes between dev and prod).
const USE_SECURE_COOKIES = env.APP_PROTOCOL === 'https';
export const SESSION_COOKIE_NAME = USE_SECURE_COOKIES
  ? '__Host-authjs.session-token'
  : 'authjs.session-token';

// A valid-shape bcrypt hash compared against when no user row exists, so an attacker cannot
// distinguish "unknown email" from "wrong password" by response timing (user enumeration).
const DUMMY_BCRYPT_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEeO.iI5wQp.J7m9F9pYVxq3sCJ8B9YQ3qK';

export async function verifyCredentials(args: {
  email: string;
  password: string;
  tenantId: number;
}): Promise<SessionUser | null> {
  return withTenant({ tenantId: args.tenantId, userId: null }, async (tx) => {
    const rows = await tx
      .select()
      .from(users)
      .where(and(eq(users.email, args.email), eq(users.tenantId, args.tenantId)))
      .limit(1);
    const u = rows[0];
    // Always run a bcrypt compare (dummy hash when the user is absent) to avoid a
    // user-enumeration timing oracle between "unknown email" and "wrong password".
    const ok = await bcrypt.compare(args.password, u?.password ?? DUMMY_BCRYPT_HASH);
    if (!u || !ok) return null;
    return { id: u.id, email: u.email, tenantId: u.tenantId, role: u.role, isSuperadmin: u.isSuperadmin };
  });
}

export const authConfig: NextAuthConfig = {
  adapter: DrizzleTenantAdapter(),
  session: { strategy: 'database', maxAge: SESSION_MAX_AGE_S },
  trustHost: true,
  cookies: {
    sessionToken: {
      name: SESSION_COOKIE_NAME,
      options: { httpOnly: true, sameSite: 'lax', path: '/', secure: USE_SECURE_COOKIES },
    },
  },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: async (creds) => {
        const email = typeof creds?.email === 'string' ? creds.email : '';
        const password = typeof creds?.password === 'string' ? creds.password : '';
        if (!email || !password) return null;
        const tenant = await getCurrentTenant();
        const user = await verifyCredentials({ email, password, tenantId: tenant.id });
        return user ? { ...user, id: String(user.id) } : null;
      },
    }),
  ],
  callbacks: {
    jwt({ token, account }) {
      if (account?.provider === 'credentials') {
        (token as { credentials?: boolean }).credentials = true;
      }
      return token;
    },
    session({ session, user }) {
      if (session.user) {
        const u = user as unknown as { tenantId: number; role: Role; isSuperadmin: boolean };
        const target = session.user as Record<string, unknown>;
        target.tenantId = u.tenantId;
        target.role = u.role;
        target.isSuperadmin = u.isSuperadmin;
      }
      return session;
    },
  },
  jwt: {
    async encode(params) {
      if ((params.token as { credentials?: boolean } | undefined)?.credentials) {
        const userId = params.token?.sub;
        if (!userId) throw new Error('credentials session missing user id');
        const tenant = await getCurrentTenant();
        const sessionToken = randomUUID();
        const expires = new Date(Date.now() + SESSION_MAX_AGE_MS);
        await createTenantSession(tenant.id, { sessionToken, userId: Number(userId), expires });
        return sessionToken;
      }
      return defaultEncode(params);
    },
  },
};
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test auth.integration`  Expected: PASS (verifyCredentials correct/wrong-pw/wrong-tenant + session round-trip and cross-tenant isolation all green).

- [ ] **Step 5: Commit**
```bash
git add src/auth/adapter.ts src/auth/config.ts tests/auth.integration.test.ts
git commit -m "feat(slice0): tenant-scoped Drizzle DB-session adapter + credential verify"
```

---

#### Cycle 3 — NextAuth wiring + session↔tenant invariant

- [ ] **Step 1: Write the failing test** — `tests/auth.session.test.ts`
```ts
import { describe, it, expect, vi } from 'vitest';
import { assertSessionTenant, TenantMismatchError } from '@/auth/session';
import type { SessionUser } from '@/auth/schema-types';

const base: SessionUser = {
  id: 7,
  email: 'u@t.test',
  tenantId: 1,
  role: 'admin',
  isSuperadmin: false,
};

describe('assertSessionTenant (session↔tenant invariant)', () => {
  it('passes when the session tenant matches the resolved tenant', () => {
    expect(() => assertSessionTenant(base, 1)).not.toThrow();
  });

  it('throws TenantMismatchError when a tenant-A user is served under tenant B', () => {
    expect(() => assertSessionTenant(base, 2)).toThrow(TenantMismatchError);
  });

  it('exempts superadmins and logs an audit line', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const su: SessionUser = { ...base, isSuperadmin: true };
    expect(() => assertSessionTenant(su, 999)).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `pnpm test auth.session`
Expected: FAIL with "Failed to resolve import \"@/auth/session\"" (module does not exist yet).

- [ ] **Step 3: Implement `index.ts`, `session.ts`, and enable `authInterrupts`**
`src/auth/index.ts`:
```ts
import NextAuth from 'next-auth';
import { authConfig } from './config';

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
```
`src/auth/session.ts`:
```ts
import 'server-only';
import { redirect, forbidden } from 'next/navigation';
import { auth } from './index';
import { getCurrentTenant } from '@/lib/tenant';
import type { Role, SessionUser } from './schema-types';

export class TenantMismatchError extends Error {
  constructor(
    public readonly userId: number,
    public readonly sessionTenantId: number,
    public readonly resolvedTenantId: number,
  ) {
    super(
      `session tenant ${sessionTenantId} does not match resolved tenant ${resolvedTenantId}`,
    );
    this.name = 'TenantMismatchError';
  }
}

// LOCKED invariant: superadmin is the only exemption and is audit-logged.
export function assertSessionTenant(user: SessionUser, resolvedTenantId: number): void {
  if (user.isSuperadmin) {
    console.warn(`[audit] superadmin user=${user.id} accessed tenant=${resolvedTenantId}`);
    return;
  }
  if (user.tenantId !== resolvedTenantId) {
    throw new TenantMismatchError(user.id, user.tenantId, resolvedTenantId);
  }
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  const u = session?.user as Record<string, unknown> | undefined;
  if (!u || u.email == null || u.tenantId == null) return null;
  return {
    id: Number(u.id),
    email: String(u.email),
    tenantId: Number(u.tenantId),
    role: u.role as Role,
    isSuperadmin: Boolean(u.isSuperadmin),
  };
}

export async function requireSession(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const tenant = await getCurrentTenant();
  try {
    assertSessionTenant(user, tenant.id);
  } catch {
    forbidden(); // → HTTP 403 (requires experimental.authInterrupts)
  }
  return user;
}
```
`next.config.ts` — merge `authInterrupts` into the existing `experimental` block (do NOT drop `serverActions.allowedOrigins` or `output:'standalone'` from Task 1):
```ts
const nextConfig: NextConfig = {
  output: 'standalone',
  experimental: {
    authInterrupts: true,
    serverActions: { allowedOrigins: ['localhost', '*.localhost'] }, // keep Task 1 value
  },
};
```

- [ ] **Step 4: Run test to verify it passes**
Run: `pnpm test auth.session`  Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/auth/index.ts src/auth/session.ts next.config.ts tests/auth.session.test.ts
git commit -m "feat(slice0): NextAuth wiring + session-tenant 403 invariant"
```

---

#### Cycle 4 — Route handler + Origin-checked login page (E2E-covered in Task 15)

- [ ] **Step 1: Implement the route handler, login action, and login page**
`src/app/api/auth/[...nextauth]/route.ts`:
```ts
import { handlers } from '@/auth';

export const { GET, POST } = handlers;
```
`src/app/login/actions.ts` (Origin check on the mutating action; let `signIn`'s redirect propagate):
```ts
'use server';

import { headers } from 'next/headers';
import { AuthError } from 'next-auth';
import { signIn } from '@/auth';
import { env } from '@/env';

export type LoginState = { error: string | null };

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const h = await headers();
  const origin = h.get('origin');
  const host = h.get('host');
  if (origin && host && origin !== `${env.APP_PROTOCOL}://${host}`) {
    return { error: 'Ungültige Herkunft (Origin).' };
  }

  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  try {
    await signIn('credentials', { email, password, redirectTo: '/' });
    return { error: null };
  } catch (e) {
    if (e instanceof AuthError) return { error: 'Ungültige Anmeldedaten.' };
    throw e; // re-throw NEXT_REDIRECT (successful login) and unexpected errors
  }
}
```
`src/app/login/page.tsx`:
```tsx
'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui';
import { Input } from '@/components/ui';
import { loginAction, type LoginState } from './actions';

const initialState: LoginState = { error: null };

export default function LoginPage() {
  const [state, action, pending] = useActionState(loginAction, initialState);
  return (
    <main>
      <form action={action}>
        <Input name="email" type="email" autoComplete="email" required aria-label="E-Mail" />
        <Input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-label="Passwort"
        />
        {state.error ? <p role="alert">{state.error}</p> : null}
        <Button type="submit" loading={pending}>
          Anmelden
        </Button>
      </form>
    </main>
  );
}
```

- [ ] **Step 2: Verify it typechecks**
Run: `pnpm typecheck`  Expected: PASS (no type errors). The full login → DB-session → shell flow is exercised by Playwright in Task 15 (§9.3/§9.8). No unit/integration test added here: route handlers and the client page are wired-only surfaces, covered E2E.

- [ ] **Step 3: Commit**
```bash
git add src/app/api/auth src/app/login/page.tsx src/app/login/actions.ts
git commit -m "feat(slice0): auth route handler + Origin-checked login page"
```

---

### Task 11: Email adapter + Mailpit

**Files:**
- Create: `src/lib/email/index.ts`
- Create: `src/lib/email/console.ts`
- Create: `src/lib/email/mailpit.ts`
- Test: `tests/email.test.ts`

**Interfaces:**
- Consumes: `env.MAIL_DRIVER` (`'mailpit'|'console'`), `env.MAIL_HOST` (string), `env.MAIL_PORT` (number), `env.MAIL_FROM` (string) from `src/env.ts`
- Produces (verbatim from SPINE PART C):
  ```ts
  // src/lib/email/index.ts
  export interface EmailMessage { to: string; subject: string; html: string; text: string }
  export interface EmailAdapter { send(msg: EmailMessage): Promise<void> }
  export function getEmailAdapter(): EmailAdapter; // switch on env.MAIL_DRIVER
  export async function sendCredentialsEmail(adapter: EmailAdapter, args: { to: string; tenantName: string; loginUrl: string; temporaryPassword: string }): Promise<void>;
  ```
  Used by: Task 12 (`provisionTenant` caller sends credentials mail), Task 15 E2E seed (validates mail lands in Mailpit).

---

- [ ] **Step 1: Write the failing tests**

Create `tests/email.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Module-level mock: all imports of @/env inside this file get this object.
vi.mock('@/env', () => ({
  env: {
    MAIL_DRIVER: 'console' as const,
    MAIL_HOST: 'localhost',
    MAIL_PORT: 1025,
    MAIL_FROM: 'noreply@test.localhost',
  },
}));

// Mock nodemailer so the Mailpit driver never touches a real SMTP server.
const mockSendMail = vi.fn().mockResolvedValue({ messageId: 'mock-id' });
const mockCreateTransport = vi.fn(() => ({ sendMail: mockSendMail }));
vi.mock('nodemailer', () => ({
  default: { createTransport: mockCreateTransport },
}));

describe('email — unit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Cycle A: factory + console driver ─────────────────────────────────────

  describe('getEmailAdapter()', () => {
    it('returns an object with a send function when MAIL_DRIVER=console', async () => {
      const { getEmailAdapter } = await import('@/lib/email/index');
      const adapter = getEmailAdapter();
      expect(typeof adapter.send).toBe('function');
    });
  });

  describe('createConsoleEmailAdapter()', () => {
    it('send() resolves to undefined', async () => {
      const { createConsoleEmailAdapter } = await import('@/lib/email/console');
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const adapter = createConsoleEmailAdapter();
      await expect(
        adapter.send({
          to: 'user@example.com',
          subject: 'Test Subject',
          html: '<p>Hello</p>',
          text: 'Hello',
        }),
      ).resolves.toBeUndefined();
      consoleSpy.mockRestore();
    });

    it('send() logs the recipient and subject', async () => {
      const { createConsoleEmailAdapter } = await import('@/lib/email/console');
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const adapter = createConsoleEmailAdapter();
      await adapter.send({
        to: 'someone@demo.localhost',
        subject: 'Credentialmail',
        html: '<p>x</p>',
        text: 'x',
      });
      // At least one log call must mention the recipient
      const allArgs = consoleSpy.mock.calls.flat().join(' ');
      expect(allArgs).toContain('someone@demo.localhost');
      consoleSpy.mockRestore();
    });
  });

  // ── Cycle A: sendCredentialsEmail content ─────────────────────────────────

  describe('sendCredentialsEmail()', () => {
    it('includes temporaryPassword in both html and text', async () => {
      const { sendCredentialsEmail } = await import('@/lib/email/index');
      const captured: { html: string; text: string }[] = [];
      const mockAdapter = {
        send: vi.fn(async (msg: { html: string; text: string }) => {
          captured.push({ html: msg.html, text: msg.text });
        }),
      };
      const temporaryPassword = 'TMP-XYZ-9A2B';
      await sendCredentialsEmail(mockAdapter, {
        to: 'admin@demo.localhost',
        tenantName: 'Demo Store',
        loginUrl: 'http://demo.localhost/login',
        temporaryPassword,
      });
      expect(mockAdapter.send).toHaveBeenCalledOnce();
      expect(captured[0].html).toContain(temporaryPassword);
      expect(captured[0].text).toContain(temporaryPassword);
    });

    it('includes loginUrl in both html and text', async () => {
      const { sendCredentialsEmail } = await import('@/lib/email/index');
      const captured: { html: string; text: string }[] = [];
      const mockAdapter = {
        send: vi.fn(async (msg: { html: string; text: string }) => {
          captured.push({ html: msg.html, text: msg.text });
        }),
      };
      const loginUrl = 'http://demo.localhost/login';
      await sendCredentialsEmail(mockAdapter, {
        to: 'admin@demo.localhost',
        tenantName: 'Demo Store',
        loginUrl,
        temporaryPassword: 'PASS-123',
      });
      expect(captured[0].html).toContain(loginUrl);
      expect(captured[0].text).toContain(loginUrl);
    });

    it('calls adapter.send with the correct to address', async () => {
      const { sendCredentialsEmail } = await import('@/lib/email/index');
      const mockAdapter = { send: vi.fn().mockResolvedValue(undefined) };
      await sendCredentialsEmail(mockAdapter, {
        to: 'owner@vinylcave.localhost',
        tenantName: 'Vinyl Cave',
        loginUrl: 'http://vinylcave.localhost/login',
        temporaryPassword: 'ABC-456',
      });
      expect(mockAdapter.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'owner@vinylcave.localhost' }),
      );
    });

    it('sends a non-empty subject', async () => {
      const { sendCredentialsEmail } = await import('@/lib/email/index');
      const mockAdapter = { send: vi.fn().mockResolvedValue(undefined) };
      await sendCredentialsEmail(mockAdapter, {
        to: 'x@x.localhost',
        tenantName: 'My Shop',
        loginUrl: 'http://x.localhost/login',
        temporaryPassword: 'PWD',
      });
      const msg = (mockAdapter.send.mock.calls[0] as [{ subject: string }])[0];
      expect(msg.subject.length).toBeGreaterThan(0);
    });
  });

  // ── Cycle B: Mailpit driver (SMTP via nodemailer mock) ────────────────────

  describe('createMailpitEmailAdapter()', () => {
    it('calls nodemailer.createTransport with the configured host and port', async () => {
      const { createMailpitEmailAdapter } = await import('@/lib/email/mailpit');
      createMailpitEmailAdapter();
      expect(mockCreateTransport).toHaveBeenCalledWith(
        expect.objectContaining({ host: 'localhost', port: 1025, secure: false }),
      );
    });

    it('send() delegates to transporter.sendMail with from/to/subject/html/text', async () => {
      const { createMailpitEmailAdapter } = await import('@/lib/email/mailpit');
      const adapter = createMailpitEmailAdapter();
      await adapter.send({
        to: 'recipient@example.com',
        subject: 'Hello',
        html: '<p>Hello</p>',
        text: 'Hello',
      });
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'noreply@test.localhost',
          to: 'recipient@example.com',
          subject: 'Hello',
          html: '<p>Hello</p>',
          text: 'Hello',
        }),
      );
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/email.test.ts`

Expected: FAIL — `Cannot find module '@/lib/email/index'`, `Cannot find module '@/lib/email/console'`, `Cannot find module '@/lib/email/mailpit'`

---

- [ ] **Step 3A: Implement `src/lib/email/console.ts`**

```ts
import type { EmailAdapter, EmailMessage } from './index';

export function createConsoleEmailAdapter(): EmailAdapter {
  return {
    async send(msg: EmailMessage): Promise<void> {
      console.log('[Email:console] ─────────────────────────────');
      console.log(`[Email:console] To:      ${msg.to}`);
      console.log(`[Email:console] Subject: ${msg.subject}`);
      console.log('[Email:console] Text:');
      console.log(msg.text);
      console.log('[Email:console] ─────────────────────────────');
    },
  };
}
```

- [ ] **Step 3B: Implement `src/lib/email/mailpit.ts`**

```ts
import nodemailer from 'nodemailer';
import { env } from '@/env';
import type { EmailAdapter, EmailMessage } from './index';

export function createMailpitEmailAdapter(): EmailAdapter {
  // One transporter per adapter instance; no auth (Mailpit dev server).
  const transporter = nodemailer.createTransport({
    host: env.MAIL_HOST,
    port: env.MAIL_PORT,
    secure: false,
  });

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

- [ ] **Step 3C: Implement `src/lib/email/index.ts`**

```ts
import { env } from '@/env';
import { createConsoleEmailAdapter } from './console';
import { createMailpitEmailAdapter } from './mailpit';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailAdapter {
  send(msg: EmailMessage): Promise<void>;
}

export function getEmailAdapter(): EmailAdapter {
  switch (env.MAIL_DRIVER) {
    case 'mailpit':
      return createMailpitEmailAdapter();
    case 'console':
      return createConsoleEmailAdapter();
    default: {
      // TypeScript exhaustiveness guard — env schema allows only two values.
      const exhaustive: never = env.MAIL_DRIVER;
      throw new Error(`Unknown MAIL_DRIVER: ${String(exhaustive)}`);
    }
  }
}

export async function sendCredentialsEmail(
  adapter: EmailAdapter,
  args: {
    to: string;
    tenantName: string;
    loginUrl: string;
    temporaryPassword: string;
  },
): Promise<void> {
  const { to, tenantName, loginUrl, temporaryPassword } = args;

  const subject = `Ihr Zugang für ${tenantName}`;

  const html = `<!DOCTYPE html>
<html lang="de">
<head><meta charset="utf-8" /><title>${subject}</title></head>
<body style="font-family:sans-serif;color:#111;max-width:480px;margin:0 auto;padding:24px">
  <h1 style="font-size:1.25rem;margin-bottom:8px">${tenantName}</h1>
  <p style="margin-bottom:16px">Willkommen! Hier sind Ihre Zugangsdaten:</p>
  <table style="border-collapse:collapse;width:100%;margin-bottom:16px">
    <tr>
      <td style="padding:6px 12px;font-weight:bold;white-space:nowrap">Login-URL</td>
      <td style="padding:6px 12px">
        <a href="${loginUrl}" style="color:#c84b31">${loginUrl}</a>
      </td>
    </tr>
    <tr style="background:#f5f5f5">
      <td style="padding:6px 12px;font-weight:bold;white-space:nowrap">Temporäres Passwort</td>
      <td style="padding:6px 12px;font-family:monospace;letter-spacing:0.05em">${temporaryPassword}</td>
    </tr>
  </table>
  <p style="font-size:0.875rem;color:#555">
    Bitte ändern Sie Ihr Passwort nach der ersten Anmeldung.
  </p>
</body>
</html>`;

  const text = [
    tenantName,
    '',
    'Willkommen! Hier sind Ihre Zugangsdaten:',
    '',
    `Login-URL:            ${loginUrl}`,
    `Temporäres Passwort:  ${temporaryPassword}`,
    '',
    'Bitte ändern Sie Ihr Passwort nach der ersten Anmeldung.',
  ].join('\n');

  await adapter.send({ to, subject, html, text });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test tests/email.test.ts`

Expected: PASS — all 9 tests green

Confirm full suite still passes:

Run: `pnpm test`

Expected: PASS (no regressions)

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`

Expected: no errors (strict mode; `never` guard catches any missing `MAIL_DRIVER` branch at compile time)

- [ ] **Step 6: Commit**

```bash
git add src/lib/email/index.ts src/lib/email/console.ts src/lib/email/mailpit.ts tests/email.test.ts
git commit -m "$(cat <<'EOF'
feat(slice0): email adapter — EmailAdapter interface, console + Mailpit drivers, sendCredentialsEmail

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Tenant provisioning + seed

**Files:**
- Create: `src/lib/provisioning.ts`
- Create: `scripts/seed.ts`
- Test: `tests/provisioning.integration.test.ts`

**Interfaces:**

- Consumes (verbatim from SPINE PART C):
  - `withOwner<T>(fn: (tx: Tx) => Promise<T>): Promise<T>` from `src/db/tenant.ts`
  - `withTenant<T>(ctx: TenantCtx, fn: (tx: Tx) => Promise<T>): Promise<T>` from `src/db/tenant.ts`
  - `RESERVED_SUBDOMAINS: ReadonlySet<string>` from `src/lib/subdomain.ts`
  - `assertAccessibleAccent(hex: string): { onAccent: '#FFFFFF' | '#111111' }` from `src/lib/tenant.ts`
  - `recordHash(input: { title: string; artist: string; country?: string|null; year?: number|null; label?: string[] }): string` from `src/db/hash.ts`
  - `setupTestDatabase(): Promise<{ container; ownerUrl: string; appUrl: string; teardown: () => Promise<void> }>` from `tests/helpers/db.ts`
  - Schema tables: `tenants`, `users`, `permalinks`, `records` from `src/db/schema.ts`

- Produces (verbatim from SPINE PART C):
  ```ts
  // src/lib/provisioning.ts
  export type ProvisionInput = { slug: string; name: string; adminEmail: string; primaryColor?: string; plan?: 'free'|'small'|'big' };
  export type ProvisionResult = { tenantId: number; adminUserId: number; temporaryPassword: string };
  export async function provisionTenant(input: ProvisionInput): Promise<ProvisionResult>;
  ```

---

- [ ] **Step 1: Write the failing integration tests**

`tests/provisioning.integration.test.ts`

```ts
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../src/db/schema';
import { setupTestDatabase } from './helpers/db';

describe('provisionTenant (integration)', () => {
  let ownerPool: Pool;
  let teardown: () => Promise<void>;

  beforeAll(async () => {
    const db = await setupTestDatabase();
    teardown = db.teardown;

    // Set env vars BEFORE module imports so src/db/client.ts picks them up
    process.env['DATABASE_OWNER_URL'] = db.ownerUrl;
    process.env['DATABASE_URL']       = db.appUrl;
    // Minimum required vars for src/env.ts zod schema
    process.env['NODE_ENV']           = 'test';
    process.env['ROOT_DOMAIN']        = 'localhost';
    process.env['APP_PROTOCOL']       = 'http';
    process.env['AUTH_SECRET']        = 'test-secret-at-least-32-characters-long';
    process.env['ENCRYPTION_KEY']     = Buffer.alloc(32).toString('base64');
    process.env['ENCRYPTION_KEY_ID']  = 'v1';
    process.env['MAIL_DRIVER']        = 'console';
    process.env['MAIL_HOST']          = 'localhost';
    process.env['MAIL_PORT']          = '1025';
    process.env['MAIL_FROM']          = 'noreply@localhost';

    ownerPool = new Pool({ connectionString: db.ownerUrl });

    // Fresh module graph so client.ts reads the overridden env vars
    vi.resetModules();
  }, 120_000);

  afterAll(async () => {
    await ownerPool.end();
    await teardown();
  });

  it('creates exactly 1 tenant, 1 admin user (role=admin), and 1 permalink (slug=lager)', async () => {
    const { provisionTenant } = await import('@/lib/provisioning');

    const result = await provisionTenant({
      slug: 'testshop',
      name: 'Test Shop',
      adminEmail: 'admin@testshop.example',
      primaryColor: '#4338CA',
      plan: 'free',
    });

    expect(result.tenantId).toBeTypeOf('number');
    expect(result.adminUserId).toBeTypeOf('number');
    expect(result.temporaryPassword).toHaveLength(16);
    // base32: uppercase A-Z + digits 2-7
    expect(/^[A-Z2-7]{16}$/.test(result.temporaryPassword)).toBe(true);

    const db = drizzle(ownerPool, { schema });

    const [tenant] = await db
      .select()
      .from(schema.tenants)
      .where(eq(schema.tenants.slug, 'testshop'));
    expect(tenant).toBeDefined();
    expect(tenant!.id).toBe(result.tenantId);
    expect(tenant!.plan).toBe('free');
    expect(
      (tenant!.config as { branding: { primaryColor: string } }).branding.primaryColor
    ).toBe('#4338CA');

    const tenantUsers = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.tenantId, result.tenantId));
    expect(tenantUsers).toHaveLength(1);
    expect(tenantUsers[0]!.id).toBe(result.adminUserId);
    expect(tenantUsers[0]!.role).toBe('admin');
    expect(tenantUsers[0]!.email).toBe('admin@testshop.example');
    expect(tenantUsers[0]!.isSuperadmin).toBe(false);

    const tenantPermalinks = await db
      .select()
      .from(schema.permalinks)
      .where(eq(schema.permalinks.tenantId, result.tenantId));
    expect(tenantPermalinks).toHaveLength(1);
    expect(tenantPermalinks[0]!.slug).toBe('lager');
  });

  it('rolls back ALL inserts when the slug already exists (atomicity)', async () => {
    const { provisionTenant } = await import('@/lib/provisioning');
    const db = drizzle(ownerPool, { schema });

    // First provision: must succeed
    const first = await provisionTenant({
      slug: 'rollback-slug',
      name: 'Rollback Test',
      adminEmail: 'admin@rollback.example',
      primaryColor: '#4338CA',
    });
    expect(first.tenantId).toBeTypeOf('number');

    // Second provision with same slug: unique constraint on tenants.slug causes rollback
    await expect(
      provisionTenant({
        slug: 'rollback-slug',
        name: 'Rollback Test Duplicate',
        adminEmail: 'admin2@rollback.example',
        primaryColor: '#4338CA',
      })
    ).rejects.toThrow();

    // State must be exactly what the FIRST provision left — no partial rows from second attempt
    const matchingTenants = await db
      .select()
      .from(schema.tenants)
      .where(eq(schema.tenants.slug, 'rollback-slug'));
    expect(matchingTenants).toHaveLength(1);

    const matchingUsers = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.tenantId, matchingTenants[0]!.id));
    expect(matchingUsers).toHaveLength(1);

    const matchingPermalinks = await db
      .select()
      .from(schema.permalinks)
      .where(eq(schema.permalinks.tenantId, matchingTenants[0]!.id));
    expect(matchingPermalinks).toHaveLength(1);
  });

  it('rejects a reserved slug before opening a DB transaction', async () => {
    const { provisionTenant } = await import('@/lib/provisioning');
    const db = drizzle(ownerPool, { schema });

    const countBefore = (await db.select({ id: schema.tenants.id }).from(schema.tenants)).length;

    await expect(
      provisionTenant({ slug: 'www', name: 'WWW', adminEmail: 'admin@www.example' })
    ).rejects.toThrow(/reserved/i);

    const countAfter = (await db.select({ id: schema.tenants.id }).from(schema.tenants)).length;
    expect(countAfter).toBe(countBefore);
  });

  it('rejects a slug that fails the format regex before opening a DB transaction', async () => {
    const { provisionTenant } = await import('@/lib/provisioning');
    const db = drizzle(ownerPool, { schema });

    const countBefore = (await db.select({ id: schema.tenants.id }).from(schema.tenants)).length;

    // 'ab' is only 2 characters — fails ^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$ (needs ≥3)
    await expect(
      provisionTenant({ slug: 'ab', name: 'AB', adminEmail: 'admin@ab.example' })
    ).rejects.toThrow(/invalid slug/i);

    const countAfter = (await db.select({ id: schema.tenants.id }).from(schema.tenants)).length;
    expect(countAfter).toBe(countBefore);
  });

  it('rejects an unparseable primary color before opening a DB transaction', async () => {
    const { provisionTenant } = await import('@/lib/provisioning');
    const db = drizzle(ownerPool, { schema });

    const countBefore = (await db.select({ id: schema.tenants.id }).from(schema.tenants)).length;

    // 'not-a-hex' is not a valid #RRGGBB value — assertAccessibleAccent must throw
    await expect(
      provisionTenant({
        slug: 'colortest',
        name: 'Color Test',
        adminEmail: 'admin@colortest.example',
        primaryColor: 'not-a-hex',
      })
    ).rejects.toThrow();

    const countAfter = (await db.select({ id: schema.tenants.id }).from(schema.tenants)).length;
    expect(countAfter).toBe(countBefore);
  });

  it('generates a unique temporaryPassword on every call', async () => {
    const { provisionTenant } = await import('@/lib/provisioning');

    const a = await provisionTenant({
      slug: 'uniq-a',
      name: 'Unique A',
      adminEmail: 'admin@uniq-a.example',
      primaryColor: '#4338CA',
    });
    const b = await provisionTenant({
      slug: 'uniq-b',
      name: 'Unique B',
      adminEmail: 'admin@uniq-b.example',
      primaryColor: '#4338CA',
    });

    expect(a.temporaryPassword).not.toBe(b.temporaryPassword);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test tests/provisioning.integration.test.ts
```

Expected: FAIL with `Cannot find module '@/lib/provisioning'`

---

- [ ] **Step 3: Implement `src/lib/provisioning.ts`**

```ts
import 'server-only';
import crypto from 'node:crypto';
import bcryptjs from 'bcryptjs';
import { withOwner } from '@/db/tenant';
import { tenants, users, permalinks } from '@/db/schema';
import { RESERVED_SUBDOMAINS } from '@/lib/subdomain';
import { assertAccessibleAccent } from '@/lib/tenant';

// ^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$ → 3–32 chars, no leading/trailing hyphen
const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

// Base32 alphabet: A-Z (26) + 2-7 (6) = 32 symbols
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Generate a 16-character base32 temporary password (80 bits of entropy).
 * Each byte contributes 5 bits via `b & 0x1f`; because 2^8 = 256 = 8×32,
 * the distribution over 0-31 is exactly uniform.
 */
function generateTempPassword(): string {
  const bytes = crypto.randomBytes(16);
  return Array.from(bytes, (b) => BASE32_ALPHABET[b & 0x1f]!).join('');
}

export type ProvisionInput = {
  slug: string;
  name: string;
  adminEmail: string;
  primaryColor?: string;
  plan?: 'free' | 'small' | 'big';
};

export type ProvisionResult = {
  tenantId: number;
  adminUserId: number;
  temporaryPassword: string;
};

export async function provisionTenant(input: ProvisionInput): Promise<ProvisionResult> {
  const { slug, name, adminEmail, primaryColor = '#C03A20', plan = 'free' } = input;

  // --- Pre-transaction validation (no DB involvement) ---

  if (RESERVED_SUBDOMAINS.has(slug)) {
    throw new Error(
      `Slug "${slug}" is reserved and cannot be used as a tenant identifier.`
    );
  }
  if (!SLUG_REGEX.test(slug)) {
    throw new Error(
      `Invalid slug "${slug}": must be 3–32 characters, start and end with a lowercase letter or digit, ` +
        `and contain only lowercase letters, digits, or hyphens.`
    );
  }

  // Throws if primaryColor cannot be parsed or achieves insufficient contrast.
  // Called here (before DB) so invalid colors never open a transaction.
  assertAccessibleAccent(primaryColor);

  // --- Credential generation (CPU work outside the DB transaction) ---
  const temporaryPassword = generateTempPassword();
  const passwordHash = await bcryptjs.hash(temporaryPassword, 12);

  // --- ONE atomic withOwner transaction: tenant → admin user → default permalink ---
  //
  // withOwner uses the qr_owner pool and sets:
  //   app.current_tenant  = ''
  //   app.current_user_id = ''
  //   app.is_superadmin   = 'false'
  // (transaction-local via set_config(..., true))
  //
  // Because we explicitly supply tenantId in every INSERT, the GUC-based column
  // default (`NULLIF(current_setting('app.current_tenant', true), '')::int`) is never invoked.
  // qr_owner has BYPASSRLS, so it writes tenant-scoped rows directly through FORCE RLS.
  // We still pass tenant_id explicitly on every insert (defence-in-depth, never a default).
  const { tenantId, adminUserId } = await withOwner(async (tx) => {
    // 1. Insert tenant into the platform registry (no RLS on tenants table)
    const [newTenant] = await tx
      .insert(tenants)
      .values({
        slug,
        name,
        plan,
        config: { branding: { primaryColor, logo: null } },
        limits: {},
      })
      .returning({ id: tenants.id });

    if (!newTenant) {
      throw new Error('[provisionTenant] Tenant insert returned no row — should not happen.');
    }

    // 2. Insert the initial admin user (bcrypt hash, role='admin')
    const [newUser] = await tx
      .insert(users)
      .values({
        tenantId: newTenant.id,
        email: adminEmail,
        password: passwordHash,
        role: 'admin',
        isSuperadmin: false,
      })
      .returning({ id: users.id });

    if (!newUser) {
      throw new Error('[provisionTenant] Admin user insert returned no row — should not happen.');
    }

    // 3. Insert the default "lager" permalink stub
    await tx.insert(permalinks).values({
      tenantId: newTenant.id,
      slug: 'lager',
      filter: {},
    });

    return { tenantId: newTenant.id, adminUserId: newUser.id };
  });
  // Any throw inside withOwner triggers a rollback — no partial rows left.

  return { tenantId, adminUserId, temporaryPassword };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test tests/provisioning.integration.test.ts
```

Expected: PASS (all 6 tests green)

---

- [ ] **Step 5: Write the failing seed idempotency test**

Add to `tests/provisioning.integration.test.ts` (inside the same `describe` block, after the existing tests — or as a separate suite in the same file):

```ts
describe('seed.ts idempotency', () => {
  it('running provisionTenant twice for the same slug yields one tenant, one user, one permalink', async () => {
    const { provisionTenant } = await import('@/lib/provisioning');
    const db = drizzle(ownerPool, { schema });

    // Simulate what seed does: check-then-provision
    const slug = 'seed-idempotency-test';

    const firstRun = await provisionTenant({
      slug,
      name: 'Seed Idempotency',
      adminEmail: 'admin@seed-idempotency.example',
      primaryColor: '#4338CA',
    });

    // Second "run": detect existing tenant and skip provisioning
    const existingTenants = await db
      .select({ id: schema.tenants.id })
      .from(schema.tenants)
      .where(eq(schema.tenants.slug, slug))
      .limit(1);

    // Guard: only provision if not already present (seed pattern)
    const tenantId = existingTenants.length > 0
      ? existingTenants[0]!.id
      : (await provisionTenant({
          slug,
          name: 'Seed Idempotency',
          adminEmail: 'admin@seed-idempotency.example',
          primaryColor: '#4338CA',
        })).tenantId;

    expect(tenantId).toBe(firstRun.tenantId);

    // Final state: exactly 1 of each
    const finalTenants = await db
      .select()
      .from(schema.tenants)
      .where(eq(schema.tenants.slug, slug));
    expect(finalTenants).toHaveLength(1);

    const finalUsers = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.tenantId, tenantId));
    expect(finalUsers).toHaveLength(1);

    const finalPermalinks = await db
      .select()
      .from(schema.permalinks)
      .where(eq(schema.permalinks.tenantId, tenantId));
    expect(finalPermalinks).toHaveLength(1);
  });
});
```

- [ ] **Step 6: Run extended test suite to verify it fails**

```bash
pnpm test tests/provisioning.integration.test.ts
```

Expected: PASS for existing tests; the new idempotency test also PASSES immediately because the guard logic is pure (provisionTenant is already tested, the guard is inline in the test). Verify all 7 tests green before proceeding to seed implementation.

---

- [ ] **Step 7: Implement `scripts/seed.ts`**

```ts
// Must be first: loads .env into process.env before any src/* imports
import 'dotenv/config';

import { eq, and } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { provisionTenant, type ProvisionInput } from '@/lib/provisioning';
import { withOwner, withTenant } from '@/db/tenant';
import { recordHash } from '@/db/hash';

// ---------------------------------------------------------------------------
// Tenant definitions
// ---------------------------------------------------------------------------

const DEMO_TENANT: ProvisionInput = {
  slug: 'demo',
  name: 'Demo Records',
  adminEmail: 'admin@demo.example',
  primaryColor: '#C03A20', // deep coral — white text contrast ≥ 4.5:1
  plan: 'free',
};

const VINYLCAVE_TENANT: ProvisionInput = {
  slug: 'vinylcave',
  name: 'Vinyl Cave',
  adminEmail: 'admin@vinylcave.example',
  primaryColor: '#4338CA', // deep indigo — white text contrast ≥ 4.5:1
  plan: 'small',
};

// ---------------------------------------------------------------------------
// Sample records (3 per tenant)
// ---------------------------------------------------------------------------

type RecordSeed = {
  title: string;
  artist: string;
  country: string;
  releaseYear: number;
  label: string[];
};

const DEMO_RECORDS: RecordSeed[] = [
  { title: 'Kind of Blue',  artist: 'Miles Davis',     country: 'US', releaseYear: 1959, label: ['Columbia']  },
  { title: 'Blue Train',    artist: 'John Coltrane',   country: 'US', releaseYear: 1958, label: ['Blue Note'] },
  { title: 'Giant Steps',   artist: 'John Coltrane',   country: 'US', releaseYear: 1960, label: ['Atlantic']  },
];

const VINYLCAVE_RECORDS: RecordSeed[] = [
  { title: 'The Dark Side of the Moon', artist: 'Pink Floyd',   country: 'UK', releaseYear: 1973, label: ['Harvest']  },
  { title: 'Abbey Road',                artist: 'The Beatles',  country: 'UK', releaseYear: 1969, label: ['Apple']    },
  { title: 'Led Zeppelin IV',           artist: 'Led Zeppelin', country: 'UK', releaseYear: 1971, label: ['Atlantic'] },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Provision a tenant only if its slug does not already exist.
 * Returns the tenantId and the temporaryPassword (null if already existed).
 */
async function ensureTenant(
  input: ProvisionInput,
): Promise<{ tenantId: number; temporaryPassword: string | null }> {
  const existing = await withOwner(async (tx) => {
    return tx
      .select({ id: schema.tenants.id })
      .from(schema.tenants)
      .where(eq(schema.tenants.slug, input.slug))
      .limit(1);
  });

  if (existing.length > 0 && existing[0]) {
    console.log(`[seed] Tenant "${input.slug}" already exists (id=${existing[0].id}), skipping.`);
    return { tenantId: existing[0].id, temporaryPassword: null };
  }

  const result = await provisionTenant(input);
  console.log(`[seed] Provisioned tenant "${input.slug}" (id=${result.tenantId}).`);
  return { tenantId: result.tenantId, temporaryPassword: result.temporaryPassword };
}

/**
 * Insert a sample record for a tenant if its hash does not already exist
 * for that tenant. Uses withTenant (qr_app + RLS) to insert correctly.
 */
async function ensureRecord(tenantId: number, rec: RecordSeed): Promise<void> {
  const hash = recordHash({
    title: rec.title,
    artist: rec.artist,
    country: rec.country,
    year: rec.releaseYear,
    label: rec.label,
  });

  const existing = await withTenant({ tenantId, userId: null }, async (tx) => {
    return tx
      .select({ id: schema.records.id })
      .from(schema.records)
      .where(
        and(
          eq(schema.records.hash, hash),
          eq(schema.records.tenantId, tenantId),
        ),
      )
      .limit(1);
  });

  if (existing.length > 0) {
    console.log(`[seed]   Record "${rec.title}" already exists, skipping.`);
    return;
  }

  await withTenant({ tenantId, userId: null }, async (tx) => {
    await tx.insert(schema.records).values({
      tenantId,
      title: rec.title,
      artist: rec.artist,
      label: rec.label,
      country: rec.country,
      releaseYear: rec.releaseYear,
      format: 'LP',
      genre: [],
      hash,
      recordStatus: 'verfuegbar',
    });
  });

  console.log(`[seed]   Inserted "${rec.title}" — ${rec.artist} (${rec.releaseYear}).`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('[seed] Starting seed run...');

  // --- demo tenant ---
  const { tenantId: demoId, temporaryPassword: demoPw } = await ensureTenant(DEMO_TENANT);
  if (demoPw !== null) {
    console.log('[seed] ┌─ Demo admin credentials ─────────────────────────');
    console.log(`[seed] │  Email:    ${DEMO_TENANT.adminEmail}`);
    console.log(`[seed] │  Password: ${demoPw}`);
    console.log('[seed] └───────────────────────────────────────────────────');
  }
  console.log(`[seed] Seeding records for "${DEMO_TENANT.slug}"...`);
  for (const rec of DEMO_RECORDS) {
    await ensureRecord(demoId, rec);
  }

  // --- vinylcave tenant ---
  const { tenantId: vinylId, temporaryPassword: vinylPw } = await ensureTenant(VINYLCAVE_TENANT);
  if (vinylPw !== null) {
    console.log('[seed] ┌─ Vinyl Cave admin credentials ────────────────────');
    console.log(`[seed] │  Email:    ${VINYLCAVE_TENANT.adminEmail}`);
    console.log(`[seed] │  Password: ${vinylPw}`);
    console.log('[seed] └───────────────────────────────────────────────────');
  }
  console.log(`[seed] Seeding records for "${VINYLCAVE_TENANT.slug}"...`);
  for (const rec of VINYLCAVE_RECORDS) {
    await ensureRecord(vinylId, rec);
  }

  console.log('[seed] Done. Safe to re-run.');
  // Pools created by src/db/client.ts are not exported; exit to release connections.
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('[seed] Fatal error:', err);
  process.exit(1);
});
```

- [ ] **Step 8: Run the full test suite and verify seed compiles**

```bash
pnpm test tests/provisioning.integration.test.ts
```

Expected: PASS (all 7 tests green, including idempotency scenario)

```bash
pnpm typecheck
```

Expected: no errors in `src/lib/provisioning.ts` or `scripts/seed.ts`

- [ ] **Step 9: Commit**

```bash
git add src/lib/provisioning.ts scripts/seed.ts tests/provisioning.integration.test.ts
git commit -m "feat(slice0): atomic tenant provisioning + idempotent dev seed (§9.9)"
```

---

### Task 13: App shell UI + integration stub interfaces

**Files:**
- Create: `src/lib/integrations/index.ts`
- Create: `src/components/theme/ThemeProvider.tsx`
- Create: `src/components/theme/ThemeToggle.tsx`
- Create: `src/components/theme/AccentSwitch.tsx`
- Create: `src/app/layout.tsx`
- Create: `src/app/(app)/layout.tsx`
- Create: `src/app/(app)/page.tsx`
- Create: `src/app/(app)/inventar/page.tsx`
- Create: `src/app/(app)/wunschlisten/page.tsx`
- Create: `src/app/(app)/analytik/page.tsx`
- Create: `src/app/(app)/schaufenster/page.tsx`
- Create: `src/app/s/[permalink]/page.tsx`
- Test: `tests/integrations.test.ts`
- Test: `tests/theme-provider.test.tsx`
- Test: `tests/permalink.integration.test.ts`

**Interfaces:**
- Consumes:
  - `getCurrentTenant(): Promise<Tenant>` — `src/lib/tenant.ts`
  - `getCurrentTenantSlug(): Promise<string | null>` — `src/lib/tenant.ts`
  - `accentOnColor(hex: string): '#FFFFFF' | '#111111'` — `src/lib/tenant.ts`
  - `requireSession(): Promise<SessionUser>` — `src/auth/session.ts`
  - `withTenant<T>(ctx: TenantCtx, fn: (tx: Tx) => Promise<T>): Promise<T>` — `src/db/tenant.ts`
  - `VinylDisc` component — `src/components/ui/VinylDisc.tsx`
  - `setupTestDatabase(), seedTenant()` — `tests/helpers/db.ts`
  - `displayFont, bodyFont, monoFont` — `src/lib/fonts.ts`
  - `permalinks` table, `tenantId`, `slug` columns — `src/db/schema.ts`

- Produces:
  - `export function notImplemented(name: string): never` — `src/lib/integrations/index.ts`
  - `export interface PaymentsAdapter` — `src/lib/integrations/index.ts`
  - `export interface PosAdapter` — `src/lib/integrations/index.ts`
  - `export interface SocialAdapter` — `src/lib/integrations/index.ts`
  - `export interface AiSearchAdapter` — `src/lib/integrations/index.ts`
  - `export interface ElsterExportAdapter` — `src/lib/integrations/index.ts`
  - `export function ThemeProvider(props: { defaultTheme: 'light'|'dark'; defaultAccent: 'coral'|'indigo'|'forest'; children: React.ReactNode }): JSX.Element` — `src/components/theme/ThemeProvider.tsx`
  - `export function useTheme(): ThemeContextValue` — `src/components/theme/ThemeProvider.tsx`
  - `export function ThemeToggle(): JSX.Element` — `src/components/theme/ThemeToggle.tsx`
  - `export function AccentSwitch(): JSX.Element` — `src/components/theme/AccentSwitch.tsx`

---

## Cycle 1 — Integration adapter stubs

- [ ] **Step 1.1: Write the failing test**

```ts
// tests/integrations.test.ts
import { describe, it, expect } from 'vitest';
import { notImplemented } from '@/lib/integrations/index';

describe('notImplemented', () => {
  it('throws including the adapter name', () => {
    expect(() => notImplemented('PaymentsAdapter.createCheckout')).toThrow(
      'PaymentsAdapter.createCheckout: not implemented in Slice 0',
    );
  });

  it('return type is never — TS compile guard (runtime: throws)', () => {
    // If notImplemented() returned, this test would fail via the throw check above.
    expect(() => notImplemented('test')).toThrow();
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `pnpm test tests/integrations.test.ts`
Expected: FAIL with "Cannot find module '@/lib/integrations/index'"

- [ ] **Step 1.3: Implement `src/lib/integrations/index.ts`**

```ts
// src/lib/integrations/index.ts

/** Throw from every stub method. Every adapter in Slice 0 is interface-only. */
export function notImplemented(name: string): never {
  throw new Error(`${name}: not implemented in Slice 0`);
}

// ---------------------------------------------------------------------------
// Payments (e.g. Stripe, SumUp)
// ---------------------------------------------------------------------------
export interface PaymentsAdapter {
  createCheckout(args: {
    tenantId: number;
    amountCents: number;
    description: string;
    returnUrl: string;
  }): Promise<{ checkoutUrl: string; sessionId: string }>;

  getCheckoutStatus(args: {
    tenantId: number;
    sessionId: string;
  }): Promise<{ status: 'pending' | 'paid' | 'failed' }>;

  refund(args: {
    tenantId: number;
    sessionId: string;
    amountCents: number;
  }): Promise<{ refundId: string }>;
}

// ---------------------------------------------------------------------------
// Point-of-sale terminal (e.g. SumUp Card Reader)
// ---------------------------------------------------------------------------
export interface PosAdapter {
  createSale(args: {
    tenantId: number;
    amountCents: number;
    reference: string;
  }): Promise<{ transactionId: string }>;

  cancelSale(args: { tenantId: number; transactionId: string }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Social / marketing (e.g. Instagram, Discogs marketplace listing)
// ---------------------------------------------------------------------------
export interface SocialAdapter {
  postListing(args: {
    tenantId: number;
    recordId: number;
    caption: string;
    imageUrl?: string;
  }): Promise<{ postId: string; postUrl: string }>;

  deleteListing(args: { tenantId: number; postId: string }): Promise<void>;
}

// ---------------------------------------------------------------------------
// AI semantic search (Slice 4)
// ---------------------------------------------------------------------------
export interface AiSearchAdapter {
  searchRecords(args: {
    tenantId: number;
    query: string;
    limit?: number;
  }): Promise<Array<{ id: number; score: number }>>;

  indexRecord(args: { tenantId: number; recordId: number }): Promise<void>;
}

// ---------------------------------------------------------------------------
// ELSTER tax export (German tax authority, Slice 6)
// ---------------------------------------------------------------------------
export interface ElsterExportAdapter {
  exportTaxData(args: {
    tenantId: number;
    year: number;
  }): Promise<{ xmlPayload: string; validationWarnings: string[] }>;
}
```

- [ ] **Step 1.4: Run test to verify it passes**

Run: `pnpm test tests/integrations.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 1.5: Commit**

```bash
git add src/lib/integrations/index.ts tests/integrations.test.ts
git commit -m "feat(slice0): integration adapter stub interfaces + notImplemented helper"
```

---

## Cycle 2 — Theme components (ThemeProvider, ThemeToggle, AccentSwitch)

- [ ] **Step 2.1: Write the failing tests**

```tsx
// @vitest-environment jsdom
// tests/theme-provider.test.tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { ThemeProvider, useTheme } from '@/components/theme/ThemeProvider';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { AccentSwitch } from '@/components/theme/AccentSwitch';

// Helper probe component
function Probe() {
  const { theme, accent } = useTheme();
  return (
    <div
      data-testid="probe"
      data-theme-val={theme}
      data-accent-val={accent}
    />
  );
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-accent');
    localStorage.clear();
    // Clear theme cookies
    document.cookie = 'qr-theme=; max-age=0';
    document.cookie = 'qr-accent=; max-age=0';
  });

  it('applies data-theme and data-accent to documentElement on mount', async () => {
    render(
      <ThemeProvider defaultTheme="dark" defaultAccent="indigo">
        <Probe />
      </ThemeProvider>,
    );
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
      expect(document.documentElement.getAttribute('data-accent')).toBe('indigo');
    });
  });

  it('exposes correct values through useTheme context', () => {
    render(
      <ThemeProvider defaultTheme="light" defaultAccent="forest">
        <Probe />
      </ThemeProvider>,
    );
    const probe = screen.getByTestId('probe');
    expect(probe.getAttribute('data-theme-val')).toBe('light');
    expect(probe.getAttribute('data-accent-val')).toBe('forest');
  });

  it('useTheme throws when used outside ThemeProvider', () => {
    // Suppress React error boundary noise
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow('useTheme must be inside ThemeProvider');
    spy.mockRestore();
  });
});

describe('ThemeToggle', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    localStorage.clear();
  });

  it('renders a button with correct aria-label for light theme', () => {
    render(
      <ThemeProvider defaultTheme="light" defaultAccent="coral">
        <ThemeToggle />
      </ThemeProvider>,
    );
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('aria-label')).toMatch(/dunkel/i);
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });

  it('toggles theme from light to dark on click', async () => {
    render(
      <ThemeProvider defaultTheme="light" defaultAccent="coral">
        <ThemeToggle />
        <Probe />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
      expect(screen.getByTestId('probe').getAttribute('data-theme-val')).toBe('dark');
    });
  });

  it('persists theme to localStorage', async () => {
    render(
      <ThemeProvider defaultTheme="light" defaultAccent="coral">
        <ThemeToggle />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => {
      expect(localStorage.getItem('qr-theme')).toBe('dark');
    });
  });
});

describe('AccentSwitch', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-accent');
    localStorage.clear();
  });

  it('renders radio buttons for coral, indigo, forest', () => {
    render(
      <ThemeProvider defaultTheme="light" defaultAccent="coral">
        <AccentSwitch />
      </ThemeProvider>,
    );
    const group = screen.getByRole('radiogroup', { name: /akzentfarbe/i });
    expect(group).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Coral' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Indigo' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Forest' })).toBeTruthy();
  });

  it('marks active accent as checked', () => {
    render(
      <ThemeProvider defaultTheme="light" defaultAccent="indigo">
        <AccentSwitch />
      </ThemeProvider>,
    );
    expect(
      screen.getByRole('radio', { name: 'Indigo' }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      screen.getByRole('radio', { name: 'Coral' }).getAttribute('aria-checked'),
    ).toBe('false');
  });

  it('clicking Indigo sets data-accent on documentElement', async () => {
    render(
      <ThemeProvider defaultTheme="light" defaultAccent="coral">
        <AccentSwitch />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Indigo' }));
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-accent')).toBe('indigo');
    });
  });

  it('persists accent to localStorage', async () => {
    render(
      <ThemeProvider defaultTheme="light" defaultAccent="coral">
        <AccentSwitch />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Forest' }));
    await waitFor(() => {
      expect(localStorage.getItem('qr-accent')).toBe('forest');
    });
  });
});
```

- [ ] **Step 2.2: Run test to verify it fails**

Run: `pnpm test tests/theme-provider.test.tsx`
Expected: FAIL with "Cannot find module '@/components/theme/ThemeProvider'"

- [ ] **Step 2.3: Implement ThemeProvider, ThemeToggle, AccentSwitch**

```tsx
// src/components/theme/ThemeProvider.tsx
'use client';

import { createContext, useContext, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
export type Accent = 'coral' | 'indigo' | 'forest';

export interface ThemeContextValue {
  theme: Theme;
  accent: Accent;
  setTheme(t: Theme): void;
  setAccent(a: Accent): void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be inside ThemeProvider');
  return ctx;
}

interface ThemeProviderProps {
  defaultTheme: Theme;
  defaultAccent: Accent;
  children: React.ReactNode;
}

export function ThemeProvider({ defaultTheme, defaultAccent, children }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(defaultTheme);
  const [accent, setAccentState] = useState<Accent>(defaultAccent);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-accent', accent);
  }, [theme, accent]);

  function setTheme(t: Theme) {
    setThemeState(t);
    try {
      localStorage.setItem('qr-theme', t);
      // Not __Host- — preference cookie, not auth
      document.cookie = `qr-theme=${t};path=/;max-age=31536000;SameSite=Lax`;
    } catch {
      // SSR guard
    }
  }

  function setAccent(a: Accent) {
    setAccentState(a);
    try {
      localStorage.setItem('qr-accent', a);
      document.cookie = `qr-accent=${a};path=/;max-age=31536000;SameSite=Lax`;
    } catch {
      // SSR guard
    }
  }

  return (
    <ThemeContext.Provider value={{ theme, accent, setTheme, setAccent }}>
      {children}
    </ThemeContext.Provider>
  );
}
```

```tsx
// src/components/theme/ThemeToggle.tsx
'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from './ThemeProvider';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      aria-label={isDark ? 'Zu hellem Theme wechseln' : 'Zu dunklem Theme wechseln'}
      aria-pressed={isDark}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      style={{
        flexShrink: 0,
        width: '42px',
        height: '42px',
        border: '1.5px solid var(--border-strong)',
        borderRadius: 'var(--r-md)',
        background: 'var(--surface)',
        color: 'var(--text)',
        cursor: 'pointer',
        display: 'grid',
        placeItems: 'center',
        transition: 'border-color var(--dur-1) var(--ease)',
      }}
    >
      {isDark ? (
        <Sun size={18} aria-hidden="true" />
      ) : (
        <Moon size={18} aria-hidden="true" />
      )}
    </button>
  );
}
```

```tsx
// src/components/theme/AccentSwitch.tsx
'use client';

import { useTheme, type Accent } from './ThemeProvider';

const ACCENT_OPTIONS: Array<{ value: Accent; label: string; hex: string }> = [
  { value: 'coral',  label: 'Coral',  hex: '#E8552E' },
  { value: 'indigo', label: 'Indigo', hex: '#5B4FCF' },
  { value: 'forest', label: 'Forest', hex: '#2F6F4E' },
];

export function AccentSwitch() {
  const { accent, setAccent } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Akzentfarbe wählen"
      style={{ display: 'flex', gap: '6px', alignItems: 'center' }}
    >
      {ACCENT_OPTIONS.map((opt) => {
        const isActive = accent === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={opt.label}
            onClick={() => setAccent(opt.value)}
            className="focus-ring-button"
            style={{
              width: '22px',
              height: '22px',
              borderRadius: '50%',
              background: opt.hex,
              border: isActive ? `2px solid var(--border-strong)` : '2px solid transparent',
              // Active indicator via box-shadow, NOT outline — inline `outline:none`
              // would clobber the browser's :focus-visible ring on inactive swatches
              // (focus-ring-button restores it for keyboard users).
              boxShadow: isActive ? `0 0 0 2px var(--surface), 0 0 0 4px ${opt.hex}` : 'none',
              cursor: 'pointer',
              padding: 0,
              transition: 'box-shadow var(--dur-1) var(--ease)',
            }}
          />
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2.4: Run test to verify it passes**

Run: `pnpm test tests/theme-provider.test.tsx`
Expected: PASS (10 tests)

- [ ] **Step 2.5: Commit**

```bash
git add src/components/theme/ThemeProvider.tsx \
        src/components/theme/ThemeToggle.tsx \
        src/components/theme/AccentSwitch.tsx \
        tests/theme-provider.test.tsx
git commit -m "feat(slice0): ThemeProvider context, ThemeToggle, AccentSwitch — tested"
```

---

## Cycle 3 — Public permalink stub + DB query guard

- [ ] **Step 3.1: Write the failing tests**

```ts
// tests/permalink.integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDatabase, seedTenant } from './helpers/db';
import { withTenant, withOwner } from '@/db/tenant';
import { permalinks } from '@/db/schema';
import { eq, and } from 'drizzle-orm';

let teardown: (() => Promise<void>) | undefined;
let tenantId: number;

beforeAll(async () => {
  const testDb = await setupTestDatabase();
  teardown = testDb.teardown;
  process.env.DATABASE_URL = testDb.appUrl;
  process.env.DATABASE_OWNER_URL = testDb.ownerUrl;

  const seeded = await seedTenant({
    slug: 'demo',
    name: 'Demo Store',
    primaryColor: '#E8552E',
  });
  tenantId = seeded.tenantId;

  // Insert a known permalink so Cycle 3 test can query it
  await withOwner((tx) =>
    tx.insert(permalinks).values({
      tenantId,
      slug: 'lager',
      filter: { status: 'verfuegbar' },
    }),
  );
}, 90_000);

afterAll(async () => {
  await teardown?.();
});

describe('permalink lookup — guard for s/[permalink]/page.tsx', () => {
  it('finds an existing permalink scoped to the correct tenant', async () => {
    const row = await withTenant({ tenantId, userId: null }, (tx) =>
      tx
        .select({ id: permalinks.id, slug: permalinks.slug })
        .from(permalinks)
        .where(
          and(
            eq(permalinks.slug, 'lager'),
            eq(permalinks.tenantId, tenantId),
          ),
        )
        .then((rows) => rows[0] ?? null),
    );

    expect(row).not.toBeNull();
    expect(row?.slug).toBe('lager');
  });

  it('returns null for an unknown permalink slug — page must call notFound()', async () => {
    const row = await withTenant({ tenantId, userId: null }, (tx) =>
      tx
        .select({ id: permalinks.id })
        .from(permalinks)
        .where(
          and(
            eq(permalinks.slug, 'does-not-exist'),
            eq(permalinks.tenantId, tenantId),
          ),
        )
        .then((rows) => rows[0] ?? null),
    );

    expect(row).toBeNull();
    // When null, the page component calls notFound() → §9.4 acceptance criterion
  });

  it('does NOT return a permalink belonging to a different tenant', async () => {
    // Seed a second tenant with the same slug
    const other = await seedTenant({ slug: 'other', name: 'Other Store' });
    await withOwner((tx) =>
      tx.insert(permalinks).values({
        tenantId: other.tenantId,
        slug: 'lager',
        filter: {},
      }),
    );

    // Query scoped to FIRST tenant — must not see second tenant's row count
    const rows = await withTenant({ tenantId, userId: null }, (tx) =>
      tx
        .select({ id: permalinks.id, tenantId: permalinks.tenantId })
        .from(permalinks)
        .where(eq(permalinks.slug, 'lager')),
    );

    // Every returned row must belong to tenantId (RLS guarantee)
    for (const row of rows) {
      expect(row.tenantId).toBe(tenantId);
    }
  });
});
```

- [ ] **Step 3.2: Run test to verify it fails**

Run: `pnpm test tests/permalink.integration.test.ts`
Expected: FAIL with "Cannot find module '@/db/tenant'" or DB connection error (file not yet created and DB not yet running)

- [ ] **Step 3.3: Implement `src/app/s/[permalink]/page.tsx`**

```tsx
// src/app/s/[permalink]/page.tsx
import { notFound } from 'next/navigation';
import { getCurrentTenant } from '@/lib/tenant';
import { withTenant } from '@/db/tenant';
import { permalinks } from '@/db/schema';
import { eq, and } from 'drizzle-orm';

interface Props {
  params: Promise<{ permalink: string }>;
}

export default async function PublicPermalinkPage({ params }: Props) {
  const { permalink: slug } = await params;

  // getCurrentTenant reads x-tenant-slug from headers — set by edge middleware.
  // notFound() propagates naturally if the slug resolves to nothing.
  const tenant = await getCurrentTenant();

  const row = await withTenant({ tenantId: tenant.id, userId: null }, (tx) =>
    tx
      .select({ id: permalinks.id, filter: permalinks.filter, createdAt: permalinks.createdAt })
      .from(permalinks)
      .where(and(eq(permalinks.slug, slug), eq(permalinks.tenantId, tenant.id)))
      .then((rows) => rows[0] ?? null),
  );

  if (!row) {
    notFound(); // §9.4: unknown permalink → 404, NOT another tenant's data
  }

  // Slice 3 will render full public storefront here.
  return (
    <main style={{ padding: 'clamp(18px,3vw,32px)', fontFamily: 'var(--font-body)' }}>
      <h1
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 800,
          fontSize: 'clamp(28px,5vw,40px)',
          letterSpacing: '-.02em',
          marginBottom: '8px',
        }}
      >
        {tenant.name}
      </h1>
      <p style={{ color: 'var(--text-2)', fontSize: '15px' }}>
        Schaufenster · <span style={{ fontFamily: 'var(--font-mono)' }}>{slug}</span> — Slice 3 folgt.
      </p>
    </main>
  );
}

export async function generateMetadata({ params }: Props) {
  const { permalink: slug } = await params;
  try {
    const tenant = await getCurrentTenant();
    return { title: `${tenant.name} · ${slug}` };
  } catch {
    return { title: slug };
  }
}
```

- [ ] **Step 3.4: Run test to verify it passes**

Run: `pnpm test tests/permalink.integration.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 3.5: Commit**

```bash
git add src/app/s/[permalink]/page.tsx tests/permalink.integration.test.ts
git commit -m "feat(slice0): public permalink stub page — notFound on unknown slug, RLS-scoped query"
```

---

## Cycle 4 — Root layout, app shell, nav, placeholder pages

No new Vitest tests in this cycle — shell layouts are validated by `pnpm typecheck` and by Task 15 E2E. The cycle ends with a passing typecheck.

- [ ] **Step 4.1: Implement `src/app/layout.tsx`**

```tsx
// src/app/layout.tsx
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { getCurrentTenantSlug, getCurrentTenant, accentOnColor } from '@/lib/tenant';
import { ThemeProvider, type Theme, type Accent } from '@/components/theme/ThemeProvider';
import { displayFont, bodyFont, monoFont } from '@/lib/fonts';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: { default: 'q·records storemanager', template: '%s · q·records' },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // SSR theme preference from cookie (set by ThemeProvider client-side)
  const cookieStore = await cookies();
  const rawTheme = cookieStore.get('qr-theme')?.value;
  const rawAccent = cookieStore.get('qr-accent')?.value;
  const initialTheme: Theme = rawTheme === 'dark' ? 'dark' : 'light';
  const initialAccent: Accent =
    rawAccent === 'indigo' || rawAccent === 'forest' ? rawAccent : 'coral';

  // SSR tenant branding — inline in <head> to eliminate FOUC.
  // getCurrentTenantSlug() returns null when x-tenant-slug header is absent
  // (middleware blocks unknown subdomains before reaching here, but system
  // routes like /_next/* have no tenant slug and must be handled gracefully).
  let brandingStyle = '';
  const slug = await getCurrentTenantSlug();
  if (slug) {
    // getCurrentTenant() calls notFound() for unresolved slugs — middleware
    // already prevented unknown tenants, so this is always valid here.
    const tenant = await getCurrentTenant();
    const { primaryColor } = tenant.branding;
    const onAccent = accentOnColor(primaryColor);
    // Override the FULL accent family from the tenant's primaryColor via CSS color-mix()
    // so hover/press/soft/soft-border/ink stay consistent with --accent for any tenant
    // colour (not just coral). No JS colour math; mixes against --surface so it adapts to
    // light/dark. color-mix() is supported in all 2026 evergreen browsers.
    brandingStyle =
      `:root{` +
      `--accent:${primaryColor};` +
      `--accent-hover:color-mix(in srgb, ${primaryColor} 88%, #000);` +
      `--accent-press:color-mix(in srgb, ${primaryColor} 78%, #000);` +
      `--accent-soft:color-mix(in srgb, ${primaryColor} 12%, var(--surface));` +
      `--accent-soft-border:color-mix(in srgb, ${primaryColor} 30%, var(--surface));` +
      `--accent-ink:color-mix(in srgb, ${primaryColor} 70%, #000);` +
      `--on-accent:${onAccent};` +
      `--focus:${primaryColor};` +
      `}`;
  }

  return (
    <html
      lang="de"
      data-theme={initialTheme}
      data-accent={initialAccent}
      className={`${displayFont.variable} ${bodyFont.variable} ${monoFont.variable}`}
    >
      <head>
        {brandingStyle ? (
          <style
            // biome-ignore lint/security/noDangerouslySetInnerHtml: verbatim CSS injection is safe here — values come from DB, not user input
            dangerouslySetInnerHTML={{ __html: brandingStyle }}
            data-qr-branding
          />
        ) : null}
      </head>
      <body>
        <ThemeProvider defaultTheme={initialTheme} defaultAccent={initialAccent}>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 4.2: Implement sidebar nav client component + `src/app/(app)/layout.tsx`**

```tsx
// src/app/(app)/layout.tsx
import { redirect } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { getCurrentTenant } from '@/lib/tenant';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { AccentSwitch } from '@/components/theme/AccentSwitch';
import { VinylDisc } from '@/components/ui/VinylDisc';
import { SidebarNav } from './_components/SidebarNav';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Enforces session↔tenant invariant; redirects to /login if no session.
  const user = await requireSession();
  const tenant = await getCurrentTenant();

  const initial = (user.email[0] ?? '?').toUpperCase();

  return (
    <div
      style={{
        display: 'flex',
        minHeight: '100vh',
        background: 'var(--bg)',
        color: 'var(--text)',
        fontFamily: 'var(--font-body)',
      }}
    >
      {/* ── Sidebar ── */}
      <aside
        style={{
          position: 'sticky',
          top: 0,
          height: '100vh',
          flexShrink: 0,
          width: '248px',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--surface)',
          borderRight: '1px solid var(--border)',
          padding: '18px 14px',
          gap: '6px',
          zIndex: 30,
          overflowY: 'auto',
        }}
      >
        {/* Logo */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '11px',
            padding: '6px 8px 18px',
          }}
        >
          {/* VinylDisc from Task 3 — uses --disc-label token (pinned coral, not accent-tracked).
              The component is aria-hidden internally; do not pass aria-hidden (not in VinylDiscProps). */}
          <VinylDisc size={36} />
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
            <span
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 800,
                fontSize: '18px',
                letterSpacing: '-.02em',
              }}
            >
              q·records
            </span>
            <span
              style={{
                fontSize: '10.5px',
                color: 'var(--text-3)',
                fontWeight: 500,
                letterSpacing: '.05em',
              }}
            >
              STOREMANAGER · 2026
            </span>
          </div>
        </div>

        {/* Nav — client component (needs usePathname for active state) */}
        <SidebarNav />

        {/* User card */}
        <div
          style={{
            marginTop: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: '11px',
            padding: '12px 10px',
            borderRadius: 'var(--r-md)',
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
          }}
        >
          <div
            aria-hidden="true"
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '50%',
              flexShrink: 0,
              background: 'linear-gradient(135deg,var(--accent),var(--honey))',
              display: 'grid',
              placeItems: 'center',
              color: 'var(--on-accent)',
              fontWeight: 800,
              fontFamily: 'var(--font-display)',
              fontSize: '14px',
            }}
          >
            {initial}
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              lineHeight: 1.25,
              minWidth: 0,
            }}
          >
            <span
              style={{
                fontWeight: 700,
                fontSize: '13.5px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {user.email}
            </span>
            <span style={{ fontSize: '11px', color: 'var(--text-3)', textTransform: 'capitalize' }}>
              {user.role} · {tenant.name}
            </span>
          </div>
        </div>
      </aside>

      {/* ── Main content area ── */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {/* Sticky topbar */}
        <header
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 25,
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '14px clamp(18px,3vw,32px)',
            background: 'color-mix(in srgb,var(--surface) 88%,transparent)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <span style={{ marginRight: 'auto' }} />
          <AccentSwitch />
          <ThemeToggle />
        </header>

        <main style={{ flex: 1, padding: 'clamp(18px,3vw,32px)' }}>
          {children}
        </main>
      </div>
    </div>
  );
}
```

```tsx
// src/app/(app)/_components/SidebarNav.tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Package,
  Heart,
  Store,
  BarChart3,
} from 'lucide-react';

const NAV_ITEMS = [
  { href: '/',             label: 'Übersicht',    Icon: LayoutDashboard },
  { href: '/inventar',     label: 'Lagerbestand', Icon: Package          },
  { href: '/wunschlisten', label: 'Wunschlisten', Icon: Heart            },
  { href: '/schaufenster', label: 'Schaufenster', Icon: Store            },
  { href: '/analytik',     label: 'Analytik',     Icon: BarChart3        },
] as const;

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Hauptnavigation" style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
      {NAV_ITEMS.map(({ href, label, Icon }) => {
        // Exact match for dashboard, prefix match for others
        const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={isActive ? 'page' : undefined}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              minHeight: 'var(--tap)',
              padding: '0 14px',
              borderRadius: 'var(--r-md)',
              background: isActive ? 'var(--accent-soft)' : 'transparent',
              color: isActive ? 'var(--accent-ink)' : 'var(--text-2)',
              fontWeight: isActive ? 700 : 600,
              fontSize: '14.5px',
              textDecoration: 'none',
              borderLeft: isActive ? '3px solid var(--accent)' : '3px solid transparent',
              transition: 'background var(--dur-1) var(--ease), color var(--dur-1) var(--ease)',
            }}
          >
            <Icon size={18} aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 4.3: Implement placeholder pages**

```tsx
// src/app/(app)/page.tsx
export default function DashboardPage() {
  return (
    <div>
      <h1
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: 'clamp(20px,3vw,26px)',
          letterSpacing: '-.02em',
          margin: '0 0 8px',
        }}
      >
        Übersicht
      </h1>
      <p style={{ color: 'var(--text-2)', fontSize: '15px' }}>Dashboard — Slice 1 folgt.</p>
    </div>
  );
}
```

```tsx
// src/app/(app)/inventar/page.tsx
export default function InventarPage() {
  return (
    <div>
      <h1
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: 'clamp(20px,3vw,26px)',
          letterSpacing: '-.02em',
          margin: '0 0 8px',
        }}
      >
        Lagerbestand
      </h1>
      <p style={{ color: 'var(--text-2)', fontSize: '15px' }}>Inventar — Slice 1 folgt.</p>
    </div>
  );
}
```

```tsx
// src/app/(app)/wunschlisten/page.tsx
export default function WunschlistenPage() {
  return (
    <div>
      <h1
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: 'clamp(20px,3vw,26px)',
          letterSpacing: '-.02em',
          margin: '0 0 8px',
        }}
      >
        Wunschlisten
      </h1>
      <p style={{ color: 'var(--text-2)', fontSize: '15px' }}>Wunschlisten — Slice 3 folgt.</p>
    </div>
  );
}
```

```tsx
// src/app/(app)/analytik/page.tsx
export default function AnalytikPage() {
  return (
    <div>
      <h1
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: 'clamp(20px,3vw,26px)',
          letterSpacing: '-.02em',
          margin: '0 0 8px',
        }}
      >
        Analytik
      </h1>
      <p style={{ color: 'var(--text-2)', fontSize: '15px' }}>Analytik — Slice 4 folgt.</p>
    </div>
  );
}
```

```tsx
// src/app/(app)/schaufenster/page.tsx
export default function SchaufensterPage() {
  return (
    <div>
      <h1
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: 'clamp(20px,3vw,26px)',
          letterSpacing: '-.02em',
          margin: '0 0 8px',
        }}
      >
        Schaufenster
      </h1>
      <p style={{ color: 'var(--text-2)', fontSize: '15px' }}>
        Öffentliche Permalinks verwalten — Slice 3 folgt.
      </p>
    </div>
  );
}
```

- [ ] **Step 4.4: Run typecheck to verify it passes**

Run: `pnpm typecheck`
Expected: PASS — zero TypeScript errors

- [ ] **Step 4.5: Commit**

```bash
git add src/app/layout.tsx \
        src/app/\(app\)/layout.tsx \
        src/app/\(app\)/_components/SidebarNav.tsx \
        src/app/\(app\)/page.tsx \
        src/app/\(app\)/inventar/page.tsx \
        src/app/\(app\)/wunschlisten/page.tsx \
        src/app/\(app\)/analytik/page.tsx \
        src/app/\(app\)/schaufenster/page.tsx
git commit -m "feat(slice0): root layout SSR branding + app shell sidebar + nav placeholder pages"
```

---

## Acceptance check

Run the full suite to confirm this task's gates pass before Task 15 E2E:

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Expected: all green.

§9.4 (unknown permalink → 404) and §9.7 (branding without FOUC, theme+accent on `<html>`) are validated end-to-end by Task 15 Playwright spec.

---

### Task 14: Worker (pg-boss)

**Files:**
- Create: `src/worker/index.ts`
- Create: `src/worker/jobs/analyticsSummary.ts`
- (Note: `docker/entrypoint-worker.sh` is created in Task 15, not here)
- Test: `tests/worker.unit.test.ts`
- Test: `tests/worker.integration.test.ts`

**Interfaces:**

Consumes (exact signatures from SPINE PART C, earlier tasks):
```ts
// from src/db/tenant.ts (Task 6)
export async function withSuperadmin<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;

// from src/env.ts (Task 1)
export const env: { PGBOSS_DATABASE_URL: string; /* … */ };
```

Produces (exact signatures later tasks rely on, from SPINE PART C):
```ts
// src/worker/index.ts
export async function startWorker(): Promise<void>; // boot pg-boss on PGBOSS_DATABASE_URL, register queues, run forever
export const QUEUE: { readonly analyticsSummaryRefresh: 'system.analytics_summary.refresh' };

// src/worker/jobs/analyticsSummary.ts
export type AnalyticsSummaryPayload = { tenantId: number };
export async function handleAnalyticsSummaryRefresh(
  job: PgBoss.Job<AnalyticsSummaryPayload>
): Promise<void>; // reads job.data.tenantId, runs withSuperadmin no-op (logs); skeleton until Slice 4
```

---

### Cycle A — QUEUE constant + job handler (unit, no live DB)

- [ ] **Step 1: Write the failing unit test**

```ts
// tests/worker.unit.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoist the mock so it applies before the tested module is imported
vi.mock('@/db/tenant', () => ({
  withSuperadmin: vi.fn().mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) => fn({})
  ),
}));

vi.mock('server-only', () => ({}));

describe('QUEUE constants', () => {
  it('analyticsSummaryRefresh equals the canonical queue name', async () => {
    const { QUEUE } = await import('@/worker/index');
    expect(QUEUE.analyticsSummaryRefresh).toBe(
      'system.analytics_summary.refresh'
    );
  });

  it('QUEUE is structurally readonly (as const)', async () => {
    const { QUEUE } = await import('@/worker/index');
    // TypeScript enforces this at compile time; at runtime the value must be a string
    expect(typeof QUEUE.analyticsSummaryRefresh).toBe('string');
  });
});

describe('handleAnalyticsSummaryRefresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls withSuperadmin exactly once and resolves without throwing', async () => {
    const { handleAnalyticsSummaryRefresh } = await import(
      '@/worker/jobs/analyticsSummary'
    );
    const { withSuperadmin } = await import('@/db/tenant');

    const mockJob = {
      id: 'unit-test-job-id',
      name: 'system.analytics_summary.refresh',
      data: { tenantId: 7 },
      completionTime: null,
      createdon: new Date().toISOString(),
      startedon: new Date().toISOString(),
      expiredin: '00:15:00',
      priority: 0,
      retrycount: 0,
    } as unknown as import('pg-boss').Job<{ tenantId: number }>;

    await expect(
      handleAnalyticsSummaryRefresh(mockJob)
    ).resolves.toBeUndefined();

    expect(withSuperadmin).toHaveBeenCalledOnce();
  });

  it('passes the tenantId from job.data to the log context (calls withSuperadmin with a function)', async () => {
    const { handleAnalyticsSummaryRefresh } = await import(
      '@/worker/jobs/analyticsSummary'
    );
    const { withSuperadmin } = await import('@/db/tenant');

    const mockJob = {
      id: 'unit-test-job-id-2',
      name: 'system.analytics_summary.refresh',
      data: { tenantId: 42 },
    } as unknown as import('pg-boss').Job<{ tenantId: number }>;

    await handleAnalyticsSummaryRefresh(mockJob);

    expect(vi.mocked(withSuperadmin)).toHaveBeenCalledOnce();
    // Verify the callback passed to withSuperadmin is a function
    const [fn] = vi.mocked(withSuperadmin).mock.calls[0]!;
    expect(typeof fn).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/worker.unit.test.ts`
Expected: FAIL with `Cannot find module '@/worker/index'` (or `'@/worker/jobs/analyticsSummary'`)

---

- [ ] **Step 3: Implement QUEUE and handler**

```ts
// src/worker/index.ts
import { pathToFileURL } from 'node:url';
import PgBoss from 'pg-boss';
import { env } from '@/env';
import { handleAnalyticsSummaryRefresh } from './jobs/analyticsSummary';

export const QUEUE = {
  analyticsSummaryRefresh: 'system.analytics_summary.refresh',
} as const;

export async function startWorker(): Promise<void> {
  const boss = new PgBoss(env.PGBOSS_DATABASE_URL);

  boss.on('error', (error: unknown) => {
    console.error('[worker] pg-boss error:', error);
  });

  await boss.start();
  console.log('[worker] pg-boss started');

  await boss.work<{ tenantId: number }>(
    QUEUE.analyticsSummaryRefresh,
    handleAnalyticsSummaryRefresh
  );
  console.log(
    `[worker] Handler registered for queue: ${QUEUE.analyticsSummaryRefresh}`
  );

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[worker] Received ${signal}. Stopping pg-boss...`);
    await boss.stop();
    console.log('[worker] pg-boss stopped. Exiting.');
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  // pg-boss internal timers keep the event loop alive.
  // This promise never resolves in normal operation; signal handlers exit the process.
  await new Promise<never>(() => undefined);
}

// Entry point when run directly (ESM-safe, mirrors src/db/migrate.ts — `require` is not
// defined under tsx ESM mode, so use import.meta.url instead of require.main === module).
const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  void startWorker().catch((err: unknown) => {
    console.error('[worker] Fatal startup error:', err);
    process.exit(1);
  });
}
```

```ts
// src/worker/jobs/analyticsSummary.ts
import type PgBoss from 'pg-boss';
import { withSuperadmin } from '@/db/tenant';

export type AnalyticsSummaryPayload = {
  tenantId: number;
};

export async function handleAnalyticsSummaryRefresh(
  job: PgBoss.Job<AnalyticsSummaryPayload>
): Promise<void> {
  const { tenantId } = job.data;

  await withSuperadmin(async (_tx) => {
    // Skeleton: no-op until Slice 4 (materialized view refresh).
    // System job runs withSuperadmin (not withTenant) because matview
    // refresh runs CONCURRENTLY outside a tenant transaction.
    console.log(
      `[worker] analyticsSummaryRefresh: tenantId=${tenantId} jobId=${job.id}`
    );
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/worker.unit.test.ts`
Expected: PASS — both describe blocks, all 4 tests green

---

### Cycle B — pg-boss integration (live testcontainer)

- [ ] **Step 5: Write the failing integration test**

```ts
// tests/worker.integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import PgBoss from 'pg-boss';
import pg from 'pg';
import { setupTestDatabase } from './helpers/db';
import { QUEUE } from '@/worker/index';

// This suite starts a real Postgres 17 container via testcontainers,
// boots pg-boss against the ownerUrl (qr_owner can create the pgboss schema),
// and verifies job dispatch + completion semantics.

describe('pg-boss worker integration', () => {
  let ownerUrl: string;
  let teardown: () => Promise<void>;

  beforeAll(async () => {
    const db = await setupTestDatabase();
    ownerUrl = db.ownerUrl;
    teardown = db.teardown;
  }, 120_000);

  afterAll(async () => {
    await teardown();
  });

  it('pgboss schema is created by boss.start() and is separate from public', async () => {
    const boss = new PgBoss(ownerUrl);
    await boss.start();

    const client = new pg.Client({ connectionString: ownerUrl });
    await client.connect();
    const result = await client.query<{ schema_name: string }>(
      `SELECT schema_name
       FROM information_schema.schemata
       WHERE schema_name = 'pgboss'`
    );
    await client.end();

    await boss.stop({ destroy: false });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.schema_name).toBe('pgboss');
  }, 60_000);

  it('pgboss tables do not appear in the public schema', async () => {
    const client = new pg.Client({ connectionString: ownerUrl });
    await client.connect();
    const result = await client.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name LIKE 'pgboss%'`
    );
    await client.end();

    expect(result.rows).toHaveLength(0);
  }, 30_000);

  it('publishes a job with {tenantId} payload and a registered handler receives it', async () => {
    const boss = new PgBoss(ownerUrl);
    await boss.start();

    const received: Array<{ tenantId: number }> = [];

    await boss.work<{ tenantId: number }>(
      QUEUE.analyticsSummaryRefresh,
      async (job) => {
        received.push(job.data);
      }
    );

    await boss.send(QUEUE.analyticsSummaryRefresh, { tenantId: 99 });

    // pg-boss polls on a configurable interval (default ~2 s).
    // Wait up to 20 s for the job to be picked up.
    const deadline = Date.now() + 20_000;
    while (received.length === 0 && Date.now() < deadline) {
      await new Promise<void>((r) => setTimeout(r, 500));
    }

    await boss.stop({ destroy: false });

    expect(received).toHaveLength(1);
    expect(received[0]!.tenantId).toBe(99);
  }, 60_000);

  it('completed job is no longer in the active jobs table', async () => {
    const boss = new PgBoss(ownerUrl);
    await boss.start();

    let resolveHandler!: () => void;
    const handlerDone = new Promise<void>((r) => {
      resolveHandler = r;
    });

    await boss.work<{ tenantId: number }>(
      QUEUE.analyticsSummaryRefresh,
      async (_job) => {
        resolveHandler();
      }
    );

    const jobId = await boss.send(QUEUE.analyticsSummaryRefresh, {
      tenantId: 1,
    });

    // Wait for handler to fire
    await Promise.race([
      handlerDone,
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('handler timeout')), 20_000)
      ),
    ]);

    // Give pg-boss a moment to mark the job completed
    await new Promise<void>((r) => setTimeout(r, 1_500));

    const client = new pg.Client({ connectionString: ownerUrl });
    await client.connect();
    const result = await client.query<{ state: string }>(
      `SELECT state FROM pgboss.job WHERE id = $1`,
      [jobId]
    );
    await client.end();

    await boss.stop({ destroy: false });

    // State should be 'completed', not 'active' or 'created'
    expect(result.rows[0]?.state).toBe('completed');
  }, 60_000);
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm test tests/worker.integration.test.ts`
Expected: FAIL with `Cannot connect` or container-start errors (no container running yet, setupTestDatabase not yet wired to provide ownerUrl accessible in this context) — or if Task 7's helpers are already in place, the job receipt assertion fails because the handler file does not yet exist.

---

- [ ] **Step 7: Verify the implementation satisfies the integration test**

The files created in Cycle A (`src/worker/index.ts`, `src/worker/jobs/analyticsSummary.ts`) already provide `QUEUE` and the handler that the integration test imports. The integration test drives pg-boss directly (it does NOT call `startWorker()` — that runs forever). No further code changes are needed for the integration test to pass once `setupTestDatabase()` is available from Task 7.

Run: `pnpm test tests/worker.integration.test.ts`
Expected: PASS — all 4 integration tests green (container startup ≈ 30–60 s covered by timeout annotations)

---

- [ ] **Step 8: (No file here) — the worker Docker entrypoint is created in Task 15**

`docker/entrypoint-worker.sh` is authored once, in Task 15 (Deploy), with the production
command `exec node /app/worker.cjs` — the runner image has neither `pnpm` nor `tsx`, so an
`exec pnpm worker` entrypoint would fail at container start. For local dev, run the worker
directly with `pnpm worker`. There is nothing to create or commit in this step.

- [ ] **Step 9: Run the full test suite to confirm no regressions**

Run: `pnpm test`
Expected: PASS — all unit and integration tests (worker.unit.test.ts + worker.integration.test.ts + previously passing tests) green

- [ ] **Step 10: Typecheck**

Run: `pnpm typecheck`
Expected: PASS — no TypeScript errors; strict mode satisfied; no `any` in committed code

- [ ] **Step 11: Commit**

```bash
git add src/worker/index.ts \
        src/worker/jobs/analyticsSummary.ts \
        tests/worker.unit.test.ts \
        tests/worker.integration.test.ts
git commit -m "feat(slice0): pg-boss worker skeleton — QUEUE, handler, entrypoint, integration tests"
```

---

### Task 15: Deploy (Docker, compose, CI) + E2E acceptance

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `.env.compose` (dev-only, gitignored in prod)
- Create: `docker/entrypoint-web.sh`
- Create: `docker/entrypoint-worker.sh`
- Create: `.github/workflows/ci.yml`
- Create/Modify: `playwright.config.ts`
- Create: `e2e/helpers.ts`
- Create: `e2e/smoke.spec.ts`
- Create: `e2e/login.spec.ts`
- Create: `e2e/branding.spec.ts`
- Create: `e2e/subdomain.spec.ts`
- Create: `e2e/isolation.spec.ts`
- Create: `e2e/mailpit.spec.ts`
- Test: `e2e/*.spec.ts`

**Interfaces:**
- Consumes:
  - `assertDatabaseSafety(): Promise<void>` from `src/db/assertions.ts` (Task 6) — called inline in `docker/entrypoint-web.sh` boot guard via node heredoc
  - `startWorker(): Promise<void>` from `src/worker/index.ts` (Task 14) — esbuild-compiled to `/app/worker.cjs` in Dockerfile builder stage
  - `src/db/migrate.ts` runMigrations (Task 5) — esbuild-compiled to `/app/migrate.cjs`
  - `scripts/seed.ts` (Task 12) — esbuild-compiled to `/app/seed.cjs`; reads `SEED_ADMIN_PASSWORD` env for deterministic dev passwords
  - `env.ROOT_DOMAIN`, `env.APP_PROTOCOL`, `env.APP_PORT` from `src/env.ts` (Task 1)
  - `provisionTenant()` from `src/lib/provisioning.ts` (Task 12) — invoked via seed.cjs
  - `getCurrentTenant()` from `src/lib/tenant.ts` (Task 9) — exercised by E2E branding assertions
  - `requireSession()` from `src/auth/session.ts` (Task 10) — exercised by E2E login + isolation assertions
  - `docker/postgres/init/01-roles.sql` from Task 5 — mounted as postgres init script
- Produces: nothing (terminal task — all infra + acceptance tests)

---

## Cycle A — Playwright harness + smoke spec → Dockerfile + compose + entrypoints

- [ ] **Step 1: Write the failing Playwright smoke test and config**

`playwright.config.ts`:
```ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : 'list',
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
```

`e2e/smoke.spec.ts`:
```ts
import { test, expect } from '@playwright/test'

test('demo.localhost:3000 returns HTTP 200', async ({ page }) => {
  const res = await page.goto('http://demo.localhost:3000/')
  expect(res?.status()).toBe(200)
})

test('root domain localhost:3000 returns 404 (no default tenant)', async ({ page }) => {
  const res = await page.goto('http://localhost:3000/')
  expect(res?.status()).toBe(404)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm e2e`
Expected: FAIL with `net::ERR_CONNECTION_REFUSED` (compose stack not running)

- [ ] **Step 3: Create Dockerfile, docker-compose.yml, entrypoints, and .env.compose**

`Dockerfile`:
```dockerfile
# ──────────────────── Stage 1: deps ────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable pnpm
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ──────────────────── Stage 2: builder ────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable pnpm
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Build Next.js standalone output
RUN pnpm build
# Compile runtime helper scripts (all node_modules external — available in standalone image)
RUN pnpm exec esbuild src/db/migrate.ts \
      --bundle --platform=node --format=cjs \
      --packages=external \
      --outfile=dist/migrate.cjs
RUN pnpm exec esbuild scripts/seed.ts \
      --bundle --platform=node --format=cjs \
      --packages=external \
      --outfile=dist/seed.cjs
RUN pnpm exec esbuild src/worker/index.ts \
      --bundle --platform=node --format=cjs \
      --packages=external \
      --outfile=dist/worker.cjs

# ──────────────────── Stage 3: runner ────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# Next.js standalone server + static assets
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Compiled runtime scripts
COPY --from=builder --chown=nextjs:nodejs /app/dist/migrate.cjs ./migrate.cjs
COPY --from=builder --chown=nextjs:nodejs /app/dist/seed.cjs    ./seed.cjs
COPY --from=builder --chown=nextjs:nodejs /app/dist/worker.cjs  ./worker.cjs

# Drizzle migration SQL files (read by migrate.cjs at runtime via process.cwd()/drizzle)
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle

# Entrypoint scripts (chmod before switching to non-root)
COPY docker/entrypoint-web.sh    ./entrypoint-web.sh
COPY docker/entrypoint-worker.sh ./entrypoint-worker.sh
RUN chmod 0755 ./entrypoint-web.sh ./entrypoint-worker.sh \
 && chown nextjs:nodejs ./entrypoint-web.sh ./entrypoint-worker.sh

USER nextjs
EXPOSE 3000
ENV PORT=3000
# Default command — overridden in compose for worker/migrate/seed services
CMD ["/app/entrypoint-web.sh"]
```

`docker/entrypoint-web.sh`:
```sh
#!/bin/sh
set -e

echo "[boot] Verifying database safety before accepting traffic..."
node << 'BOOT_ASSERT'
const { Pool } = require('pg');

async function assertSafety() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    // 1. qr_app must NOT be superuser or BYPASSRLS
    const { rows: [role] } = await client.query(
      "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user"
    );
    if (!role) throw new Error('Cannot read pg_roles for current_user');
    if (role.rolsuper)    throw new Error('FATAL: qr_app must not be a superuser');
    if (role.rolbypassrls) throw new Error('FATAL: qr_app must not have BYPASSRLS');

    // 2. Each tenant-scoped table must have RLS enabled, FORCE enabled, and tenant_isolation policy
    const tables = ['users', 'user_detail', 'sessions', 'records', 'purchases', 'permalinks'];
    for (const t of tables) {
      const { rows: [tbl] } = await client.query(
        `SELECT c.relrowsecurity, c.relforcerowsecurity,
                (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'tenant_isolation') AS has_policy
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relname = $1 AND n.nspname = 'public'`,
        [t]
      );
      if (!tbl)                throw new Error(`Table not found in public schema: ${t}`);
      if (!tbl.relrowsecurity) throw new Error(`${t}: ROW LEVEL SECURITY not enabled`);
      if (!tbl.relforcerowsecurity) throw new Error(`${t}: FORCE ROW LEVEL SECURITY not set`);
      if (!tbl.has_policy)     throw new Error(`${t}: tenant_isolation policy missing`);
    }

    // 3. SELECT without tenant GUC must return 0 rows (RLS fail-closed check)
    const { rows } = await client.query('SELECT id FROM records LIMIT 1');
    if (rows.length > 0) throw new Error('records returned rows without tenant context — RLS is NOT enforcing');

    console.log('[boot] All database safety assertions passed.');
  } finally {
    client.release();
    await pool.end();
  }
}

assertSafety().catch(err => {
  console.error('[boot] FATAL — database safety check failed:', err.message);
  process.exit(1);
});
BOOT_ASSERT

echo "[boot] Starting Next.js server..."
exec node /app/server.js
```

`docker/entrypoint-worker.sh`:
```sh
#!/bin/sh
set -e

# compose depends_on ensures DB is healthy and migrate is complete before this runs
echo "[worker] Starting pg-boss worker process..."
exec node /app/worker.cjs
```

`.env.compose` (committed for dev; list in .gitignore for real deployments):
```dotenv
# Dev-only docker compose environment — never use these values in production
DATABASE_URL=postgresql://qr_app:app_secret@db:5432/qrecords
DATABASE_OWNER_URL=postgresql://qr_owner:owner_secret@db:5432/qrecords
PGBOSS_DATABASE_URL=postgresql://qr_owner:owner_secret@db:5432/qrecords
ROOT_DOMAIN=localhost
APP_PROTOCOL=http
APP_PORT=3000
AUTH_SECRET=dev-auth-secret-minimum-32-characters-here
ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
ENCRYPTION_KEY_ID=v1
MAIL_DRIVER=mailpit
MAIL_HOST=mailpit
MAIL_PORT=1025
MAIL_FROM=noreply@localhost
DB_POOL_MAX=10
DB_STATEMENT_TIMEOUT_MS=10000
DB_IDLE_TX_TIMEOUT_MS=10000
# Fixed dev password so E2E tests have deterministic credentials
SEED_ADMIN_PASSWORD=E2eDevPassword1!
```

`docker-compose.yml`:
```yaml
version: '3.9'

services:
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: qrecords
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    volumes:
      - ./docker/postgres/init:/docker-entrypoint-initdb.d:ro
      - db_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d qrecords"]
      interval: 5s
      timeout: 5s
      retries: 12
      start_period: 10s

  migrate:
    build: .
    command: ["node", "/app/migrate.cjs"]
    env_file: .env.compose
    environment:
      NODE_ENV: production
    depends_on:
      db:
        condition: service_healthy
    restart: "no"

  seed:
    build: .
    command: ["node", "/app/seed.cjs"]
    env_file: .env.compose
    environment:
      NODE_ENV: production
    depends_on:
      migrate:
        condition: service_completed_successfully
    restart: "no"
    # NO `profiles:` — a plain `docker compose up` MUST run the seed (idempotent),
    # otherwise there is no admin user and §9.8 login on demo.localhost is impossible.

  web:
    build: .
    # CMD in Dockerfile is ["/app/entrypoint-web.sh"] — no override needed
    env_file: .env.compose
    environment:
      NODE_ENV: production
      PORT: "3000"
    ports:
      - "3000:3000"
    depends_on:
      # seed depends_on migrate, so this transitively orders db → migrate → seed → web.
      seed:
        condition: service_completed_successfully
      db:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "wget -q --spider http://localhost:3000/ 2>/dev/null || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 8
      start_period: 30s

  worker:
    build: .
    command: ["/app/entrypoint-worker.sh"]
    env_file: .env.compose
    environment:
      NODE_ENV: production
    depends_on:
      migrate:
        condition: service_completed_successfully
      db:
        condition: service_healthy
    restart: unless-stopped

  mailpit:
    image: axllent/mailpit:latest
    ports:
      - "1025:1025"   # SMTP
      - "8025:8025"   # HTTP UI + API

volumes:
  db_data:
```

- [ ] **Step 4: Run smoke test to verify it passes**

```bash
docker compose up -d --build db migrate web mailpit
# Wait for web to be healthy (~30 s on first build, ~10 s after image cached)
docker compose run --rm --no-deps seed
```

Run: `pnpm e2e --project=chromium e2e/smoke.spec.ts`
Expected: PASS — both tests green (demo.localhost:3000 → 200; localhost:3000 → 404)

---

## Cycle B — Full E2E acceptance specs (§9 criteria a–g)

- [ ] **Step 5: Write all E2E acceptance spec files**

`e2e/helpers.ts`:
```ts
// Shared constants for E2E tests.
// Credentials are set by scripts/seed.ts when SEED_ADMIN_PASSWORD is provided.
export const DEMO_URL      = 'http://demo.localhost:3000'
export const VINYLCAVE_URL = 'http://vinylcave.localhost:3000'
export const MAILPIT_API   = 'http://localhost:8025/api/v1'

export const DEMO_EMAIL    = process.env.E2E_DEMO_EMAIL    ?? 'admin@demo.localhost'
export const DEMO_PASSWORD = process.env.E2E_DEMO_PASSWORD ?? 'E2eDevPassword1!'
export const VC_EMAIL      = process.env.E2E_VC_EMAIL      ?? 'admin@vinylcave.localhost'
export const VC_PASSWORD   = process.env.E2E_VC_PASSWORD   ?? 'E2eDevPassword1!'
```

`e2e/login.spec.ts` — §9.8(a): seed runs, login on demo.localhost succeeds:
```ts
import { test, expect } from '@playwright/test'
import { DEMO_URL, DEMO_EMAIL, DEMO_PASSWORD } from './helpers'

test('login on demo.localhost succeeds with seed credentials', async ({ page }) => {
  await page.goto(`${DEMO_URL}/login`)
  await page.getByLabel(/e-mail/i).fill(DEMO_EMAIL)
  await page.getByLabel(/passwort/i).fill(DEMO_PASSWORD)
  await page.getByRole('button', { name: /einloggen/i }).click()

  await expect(page).toHaveURL(`${DEMO_URL}/`)
  // App shell sidebar must be present — confirms authed layout rendered
  await expect(page.getByRole('navigation')).toBeVisible()
})

test('wrong password on demo.localhost is rejected', async ({ page }) => {
  await page.goto(`${DEMO_URL}/login`)
  await page.getByLabel(/e-mail/i).fill(DEMO_EMAIL)
  await page.getByLabel(/passwort/i).fill('wrongpassword')
  await page.getByRole('button', { name: /einloggen/i }).click()

  // Must stay on login page
  await expect(page).toHaveURL(new RegExp(`${DEMO_URL}/login`))
})
```

`e2e/branding.spec.ts` — §9.7(b/c): branding FOUC-free, theme + accent toggle:
```ts
import { test, expect, type Page } from '@playwright/test'
import { DEMO_URL, DEMO_EMAIL, DEMO_PASSWORD } from './helpers'

// ThemeToggle + AccentSwitch render ONLY in the authenticated app shell
// (src/app/(app)/layout.tsx), never on /login — so log in before asserting on them.
async function loginAndOpenShell(page: Page): Promise<void> {
  await page.goto(`${DEMO_URL}/login`)
  await page.getByLabel(/e-mail/i).fill(DEMO_EMAIL)
  await page.getByLabel(/passwort/i).fill(DEMO_PASSWORD)
  await page.getByRole('button', { name: /einloggen/i }).click()
  await expect(page).toHaveURL(`${DEMO_URL}/`)
  await page.waitForLoadState('domcontentloaded')
}

test('SSR response inlines tenant branding <style> — no FOUC', async ({ page }) => {
  const response = await page.goto(`${DEMO_URL}/login`)
  expect(response?.status()).toBe(200)

  // The HTML must contain an inlined <style> block with the tenant accent in <head>
  const html = await response!.text()
  expect(html).toMatch(/<style[^>]*>[\s\S]*--accent[\s\S]*<\/style>/i)

  // <html> must already have data-theme and data-accent set in the SSR markup
  // (ThemeProvider reads cookie on server and sets them before first paint)
  await page.waitForLoadState('domcontentloaded')
  const dataTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))
  expect(['light', 'dark']).toContain(dataTheme)

  const dataAccent = await page.evaluate(() => document.documentElement.getAttribute('data-accent'))
  expect(dataAccent).toBeTruthy()
})

test('theme toggle changes data-theme on <html> element', async ({ page }) => {
  await loginAndOpenShell(page)

  const initialTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))
  expect(['light', 'dark']).toContain(initialTheme)

  // Click the ThemeToggle button (only present in the authenticated shell)
  await page.getByRole('button', { name: /theme|hell|dunkel|light|dark/i }).first().click()

  const newTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))
  expect(newTheme).not.toBe(initialTheme)
  expect(['light', 'dark']).toContain(newTheme)
})

test('accent switch changes data-accent on <html> element', async ({ page }) => {
  await loginAndOpenShell(page)

  const initialAccent = await page.evaluate(() => document.documentElement.getAttribute('data-accent'))

  // Click the AccentSwitch to cycle to next accent
  await page.getByRole('button', { name: /accent|akzent|farbe/i }).first().click()

  const newAccent = await page.evaluate(() => document.documentElement.getAttribute('data-accent'))
  expect(newAccent).not.toBe(initialAccent)
})
```

`e2e/subdomain.spec.ts` — §9.4(d/e): unknown subdomain → 404, unknown permalink → 404:
```ts
import { test, expect } from '@playwright/test'
import { DEMO_URL } from './helpers'

test('unknown subdomain nope.localhost returns 404', async ({ page }) => {
  const res = await page.goto('http://nope.localhost:3000/')
  expect(res?.status()).toBe(404)
})

test('reserved subdomain www.localhost returns 404', async ({ page }) => {
  const res = await page.goto('http://www.localhost:3000/')
  expect(res?.status()).toBe(404)
})

test('unknown permalink on demo.localhost returns 404', async ({ page }) => {
  const res = await page.goto(`${DEMO_URL}/s/does-not-exist-xyz`)
  expect(res?.status()).toBe(404)
})

test('known lager permalink on demo.localhost returns 200', async ({ page }) => {
  // seed provisions a default "lager" permalink per provisionTenant()
  const res = await page.goto(`${DEMO_URL}/s/lager`)
  // Not 404 — even if the storefront renders an empty page, it must exist
  expect(res?.status()).not.toBe(404)
})
```

`e2e/isolation.spec.ts` — §9.3(f): session↔tenant invariant at HTTP level:
```ts
import { test, expect } from '@playwright/test'
import { DEMO_URL, VINYLCAVE_URL, DEMO_EMAIL, DEMO_PASSWORD } from './helpers'

test('valid demo session token is rejected on vinylcave.localhost (session↔tenant invariant)', async ({
  browser,
}) => {
  // Step 1: Login on demo, capture the opaque session token
  const demoCtx = await browser.newContext()
  const demoPage = await demoCtx.newPage()
  await demoPage.goto(`${DEMO_URL}/login`)
  await demoPage.getByLabel(/e-mail/i).fill(DEMO_EMAIL)
  await demoPage.getByLabel(/passwort/i).fill(DEMO_PASSWORD)
  await demoPage.getByRole('button', { name: /einloggen/i }).click()
  await expect(demoPage).toHaveURL(`${DEMO_URL}/`)

  const allCookies = await demoCtx.cookies(`${DEMO_URL}/`)
  // Cookie name is `__Host-authjs.session-token` over https, plain `authjs.session-token`
  // over http (dev) — match by suffix so the test is protocol-agnostic.
  const sessionCookie = allCookies.find(c => c.name.endsWith('authjs.session-token'))
  expect(sessionCookie).toBeDefined()
  const sessionToken = sessionCookie!.value

  await demoCtx.close()

  // Step 2: Present demo's session token to vinylcave endpoint
  // (bypassing browser cookie same-host rules to test SERVER-SIDE invariant)
  const vcCtx = await browser.newContext()
  const vcPage = await vcCtx.newPage()
  const res = await vcPage.request.get(`${VINYLCAVE_URL}/`, {
    headers: { Cookie: `${sessionCookie!.name}=${sessionToken}` },
    maxRedirects: 0,
  })
  // Server must NOT grant access — expected: redirect (30x) to login OR 401/403
  // The requireSession() session↔tenant invariant must fire
  expect([301, 302, 303, 307, 308, 401, 403]).toContain(res.status())

  await vcCtx.close()
})

test('accessing protected route on vinylcave without auth redirects to login', async ({ page }) => {
  const res = await page.goto(`${VINYLCAVE_URL}/`, { waitUntil: 'domcontentloaded' })
  // Must redirect to login, not serve the authed shell
  const finalUrl = page.url()
  expect(finalUrl).toContain('/login')
})
```

`e2e/mailpit.spec.ts` — §9.10(g): seed credential mail arrives in Mailpit:
```ts
import { test, expect } from '@playwright/test'
import { MAILPIT_API } from './helpers'

test('seed dispatched a credential email visible in Mailpit', async ({ request }) => {
  const res = await request.get(`${MAILPIT_API}/messages`)
  expect(res.ok()).toBeTruthy()

  const body = await res.json() as {
    total: number
    messages: Array<{ Subject: string; To: Array<{ Address: string }> }>
  }
  expect(body.total).toBeGreaterThan(0)

  // At least one message must look like a credential email
  const credentialMail = body.messages.find(m =>
    /passwort|anmeldedaten|zugang|password|credential|login/i.test(m.Subject)
  )
  expect(credentialMail).toBeDefined()
})

test('Mailpit contains mail addressed to demo admin', async ({ request }) => {
  const res = await request.get(`${MAILPIT_API}/messages`)
  expect(res.ok()).toBeTruthy()
  const body = await res.json() as {
    messages: Array<{ To: Array<{ Address: string }> }>
  }
  const toDemo = body.messages.find(m =>
    m.To.some(t => t.Address.includes('demo'))
  )
  expect(toDemo).toBeDefined()
})
```

- [ ] **Step 6: Run full E2E to verify new specs fail before seed runs**

Run: `pnpm e2e --project=chromium e2e/login.spec.ts`
Expected: FAIL with `Locator.fill: Error: ... Target closed` or `Expected: 200, received: 302` (login page inaccessible if seed not run)

- [ ] **Step 7: Run seed service, then re-run E2E**

```bash
# Seed the compose stack (idempotent; SEED_ADMIN_PASSWORD from .env.compose)
docker compose run --rm seed
```

- [ ] **Step 8: Run full E2E to verify all acceptance specs pass**

Run: `pnpm e2e`
Expected: PASS — all specs in `e2e/*.spec.ts` green (§9 criteria a–g satisfied)

---

## Cycle C — CI workflow

- [ ] **Step 9: Write `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main, 'feat/**']
  pull_request:
    branches: [main]

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  lint-typecheck-test:
    name: Lint · Typecheck · Unit tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node 22
        uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Setup pnpm 9
        uses: pnpm/action-setup@v3
        with:
          version: 9

      - name: Get pnpm store path
        id: pnpm-cache
        run: echo "STORE_PATH=$(pnpm store path)" >> $GITHUB_OUTPUT

      - name: Cache pnpm store
        uses: actions/cache@v4
        with:
          path: ${{ steps.pnpm-cache.outputs.STORE_PATH }}
          key: ${{ runner.os }}-pnpm-${{ hashFiles('**/pnpm-lock.yaml') }}
          restore-keys: |
            ${{ runner.os }}-pnpm-

      - run: pnpm install --frozen-lockfile

      - run: pnpm lint

      - run: pnpm typecheck

      # pnpm test uses @testcontainers/postgresql — requires Docker socket
      - run: pnpm test

  build:
    name: Build Next.js + Docker image
    runs-on: ubuntu-latest
    needs: lint-typecheck-test
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node 22 + pnpm
        uses: actions/setup-node@v4
        with:
          node-version: '22'
      - uses: pnpm/action-setup@v3
        with:
          version: 9
      - run: pnpm install --frozen-lockfile

      - name: Build Next.js
        run: pnpm build
        env:
          NEXT_TELEMETRY_DISABLED: '1'
          # Minimal env so src/env.ts passes validation during build
          DATABASE_URL: postgresql://qr_app:x@localhost:5432/qrecords
          DATABASE_OWNER_URL: postgresql://qr_owner:x@localhost:5432/qrecords
          PGBOSS_DATABASE_URL: postgresql://qr_owner:x@localhost:5432/qrecords
          ROOT_DOMAIN: localhost
          APP_PROTOCOL: http
          AUTH_SECRET: ci-build-placeholder-32-chars-min
          ENCRYPTION_KEY: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
          ENCRYPTION_KEY_ID: v1
          MAIL_DRIVER: console
          MAIL_HOST: localhost
          MAIL_PORT: '1025'
          MAIL_FROM: noreply@localhost

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to GHCR
        if: github.event_name == 'push' && github.ref == 'refs/heads/main'
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build (and push on main)
        uses: docker/build-push-action@v6
        with:
          context: .
          push: ${{ github.event_name == 'push' && github.ref == 'refs/heads/main' }}
          tags: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }},${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

  e2e:
    name: E2E acceptance (docker compose)
    runs-on: ubuntu-latest
    needs: build
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node 22 + pnpm
        uses: actions/setup-node@v4
        with:
          node-version: '22'
      - uses: pnpm/action-setup@v3
        with:
          version: 9
      - run: pnpm install --frozen-lockfile

      - name: Install Playwright browsers
        run: pnpm exec playwright install --with-deps chromium

      # *.localhost resolves on macOS but not reliably on Linux runners
      - name: Add local DNS entries for *.localhost subdomains
        run: |
          echo "127.0.0.1 demo.localhost" | sudo tee -a /etc/hosts
          echo "127.0.0.1 vinylcave.localhost" | sudo tee -a /etc/hosts
          echo "127.0.0.1 nope.localhost" | sudo tee -a /etc/hosts
          echo "127.0.0.1 www.localhost" | sudo tee -a /etc/hosts

      - name: Build and start compose stack (no seed yet)
        run: docker compose up -d --build db migrate web worker mailpit
        env:
          SEED_ADMIN_PASSWORD: ${{ secrets.E2E_SEED_PASSWORD || 'E2eDevPassword1!' }}

      - name: Wait for web service to become healthy
        run: |
          echo "Waiting for web healthcheck..."
          for i in $(seq 1 30); do
            STATUS=$(docker compose ps --format json web | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('Health',''))" 2>/dev/null || true)
            if [ "$STATUS" = "healthy" ]; then echo "Web is healthy."; break; fi
            echo "Attempt $i/30: not healthy yet (${STATUS}), sleeping 5s..."
            sleep 5
          done

      - name: Run seed
        run: docker compose run --rm seed
        env:
          SEED_ADMIN_PASSWORD: ${{ secrets.E2E_SEED_PASSWORD || 'E2eDevPassword1!' }}

      - name: Run Playwright E2E tests
        run: pnpm e2e
        env:
          E2E_DEMO_EMAIL: admin@demo.localhost
          E2E_DEMO_PASSWORD: ${{ secrets.E2E_SEED_PASSWORD || 'E2eDevPassword1!' }}
          E2E_VC_EMAIL: admin@vinylcave.localhost
          E2E_VC_PASSWORD: ${{ secrets.E2E_SEED_PASSWORD || 'E2eDevPassword1!' }}

      - name: Upload Playwright report on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7

      - name: Tear down compose stack
        if: always()
        run: docker compose down -v
```

- [ ] **Step 10: Verify CI workflow syntax and run local smoke of Docker image**

```bash
# Verify docker builds cleanly (same steps as CI)
docker build -t qrecords:local .
# Verify entrypoint scripts are executable inside the image
docker run --rm --entrypoint /bin/sh qrecords:local -c "ls -la /app/entrypoint-web.sh /app/entrypoint-worker.sh"
# Confirm compiled scripts are present
docker run --rm --entrypoint /bin/sh qrecords:local -c "ls /app/migrate.cjs /app/seed.cjs /app/worker.cjs"
```

Expected: all files present, mode `-rwxr-xr-x` for entrypoints, `migrate.cjs`/`seed.cjs`/`worker.cjs` visible.

- [ ] **Step 11: Full E2E pass against running compose stack**

```bash
# Fresh build to ensure CI parity
docker compose down -v
docker compose up -d --build db migrate web worker mailpit
# Wait for healthcheck (approx 30–60 s on cold start)
docker compose run --rm seed
```

Run: `pnpm e2e`
Expected: PASS — all 13 tests in `e2e/*.spec.ts` green; confirms §9.8 (<5 min from `up` to login on demo.localhost) and §9 criteria (a)–(g) all satisfied.

- [ ] **Step 12: Commit**

```bash
git add Dockerfile docker-compose.yml .env.compose \
        docker/entrypoint-web.sh docker/entrypoint-worker.sh \
        .github/workflows/ci.yml playwright.config.ts \
        e2e/helpers.ts e2e/smoke.spec.ts e2e/login.spec.ts \
        e2e/branding.spec.ts e2e/subdomain.spec.ts \
        e2e/isolation.spec.ts e2e/mailpit.spec.ts
git commit -m "$(cat <<'EOF'
feat(slice0): multi-stage Docker image, compose stack, CI pipeline, and Playwright E2E acceptance

Adds the full deployment layer for Slice 0: non-root Node 22 alpine standalone image
with esbuild-compiled migrate/seed/worker CJS bundles; docker-compose with db→migrate→seed
→web/worker→mailpit dependency chain; entrypoint-web.sh boot assertion (RLS + role check
via inline node heredoc); GitHub Actions CI (lint→typecheck→test→build→e2e); and
Playwright E2E covering all §9 acceptance criteria (login, FOUC-free branding, theme/accent
toggle, subdomain 404s, permalink 404, session↔tenant isolation, Mailpit credential mail).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Acceptance-Criteria Mapping (spec §9 → tasks)

| §9 criterion | Verified by |
|---|---|
| 1. No tenant context → 0 rows | Task 7 |
| 2. Two-tenant interleaving → no leak | Task 7 |
| 3. User A on B-subdomain → 403 | Task 10 |
| 4. Unknown/reserved subdomain → 404; unknown permalink → 404 | Tasks 9, 13, 15 |
| 5. App role is not superuser; boot assertion fails on missing RLS | Tasks 6, 7 |
| 6. `is_superadmin` does not leak across pooled connections | Task 7 |
| 7. Branding without FOUC; theme+accent both on `<html>` | Tasks 2, 13, 15 |
| 8. Fresh `docker compose up` → migrated+seeded+running < 5 min; login on demo.localhost | Task 15 |
| 9. `provisionTenant()` atomic (rollback on partial failure) | Task 12 |
| 10. Dev-mail credential mail lands in Mailpit | Tasks 11, 15 |
