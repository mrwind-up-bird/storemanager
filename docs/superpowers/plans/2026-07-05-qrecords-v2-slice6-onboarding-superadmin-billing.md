# Q-Records v2 — Slice 6: Onboarding + Superadmin + Billing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Slice 6 macht aus der Einzel-Shop-App ein betreibbares Multi-Tenant-SaaS: Platform-Zone unter `admin.<ROOT_DOMAIN>` (eigener Superadmin-Login, Tenant-Provisioning-UI), Billing hinter `BILLING_DRIVER=fake|stripe`, serverseitiges Feature-Gating (Limits + Modul-Gates), erzwungener Passwortwechsel + 4-Schritt-Onboarding-Wizard, `/einstellungen` mit Tabs Info/Discogs/Team/Abo.

**Architecture:** Getrennte Platform-Identität (Ansatz A): Registry-Tabellen `platform_users`/`platform_sessions` ohne Tenant-RLS und **ohne qr_app-Grants** (Zugriff ausschließlich `withOwner()`), eigener schlanker Session-Mechanismus (bcrypt + opakes Token + Cookie, 24 h) — Auth.js bleibt exklusiv für Tenants. Middleware bekommt einen Platform-Zweig (Rewrite `admin.<host>/*` → `/platform/*`); `subscriptions` ist voll tenant-RLS-geschützt; Gating-Autorität ist ausschließlich `tenants.plan`; Kapazitäts-Checks laufen **innerhalb** der bestehenden `withTenant`-Transaktionen von `performAnkauf`/`createCollection`.

**Tech Stack:** Next.js 15 App Router (params/searchParams als Promises, `forbidden()`), React 19, TS strict, Drizzle ORM 0.38, PostgreSQL 17 FORCE RLS, Auth.js v5 (nur Tenant), `stripe` npm (neu), Vitest 2.1.9 + Testcontainers, Playwright (workers:1, serial).

**Spec:** `docs/superpowers/specs/2026-07-05-qrecords-v2-slice6-onboarding-superadmin-billing-design.md`
**Contracts:** `docs/superpowers/plans/2026-07-05-qrecords-v2-slice6-onboarding-superadmin-billing-CONTRACTS.md` (C1–C12 — bindende Schnittstellen zwischen den Tasks)

## Global Constraints

Diese Regeln gelten für JEDEN Task dieses Plans (aus Spec §13, bindend):

1. RLS-Isolation ausschließlich via `withTenant`/`withSuperadmin`/`withOwner` (`src/db/tenant.ts`); `subscriptions` voll tenant-RLS-geschützt (ENABLE+FORCE, `tenant_isolation`+`superadmin_bypass`, NULLIF-GUC-Default); `platform_users`/`platform_sessions`/`webhook_events` haben **kein** `tenant_id`, **keine** RLS und **keine** qr_app-Grants — Zugriff nur über `withOwner()`.
2. Jede mutierende Action (Tenant **und** Platform): Session-Pflicht → Rollen-Gate → Origin-CSRF (`isValidOrigin()`) → zod → Delegation. `kunde` bleibt von allen neuen Mutationen ausgeschlossen (`forbidden()`).
3. Platform-Zone nur über `admin.<ROOT_DOMAIN>` erreichbar; `/platform`/`/platform/*` auf **jedem** Host direkt 404 (nur der Middleware-Rewrite erreicht die Zone); `x-platform-zone` wird wie `x-tenant-slug` auf jedem Pfad gegen Client-Spoofing gestrippt. Fail-closed bleibt: unbekannte Hosts 404, kein Default-Tenant.
4. Server ist Preisautorität: Checkout entsteht aus `plans.stripePriceId`; der Client liefert nur Plan-Slugs. Geldbeträge bleiben Integer-Cents (`priceMonthlyCents`), niemals Float.
5. Webhook: Signaturprüfung vor jeder Verarbeitung, Event-Dedup über `webhook_events` (id = Provider-Event-Id), Owner-Kontext nur innerhalb des Handlers, keine internen Details in Responses.
6. Secrets: Discogs-Token weiterhin AES-256-GCM mit Tenant-AAD (`encryptSecret`), nie im Klartext angezeigt oder geloggt; `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` nur serverseitig (`src/env.ts`, `server-only`).
7. Gating wird an den Actions erzwungen, nie nur in der UI; `getEntitlements` fällt bei unbekanntem Plan fail-closed auf die Free-Matrix zurück. Exakte Fehlertexte: siehe CONTRACTS C8.
8. Kein Kunden-PII in der Platform-Zone über Aggregatzahlen hinaus; EK/`purchasePrice` bleibt server-intern; keine Kundendaten/Verkaufsinterna an `kunde`/Storefront.
9. Temporäre Passwörter: einmalige Anzeige (Provisioning-UI) bzw. nur per Mail; `mustChangePassword`-Zwang für jeden Empfänger; bcrypt-Cost 12 überall (`hashPassword`), Dummy-Hash-Timing-Schutz bei jedem Credential-Vergleich.
10. UI deutsch, Design-System-Tokens (`--surface/-2/-3`, `--border/-strong`, `--accent`, `--on-accent`, `--accent-ink`, `--text/-2/-3`, `--r-md/-lg/-pill`, `--tap`, `--font-display`), Wizard-Stepper pixel-treu zum Handoff (30px-Kreise, 2px-Connectoren, Labels Info/Discogs/Admin/Review).
11. Prozess: Commits nur auf `feat/v2-slice6-onboarding-superadmin-billing`, nie auf `main`; `.superpowers/`, `.memory/letter_*.md`, `.codex/` niemals stagen; Commit-Messages enden mit `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
12. Gates: `pnpm lint` + `pnpm typecheck` grün; bestehende 643 Unit/Integration + 59 E2E bleiben grün; Desktop-≥768px-Verhalten bestehender Screens unverändert.

---

## Dateistruktur (Neu/Geändert — Locked-in Decomposition)

```
NEU:
  drizzle/0010_slice6_platform_billing.sql       (generiert via drizzle-kit)
  drizzle/0011_slice6_rls.sql                    (handgeschrieben: subscriptions-RLS + Grants)
  drizzle/0012_slice6_data.sql                   (handgeschrieben: Plan-Matrix + Onboarding-Backfill)
  src/lib/gating.ts                              (Entitlements, Merge, Kapazitäts-Checks)
  src/auth/platform.ts                           (Platform-Session: verify/create/get/require/destroy)
  src/lib/platform/tenants.ts                    (listTenantsWithStats, getTenantDetail)
  src/lib/billing/{types,fake,stripe,index,store,apply}.ts
  src/lib/tenant-settings.ts                     (updateTenantInfo, completeOnboarding)
  src/lib/team.ts                                (listTeamUsers, createTeamUser, resetTeamUserPassword)
  src/lib/account.ts                             (verifyAndChangePassword)
  src/app/platform/layout.tsx                    (Zone-Guard x-platform-zone)
  src/app/platform/login/{page.tsx,actions.ts}
  src/app/platform/(dashboard)/{layout.tsx,page.tsx,actions.ts}
  src/app/platform/(dashboard)/tenants/{actions.ts,neu/page.tsx,neu/CreateTenantForm.tsx,[id]/page.tsx,[id]/_components/*.tsx}
  src/app/api/billing/webhook/route.ts
  src/app/(app)/einstellungen/{page.tsx,actions.ts,_components/*.tsx}
  src/app/passwort/{page.tsx,actions.ts,ChangePasswordForm.tsx}
  src/app/onboarding/{page.tsx,actions.ts,_components/*.tsx}
  tests/slice6-migration.integration.test.ts · tests/gating.test.ts · tests/gating.integration.test.ts
  tests/platform-auth.integration.test.ts · tests/billing-fake.test.ts · tests/billing-stripe-mapping.test.ts
  tests/billing.integration.test.ts · tests/slice6-actions.integration.test.ts
  tests/wizard-stepper.test.tsx · tests/einstellungen-tabs.test.tsx · tests/env-billing.test.ts
  e2e/platform-billing.spec.ts

GEÄNDERT:
  src/db/schema.ts (+4 Tabellen, +3 Spalten) · src/db/assertions.ts (+'subscriptions')
  src/env.ts (+BILLING_*, parseEnv) · src/middleware.ts (+Platform-Zweig, +Webhook-Allow)
  src/lib/subdomain.ts (+isPlatformHost) · src/lib/password.ts (+DUMMY_BCRYPT_HASH Export)
  src/auth/config.ts (Dummy-Hash-Import, +mustChangePassword) · src/auth/adapter.ts · src/auth/schema-types.ts · src/auth/session.ts
  src/lib/provisioning.ts (+mustChangePassword, +Exports generateTempPassword/HEX_COLOR_REGEX)
  src/lib/tenant.ts (Tenant += onboardingCompletedAt) · src/lib/discogs/{types,client,fake}.ts (+identity())
  src/app/api/discogs/{_shared.ts,connect/route.ts,callback/route.ts} (+returnTo)
  src/lib/ankauf.ts + src/lib/collections.ts (+Entitlements-Param, Kapazitäts-Gate)
  src/app/(app)/ankauf/actions.ts + sammlung/actions.ts (+Gating) · src/app/(app)/analytik/page.tsx (+Upsell)
  src/app/(app)/layout.tsx (+Redirects, +lockedHrefs) · SidebarNav.tsx · BottomTabBar.tsx · MobileHeader.tsx
  scripts/seed.ts (demo→big, +freeshop, +Platform-User, +Onboarded-Marker) · e2e/helpers.ts
  package.json (+stripe) · .env.example · .env.compose (+BILLING_DRIVER)
```

**Task-Reihenfolge (strikt sequenziell):** T1 → T2 → … → T13. Jeder Task endet mit grünem `pnpm lint && pnpm typecheck` + den genannten Tests + einem Commit.

---

### Task 1: DB-Fundament — Schema, Migrationen 0010/0011/0012, Boot-Assertion, Provisioning-Flag

**Files:**
- Modify: `src/db/schema.ts`
- Create: `drizzle/0010_slice6_platform_billing.sql` (via `pnpm db:generate`)
- Create: `drizzle/0011_slice6_rls.sql`
- Create: `drizzle/0012_slice6_data.sql`
- Modify: `drizzle/meta/_journal.json` (Einträge idx 11, 12)
- Modify: `src/db/assertions.ts:5-19` (TENANT_SCOPED_TABLES)
- Modify: `src/lib/provisioning.ts` (mustChangePassword + Exporte)
- Modify: `src/lib/tenant.ts` (Tenant-Typ + Mapping)
- Test: `tests/slice6-migration.integration.test.ts`

**Interfaces:**
- Consumes: bestehendes Schema (`tenants`, `plans`, `users`), RLS-Muster aus `drizzle/0009_slice4_rls.sql`, `withOwner`.
- Produces (für alle Folge-Tasks): Drizzle-Exporte `platformUsers`, `platformSessions`, `subscriptions`, `webhookEvents`; Spalten `plans.stripePriceId: text|null`, `users.mustChangePassword: boolean NOT NULL DEFAULT false`, `tenants.onboardingCompletedAt: timestamptz|null`; `Tenant.onboardingCompletedAt: Date | null` (src/lib/tenant.ts); Exporte `generateTempPassword(): string` und `HEX_COLOR_REGEX` aus `src/lib/provisioning.ts`.

- [ ] **Step 1: Schema erweitern**

In `src/db/schema.ts` — Registry-Block (nach `plans`, vor dem Tenant-scoped-Kommentar) einfügen:

```ts
// ── Slice 6: Platform-Identität + Webhook-Dedup (Registry, KEINE Tenant-RLS,
//    KEINE qr_app-Grants — Zugriff ausschließlich via withOwner(), Spec §5/§8) ──

export const platformUsers = pgTable('platform_users', {
  id: serial('id').primaryKey(),
  email: text('email').unique().notNull(),
  /** bcrypt-Hash, Cost 12 (hashPassword) */
  password: text('password').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const platformSessions = pgTable('platform_sessions', {
  token: text('token').primaryKey(),
  platformUserId: integer('platform_user_id')
    .notNull()
    .references(() => platformUsers.id),
  expires: timestamp('expires', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const webhookEvents = pgTable('webhook_events', {
  /** Provider-Event-Id (Stripe event.id) — PK = Dedup-Schlüssel (Spec §9.2) */
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow(),
});
```

Am Ende der Datei (nach `wishlistMatches`) den Tenant-scoped-Block einfügen:

```ts
// ── Slice 6: Abo-Zeile (tenant-scoped, RLS in 0011_slice6_rls.sql) ───────────
// Genau ein Abo pro Tenant (UNIQUE tenant_id). Free-Plan = keine Zeile.
// `status` ist informativ fürs UI — Gating-Autorität ist ausschließlich tenants.plan.

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    stripeCustomerId: text('stripe_customer_id').notNull(),
    stripeSubscriptionId: text('stripe_subscription_id').notNull(),
    planSlug: text('plan_slug')
      .notNull()
      .references(() => plans.slug),
    status: text('status').notNull(),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    tenantUnique: unique('subscriptions_tenant').on(t.tenantId),
  }),
);
```

Bestehende Tabellen erweitern — in `plans` nach `features`:

```ts
  /** Stripe Price-Id (Test-Mode). NULL beim Fake-Driver — der ignoriert sie. */
  stripePriceId: text('stripe_price_id'),
```

In `users` nach `isSuperadmin`:

```ts
  /** Erzwingt /passwort beim nächsten Login (Provisioning/Team-Anlage/Credentials-Resend). */
  mustChangePassword: boolean('must_change_password').notNull().default(false),
```

In `tenants` nach `limits`:

```ts
  /** NULL = Onboarding-Wizard noch offen (nur neu provisionierte Tenants). */
  onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),
```

- [ ] **Step 2: DDL-Migration generieren**

Run: `pnpm db:generate --name slice6_platform_billing`
Expected: neue Datei `drizzle/0010_slice6_platform_billing.sql` + automatischer Journal-Eintrag idx 10. Inhalt prüfen — MUSS enthalten: `CREATE TABLE "platform_users"`, `CREATE TABLE "platform_sessions"`, `CREATE TABLE "webhook_events"`, `CREATE TABLE "subscriptions"` (mit `CONSTRAINT "subscriptions_tenant" UNIQUE("tenant_id")`), `ALTER TABLE "plans" ADD COLUMN "stripe_price_id" text`, `ALTER TABLE "users" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL`, `ALTER TABLE "tenants" ADD COLUMN "onboarding_completed_at" timestamp with time zone`, plus die FK-Constraints. Nichts anderes darf drin sein (kein Drift aus fremden Tabellen) — sonst Schema-Änderung prüfen.

- [ ] **Step 3: RLS-Migration 0011 schreiben**

Create `drizzle/0011_slice6_rls.sql` (Muster = `drizzle/0009_slice4_rls.sql`):

```sql
-- Row-Level Security für die Slice-6-Tabelle `subscriptions`. drizzle-kit verwaltet kein RLS,
-- daher handgeschrieben + manuell in meta/_journal.json registriert (idx 11).
-- Gleiche Form wie 0009_slice4_rls.sql: ENABLE + FORCE RLS, tenant_id-Default aus dem
-- request-scoped GUC (NULLIF-guarded), tenant_isolation + superadmin_bypass, DML-Grant +
-- Sequence-Grant an qr_app (der Sequence-Grant ist load-bearing — INSERT schlägt sonst fehl).
--
-- BEWUSST KEINE Grants für platform_users / platform_sessions / webhook_events:
-- Diese Registry-Tabellen werden ausschließlich über withOwner() (qr_owner) angesprochen.
-- qr_app hat darauf weder SELECT noch DML — enger als die Spec fordert (Defence-in-Depth).
-- Die Boot-Assertion braucht KEINE Ausnahmeliste: sie introspiziert nur Tabellen MIT
-- tenant_id-Spalte, und die drei Registry-Tabellen haben keine.

ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "subscriptions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "tenant_id" SET DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::int;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "subscriptions"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int);
--> statement-breakpoint
CREATE POLICY "superadmin_bypass" ON "subscriptions"
  USING (current_setting('app.is_superadmin', true) = 'true')
  WITH CHECK (current_setting('app.is_superadmin', true) = 'true');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "subscriptions" TO qr_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "subscriptions_id_seq" TO qr_app;
```

- [ ] **Step 4: Daten-Migration 0012 schreiben**

Create `drizzle/0012_slice6_data.sql`:

```sql
-- Slice-6-Daten-Migration (idempotent):
-- 1. Plan-Matrix (Spec §10) — überschreibt die Slice-0-Keys {records, discogs} mit der
--    Slice-6-Struktur {maxRecords, maxUsers} / {analytik, discogsListing}.
--    JSON null = unbegrenzt (big). Anzeigepreise; der abgerechnete Preis hängt am stripePriceId.
-- 2. onboarding_completed_at-Backfill: Bestands-Tenants sind längst konfiguriert und dürfen
--    beim nächsten Login NICHT in den Wizard laufen (Spec §8). Auf frischen DBs ein No-op.

INSERT INTO "plans" ("slug", "name", "price_monthly_cents", "limits", "features") VALUES
  ('free',  'Free',     0, '{"maxRecords": 100,  "maxUsers": 2}'::jsonb,    '{"analytik": false, "discogsListing": false}'::jsonb),
  ('small', 'Small', 1900, '{"maxRecords": 5000, "maxUsers": 10}'::jsonb,   '{"analytik": true,  "discogsListing": true}'::jsonb),
  ('big',   'Big',   4900, '{"maxRecords": null, "maxUsers": null}'::jsonb, '{"analytik": true,  "discogsListing": true}'::jsonb)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "price_monthly_cents" = EXCLUDED."price_monthly_cents",
  "limits" = EXCLUDED."limits",
  "features" = EXCLUDED."features";
--> statement-breakpoint
UPDATE "tenants" SET "onboarding_completed_at" = now() WHERE "onboarding_completed_at" IS NULL;
```

- [ ] **Step 5: Journal-Einträge für 0011/0012**

In `drizzle/meta/_journal.json` nach dem (von Step 2 erzeugten) idx-10-Eintrag zwei Einträge anhängen. `<WHEN10>` = der `when`-Wert des idx-10-Eintrags:

```json
    {
      "idx": 11,
      "version": "7",
      "when": <WHEN10 + 1>,
      "tag": "0011_slice6_rls",
      "breakpoints": true
    },
    {
      "idx": 12,
      "version": "7",
      "when": <WHEN10 + 2>,
      "tag": "0012_slice6_data",
      "breakpoints": true
    }
```

(Exakt das Muster von 0004→0005: `when` 1782797893072 → 1782797893073.)

- [ ] **Step 6: Boot-Assertion erweitern**

In `src/db/assertions.ts` die Konstante ergänzen (alphabetisch ans Ende der Liste):

```ts
const TENANT_SCOPED_TABLES = [
  'users',
  'user_detail',
  'sessions',
  'records',
  'purchases',
  'permalinks',
  'discogs_connections',
  'quick_items',
  'transactions',
  'transaction_items',
  'wishlists',
  'wishlist_matches',
  'collections',
  'subscriptions',
] as const;
```

WICHTIG (Spec-§8-Korrektur, im Spec-Amendment festgehalten): `platform_users`, `platform_sessions`, `webhook_events` kommen NICHT in diese Liste und brauchen KEINE Ausnahmeliste — der Drift-Guard introspiziert nur Tabellen mit `tenant_id`-Spalte, die diese drei nicht haben.

- [ ] **Step 7: provisionTenant — mustChangePassword + Exporte**

In `src/lib/provisioning.ts`:

1. `HEX_COLOR_REGEX` (Zeile 27) exportieren: `export const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;`
2. `generateTempPassword` (Zeile 65) exportieren: `export function generateTempPassword(): string { … }` (Body unverändert; wird von Platform-Resend T4 und Team-Anlage T8 wiederverwendet).
3. Im User-Insert (Zeile 156–164) das Flag ergänzen:

```ts
    const [newUser] = await tx
      .insert(users)
      .values({
        tenantId: newTenant.id,
        email: adminEmail,
        password: passwordHash,
        role: 'admin',
        isSuperadmin: false,
        // Generiertes temporäres Passwort ⇒ Zwangswechsel beim Erst-Login (Spec §11).
        // Explizit übergebenes Passwort (Seed) ⇒ kein Zwang.
        mustChangePassword: password === undefined,
      })
      .returning({ id: users.id });
```

- [ ] **Step 8: Tenant-Typ erweitern**

In `src/lib/tenant.ts`: im `Tenant`-Typ nach `limits` ergänzen:

```ts
  onboardingCompletedAt: Date | null;
```

Im Mapping von `getCurrentTenant` (return-Objekt) ergänzen:

```ts
      onboardingCompletedAt: row.onboardingCompletedAt ?? null,
```

- [ ] **Step 9: Integrationstest schreiben**

Create `tests/slice6-migration.integration.test.ts`:

```ts
// Slice 6 T1 — Migrations-Gate: neue Tabellen/Spalten, subscriptions-RLS nicht-vakuos,
// Registry-Tabellen OHNE qr_app-Zugriff, Boot-Assertion grün, Plan-Matrix neu.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { setupTestDatabase, seedTenant, type TestDatabase } from './helpers/db';

describe('slice6 migration (0010–0012)', () => {
  let db: TestDatabase;
  let owner: Pool;
  let tenantA: number;
  let tenantB: number;

  beforeAll(async () => {
    db = await setupTestDatabase();
    owner = new Pool({ connectionString: db.ownerUrl, max: 2 });
    const a = await seedTenant({ slug: 'sub-a', name: 'Sub A' });
    const b = await seedTenant({ slug: 'sub-b', name: 'Sub B' });
    tenantA = a.tenantId;
    tenantB = b.tenantId;
  }, 180_000);

  afterAll(async () => {
    await owner.end();
    await db.teardown();
  });

  it('legt die neuen Tabellen und Spalten an', async () => {
    const tables = await owner.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('platform_users','platform_sessions','webhook_events','subscriptions')`,
    );
    expect(tables.rows.map((r: { table_name: string }) => r.table_name).sort()).toEqual([
      'platform_sessions', 'platform_users', 'subscriptions', 'webhook_events',
    ]);
    const cols = await owner.query(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE (table_name = 'plans' AND column_name = 'stripe_price_id')
           OR (table_name = 'users' AND column_name = 'must_change_password')
           OR (table_name = 'tenants' AND column_name = 'onboarding_completed_at')`,
    );
    expect(cols.rows).toHaveLength(3);
  });

  it('plans trägt die Slice-6-Matrix (maxRecords/maxUsers, analytik/discogsListing)', async () => {
    const res = await owner.query(`SELECT slug, limits, features FROM plans ORDER BY slug`);
    const bySlug = Object.fromEntries(
      res.rows.map((r: { slug: string; limits: unknown; features: unknown }) => [r.slug, r]),
    ) as Record<string, { limits: Record<string, unknown>; features: Record<string, unknown> }>;
    expect(bySlug.free.limits).toEqual({ maxRecords: 100, maxUsers: 2 });
    expect(bySlug.free.features).toEqual({ analytik: false, discogsListing: false });
    expect(bySlug.small.limits).toEqual({ maxRecords: 5000, maxUsers: 10 });
    expect(bySlug.big.limits).toEqual({ maxRecords: null, maxUsers: null });
    expect(bySlug.big.features).toEqual({ analytik: true, discogsListing: true });
  });

  it('subscriptions-RLS ist nicht-vakuos: A sieht exakt seine Zeile, B exakt seine', async () => {
    await owner.query(
      `INSERT INTO subscriptions (tenant_id, stripe_customer_id, stripe_subscription_id, plan_slug, status)
       VALUES ($1, 'cus_a', 'sub_a', 'small', 'active'), ($2, 'cus_b', 'sub_b', 'big', 'active')`,
      [tenantA, tenantB],
    );
    const { withTenant } = await import('@/db/tenant');
    const { subscriptions } = await import('@/db/schema');
    const seenByA = await withTenant({ tenantId: tenantA, userId: null }, (tx) =>
      tx.select().from(subscriptions),
    );
    expect(seenByA).toHaveLength(1);
    expect(seenByA[0]!.stripeCustomerId).toBe('cus_a');
    const seenByB = await withTenant({ tenantId: tenantB, userId: null }, (tx) =>
      tx.select().from(subscriptions),
    );
    expect(seenByB).toHaveLength(1);
    expect(seenByB[0]!.stripeCustomerId).toBe('cus_b');
  });

  it('qr_app hat KEINEN Zugriff auf platform_users/platform_sessions/webhook_events', async () => {
    const app = new Pool({ connectionString: db.appUrl, max: 1 });
    try {
      for (const table of ['platform_users', 'platform_sessions', 'webhook_events']) {
        await expect(app.query(`SELECT count(*) FROM ${table}`)).rejects.toMatchObject({
          code: '42501', // insufficient_privilege
        });
      }
    } finally {
      await app.end();
    }
  });

  it('Boot-Assertion bleibt grün (Drift-Guard kennt subscriptions)', async () => {
    const { assertDatabaseSafety } = await import('@/db/assertions');
    await expect(assertDatabaseSafety()).resolves.toBeUndefined();
  });

  it('provisionTenant setzt mustChangePassword nur bei generiertem Passwort', async () => {
    const { provisionTenant } = await import('@/lib/provisioning');
    const gen = await provisionTenant({ slug: 'gen-pw', name: 'Gen', adminEmail: 'a@gen.test' });
    const explicit = await provisionTenant({
      slug: 'exp-pw', name: 'Exp', adminEmail: 'a@exp.test', password: 'ExplicitSeedPw1!',
    });
    const rows = await owner.query(
      `SELECT id, must_change_password FROM users WHERE id = ANY($1::int[]) ORDER BY id`,
      [[gen.adminUserId, explicit.adminUserId]],
    );
    const byId = Object.fromEntries(
      rows.rows.map((r: { id: number; must_change_password: boolean }) => [r.id, r.must_change_password]),
    );
    expect(byId[gen.adminUserId]).toBe(true);
    expect(byId[explicit.adminUserId]).toBe(false);
  });
});
```

- [ ] **Step 10: Tests ausführen**

Run: `pnpm test tests/slice6-migration.integration.test.ts`
Expected: PASS (6 Tests). Danach Regression: `pnpm test tests/migration.integration.test.ts tests/rls.integration.test.ts tests/provisioning.integration.test.ts` — Expected: PASS. Falls einer dieser Bestandstests Tabellen ENUMERIERT und wegen der 4 neuen Tabellen fehlschlägt: die erwartete Liste dort um die neuen Tabellen erweitern (Verhaltens-Assertions unverändert lassen).

- [ ] **Step 11: Lint/Typecheck + Commit**

Run: `pnpm lint && pnpm typecheck`
Expected: 0 Fehler.

```bash
git add src/db/schema.ts src/db/assertions.ts src/lib/provisioning.ts src/lib/tenant.ts drizzle/ tests/slice6-migration.integration.test.ts
git commit -m "feat(slice6): T1 DB-Fundament — platform_users/platform_sessions/webhook_events/subscriptions, Plan-Matrix, mustChangePassword, onboardingCompletedAt

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Gating-Bibliothek + Seed (demo→big, freeshop, Platform-User)

**Files:**
- Create: `src/lib/gating.ts`
- Modify: `scripts/seed.ts`
- Test: `tests/gating.test.ts` (pure Merge-Logik), `tests/gating.integration.test.ts` (Kapazitäts-Checks gegen echte DB), Erweiterung `tests/seed.integration.test.ts` NICHT anfassen — stattdessen neue Fälle in `tests/gating.integration.test.ts`.

**Interfaces:**
- Consumes: T1-Schema (`plans.limits/features` neue Keys, `tenants.limits`-Override, `subscriptions`), `withSuperadmin`/`withTenant`/`Tx` aus `src/db/tenant.ts`.
- Produces (bindend, CONTRACTS C7/C8/C11):
  - `type PlanLimits = { maxRecords: number | null; maxUsers: number | null }` (`null` = unbegrenzt)
  - `type PlanFeatures = { analytik: boolean; discogsListing: boolean }`
  - `type Entitlements = { plan: string; planName: string; priceMonthlyCents: number; limits: PlanLimits; features: PlanFeatures }`
  - `FREE_FALLBACK_ENTITLEMENTS: Entitlements`, `UNLIMITED_ENTITLEMENTS: Entitlements`
  - `class LimitExceededError extends Error { current: number; max: number }`
  - `mergeEntitlements(planRow, tenantOverrides): Entitlements` (pure)
  - `getEntitlements(tenantId: number): Promise<Entitlements>` (React `cache()`, fail-closed Free)
  - `checkRecordCapacity(tx: Tx, ent: Entitlements, addCount: number): Promise<void>` (wirft `LimitExceededError`)
  - `checkUserCapacity(tx: Tx, ent: Entitlements, addCount: number): Promise<void>` (zählt NUR admin+mitarbeiter)
  - Seed-Exporte: `FREESHOP_TENANT`, `FREESHOP_RECORDS`, `FREESHOP_PURCHASES`, `PLATFORM_ADMIN_EMAIL = 'platform@qrecords.test'`, `ensurePlatformUser(ownerPool, email, password)`, `resetFreeshopGatingState(ownerPool, tenantId)`, `markTenantOnboarded(ownerPool, tenantId)`

- [ ] **Step 1: Gating-Bibliothek schreiben**

Create `src/lib/gating.ts`:

```ts
import 'server-only';
import { cache } from 'react';
import { count, eq, inArray } from 'drizzle-orm';
import { withSuperadmin, type Tx } from '@/db/tenant';
import { plans, records, tenants, users } from '@/db/schema';

// ---------------------------------------------------------------------------
// Typen (CONTRACTS C7)
// ---------------------------------------------------------------------------

export type PlanLimits = { maxRecords: number | null; maxUsers: number | null };
export type PlanFeatures = { analytik: boolean; discogsListing: boolean };

export type Entitlements = {
  plan: string;
  planName: string;
  priceMonthlyCents: number;
  limits: PlanLimits;
  features: PlanFeatures;
};

/** Fail-closed-Matrix bei unbekanntem/verwaistem tenants.plan (Spec §10). */
export const FREE_FALLBACK_ENTITLEMENTS: Entitlements = {
  plan: 'free',
  planName: 'Free',
  priceMonthlyCents: 0,
  limits: { maxRecords: 100, maxUsers: 2 },
  features: { analytik: false, discogsListing: false },
};

/**
 * NUR für vertrauenswürdige Fixture-Pfade (scripts/seed.ts, Test-Setups) — niemals
 * aus Request-Kontext verwenden. Request-Pfade laden IMMER getEntitlements(tenantId).
 */
export const UNLIMITED_ENTITLEMENTS: Entitlements = {
  plan: 'big',
  planName: 'Big',
  priceMonthlyCents: 4900,
  limits: { maxRecords: null, maxUsers: null },
  features: { analytik: true, discogsListing: true },
};

export class LimitExceededError extends Error {
  constructor(
    message: string,
    public readonly current: number,
    public readonly max: number,
  ) {
    super(message);
    this.name = 'LimitExceededError';
  }
}

// ---------------------------------------------------------------------------
// Merge (pure — unit-getestet)
// ---------------------------------------------------------------------------

/**
 * Liest einen Limit-Override aus tenants.limits.
 *  - Key fehlt            → undefined (Plan-Wert gilt)
 *  - JSON null            → null (unbegrenzt — GÜLTIGER Override)
 *  - nicht-negatives int  → Zahl
 *  - alles andere         → undefined + Warn-Log (defekter Override wird ignoriert)
 */
function overrideValue(
  overrides: Record<string, unknown>,
  key: 'maxRecords' | 'maxUsers',
): number | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(overrides, key)) return undefined;
  const v = overrides[key];
  if (v === null) return null;
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return v;
  console.warn(`[gating] ungültiger limits-Override ${key}=${String(v)} — ignoriert`);
  return undefined;
}

function baseLimit(planLimits: Record<string, unknown>, key: 'maxRecords' | 'maxUsers'): number | null {
  const v = planLimits[key];
  if (v === null) return null;
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return v;
  // Defekte/alte Plan-Zeile (z. B. Slice-0-Keys) → fail-closed auf Free-Wert.
  return FREE_FALLBACK_ENTITLEMENTS.limits[key];
}

/** Feldweiser Merge: tenants.limits gewinnt je Feld über plans.limits (Spec §10). */
export function mergeEntitlements(
  planRow: {
    slug: string;
    name: string;
    priceMonthlyCents: number;
    limits: unknown;
    features: unknown;
  },
  tenantOverrides: unknown,
): Entitlements {
  const pl = (planRow.limits ?? {}) as Record<string, unknown>;
  const pf = (planRow.features ?? {}) as Record<string, unknown>;
  const ov = (tenantOverrides ?? {}) as Record<string, unknown>;

  const ovRecords = overrideValue(ov, 'maxRecords');
  const ovUsers = overrideValue(ov, 'maxUsers');

  return {
    plan: planRow.slug,
    planName: planRow.name,
    priceMonthlyCents: planRow.priceMonthlyCents,
    limits: {
      maxRecords: ovRecords === undefined ? baseLimit(pl, 'maxRecords') : ovRecords,
      maxUsers: ovUsers === undefined ? baseLimit(pl, 'maxUsers') : ovUsers,
    },
    features: {
      analytik: pf.analytik === true,
      discogsListing: pf.discogsListing === true,
    },
  };
}

// ---------------------------------------------------------------------------
// Laden (einmal pro Request — React cache())
// ---------------------------------------------------------------------------

export const getEntitlements: (tenantId: number) => Promise<Entitlements> = cache(
  async (tenantId: number): Promise<Entitlements> => {
    const rows = await withSuperadmin((tx) =>
      tx
        .select({
          tenantPlan: tenants.plan,
          overrides: tenants.limits,
          slug: plans.slug,
          name: plans.name,
          priceMonthlyCents: plans.priceMonthlyCents,
          planLimits: plans.limits,
          planFeatures: plans.features,
        })
        .from(tenants)
        .leftJoin(plans, eq(plans.slug, tenants.plan))
        .where(eq(tenants.id, tenantId))
        .limit(1),
    );
    const r = rows[0];
    if (!r) {
      console.warn(`[gating] Tenant ${tenantId} nicht gefunden — fail-closed Free`);
      return FREE_FALLBACK_ENTITLEMENTS;
    }
    if (!r.slug || r.name === null || r.priceMonthlyCents === null) {
      // Verwaister tenants.plan-Wert: Free-Matrix als Basis, Overrides bleiben wirksam
      // (Sonderkonditionen hängen am Tenant, nicht am Plan).
      console.warn(`[gating] Unbekannter Plan "${r.tenantPlan}" (Tenant ${tenantId}) — fail-closed Free`);
      return mergeEntitlements(
        {
          slug: FREE_FALLBACK_ENTITLEMENTS.plan,
          name: FREE_FALLBACK_ENTITLEMENTS.planName,
          priceMonthlyCents: FREE_FALLBACK_ENTITLEMENTS.priceMonthlyCents,
          limits: FREE_FALLBACK_ENTITLEMENTS.limits,
          features: FREE_FALLBACK_ENTITLEMENTS.features,
        },
        r.overrides,
      );
    }
    return mergeEntitlements(
      {
        slug: r.slug,
        name: r.name,
        priceMonthlyCents: r.priceMonthlyCents,
        limits: r.planLimits,
        features: r.planFeatures,
      },
      r.overrides,
    );
  },
);

// ---------------------------------------------------------------------------
// Kapazitäts-Checks (laufen INNERHALB der withTenant-Tx des Aufrufers — der
// RLS-Kontext der Transaktion scoped die Counts auf den Tenant)
// ---------------------------------------------------------------------------

/** count(records) + addCount ≤ maxRecords, sonst LimitExceededError. count+add == max ist ERLAUBT. */
export async function checkRecordCapacity(tx: Tx, ent: Entitlements, addCount: number): Promise<void> {
  const max = ent.limits.maxRecords;
  if (max === null) return;
  const [row] = await tx.select({ n: count() }).from(records);
  const current = row?.n ?? 0;
  if (current + addCount > max) {
    throw new LimitExceededError(
      `Plan-Limit erreicht: max. ${max} Platten im ${ent.planName}-Plan. Upgrade unter Einstellungen → Abo.`,
      current,
      max,
    );
  }
}

/** Zählt NUR Staff (admin + mitarbeiter) — kunde-Konten sind unbegrenzt (Spec §10). */
export async function checkUserCapacity(tx: Tx, ent: Entitlements, addCount: number): Promise<void> {
  const max = ent.limits.maxUsers;
  if (max === null) return;
  const [row] = await tx
    .select({ n: count() })
    .from(users)
    .where(inArray(users.role, ['admin', 'mitarbeiter']));
  const current = row?.n ?? 0;
  if (current + addCount > max) {
    throw new LimitExceededError(
      `Plan-Limit erreicht: max. ${max} Nutzer im ${ent.planName}-Plan. Upgrade unter Einstellungen → Abo.`,
      current,
      max,
    );
  }
}
```

- [ ] **Step 2: Unit-Test für den Merge schreiben + laufen lassen**

Create `tests/gating.test.ts`:

```ts
// Slice 6 T2 — pure Merge-Logik (Spec §10 / §14): feldweiser Override, JSON null = unbegrenzt,
// defekte Werte werden ignoriert, Features strikt boolesch.
import { describe, it, expect } from 'vitest';
import { mergeEntitlements, FREE_FALLBACK_ENTITLEMENTS } from '@/lib/gating';

const SMALL = {
  slug: 'small',
  name: 'Small',
  priceMonthlyCents: 1900,
  limits: { maxRecords: 5000, maxUsers: 10 },
  features: { analytik: true, discogsListing: true },
};

describe('mergeEntitlements', () => {
  it('ohne Overrides gelten die Plan-Werte', () => {
    const e = mergeEntitlements(SMALL, {});
    expect(e).toEqual({
      plan: 'small',
      planName: 'Small',
      priceMonthlyCents: 1900,
      limits: { maxRecords: 5000, maxUsers: 10 },
      features: { analytik: true, discogsListing: true },
    });
  });

  it('Override gewinnt feldweise — das andere Feld bleibt Plan-Wert', () => {
    const e = mergeEntitlements(SMALL, { maxRecords: 2 });
    expect(e.limits).toEqual({ maxRecords: 2, maxUsers: 10 });
  });

  it('JSON null im Override bedeutet unbegrenzt', () => {
    const e = mergeEntitlements(SMALL, { maxRecords: null });
    expect(e.limits.maxRecords).toBeNull();
    expect(e.limits.maxUsers).toBe(10);
  });

  it('JSON null im Plan bedeutet unbegrenzt (big)', () => {
    const e = mergeEntitlements(
      { ...SMALL, slug: 'big', name: 'Big', limits: { maxRecords: null, maxUsers: null } },
      {},
    );
    expect(e.limits).toEqual({ maxRecords: null, maxUsers: null });
  });

  it('defekte Overrides (string, negative, float) werden ignoriert', () => {
    expect(mergeEntitlements(SMALL, { maxRecords: 'viele' }).limits.maxRecords).toBe(5000);
    expect(mergeEntitlements(SMALL, { maxRecords: -1 }).limits.maxRecords).toBe(5000);
    expect(mergeEntitlements(SMALL, { maxRecords: 1.5 }).limits.maxRecords).toBe(5000);
  });

  it('alte Slice-0-Plan-Keys ({records, discogs}) fallen fail-closed auf Free-Limits', () => {
    const e = mergeEntitlements(
      { ...SMALL, limits: { records: 1000 }, features: { discogs: true } },
      {},
    );
    expect(e.limits).toEqual(FREE_FALLBACK_ENTITLEMENTS.limits);
    expect(e.features).toEqual({ analytik: false, discogsListing: false });
  });

  it('Features sind strikt boolesch (truthy-Strings zählen nicht)', () => {
    const e = mergeEntitlements({ ...SMALL, features: { analytik: 'yes', discogsListing: 1 } }, {});
    expect(e.features).toEqual({ analytik: false, discogsListing: false });
  });
});
```

Run: `pnpm test tests/gating.test.ts`
Expected: PASS (7 Tests). (`src/lib/gating.ts` importiert `server-only` — der vitest-Alias/Stub dafür existiert bereits, andere `server-only`-Module werden bereits in Unit-Tests importiert; falls der Import knallt, den Merge in den Integrationstest verschieben und hier NUR über `@/lib/gating` via `vi.mock('server-only', () => ({}))` testen — Muster aus bestehenden Tests übernehmen, `grep -l "server-only" tests/*.test.ts`.)

- [ ] **Step 3: Seed erweitern**

In `scripts/seed.ts`:

1. `DEMO_TENANT.plan` von `'free'` auf `'big'` ändern (Zeile 28; Kommentar: bestehende 59 E2E laufen ungegated weiter).
2. Nach `VINYLCAVE_TENANT` einfügen:

```ts
// Dritter Seed-Tenant NUR für die Gating-E2E (Spec §8/§14): plan=free mit
// tenants.limits-Override {maxRecords: 2} — deterministisch kleines Limit.
// resetFreeshopGatingState() dreht E2E-Rückstände vor jedem Lauf zurück.
const FREESHOP_TENANT: ProvisionInput = {
  slug: 'freeshop',
  name: 'Freeshop',
  adminEmail: 'admin@freeshop.test',
  primaryColor: DEFAULT_PRIMARY_COLOR,
  plan: 'free',
};

export const PLATFORM_ADMIN_EMAIL = 'platform@qrecords.test';
```

3. Nach `VINYLCAVE_PERMALINKS` die Freeshop-Datensätze einfügen:

```ts
// ---------------------------------------------------------------------------
// Datasets — freeshop tenant (Gating-Baseline: GENAU 1 Platte, Limit-Override 2)
// ---------------------------------------------------------------------------

export const FREESHOP_RECORDS: RecordSeed[] = [
  { title: 'Nevermind', artist: 'Nirvana', country: 'US', releaseYear: 1991, label: ['DGC'], format: 'Vinyl', genre: ['Grunge'] },
];

export const FREESHOP_PURCHASES: PurchaseSpec[] = [
  { recordIndex: 0, ek: '5.00', vk: '19.90', status: 'verfuegbar', conditionRecord: 5, conditionCover: 5 },
];

export const FREESHOP_PERMALINKS: PermalinkSpec[] = []; // provisionTenant legt 'lager' an — reicht.
```

4. Bei den Imports oben ergänzen: `import { and, eq, inArray, isNull, notInArray } from 'drizzle-orm';` (bestehende `and, eq` ersetzen) und `import { generateTempPassword } from '../src/lib/provisioning';`.

5. Nach `ensureDiscogsConnection` drei neue Helper einfügen:

```ts
/**
 * Idempotenter Platform-User (Spec §5). Passwort: SEED_ADMIN_PASSWORD, sonst generiert
 * (einmalig geloggt — Muster wie printCredentials). Re-Seed setzt das Passwort neu,
 * wenn SEED_ADMIN_PASSWORD gesetzt ist (wie ensureTenant für Tenant-Admins).
 */
export async function ensurePlatformUser(
  ownerPool: Pool,
  email: string,
  password: string | undefined,
): Promise<void> {
  const db = drizzle(ownerPool, { schema });

  const existing = await db
    .select({ id: schema.platformUsers.id })
    .from(schema.platformUsers)
    .where(eq(schema.platformUsers.email, email))
    .limit(1);

  if (existing.length > 0 && existing[0]) {
    if (password) {
      await db
        .update(schema.platformUsers)
        .set({ password: await hashPassword(password), updatedAt: new Date() })
        .where(eq(schema.platformUsers.id, existing[0].id));
      console.log(`[seed]   Platform-User "${email}" Passwort aktualisiert.`);
    }
    return;
  }

  const effective = password ?? generateTempPassword();
  await db.insert(schema.platformUsers).values({ email, password: await hashPassword(effective) });
  console.log(`[seed]   Platform-User "${email}" angelegt${password ? '' : ` — temporäres Passwort: ${effective}`}.`);
}

/**
 * Seed-Tenants sind fertig konfiguriert: Wizard nie zeigen, Passwortzwang aus (Spec §8) —
 * sonst laufen die bestehenden E2E-Logins in Passwort-/Wizard-Redirects.
 */
export async function markTenantOnboarded(ownerPool: Pool, tenantId: number): Promise<void> {
  const db = drizzle(ownerPool, { schema });
  await db
    .update(schema.tenants)
    .set({ onboardingCompletedAt: new Date() })
    .where(and(eq(schema.tenants.id, tenantId), isNull(schema.tenants.onboardingCompletedAt)));
  await db
    .update(schema.users)
    .set({ mustChangePassword: false })
    .where(eq(schema.users.tenantId, tenantId));
}

/**
 * Freeshop-Reset (Reset-Muster wie ensureWishlist, Slice 3): Die Upgrade-E2E (Szenario 4)
 * hinterlässt plan='small' + eine subscriptions-Zeile, die Gating-E2E (Szenario 3) zusätzliche
 * records/purchases/collections. Alles zurückdrehen, damit jeder Lauf deterministisch startet.
 * freeshop verkauft in keinem E2E (sonst FK transaction_items → purchases beachten).
 */
export async function resetFreeshopGatingState(ownerPool: Pool, tenantId: number): Promise<void> {
  const db = drizzle(ownerPool, { schema });

  await db
    .update(schema.tenants)
    .set({ plan: 'free', limits: { maxRecords: 2 }, updatedAt: new Date() })
    .where(eq(schema.tenants.id, tenantId));
  await db.delete(schema.subscriptions).where(eq(schema.subscriptions.tenantId, tenantId));

  // Nicht-Seed-Bestände löschen: purchases → collections → records (FK-Reihenfolge).
  const keepHashes = FREESHOP_RECORDS.map((r) =>
    recordHash({ title: r.title, artist: r.artist, country: r.country, year: r.releaseYear, label: r.label }),
  );
  const stale = await db
    .select({ id: schema.records.id })
    .from(schema.records)
    .where(and(eq(schema.records.tenantId, tenantId), notInArray(schema.records.hash, keepHashes)));
  const staleIds = stale.map((r) => r.id);
  if (staleIds.length > 0) {
    await db
      .delete(schema.purchases)
      .where(and(eq(schema.purchases.tenantId, tenantId), inArray(schema.purchases.recordId, staleIds)));
  }
  await db.delete(schema.collections).where(eq(schema.collections.tenantId, tenantId));
  if (staleIds.length > 0) {
    await db
      .delete(schema.records)
      .where(and(eq(schema.records.tenantId, tenantId), inArray(schema.records.id, staleIds)));
  }
}
```

6. In `main()` — nach dem demo-Block `await seedTenantCollections(...)` UND nach dem vinylcave-Block je eine Zeile ergänzen, sowie den freeshop- und Platform-Block anhängen (vor `console.log('[seed] Done…')`):

```ts
    await markTenantOnboarded(ownerPool, demoId);
```
```ts
    await markTenantOnboarded(ownerPool, vinylId);

    // ── freeshop tenant (Gating-E2E, Spec §8) ──────────────────────────────
    const { tenantId: freeId, usedPassword: freePw } = await ensureTenant(FREESHOP_TENANT, ownerPool);
    printCredentials(FREESHOP_TENANT, freePw, protocol, rootDomain);
    await sendCredentialMail(FREESHOP_TENANT, freePw, protocol, rootDomain);

    console.log(`[seed] Resetting gating state for "${FREESHOP_TENANT.slug}"...`);
    await resetFreeshopGatingState(ownerPool, freeId);

    console.log(`[seed] Seeding inventory for "${FREESHOP_TENANT.slug}"...`);
    await seedTenantInventory(ownerPool, freeId, FREESHOP_RECORDS, FREESHOP_PURCHASES, FREESHOP_PERMALINKS);
    await markTenantOnboarded(ownerPool, freeId);

    // ── Platform-User (Spec §5) ────────────────────────────────────────────
    await ensurePlatformUser(ownerPool, PLATFORM_ADMIN_EMAIL, process.env['SEED_ADMIN_PASSWORD']);
```

- [ ] **Step 4: Integrationstest für Kapazitäts-Checks + Seed-Helper**

Create `tests/gating.integration.test.ts`:

```ts
// Slice 6 T2 — Kapazitäts-Checks gegen echte Zählung (Spec §14): Grenzfall count+add == max
// erlaubt, +1 wirft; maxUsers zählt nur Staff; Freeshop-Reset stellt den Seed-Zustand her.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { setupTestDatabase, seedTenant, type TestDatabase } from './helpers/db';

describe('gating capacity checks + freeshop reset', () => {
  let db: TestDatabase;
  let owner: Pool;
  let tenantId: number;

  beforeAll(async () => {
    db = await setupTestDatabase();
    owner = new Pool({ connectionString: db.ownerUrl, max: 2 });
    const t = await seedTenant({ slug: 'gate', name: 'Gate' });
    tenantId = t.tenantId;
    // 2 Platten als Bestand (explizite tenant_id, ownerPool = vertrauenswürdige Fixture).
    await owner.query(
      `INSERT INTO records (tenant_id, title, artist, hash) VALUES
       ($1, 'R1', 'A1', repeat('1', 64)), ($1, 'R2', 'A2', repeat('2', 64))`,
      [tenantId],
    );
  }, 180_000);

  afterAll(async () => {
    await owner.end();
    await db.teardown();
  });

  it('count + add == max ist erlaubt, +1 wirft LimitExceededError mit exaktem Text', async () => {
    const { withTenant } = await import('@/db/tenant');
    const { checkRecordCapacity, LimitExceededError, FREE_FALLBACK_ENTITLEMENTS } = await import('@/lib/gating');
    const ent = { ...FREE_FALLBACK_ENTITLEMENTS, limits: { maxRecords: 3, maxUsers: 2 } };

    await withTenant({ tenantId, userId: null }, (tx) => checkRecordCapacity(tx, ent, 1)); // 2+1==3 ok

    await expect(
      withTenant({ tenantId, userId: null }, (tx) => checkRecordCapacity(tx, ent, 2)), // 2+2>3
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(LimitExceededError);
      expect((err as Error).message).toBe(
        'Plan-Limit erreicht: max. 3 Platten im Free-Plan. Upgrade unter Einstellungen → Abo.',
      );
      expect((err as InstanceType<typeof LimitExceededError>).current).toBe(2);
      return true;
    });
  });

  it('maxRecords null = unbegrenzt (kein Count-Query nötig)', async () => {
    const { withTenant } = await import('@/db/tenant');
    const { checkRecordCapacity, UNLIMITED_ENTITLEMENTS } = await import('@/lib/gating');
    await withTenant({ tenantId, userId: null }, (tx) =>
      checkRecordCapacity(tx, UNLIMITED_ENTITLEMENTS, 100_000),
    );
  });

  it('maxUsers zählt nur Staff — kunde-Konten sind frei', async () => {
    const { withTenant } = await import('@/db/tenant');
    const { checkUserCapacity, FREE_FALLBACK_ENTITLEMENTS } = await import('@/lib/gating');
    // seedTenant hat 1 admin angelegt; + 3 kunden:
    await owner.query(
      `INSERT INTO users (tenant_id, email, password, role) VALUES
       ($1, 'k1@t.test', 'x', 'kunde'), ($1, 'k2@t.test', 'x', 'kunde'), ($1, 'k3@t.test', 'x', 'kunde')`,
      [tenantId],
    );
    const ent = { ...FREE_FALLBACK_ENTITLEMENTS, limits: { maxRecords: 100, maxUsers: 2 } };
    // Staff aktuell: 1 admin → 1+1==2 ok, 1+2>2 wirft.
    await withTenant({ tenantId, userId: null }, (tx) => checkUserCapacity(tx, ent, 1));
    await expect(
      withTenant({ tenantId, userId: null }, (tx) => checkUserCapacity(tx, ent, 2)),
    ).rejects.toMatchObject({ name: 'LimitExceededError' });
  });

  it('getEntitlements merged tenants.limits-Override und fällt bei unbekanntem Plan auf Free', async () => {
    const { getEntitlements } = await import('@/lib/gating');
    // seedTenant setzt plan default 'free' (Spalte hat DEFAULT); Override setzen:
    await owner.query(`UPDATE tenants SET plan = 'free', limits = '{"maxRecords": 2}' WHERE id = $1`, [tenantId]);
    const ent = await getEntitlements(tenantId);
    expect(ent.plan).toBe('free');
    expect(ent.limits.maxRecords).toBe(2);
    expect(ent.limits.maxUsers).toBe(2);

    await owner.query(`UPDATE tenants SET plan = 'gibtsnicht' WHERE id = $1`, [tenantId]);
    // getEntitlements ist React-cache()-memoisiert pro (tenantId) im selben Request-Scope;
    // in vitest gibt es keinen Request-Scope → frisches import über resetModules erzwingen:
    const { getEntitlements: fresh } = await import('@/lib/gating');
    const fallback = await fresh(tenantId);
    expect(fallback.plan).toBe('free');
    expect(fallback.limits.maxRecords).toBe(2); // Override bleibt wirksam
    expect(fallback.features).toEqual({ analytik: false, discogsListing: false });
    await owner.query(`UPDATE tenants SET plan = 'free' WHERE id = $1`, [tenantId]);
  });

  it('resetFreeshopGatingState stellt free/Override her und löscht E2E-Rückstände', async () => {
    const { resetFreeshopGatingState, FREESHOP_RECORDS } = await import('../scripts/seed');
    const { seedTenantInventory, FREESHOP_PURCHASES, FREESHOP_PERMALINKS } = await import('../scripts/seed');
    const t = await seedTenant({ slug: 'freeshop', name: 'Freeshop' });
    await seedTenantInventory(owner, t.tenantId, FREESHOP_RECORDS, FREESHOP_PURCHASES, FREESHOP_PERMALINKS);
    // E2E-Rückstände simulieren:
    await owner.query(`UPDATE tenants SET plan = 'small' WHERE id = $1`, [t.tenantId]);
    await owner.query(
      `INSERT INTO subscriptions (tenant_id, stripe_customer_id, stripe_subscription_id, plan_slug, status)
       VALUES ($1, 'fake_cus_x', 'fake_sub_x', 'small', 'active')`,
      [t.tenantId],
    );
    await owner.query(
      `INSERT INTO records (tenant_id, title, artist, hash) VALUES ($1, 'Extra', 'E2E', repeat('e', 64))`,
      [t.tenantId],
    );

    await resetFreeshopGatingState(owner, t.tenantId);

    const tenant = await owner.query(`SELECT plan, limits FROM tenants WHERE id = $1`, [t.tenantId]);
    expect(tenant.rows[0]).toMatchObject({ plan: 'free', limits: { maxRecords: 2 } });
    const subs = await owner.query(`SELECT count(*)::int AS n FROM subscriptions WHERE tenant_id = $1`, [t.tenantId]);
    expect(subs.rows[0].n).toBe(0);
    const recs = await owner.query(`SELECT count(*)::int AS n FROM records WHERE tenant_id = $1`, [t.tenantId]);
    expect(recs.rows[0].n).toBe(1); // nur die Seed-Baseline
  });
});
```

- [ ] **Step 5: Tests ausführen**

Run: `pnpm test tests/gating.test.ts tests/gating.integration.test.ts`
Expected: PASS. Danach Seed-Regression: `pnpm test tests/seed.integration.test.ts tests/seed-sales.integration.test.ts tests/seed-collections.integration.test.ts`
Expected: PASS (die Seed-Helper-Signaturen sind unverändert; nur `main()` und neue Exporte kamen dazu).

- [ ] **Step 6: Lint/Typecheck + Commit**

Run: `pnpm lint && pnpm typecheck`
Expected: 0 Fehler.

```bash
git add src/lib/gating.ts scripts/seed.ts tests/gating.test.ts tests/gating.integration.test.ts
git commit -m "feat(slice6): T2 Gating-Lib (Entitlements-Merge, Kapazitäts-Checks) + Seed (demo→big, freeshop, Platform-User)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Platform-Routing + Platform-Auth (Middleware-Zweig, Session, Login/Logout)

**Files:**
- Modify: `src/lib/subdomain.ts` (+`isPlatformHost`)
- Modify: `src/middleware.ts`
- Modify: `src/lib/password.ts` (+`DUMMY_BCRYPT_HASH`-Export)
- Modify: `src/auth/config.ts` (Dummy-Hash importieren statt lokal definieren)
- Create: `src/auth/platform.ts`
- Create: `src/app/platform/layout.tsx`
- Create: `src/app/platform/login/page.tsx`, `src/app/platform/login/actions.ts`
- Create: `src/app/platform/(dashboard)/layout.tsx`, `src/app/platform/(dashboard)/actions.ts`
- Create: `src/app/platform/(dashboard)/page.tsx` (Platzhalter-Inhalt, wird in T4 durch die Tenant-Liste ersetzt — hier nur `<p>Platform</p>`-Shell, damit Login-Redirect ein Ziel hat)
- Test: `tests/subdomain.test.ts` (erweitern), `tests/platform-auth.integration.test.ts`

**Interfaces:**
- Consumes: T1-Schema (`platformUsers`, `platformSessions`), `withOwner`, `isValidOrigin`, `hashPassword`, Design-Tokens.
- Produces (bindend, CONTRACTS C1/C2/C3):
  - `isPlatformHost(host: string | null, rootDomain: string): boolean` (`src/lib/subdomain.ts`)
  - `platformCookieName(protocol: 'http' | 'https'): string` → `'__Host-qr.platform'` | `'qr.platform'`
  - `PLATFORM_COOKIE_NAME: string`, `PLATFORM_SESSION_TTL_MS = 86_400_000`
  - `type PlatformUser = { id: number; email: string }`
  - `verifyPlatformCredentials(email, password): Promise<PlatformUser | null>`
  - `createPlatformSession(platformUserId): Promise<{ token: string; expires: Date }>`
  - `getPlatformSessionByToken(token): Promise<PlatformUser | null>` (löscht abgelaufene Row opportunistisch)
  - `getPlatformSession(): Promise<PlatformUser | null>` (Cookie-Wrapper)
  - `requirePlatformSession(): Promise<PlatformUser>` (sonst `redirect('/login')` — zone-relativ)
  - `destroyPlatformSession(): Promise<void>`
  - `platformSessionCookieOptions()` (httpOnly, lax, path=/, secure je Protokoll, maxAge 86400)
  - Middleware: Header `x-platform-zone: '1'` NUR via Rewrite; `DUMMY_BCRYPT_HASH` aus `src/lib/password.ts`

- [ ] **Step 1: Unit-Tests für isPlatformHost schreiben (TDD)**

In `tests/subdomain.test.ts` am Ende anhängen:

```ts
describe('isPlatformHost', () => {
  it('erkennt exakt admin.<rootDomain> (case-insensitiv, Port-strip)', async () => {
    const { isPlatformHost } = await import('@/lib/subdomain');
    expect(isPlatformHost('admin.localhost', 'localhost')).toBe(true);
    expect(isPlatformHost('admin.localhost:3000', 'localhost')).toBe(true);
    expect(isPlatformHost('ADMIN.Localhost:3000', 'localhost')).toBe(true);
  });

  it('lehnt alles andere ab (Tenant, nested, root, leer)', async () => {
    const { isPlatformHost } = await import('@/lib/subdomain');
    expect(isPlatformHost('demo.localhost', 'localhost')).toBe(false);
    expect(isPlatformHost('admin.demo.localhost', 'localhost')).toBe(false);
    expect(isPlatformHost('localhost', 'localhost')).toBe(false);
    expect(isPlatformHost('admin.evil.com', 'localhost')).toBe(false);
    expect(isPlatformHost(null, 'localhost')).toBe(false);
    expect(isPlatformHost('admin.localhost', '')).toBe(false);
  });
});
```

(Falls `tests/subdomain.test.ts` `parseTenantSlug` statisch importiert, denselben Stil verwenden — statischer Import ist hier ok, `src/lib/subdomain.ts` ist Edge-safe ohne `server-only`.)

Run: `pnpm test tests/subdomain.test.ts`
Expected: FAIL — `isPlatformHost` existiert noch nicht.

- [ ] **Step 2: isPlatformHost implementieren**

In `src/lib/subdomain.ts` am Ende:

```ts
/**
 * True gdw. der Host (ohne Port, case-insensitiv) EXAKT `admin.<rootDomain>` ist.
 * Leerer rootDomain → immer false (fail-closed, wie die Middleware bei fehlendem ROOT_DOMAIN).
 */
export function isPlatformHost(host: string | null, rootDomain: string): boolean {
  if (!host || !rootDomain) return false;
  const h = host.split(':')[0].toLowerCase();
  return h === `admin.${rootDomain.toLowerCase()}`;
}
```

Run: `pnpm test tests/subdomain.test.ts` — Expected: PASS.

- [ ] **Step 3: Middleware-Zweig einbauen**

`src/middleware.ts` — Import ergänzen und `middleware()` ersetzen (Rest der Datei unverändert):

```ts
import { parseTenantSlug, isPlatformHost } from '@/lib/subdomain';
```

```ts
export function middleware(request: NextRequest): NextResponse {
  const host = resolveHost(request);
  const { pathname } = request.nextUrl;

  // Header-Hygiene ZUERST, auf jedem Pfad: client-gelieferte Zonen-/Tenant-Header strippen —
  // nur die Middleware darf x-tenant-slug und x-platform-zone setzen (Spec §4.1/§13.3).
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete('x-tenant-slug');
  requestHeaders.delete('x-platform-zone');

  // Direkter /platform*-Request ist auf JEDEM Host 404 — die Zone ist ausschließlich über den
  // Rewrite unten erreichbar (ein Rewrite durchläuft die Middleware nicht erneut) (Spec §4.3).
  if (pathname === '/platform' || pathname.startsWith('/platform/')) {
    return new NextResponse(null, { status: 404 });
  }

  // Stripe-Webhook: exakter Pfad, host-unabhängig erlaubt — die Signaturprüfung im Handler
  // ist der Wächter (Spec §4.4/§9.1). Kein Tenant-Header nötig (Owner-Kontext im Handler).
  if (pathname === '/api/billing/webhook') {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // Platform-Zone: Host ist exakt admin.<ROOT_DOMAIN> → Rewrite auf /platform/* (Spec §4.2).
  // Greift VOR dem reserved-404 — 'admin' bleibt in RESERVED_SUBDOMAINS.
  if (isPlatformHost(host, ROOT_DOMAIN)) {
    requestHeaders.set('x-platform-zone', '1');
    const url = request.nextUrl.clone();
    url.pathname = pathname === '/' ? '/platform' : `/platform${pathname}`;
    return NextResponse.rewrite(url, { request: { headers: requestHeaders } });
  }

  const result = parseTenantSlug(host, ROOT_DOMAIN);

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
```

- [ ] **Step 4: DUMMY_BCRYPT_HASH nach password.ts ziehen**

In `src/lib/password.ts` am Ende:

```ts
/**
 * Gültig geformter bcrypt-Hash (Cost 12) für den Timing-Schutz: wird verglichen, wenn KEINE
 * User-Zeile existiert, damit "unbekannte E-Mail" und "falsches Passwort" identisch lange
 * dauern (kein User-Enumeration-Orakel). Geteilt von Tenant-Auth und Platform-Auth.
 */
export const DUMMY_BCRYPT_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEeO.iI5wQp.J7m9F9pYVxq3sCJ8B9YQ3qK';
```

In `src/auth/config.ts`: die lokale `const DUMMY_BCRYPT_HASH = …`-Definition (Zeile 27–29) löschen und importieren:

```ts
import { DUMMY_BCRYPT_HASH } from '@/lib/password';
```

- [ ] **Step 5: Platform-Session-Bibliothek**

Create `src/auth/platform.ts`:

```ts
import 'server-only';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { env } from '@/env';
import { withOwner } from '@/db/tenant';
import { platformSessions, platformUsers } from '@/db/schema';
import { DUMMY_BCRYPT_HASH } from '@/lib/password';

// ---------------------------------------------------------------------------
// Cookie (Muster wie SESSION_COOKIE_NAME in src/auth/config.ts: __Host- nur unter https)
// ---------------------------------------------------------------------------

/** Pure — unit-testbar (Muster discogsOAuthCookieName). */
export function platformCookieName(protocol: 'http' | 'https'): string {
  return protocol === 'https' ? '__Host-qr.platform' : 'qr.platform';
}

const USE_SECURE = env.APP_PROTOCOL === 'https';
export const PLATFORM_COOKIE_NAME = platformCookieName(env.APP_PROTOCOL);

/** 24 h — bewusst kürzer als die 30-Tage-Tenant-Session (Spec §5). */
export const PLATFORM_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export function platformSessionCookieOptions(): {
  httpOnly: true;
  sameSite: 'lax';
  path: '/';
  secure: boolean;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: USE_SECURE,
    maxAge: PLATFORM_SESSION_TTL_MS / 1000,
  };
}

// ---------------------------------------------------------------------------
// Credentials + Session-Lebenszyklus (ALLE Zugriffe via withOwner — die
// Platform-Tabellen haben keine qr_app-Grants, Global Constraint 1)
// ---------------------------------------------------------------------------

export type PlatformUser = { id: number; email: string };

export async function verifyPlatformCredentials(
  email: string,
  password: string,
): Promise<PlatformUser | null> {
  const rows = await withOwner((tx) =>
    tx.select().from(platformUsers).where(eq(platformUsers.email, email)).limit(1),
  );
  const u = rows[0];
  // Dummy-Vergleich bei fehlender Zeile — kein Timing-Orakel (Muster verifyCredentials).
  const ok = await bcrypt.compare(password, u?.password ?? DUMMY_BCRYPT_HASH);
  if (!u || !ok) return null;
  return { id: u.id, email: u.email };
}

export async function createPlatformSession(
  platformUserId: number,
): Promise<{ token: string; expires: Date }> {
  const token = randomUUID();
  const expires = new Date(Date.now() + PLATFORM_SESSION_TTL_MS);
  await withOwner((tx) => tx.insert(platformSessions).values({ token, platformUserId, expires }));
  return { token, expires };
}

/** Token → PlatformUser; abgelaufene Session wird beim Lookup opportunistisch gelöscht (Spec §5). */
export async function getPlatformSessionByToken(token: string): Promise<PlatformUser | null> {
  return withOwner(async (tx) => {
    const rows = await tx
      .select({
        expires: platformSessions.expires,
        id: platformUsers.id,
        email: platformUsers.email,
      })
      .from(platformSessions)
      .innerJoin(platformUsers, eq(platformSessions.platformUserId, platformUsers.id))
      .where(eq(platformSessions.token, token))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    if (r.expires.getTime() <= Date.now()) {
      await tx.delete(platformSessions).where(eq(platformSessions.token, token));
      return null;
    }
    return { id: r.id, email: r.email };
  });
}

export async function getPlatformSession(): Promise<PlatformUser | null> {
  const jar = await cookies();
  const token = jar.get(PLATFORM_COOKIE_NAME)?.value;
  if (!token) return null;
  return getPlatformSessionByToken(token);
}

export async function requirePlatformSession(): Promise<PlatformUser> {
  const user = await getPlatformSession();
  // Zone-relativ: auf admin.<host> rewritet die Middleware /login → /platform/login.
  if (!user) redirect('/login');
  return user;
}

export async function destroyPlatformSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(PLATFORM_COOKIE_NAME)?.value;
  if (token) {
    await withOwner((tx) => tx.delete(platformSessions).where(eq(platformSessions.token, token)));
  }
  jar.delete(PLATFORM_COOKIE_NAME);
}
```

- [ ] **Step 6: Zone-Layouts + Login/Logout**

Create `src/app/platform/layout.tsx`:

```tsx
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

/**
 * Zone-Guard (Defence-in-Depth zu Middleware-404 + Header-Strip): erreichbar NUR, wenn die
 * Middleware den Rewrite von admin.<ROOT_DOMAIN> gesetzt hat. Direkte /platform*-Requests
 * beantwortet bereits die Middleware mit 404 — dieser Guard fängt jeden Restpfad.
 */
export default async function PlatformZoneLayout({ children }: { children: React.ReactNode }) {
  const h = await headers();
  if (h.get('x-platform-zone') !== '1') notFound();
  return <>{children}</>;
}
```

Create `src/app/platform/login/actions.ts`:

```ts
'use server';

import { z } from 'zod';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { isValidOrigin } from '@/lib/csrf';
import {
  createPlatformSession,
  PLATFORM_COOKIE_NAME,
  platformSessionCookieOptions,
  verifyPlatformCredentials,
} from '@/auth/platform';

export type PlatformLoginState = { error: string | null };

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function platformLoginAction(
  _prev: PlatformLoginState,
  formData: FormData,
): Promise<PlatformLoginState> {
  // Kette (Global Constraint 2): (keine Session nötig) → Origin → zod → Delegation.
  if (!(await isValidOrigin())) return { error: 'Ungültige Herkunft (Origin).' };
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) return { error: 'Ungültige Anmeldedaten.' };

  const user = await verifyPlatformCredentials(parsed.data.email, parsed.data.password);
  if (!user) return { error: 'Ungültige Anmeldedaten.' };

  const { token } = await createPlatformSession(user.id);
  (await cookies()).set(PLATFORM_COOKIE_NAME, token, platformSessionCookieOptions());
  redirect('/');
}
```

Create `src/app/platform/login/page.tsx` (Muster `src/app/login/page.tsx`):

```tsx
'use client';

import { useActionState } from 'react';
import { Button, Input } from '@/components/ui';
import { platformLoginAction, type PlatformLoginState } from './actions';

const initialState: PlatformLoginState = { error: null };

export default function PlatformLoginPage() {
  const [state, action, pending] = useActionState(platformLoginAction, initialState);
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: 'var(--bg)',
        color: 'var(--text)',
        fontFamily: 'var(--font-body)',
        padding: 24,
      }}
    >
      <form
        action={action}
        data-testid="platform-login-form"
        style={{
          width: 'min(380px, 100%)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-lg)',
          padding: 24,
        }}
      >
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22, margin: 0 }}>
          Platform-Login
        </h1>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-3)' }}>
          q·records Superadmin-Zone
        </p>
        <label htmlFor="email">E-Mail</label>
        <Input id="email" name="email" type="email" autoComplete="email" required aria-label="E-Mail" />
        <label htmlFor="password">Passwort</label>
        <Input
          id="password"
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

Create `src/app/platform/(dashboard)/actions.ts`:

```ts
'use server';

import { redirect } from 'next/navigation';
import { isValidOrigin } from '@/lib/csrf';
import { destroyPlatformSession } from '@/auth/platform';

export async function platformLogoutAction(): Promise<void> {
  if (!(await isValidOrigin())) return;
  await destroyPlatformSession();
  redirect('/login');
}
```

Create `src/app/platform/(dashboard)/layout.tsx`:

```tsx
import Link from 'next/link';
import { requirePlatformSession } from '@/auth/platform';
import { platformLogoutAction } from './actions';

/** Minimale Desktop-Chrome der Platform-Zone (Spec §4) — kein (app)-Layout, kein Bottom-Tab/PWA. */
export default async function PlatformDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requirePlatformSession();
  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg)',
        color: 'var(--text)',
        fontFamily: 'var(--font-body)',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '14px 24px',
          background: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <Link
          href="/"
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            fontSize: 17,
            letterSpacing: '-.02em',
            color: 'var(--text)',
            textDecoration: 'none',
          }}
        >
          q·records · Platform
        </Link>
        <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--text-3)' }}>{user.email}</span>
        <form action={platformLogoutAction}>
          <button
            type="submit"
            className="focus-ring-button"
            style={{
              minHeight: 'var(--tap)',
              padding: '0 14px',
              borderRadius: 'var(--r-pill)',
              border: '1px solid var(--border-strong)',
              background: 'var(--surface-2)',
              color: 'var(--text-2)',
              fontWeight: 600,
              fontSize: 13.5,
              cursor: 'pointer',
            }}
          >
            Abmelden
          </button>
        </form>
      </header>
      <main style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>{children}</main>
    </div>
  );
}
```

Create `src/app/platform/(dashboard)/page.tsx` (T4 ersetzt den Inhalt durch die Tenant-Liste):

```tsx
export default function PlatformHomePage() {
  return <p data-testid="platform-home">Platform-Zone bereit.</p>;
}
```

- [ ] **Step 7: Integrationstest Platform-Session-Lebenszyklus**

Create `tests/platform-auth.integration.test.ts`:

```ts
// Slice 6 T3 — Platform-Session (Spec §5/§14): verify mit Dummy-Hash-Fallback, Create/Lookup,
// Expiry-Cleanup, Cookie-Name je Protokoll (pure), Token-Delete.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { setupTestDatabase, type TestDatabase } from './helpers/db';

describe('platform auth', () => {
  let db: TestDatabase;
  let owner: Pool;

  beforeAll(async () => {
    db = await setupTestDatabase();
    owner = new Pool({ connectionString: db.ownerUrl, max: 2 });
    const { hashPassword } = await import('@/lib/password');
    await owner.query(`INSERT INTO platform_users (email, password) VALUES ($1, $2)`, [
      'platform@qrecords.test',
      await hashPassword('PlatformPw123!'),
    ]);
  }, 180_000);

  afterAll(async () => {
    await owner.end();
    await db.teardown();
  });

  it('platformCookieName ist protokollabhängig', async () => {
    const { platformCookieName } = await import('@/auth/platform');
    expect(platformCookieName('https')).toBe('__Host-qr.platform');
    expect(platformCookieName('http')).toBe('qr.platform');
  });

  it('verifyPlatformCredentials: korrekt / falsches Passwort / unbekannte E-Mail', async () => {
    const { verifyPlatformCredentials } = await import('@/auth/platform');
    const ok = await verifyPlatformCredentials('platform@qrecords.test', 'PlatformPw123!');
    expect(ok).toMatchObject({ email: 'platform@qrecords.test' });
    expect(await verifyPlatformCredentials('platform@qrecords.test', 'falsch')).toBeNull();
    expect(await verifyPlatformCredentials('nix@qrecords.test', 'PlatformPw123!')).toBeNull();
  });

  it('Session: create → lookup → destroy-by-delete', async () => {
    const { verifyPlatformCredentials, createPlatformSession, getPlatformSessionByToken } =
      await import('@/auth/platform');
    const user = (await verifyPlatformCredentials('platform@qrecords.test', 'PlatformPw123!'))!;
    const { token, expires } = await createPlatformSession(user.id);
    expect(expires.getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);

    const resolved = await getPlatformSessionByToken(token);
    expect(resolved).toEqual({ id: user.id, email: 'platform@qrecords.test' });

    await owner.query(`DELETE FROM platform_sessions WHERE token = $1`, [token]);
    expect(await getPlatformSessionByToken(token)).toBeNull();
  });

  it('abgelaufene Session wird beim Lookup gelöscht (opportunistischer Cleanup)', async () => {
    const { getPlatformSessionByToken } = await import('@/auth/platform');
    const uid = (await owner.query(`SELECT id FROM platform_users LIMIT 1`)).rows[0].id as number;
    await owner.query(
      `INSERT INTO platform_sessions (token, platform_user_id, expires) VALUES ('expired-token', $1, now() - interval '1 hour')`,
      [uid],
    );
    expect(await getPlatformSessionByToken('expired-token')).toBeNull();
    const left = await owner.query(`SELECT count(*)::int AS n FROM platform_sessions WHERE token = 'expired-token'`);
    expect(left.rows[0].n).toBe(0);
  });
});
```

Run: `pnpm test tests/platform-auth.integration.test.ts`
Expected: PASS (4 Tests).

- [ ] **Step 8: Manuelle Smoke (Middleware-Zweig)**

Run: `pnpm dev` kurz starten, dann in zweiter Shell:
`curl -s -o /dev/null -w '%{http_code}' -H 'Host: demo.localhost' http://127.0.0.1:3000/platform` → Expected: `404`
`curl -s -o /dev/null -w '%{http_code}' -H 'Host: admin.localhost' http://127.0.0.1:3000/platform` → Expected: `404`
`curl -s -o /dev/null -w '%{http_code}' -H 'Host: admin.localhost' -L http://127.0.0.1:3000/` → Expected: `200` (Login-Seite nach Redirect; ohne `-L`: `307` mit `location: /login`)
Dev-Server danach wieder stoppen.

- [ ] **Step 9: Lint/Typecheck + bestehende Auth-Tests + Commit**

Run: `pnpm lint && pnpm typecheck && pnpm test tests/subdomain.test.ts tests/tenant.test.ts`
Expected: 0 Fehler, Tests PASS.

```bash
git add src/lib/subdomain.ts src/middleware.ts src/lib/password.ts src/auth/config.ts src/auth/platform.ts src/app/platform tests/subdomain.test.ts tests/platform-auth.integration.test.ts
git commit -m "feat(slice6): T3 Platform-Zone — Middleware-Rewrite admin.<host>→/platform, eigene Platform-Session (bcrypt+opakes Token, 24h), Login/Logout

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Platform-Screens — Tenant-Liste, Tenant anlegen, Tenant-Detail

**Files:**
- Create: `src/lib/platform/tenants.ts`
- Create: `src/app/platform/(dashboard)/tenants/actions.ts`
- Modify: `src/app/platform/(dashboard)/page.tsx` (Tenant-Liste, ersetzt T3-Platzhalter)
- Create: `src/app/platform/(dashboard)/tenants/neu/page.tsx`
- Create: `src/app/platform/(dashboard)/tenants/neu/CreateTenantForm.tsx`
- Create: `src/app/platform/(dashboard)/tenants/[id]/page.tsx`
- Create: `src/app/platform/(dashboard)/tenants/[id]/_components/PlanOverrideForm.tsx`
- Create: `src/app/platform/(dashboard)/tenants/[id]/_components/ResendCredentialsButton.tsx`
- Test: `tests/slice6-actions.integration.test.ts` (NEU — sammelt ab jetzt die Slice-6-Action-/Lib-Integrationsfälle von T4/T7/T8/T10/T11, EIN Container)

**Interfaces:**
- Consumes: `requirePlatformSession` (T3), `provisionTenant`/`generateTempPassword` (T1), `withSuperadmin`/`withOwner`, `sendCredentialsEmail`/`getEmailAdapter`, `tenantUrl`, `subscriptions`-Schema (T1).
- Produces (CONTRACTS C3):
  - `listTenantsWithStats(): Promise<TenantListRow[]>` mit `TenantListRow = { id, slug, name, plan, recordCount, userCount, createdAt: Date | null }`
  - `getTenantDetail(id: number): Promise<TenantDetail | null>` mit `TenantDetail = { id, slug, name, plan, createdAt, primaryColor, onboardingCompletedAt, adminEmail: string | null, subscription: { planSlug; status; currentPeriodEnd: Date | null; cancelAtPeriodEnd: boolean; stripeCustomerId; stripeSubscriptionId } | null }`
  - Actions: `createTenantAction(prev, formData): Promise<CreateTenantState>` mit `CreateTenantState = { ok: boolean; error: string | null; temporaryPassword: string | null; slug: string | null }`; `setTenantPlanAction(prev, formData): Promise<{ ok: boolean; error: string | null }>`; `resendCredentialsAction(prev, formData): Promise<{ ok: boolean; error: string | null }>`

- [ ] **Step 1: Query-Bibliothek**

Create `src/lib/platform/tenants.ts`:

```ts
import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { withSuperadmin } from '@/db/tenant';
import { subscriptions, tenants, users } from '@/db/schema';
import { DEFAULT_PRIMARY_COLOR } from '@/lib/branding';

export type TenantListRow = {
  id: number;
  slug: string;
  name: string;
  plan: string;
  recordCount: number;
  userCount: number;
  createdAt: Date | null;
};

/** Aggregatzahlen only — kein Kunden-PII in der Platform-Zone (Global Constraint 8). */
export async function listTenantsWithStats(): Promise<TenantListRow[]> {
  return withSuperadmin((tx) =>
    tx
      .select({
        id: tenants.id,
        slug: tenants.slug,
        name: tenants.name,
        plan: tenants.plan,
        createdAt: tenants.createdAt,
        recordCount: sql<number>`(SELECT count(*) FROM records r WHERE r.tenant_id = tenants.id)::int`,
        userCount: sql<number>`(SELECT count(*) FROM users u WHERE u.tenant_id = tenants.id)::int`,
      })
      .from(tenants)
      .orderBy(tenants.slug),
  );
}

export type TenantDetail = {
  id: number;
  slug: string;
  name: string;
  plan: string;
  createdAt: Date | null;
  primaryColor: string;
  onboardingCompletedAt: Date | null;
  adminEmail: string | null;
  subscription: {
    planSlug: string;
    status: string;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
    stripeCustomerId: string;
    stripeSubscriptionId: string;
  } | null;
};

export async function getTenantDetail(id: number): Promise<TenantDetail | null> {
  return withSuperadmin(async (tx) => {
    const [t] = await tx.select().from(tenants).where(eq(tenants.id, id)).limit(1);
    if (!t) return null;
    const [admin] = await tx
      .select({ email: users.email })
      .from(users)
      .where(and(eq(users.tenantId, id), eq(users.role, 'admin')))
      .orderBy(users.id)
      .limit(1);
    const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.tenantId, id)).limit(1);
    const config = (t.config ?? {}) as { branding?: { primaryColor?: string } };
    return {
      id: t.id,
      slug: t.slug,
      name: t.name,
      plan: t.plan,
      createdAt: t.createdAt,
      primaryColor: config.branding?.primaryColor ?? DEFAULT_PRIMARY_COLOR,
      onboardingCompletedAt: t.onboardingCompletedAt ?? null,
      adminEmail: admin?.email ?? null,
      subscription: sub
        ? {
            planSlug: sub.planSlug,
            status: sub.status,
            currentPeriodEnd: sub.currentPeriodEnd,
            cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
            stripeCustomerId: sub.stripeCustomerId,
            stripeSubscriptionId: sub.stripeSubscriptionId,
          }
        : null,
    };
  });
}
```

- [ ] **Step 2: Platform-Actions**

Create `src/app/platform/(dashboard)/tenants/actions.ts`:

```ts
'use server';

import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { requirePlatformSession } from '@/auth/platform';
import { isValidOrigin } from '@/lib/csrf';
import { withOwner } from '@/db/tenant';
import { tenants, users } from '@/db/schema';
import { provisionTenant, generateTempPassword, HEX_COLOR_REGEX } from '@/lib/provisioning';
import { hashPassword } from '@/lib/password';
import { getEmailAdapter, sendCredentialsEmail } from '@/lib/email';
import { tenantUrl } from '@/env';

// ---------------------------------------------------------------------------
// Tenant anlegen (Spec §6.2) — Platform-Action-Kette (CONTRACTS C3):
// requirePlatformSession → Origin → zod → Delegation
// ---------------------------------------------------------------------------

export type CreateTenantState = {
  ok: boolean;
  error: string | null;
  /** Einmalige Anzeige (Spec §13.9) — danach nur noch per Mail. */
  temporaryPassword: string | null;
  slug: string | null;
};

const createTenantSchema = z.object({
  slug: z.string().trim().toLowerCase(),
  name: z.string().trim().min(1, 'Name darf nicht leer sein.'),
  adminEmail: z.string().trim().email('Bitte eine gültige E-Mail angeben.'),
  primaryColor: z.string().trim().regex(HEX_COLOR_REGEX, 'Primärfarbe muss #RGB oder #RRGGBB sein.'),
  plan: z.enum(['free', 'small', 'big']),
});

export async function createTenantAction(
  _prev: CreateTenantState,
  formData: FormData,
): Promise<CreateTenantState> {
  await requirePlatformSession();
  if (!(await isValidOrigin())) {
    return { ok: false, error: 'Ungültige Herkunft (Origin).', temporaryPassword: null, slug: null };
  }
  const parsed = createTenantSchema.safeParse({
    slug: formData.get('slug'),
    name: formData.get('name'),
    adminEmail: formData.get('adminEmail'),
    primaryColor: formData.get('primaryColor'),
    plan: formData.get('plan'),
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Ungültige Eingaben.',
      temporaryPassword: null,
      slug: null,
    };
  }

  let temporaryPassword: string;
  try {
    // provisionTenant validiert Slug-Format/Reserved-Liste + WCAG-Kontrast und wirft
    // mit sprechender Message; Duplikat-Slug endet als unique-violation (23505).
    const result = await provisionTenant(parsed.data);
    temporaryPassword = result.temporaryPassword;
  } catch (err) {
    const code =
      (err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code;
    if (code === '23505') {
      return { ok: false, error: `Slug "${parsed.data.slug}" ist bereits vergeben.`, temporaryPassword: null, slug: null };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Anlegen fehlgeschlagen.',
      temporaryPassword: null,
      slug: null,
    };
  }

  // Credentials-Mail (mailpit/console) — soft-fail: Tenant ist bereits angelegt,
  // das Passwort wird zusätzlich einmalig angezeigt.
  try {
    await sendCredentialsEmail(getEmailAdapter(), {
      to: parsed.data.adminEmail,
      tenantName: parsed.data.name,
      loginUrl: `${tenantUrl(parsed.data.slug)}/login`,
      temporaryPassword,
    });
  } catch (err) {
    console.warn('[platform] Credentials-Mail fehlgeschlagen (non-fatal):', err);
  }

  revalidatePath('/platform');
  return { ok: true, error: null, temporaryPassword, slug: parsed.data.slug };
}

// ---------------------------------------------------------------------------
// Plan manuell setzen (Spec §6.3) — schreibt NUR tenants.plan, keine Stripe-Objekte.
// ---------------------------------------------------------------------------

export type PlatformActionState = { ok: boolean; error: string | null };

const setPlanSchema = z.object({
  tenantId: z.coerce.number().int().positive(),
  plan: z.enum(['free', 'small', 'big']),
});

export async function setTenantPlanAction(
  _prev: PlatformActionState,
  formData: FormData,
): Promise<PlatformActionState> {
  await requirePlatformSession();
  if (!(await isValidOrigin())) return { ok: false, error: 'Ungültige Herkunft (Origin).' };
  const parsed = setPlanSchema.safeParse({
    tenantId: formData.get('tenantId'),
    plan: formData.get('plan'),
  });
  if (!parsed.success) return { ok: false, error: 'Ungültige Eingaben.' };

  await withOwner((tx) =>
    tx
      .update(tenants)
      .set({ plan: parsed.data.plan, updatedAt: new Date() })
      .where(eq(tenants.id, parsed.data.tenantId)),
  );
  revalidatePath('/platform');
  revalidatePath(`/platform/tenants/${parsed.data.tenantId}`);
  return { ok: true, error: null };
}

// ---------------------------------------------------------------------------
// Credentials-Mail erneut senden (Spec §6.3): neues temp. Passwort an den admin-User,
// mustChangePassword=true. Passwort wird NICHT angezeigt — nur Mail (Spec §13.9).
// ---------------------------------------------------------------------------

const resendSchema = z.object({ tenantId: z.coerce.number().int().positive() });

export async function resendCredentialsAction(
  _prev: PlatformActionState,
  formData: FormData,
): Promise<PlatformActionState> {
  await requirePlatformSession();
  if (!(await isValidOrigin())) return { ok: false, error: 'Ungültige Herkunft (Origin).' };
  const parsed = resendSchema.safeParse({ tenantId: formData.get('tenantId') });
  if (!parsed.success) return { ok: false, error: 'Ungültige Eingaben.' };

  const temporaryPassword = generateTempPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  const target = await withOwner(async (tx) => {
    const [tenant] = await tx
      .select({ id: tenants.id, slug: tenants.slug, name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, parsed.data.tenantId))
      .limit(1);
    if (!tenant) return null;
    const [admin] = await tx
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(and(eq(users.tenantId, tenant.id), eq(users.role, 'admin')))
      .orderBy(users.id)
      .limit(1);
    if (!admin) return null;
    await tx
      .update(users)
      .set({ password: passwordHash, mustChangePassword: true, updatedAt: new Date() })
      .where(eq(users.id, admin.id));
    return { tenant, admin };
  });
  if (!target) return { ok: false, error: 'Tenant oder Admin-User nicht gefunden.' };

  try {
    await sendCredentialsEmail(getEmailAdapter(), {
      to: target.admin.email,
      tenantName: target.tenant.name,
      loginUrl: `${tenantUrl(target.tenant.slug)}/login`,
      temporaryPassword,
    });
  } catch (err) {
    console.error('[platform] Credentials-Resend-Mail fehlgeschlagen:', err);
    return { ok: false, error: 'Mail-Versand fehlgeschlagen — Passwort wurde trotzdem zurückgesetzt.' };
  }
  return { ok: true, error: null };
}
```

- [ ] **Step 3: Tenant-Liste (ersetzt Platzhalter)**

Replace `src/app/platform/(dashboard)/page.tsx`:

```tsx
import Link from 'next/link';
import { listTenantsWithStats } from '@/lib/platform/tenants';
import { env, tenantUrl } from '@/env';

const dateDE = (d: Date | null): string =>
  d ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(d) : '—';

export default async function PlatformTenantListPage() {
  const rows = await listTenantsWithStats();
  return (
    <section data-testid="platform-tenant-list">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 24, margin: 0 }}>
          Tenants
        </h1>
        <Link
          href="/tenants/neu"
          data-testid="platform-tenant-create-link"
          style={{
            marginLeft: 'auto',
            minHeight: 'var(--tap)',
            display: 'inline-flex',
            alignItems: 'center',
            padding: '0 16px',
            borderRadius: 'var(--r-pill)',
            background: 'var(--accent)',
            color: 'var(--on-accent)',
            fontWeight: 700,
            fontSize: 14,
            textDecoration: 'none',
          }}
        >
          Tenant anlegen
        </Link>
      </div>
      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: 'var(--surface-2)', textAlign: 'left' }}>
              {['Name', 'Slug', 'Plan', 'Platten', 'User', 'Angelegt am'].map((h) => (
                <th key={h} style={{ padding: '10px 14px', fontWeight: 700, color: 'var(--text-2)' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} data-testid="platform-tenant-row" style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '10px 14px', fontWeight: 600 }}>
                  <Link href={`/tenants/${t.id}`} style={{ color: 'var(--accent-ink)', textDecoration: 'none' }}>
                    {t.name}
                  </Link>
                </td>
                <td style={{ padding: '10px 14px' }}>
                  <a href={tenantUrl(t.slug)} style={{ color: 'var(--text-2)' }}>
                    {t.slug}.{env.ROOT_DOMAIN}
                  </a>
                </td>
                <td style={{ padding: '10px 14px', textTransform: 'capitalize' }}>{t.plan}</td>
                <td style={{ padding: '10px 14px' }}>{t.recordCount}</td>
                <td style={{ padding: '10px 14px' }}>{t.userCount}</td>
                <td style={{ padding: '10px 14px', color: 'var(--text-3)' }}>{dateDE(t.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Tenant anlegen (Formular + einmalige Passwort-Anzeige)**

Create `src/app/platform/(dashboard)/tenants/neu/CreateTenantForm.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { Button, Input } from '@/components/ui';
import { createTenantAction, type CreateTenantState } from '../actions';

const selectStyle: React.CSSProperties = {
  minHeight: 'var(--tap)',
  padding: '0 14px',
  border: '1.5px solid var(--border-strong)',
  borderRadius: 'var(--r-md)',
  background: 'var(--surface-2)',
  color: 'var(--text)',
  fontFamily: 'var(--font-body)',
  fontSize: 15,
  cursor: 'pointer',
};

const initialState: CreateTenantState = { ok: false, error: null, temporaryPassword: null, slug: null };

export function CreateTenantForm({ rootDomain }: { rootDomain: string }) {
  const [state, action, pending] = useActionState(createTenantAction, initialState);

  if (state.ok && state.temporaryPassword) {
    return (
      <div
        data-testid="platform-tenant-created"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          background: 'var(--surface)',
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--r-lg)',
          padding: 20,
        }}
      >
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 18 }}>Tenant angelegt</h2>
        <p style={{ margin: 0, fontSize: 14 }}>
          Login: <strong>{state.slug}.{rootDomain}</strong>
        </p>
        <p style={{ margin: 0, fontSize: 14 }}>
          Temporäres Passwort (einmalige Anzeige — wurde zusätzlich per Mail verschickt):
        </p>
        <code
          data-testid="temp-password"
          style={{
            fontFamily: 'monospace',
            letterSpacing: '.05em',
            fontSize: 16,
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-md)',
            padding: '10px 14px',
          }}
        >
          {state.temporaryPassword}
        </code>
      </div>
    );
  }

  return (
    <form
      action={action}
      data-testid="platform-tenant-create-form"
      style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 420 }}
    >
      <label htmlFor="slug">Slug (Subdomain)</label>
      <Input id="slug" name="slug" required aria-label="Slug" placeholder="plattenkiste" />
      <label htmlFor="name">Name</label>
      <Input id="name" name="name" required aria-label="Name" placeholder="Die Plattenkiste" />
      <label htmlFor="adminEmail">Admin-E-Mail</label>
      <Input id="adminEmail" name="adminEmail" type="email" required aria-label="Admin-E-Mail" />
      <label htmlFor="primaryColor">Primärfarbe</label>
      <Input id="primaryColor" name="primaryColor" defaultValue="#C84B31" required aria-label="Primärfarbe" />
      <label htmlFor="plan">Plan</label>
      <select id="plan" name="plan" defaultValue="free" aria-label="Plan" className="focus-ring-field" style={selectStyle}>
        <option value="free">Free</option>
        <option value="small">Small</option>
        <option value="big">Big</option>
      </select>
      {state.error ? <p role="alert">{state.error}</p> : null}
      <Button type="submit" loading={pending}>
        Anlegen
      </Button>
    </form>
  );
}
```

(Bewusst natives `<select>` statt der UI-Komponente `Select`: deren Props `options`/`value`/`onChange` sind alle Pflicht (controlled-only, Children werden ignoriert) — für ein unkontrolliertes FormData-Formular wäre zusätzlicher `useState`-Ballast nötig. Das native Element übernimmt `focus-ring-field` + Feldstyles aus dem Designsystem; die Optionswerte `free|small|big` und Labels bleiben exakt diese. Gilt genauso für `PlanOverrideForm` in Step 5 und `CreateUserForm` in Task 8.)

Create `src/app/platform/(dashboard)/tenants/neu/page.tsx`:

```tsx
import { env } from '@/env';
import { CreateTenantForm } from './CreateTenantForm';

export default function TenantNeuPage() {
  return (
    <section>
      <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 24, marginTop: 0 }}>
        Tenant anlegen
      </h1>
      <CreateTenantForm rootDomain={env.ROOT_DOMAIN} />
    </section>
  );
}
```

- [ ] **Step 5: Tenant-Detail**

Create `src/app/platform/(dashboard)/tenants/[id]/_components/PlanOverrideForm.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui';
import { setTenantPlanAction, type PlatformActionState } from '../../actions';

const initialState: PlatformActionState = { ok: false, error: null };

const selectStyle: React.CSSProperties = {
  minHeight: 'var(--tap)',
  padding: '0 14px',
  border: '1.5px solid var(--border-strong)',
  borderRadius: 'var(--r-md)',
  background: 'var(--surface-2)',
  color: 'var(--text)',
  fontFamily: 'var(--font-body)',
  fontSize: 15,
  cursor: 'pointer',
};

export function PlanOverrideForm({ tenantId, currentPlan }: { tenantId: number; currentPlan: string }) {
  const [state, action, pending] = useActionState(setTenantPlanAction, initialState);
  return (
    <form action={action} data-testid="plan-override-form" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      <input type="hidden" name="tenantId" value={tenantId} />
      <select name="plan" defaultValue={currentPlan} aria-label="Plan" className="focus-ring-field" style={selectStyle}>
        <option value="free">Free</option>
        <option value="small">Small</option>
        <option value="big">Big</option>
      </select>
      <Button type="submit" loading={pending}>
        Plan speichern
      </Button>
      {state.ok ? <span data-testid="plan-saved">Gespeichert.</span> : null}
      {state.error ? <p role="alert">{state.error}</p> : null}
    </form>
  );
}
```

Create `src/app/platform/(dashboard)/tenants/[id]/_components/ResendCredentialsButton.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui';
import { resendCredentialsAction, type PlatformActionState } from '../../actions';

const initialState: PlatformActionState = { ok: false, error: null };

export function ResendCredentialsButton({ tenantId, adminEmail }: { tenantId: number; adminEmail: string }) {
  const [state, action, pending] = useActionState(resendCredentialsAction, initialState);
  return (
    <form action={action} data-testid="resend-credentials-form">
      <input type="hidden" name="tenantId" value={tenantId} />
      <Button type="submit" loading={pending}>
        Credentials-Mail erneut senden
      </Button>
      <p style={{ fontSize: 12.5, color: 'var(--text-3)', margin: '6px 0 0' }}>
        Setzt ein neues temporäres Passwort für {adminEmail} und erzwingt den Passwortwechsel.
      </p>
      {state.ok ? <p data-testid="resend-ok">Mail verschickt.</p> : null}
      {state.error ? <p role="alert">{state.error}</p> : null}
    </form>
  );
}
```

Create `src/app/platform/(dashboard)/tenants/[id]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { getTenantDetail } from '@/lib/platform/tenants';
import { env, tenantUrl } from '@/env';
import { PlanOverrideForm } from './_components/PlanOverrideForm';
import { ResendCredentialsButton } from './_components/ResendCredentialsButton';

const dateDE = (d: Date | null): string =>
  d ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(d) : '—';

export default async function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenantId = Number(id);
  if (!Number.isInteger(tenantId) || tenantId <= 0) notFound();
  const detail = await getTenantDetail(tenantId);
  if (!detail) notFound();

  const cardStyle: React.CSSProperties = {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--r-lg)',
    padding: 20,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  };

  return (
    <section data-testid="platform-tenant-detail" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 24, margin: 0 }}>
        {detail.name}
      </h1>

      <div style={cardStyle}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Stammdaten</h2>
        <p style={{ margin: 0 }}>
          URL: <a href={tenantUrl(detail.slug)}>{detail.slug}.{env.ROOT_DOMAIN}</a>
        </p>
        <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          Primärfarbe:
          <span
            aria-hidden="true"
            style={{
              width: 16,
              height: 16,
              borderRadius: 4,
              background: detail.primaryColor,
              border: '1px solid var(--border-strong)',
              display: 'inline-block',
            }}
          />
          <code>{detail.primaryColor}</code>
        </p>
        <p style={{ margin: 0 }}>Angelegt am: {dateDE(detail.createdAt)}</p>
        <p style={{ margin: 0 }}>
          Onboarding: {detail.onboardingCompletedAt ? `abgeschlossen (${dateDE(detail.onboardingCompletedAt)})` : 'offen'}
        </p>
      </div>

      <div style={cardStyle}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Plan &amp; Abo</h2>
        <p style={{ margin: 0 }}>
          Aktueller Plan: <strong data-testid="tenant-plan" style={{ textTransform: 'capitalize' }}>{detail.plan}</strong>
        </p>
        {detail.subscription ? (
          <p style={{ margin: 0 }} data-testid="tenant-subscription">
            Abo: {detail.subscription.planSlug} · Status {detail.subscription.status}
            {detail.subscription.currentPeriodEnd ? ` · läuft bis ${dateDE(detail.subscription.currentPeriodEnd)}` : ''}
            {detail.subscription.cancelAtPeriodEnd ? ' · gekündigt zum Periodenende' : ''}
          </p>
        ) : (
          <p style={{ margin: 0, color: 'var(--text-3)' }} data-testid="tenant-subscription">
            Kein aktives Abo (Free oder manueller Override).
          </p>
        )}
        <PlanOverrideForm tenantId={detail.id} currentPlan={detail.plan} />
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-3)' }}>
          Der manuelle Override schreibt nur tenants.plan (Sonderkonditionen, Webhook-Fallback) —
          er ändert keine Stripe-Objekte.
        </p>
      </div>

      <div style={cardStyle}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Zugang</h2>
        {detail.adminEmail ? (
          <ResendCredentialsButton tenantId={detail.id} adminEmail={detail.adminEmail} />
        ) : (
          <p style={{ margin: 0, color: 'var(--text-3)' }}>Kein Admin-User gefunden.</p>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 6: Integrationstest (Basis von tests/slice6-actions.integration.test.ts)**

Create `tests/slice6-actions.integration.test.ts` mit dem T4-Block (T7/T8/T10/T11 hängen weitere describes an dieselbe Datei — EIN Container):

```ts
// Slice 6 — Action-/Lib-Integrationsfälle (T4/T7/T8/T10/T11 teilen sich diesen Container).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { setupTestDatabase, type TestDatabase } from './helpers/db';

let db: TestDatabase;
let owner: Pool;

beforeAll(async () => {
  db = await setupTestDatabase();
  owner = new Pool({ connectionString: db.ownerUrl, max: 2 });
}, 180_000);

afterAll(async () => {
  await owner.end();
  await db.teardown();
});

describe('T4 platform tenants lib', () => {
  it('listTenantsWithStats liefert Aggregatzahlen, getTenantDetail Branding/Admin/Sub', async () => {
    const { provisionTenant } = await import('@/lib/provisioning');
    const { tenantId } = await provisionTenant({
      slug: 'plattenkiste',
      name: 'Die Plattenkiste',
      adminEmail: 'chef@plattenkiste.test',
      primaryColor: '#C84B31',
      plan: 'small',
    });
    await owner.query(
      `INSERT INTO records (tenant_id, title, artist, hash) VALUES ($1, 'X', 'Y', repeat('a', 64))`,
      [tenantId],
    );

    const { listTenantsWithStats, getTenantDetail } = await import('@/lib/platform/tenants');
    const list = await listTenantsWithStats();
    const row = list.find((t) => t.slug === 'plattenkiste')!;
    expect(row).toMatchObject({ name: 'Die Plattenkiste', plan: 'small', recordCount: 1, userCount: 1 });

    const detail = (await getTenantDetail(tenantId))!;
    expect(detail.adminEmail).toBe('chef@plattenkiste.test');
    expect(detail.primaryColor).toBe('#C84B31');
    expect(detail.subscription).toBeNull();
    expect(detail.onboardingCompletedAt).toBeNull(); // frisch provisioniert → Wizard offen
  });

  it('Credentials-Resend-Kern: neues Passwort + mustChangePassword=true', async () => {
    // Der Action-Wrapper braucht Request-Kontext (Cookies/Origin) — hier wird der DB-Kern
    // geprüft, den resendCredentialsAction ausführt (identisches SQL).
    const { generateTempPassword } = await import('@/lib/provisioning');
    const { hashPassword } = await import('@/lib/password');
    const before = await owner.query(
      `SELECT id, password FROM users WHERE email = 'chef@plattenkiste.test'`,
    );
    const temp = generateTempPassword();
    expect(temp).toMatch(/^[A-Z2-7]{16}$/);
    await owner.query(`UPDATE users SET password = $1, must_change_password = true WHERE id = $2`, [
      await hashPassword(temp),
      before.rows[0].id,
    ]);
    const after = await owner.query(
      `SELECT password, must_change_password FROM users WHERE id = $1`,
      [before.rows[0].id],
    );
    expect(after.rows[0].password).not.toBe(before.rows[0].password);
    expect(after.rows[0].must_change_password).toBe(true);
  });
});
```

Run: `pnpm test tests/slice6-actions.integration.test.ts`
Expected: PASS (2 Tests).

- [ ] **Step 7: Lint/Typecheck + Commit**

Run: `pnpm lint && pnpm typecheck`
Expected: 0 Fehler.

```bash
git add src/lib/platform src/app/platform tests/slice6-actions.integration.test.ts
git commit -m "feat(slice6): T4 Platform-Screens — Tenant-Liste mit Aggregaten, Provisioning-UI mit Einmal-Passwort, Tenant-Detail (Plan-Override, Credentials-Resend)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Billing-Adapter — types/store/fake/stripe/index + Env + stripe-Dependency

**Files:**
- Modify: `package.json` (`pnpm add stripe`)
- Modify: `src/env.ts` (+BILLING_DRIVER/STRIPE_*, `parseEnv`)
- Create: `src/lib/billing/types.ts`
- Create: `src/lib/billing/store.ts`
- Create: `src/lib/billing/fake.ts`
- Create: `src/lib/billing/stripe.ts`
- Create: `src/lib/billing/index.ts`
- Modify: `.env.example`, `.env.compose` (+Billing-Block)
- Test: `tests/env-billing.test.ts`, `tests/billing-stripe-mapping.test.ts`, `tests/billing-fake.test.ts` (nur Signatur/Parse — DB-Effekte in T6-Integrationstest)

**Interfaces:**
- Consumes: T1-Schema (`plans.stripePriceId`, `subscriptions`, `tenants`), `withOwner`/`withTenant`.
- Produces (bindend, CONTRACTS C4/C5):
  - `interface BillingAdapter { createCheckoutSession(args: { tenantId: number; planSlug: string; successUrl: string; cancelUrl: string }): Promise<{ url: string }>; createPortalSession(args: { customerId: string; returnUrl: string }): Promise<{ url: string }>; parseWebhookEvent(rawBody: string, signature: string): BillingEvent }`
  - `type BillingEvent` (4 Varianten, alle mit `eventId` + `type`; `subscription_updated` trägt `priceId: string | null` — Plan-Auflösung passiert im Apply-Handler, NICHT im Driver; Spec-Amendment)
  - `class BillingSignatureError`, `class BillingConfigError`
  - `getBillingAdapter(): BillingAdapter` (Singleton, `BILLING_DRIVER`)
  - Fake-Semantik: `fakeCustomerId(tenantId) = 'fake_cus_<id>'`, `fakeSubscriptionId(tenantId) = 'fake_sub_<id>'`, `FAKE_SIGNATURE = 'fake'`; Checkout = Sofort-Upsert + successUrl
  - Store: `getSubscriptionForTenant(ctx): Promise<SubscriptionInfo | null>`, `getStripePriceId(planSlug): Promise<string | null>`, `listPlans(): Promise<{ slug: string; name: string; priceMonthlyCents: number }[]>`, `upsertSubscriptionAndPlanTx(tx, args)`, `upsertSubscriptionAndPlan(args)`
  - `mapStripeEvent(event: Stripe.Event): BillingEvent` (pure, exportiert für Unit-Tests)
  - Env: `BILLING_DRIVER: 'fake' | 'stripe'` (Default `'fake'`), `STRIPE_SECRET_KEY?`, `STRIPE_WEBHOOK_SECRET?`, `parseEnv(source)` exportiert (wirft, wenn stripe ohne Keys)

- [ ] **Step 1: Dependency installieren**

Run: `pnpm add stripe`
Expected: `stripe` in `package.json` dependencies (aktuelle Major, ^18), `pnpm-lock.yaml` aktualisiert.

- [ ] **Step 2: Env erweitern (fail-closed Refinement)**

In `src/env.ts` — im `envSchema` nach dem Discogs-Block einfügen:

```ts
  // ── Billing ───────────────────────────────────────────────
  BILLING_DRIVER: z.enum(['fake', 'stripe']).default('fake'),
  /** Pflicht bei BILLING_DRIVER=stripe — geprüft in parseEnv (fail-closed on boot). */
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
```

Die Zeile `export const env: Env = envSchema.parse(process.env);` ersetzen durch:

```ts
/**
 * Parse + Cross-Field-Refinement. Bewusst KEIN .superRefine am Schema selbst —
 * das würde envSchema zu ZodEffects machen und bestehende .shape-Zugriffe in Tests brechen.
 * Exportiert für tests/env-billing.test.ts.
 */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const parsed = envSchema.parse(source);
  if (parsed.BILLING_DRIVER === 'stripe' && (!parsed.STRIPE_SECRET_KEY || !parsed.STRIPE_WEBHOOK_SECRET)) {
    throw new Error(
      'BILLING_DRIVER=stripe erfordert STRIPE_SECRET_KEY und STRIPE_WEBHOOK_SECRET (src/env.ts).',
    );
  }
  return parsed;
}

/**
 * Validated environment variables. Throws at module-load time (boot) if any
 * required key is absent or fails validation — this is intentional "fail-closed on boot".
 */
export const env: Env = parseEnv(process.env);
```

- [ ] **Step 3: Env-Test schreiben + laufen lassen**

Create `tests/env-billing.test.ts`:

```ts
// Slice 6 T5 — Billing-Env: Default fake, stripe erzwingt beide Keys (fail-closed on boot).
import { describe, it, expect } from 'vitest';
import { envSchema, parseEnv } from '@/env';

const BASE: Record<string, string> = {
  ROOT_DOMAIN: 'localhost',
  DATABASE_URL: 'postgresql://qr_app:x@localhost:5432/db',
  DATABASE_OWNER_URL: 'postgresql://qr_owner:x@localhost:5432/db',
  PGBOSS_DATABASE_URL: 'postgresql://qr_owner:x@localhost:5432/db',
  AUTH_SECRET: 's',
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  ENCRYPTION_KEY_ID: 'v1',
  MAIL_DRIVER: 'console',
  MAIL_HOST: 'localhost',
  MAIL_PORT: '1025',
  MAIL_FROM: 'noreply@localhost',
  DISCOGS_CONSUMER_KEY: 'k',
  DISCOGS_CONSUMER_SECRET: 's',
};

describe('billing env', () => {
  it('BILLING_DRIVER default ist fake', () => {
    expect(envSchema.parse(BASE).BILLING_DRIVER).toBe('fake');
  });

  it('fake braucht keine Stripe-Keys', () => {
    expect(() => parseEnv({ ...BASE, BILLING_DRIVER: 'fake' } as NodeJS.ProcessEnv)).not.toThrow();
  });

  it('stripe ohne Keys wirft; mit beiden Keys ok', () => {
    expect(() => parseEnv({ ...BASE, BILLING_DRIVER: 'stripe' } as NodeJS.ProcessEnv)).toThrow(/STRIPE_SECRET_KEY/);
    expect(() =>
      parseEnv({
        ...BASE,
        BILLING_DRIVER: 'stripe',
        STRIPE_SECRET_KEY: 'sk_test_x',
      } as NodeJS.ProcessEnv),
    ).toThrow(/STRIPE_WEBHOOK_SECRET/);
    expect(() =>
      parseEnv({
        ...BASE,
        BILLING_DRIVER: 'stripe',
        STRIPE_SECRET_KEY: 'sk_test_x',
        STRIPE_WEBHOOK_SECRET: 'whsec_x',
      } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });

  it('unbekannter Driver wird abgelehnt', () => {
    expect(() => envSchema.parse({ ...BASE, BILLING_DRIVER: 'paddle' })).toThrow();
  });
});
```

(Hinweis: `parseEnv`-Fehlermeldung nennt beide Keys in EINEM String — der zweite Assert oben prüft deshalb ebenfalls nur `/STRIPE_WEBHOOK_SECRET/`, was in der gemeinsamen Message enthalten ist. Wenn die Message-Zeile exakt wie in Step 2 übernommen wird, matchen beide Regexe.)

Run: `pnpm test tests/env-billing.test.ts tests/env-discogs.test.ts`
Expected: PASS.

- [ ] **Step 4: Billing-Typen**

Create `src/lib/billing/types.ts`:

```ts
// Billing-Adapter-Schnittstelle (Spec §7, Spiegel des Discogs-Musters).
// Bewusst OHNE DB-Zugriff in den Typen: subscription_updated trägt die rohe priceId —
// die Rückauflösung priceId → plans.slug macht der Apply-Handler (src/lib/billing/apply.ts),
// damit die Driver rein bleiben (Spec-Amendment zu §7).

export interface BillingAdapter {
  createCheckoutSession(args: {
    tenantId: number;
    planSlug: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string }>;
  createPortalSession(args: { customerId: string; returnUrl: string }): Promise<{ url: string }>;
  /** Wirft BillingSignatureError bei ungültiger Signatur (Spec §9.1). */
  parseWebhookEvent(rawBody: string, signature: string): BillingEvent;
}

/** `type` = roher Provider-Event-Typ (Stripe event.type; Fake: identisch zu kind) → webhook_events.type. */
export type BillingEvent =
  | {
      kind: 'checkout_completed';
      eventId: string;
      type: string;
      tenantId: number;
      planSlug: string;
      customerId: string;
      subscriptionId: string;
    }
  | {
      kind: 'subscription_updated';
      eventId: string;
      type: string;
      customerId: string;
      subscriptionId: string;
      status: string;
      priceId: string | null;
      currentPeriodEnd: Date | null;
      cancelAtPeriodEnd: boolean;
    }
  | {
      kind: 'subscription_deleted';
      eventId: string;
      type: string;
      customerId: string;
      subscriptionId: string;
    }
  | { kind: 'ignored'; eventId: string; type: string };

export class BillingSignatureError extends Error {}
/** Konfigurationsfehler (fehlender Key / fehlende stripePriceId) — 500er-Klasse, kein User-Fehler. */
export class BillingConfigError extends Error {}
```

- [ ] **Step 5: Store (Persistenz, von Fake-Driver UND Apply-Handler geteilt)**

Create `src/lib/billing/store.ts`:

```ts
import 'server-only';
import { eq } from 'drizzle-orm';
import { withOwner, withTenant, type TenantCtx, type Tx } from '@/db/tenant';
import { plans, subscriptions, tenants } from '@/db/schema';

export type SubscriptionInfo = {
  planSlug: string;
  status: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
};

/** RLS-gebundene Leseansicht für den Abo-Tab (max. 1 Zeile pro Tenant — UNIQUE tenant_id). */
export async function getSubscriptionForTenant(ctx: TenantCtx): Promise<SubscriptionInfo | null> {
  return withTenant(ctx, async (tx) => {
    const rows = await tx.select().from(subscriptions).limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      planSlug: r.planSlug,
      status: r.status,
      stripeCustomerId: r.stripeCustomerId,
      stripeSubscriptionId: r.stripeSubscriptionId,
      currentPeriodEnd: r.currentPeriodEnd,
      cancelAtPeriodEnd: r.cancelAtPeriodEnd,
    };
  });
}

/** Server ist Preisautorität (Global Constraint 4): Price-Id kommt aus plans, nie vom Client. */
export async function getStripePriceId(planSlug: string): Promise<string | null> {
  return withOwner(async (tx) => {
    const rows = await tx
      .select({ stripePriceId: plans.stripePriceId })
      .from(plans)
      .where(eq(plans.slug, planSlug))
      .limit(1);
    return rows[0]?.stripePriceId ?? null;
  });
}

/** Für den Abo-Tab: Anzeigematrix aller Pläne (Integer-Cents). */
export async function listPlans(): Promise<{ slug: string; name: string; priceMonthlyCents: number }[]> {
  return withOwner((tx) =>
    tx
      .select({ slug: plans.slug, name: plans.name, priceMonthlyCents: plans.priceMonthlyCents })
      .from(plans)
      .orderBy(plans.priceMonthlyCents),
  );
}

export type UpsertSubscriptionArgs = {
  tenantId: number;
  planSlug: string;
  customerId: string;
  subscriptionId: string;
  status: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
};

/**
 * Upsert der Abo-Zeile (Konfliktziel tenantId) + tenants.plan-Flip — INNERHALB der übergebenen
 * Owner-Tx (der Webhook-Handler teilt sich die Tx mit dem Dedup-Insert, T6).
 */
export async function upsertSubscriptionAndPlanTx(tx: Tx, args: UpsertSubscriptionArgs): Promise<void> {
  await tx
    .insert(subscriptions)
    .values({
      tenantId: args.tenantId,
      stripeCustomerId: args.customerId,
      stripeSubscriptionId: args.subscriptionId,
      planSlug: args.planSlug,
      status: args.status,
      currentPeriodEnd: args.currentPeriodEnd,
      cancelAtPeriodEnd: args.cancelAtPeriodEnd,
    })
    .onConflictDoUpdate({
      target: subscriptions.tenantId,
      set: {
        stripeCustomerId: args.customerId,
        stripeSubscriptionId: args.subscriptionId,
        planSlug: args.planSlug,
        status: args.status,
        currentPeriodEnd: args.currentPeriodEnd,
        cancelAtPeriodEnd: args.cancelAtPeriodEnd,
        updatedAt: new Date(),
      },
    });
  await tx
    .update(tenants)
    .set({ plan: args.planSlug, updatedAt: new Date() })
    .where(eq(tenants.id, args.tenantId));
}

/** Eigenständige Owner-Tx-Variante — vom Fake-Checkout benutzt (Spec §7 Fake-Driver). */
export async function upsertSubscriptionAndPlan(args: UpsertSubscriptionArgs): Promise<void> {
  await withOwner((tx) => upsertSubscriptionAndPlanTx(tx, args));
}
```

- [ ] **Step 6: Fake-Driver**

Create `src/lib/billing/fake.ts`:

```ts
import 'server-only';
import { upsertSubscriptionAndPlan } from './store';
import { BillingSignatureError, type BillingAdapter, type BillingEvent } from './types';

export const FAKE_SIGNATURE = 'fake';
export function fakeCustomerId(tenantId: number): string {
  return `fake_cus_${tenantId}`;
}
export function fakeSubscriptionId(tenantId: number): string {
  return `fake_sub_${tenantId}`;
}

const VALID_KINDS = new Set(['checkout_completed', 'subscription_updated', 'subscription_deleted', 'ignored']);

export function createFakeBillingAdapter(): BillingAdapter {
  return {
    async createCheckoutSession({ tenantId, planSlug, successUrl }) {
      // Fake-Checkout schließt SOFORT ab (Spec §7): Upsert + Plan-Flip im Owner-Kontext mit
      // deterministischen IDs, dann direkt zurück zur successUrl — der komplette
      // Upgrade-Flow ist ohne Stripe-Keys E2E-testbar.
      await upsertSubscriptionAndPlan({
        tenantId,
        planSlug,
        customerId: fakeCustomerId(tenantId),
        subscriptionId: fakeSubscriptionId(tenantId),
        status: 'active',
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        cancelAtPeriodEnd: false,
      });
      return { url: successUrl };
    },

    async createPortalSession({ returnUrl }) {
      return { url: returnUrl };
    },

    parseWebhookEvent(rawBody, signature) {
      // Für Integrationstests des Webhook-Handlers (Spec §7): Body = BillingEvent-JSON,
      // Signatur muss exakt 'fake' sein; currentPeriodEnd wird aus ISO-String revived.
      if (signature !== FAKE_SIGNATURE) throw new BillingSignatureError('invalid fake signature');
      let raw: Record<string, unknown>;
      try {
        raw = JSON.parse(rawBody) as Record<string, unknown>;
      } catch {
        throw new BillingSignatureError('fake webhook body is not JSON');
      }
      if (typeof raw.kind !== 'string' || !VALID_KINDS.has(raw.kind) || typeof raw.eventId !== 'string') {
        throw new BillingSignatureError('fake webhook body is not a BillingEvent');
      }
      if (typeof raw.type !== 'string') raw.type = raw.kind;
      if (typeof raw.currentPeriodEnd === 'string') raw.currentPeriodEnd = new Date(raw.currentPeriodEnd);
      return raw as unknown as BillingEvent;
    },
  };
}
```

- [ ] **Step 7: Stripe-Driver (Mapping pure + exportiert)**

Create `src/lib/billing/stripe.ts`:

```ts
import 'server-only';
import Stripe from 'stripe';
import { env } from '@/env';
import { getStripePriceId } from './store';
import {
  BillingConfigError,
  BillingSignatureError,
  type BillingAdapter,
  type BillingEvent,
} from './types';

let client: Stripe | null = null;
function stripeClient(): Stripe {
  if (!client) {
    if (!env.STRIPE_SECRET_KEY) throw new BillingConfigError('STRIPE_SECRET_KEY fehlt');
    // Ohne apiVersion-Pin: SDK nutzt die Account-Default-Version (Test-Mode, Spec §7).
    client = new Stripe(env.STRIPE_SECRET_KEY);
  }
  return client;
}

/**
 * Liest current_period_end versionstolerant: neuere Stripe-API-Versionen (Basil, 2025+)
 * tragen es auf dem Subscription-Item, ältere auf der Subscription selbst.
 */
function subscriptionPeriodEnd(sub: Stripe.Subscription): Date | null {
  const item = sub.items?.data?.[0] as unknown as { current_period_end?: number } | undefined;
  const unix =
    item?.current_period_end ??
    (sub as unknown as { current_period_end?: number }).current_period_end;
  return typeof unix === 'number' ? new Date(unix * 1000) : null;
}

function customerIdOf(customer: string | { id: string } | null): string {
  if (typeof customer === 'string') return customer;
  return customer?.id ?? '';
}

/** Pure Mapping Stripe.Event → BillingEvent (Spec §7) — exportiert für Unit-Tests. */
export function mapStripeEvent(event: Stripe.Event): BillingEvent {
  switch (event.type) {
    case 'checkout.session.completed': {
      const s = event.data.object as Stripe.Checkout.Session;
      const tenantId = Number(s.metadata?.tenantId ?? s.client_reference_id);
      const planSlug = s.metadata?.planSlug ?? '';
      const subscriptionId =
        typeof s.subscription === 'string' ? s.subscription : (s.subscription?.id ?? '');
      if (!Number.isInteger(tenantId) || tenantId <= 0 || !planSlug || !subscriptionId) {
        // Checkout ohne unsere Metadata (fremd/handgeklickt) → nicht verarbeitbar, kein Fehler.
        console.warn(`[billing] checkout.session.completed ohne verwertbare Metadata — ignoriert (${event.id})`);
        return { kind: 'ignored', eventId: event.id, type: event.type };
      }
      return {
        kind: 'checkout_completed',
        eventId: event.id,
        type: event.type,
        tenantId,
        planSlug,
        customerId: customerIdOf(s.customer as string | { id: string } | null),
        subscriptionId,
      };
    }
    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription;
      return {
        kind: 'subscription_updated',
        eventId: event.id,
        type: event.type,
        customerId: customerIdOf(sub.customer as string | { id: string }),
        subscriptionId: sub.id,
        status: sub.status,
        priceId: sub.items?.data?.[0]?.price?.id ?? null,
        currentPeriodEnd: subscriptionPeriodEnd(sub),
        cancelAtPeriodEnd: sub.cancel_at_period_end === true,
      };
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      return {
        kind: 'subscription_deleted',
        eventId: event.id,
        type: event.type,
        customerId: customerIdOf(sub.customer as string | { id: string }),
        subscriptionId: sub.id,
      };
    }
    default:
      return { kind: 'ignored', eventId: event.id, type: event.type };
  }
}

export function createStripeBillingAdapter(): BillingAdapter {
  return {
    async createCheckoutSession({ tenantId, planSlug, successUrl, cancelUrl }) {
      const priceId = await getStripePriceId(planSlug);
      if (!priceId) throw new BillingConfigError(`Plan "${planSlug}" hat keine stripePriceId`);
      const session = await stripeClient().checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        client_reference_id: String(tenantId),
        metadata: { tenantId: String(tenantId), planSlug },
        subscription_data: { metadata: { tenantId: String(tenantId) } },
      });
      if (!session.url) throw new BillingConfigError('Stripe Checkout-Session ohne URL');
      return { url: session.url };
    },

    async createPortalSession({ customerId, returnUrl }) {
      const session = await stripeClient().billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
      });
      return { url: session.url };
    },

    parseWebhookEvent(rawBody, signature) {
      if (!env.STRIPE_WEBHOOK_SECRET) throw new BillingConfigError('STRIPE_WEBHOOK_SECRET fehlt');
      let event: Stripe.Event;
      try {
        event = stripeClient().webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
      } catch (err) {
        throw new BillingSignatureError(err instanceof Error ? err.message : 'invalid signature');
      }
      return mapStripeEvent(event);
    },
  };
}
```

Create `src/lib/billing/index.ts` (Spiegel `src/lib/discogs/index.ts`):

```ts
import 'server-only';
import { env } from '@/env';
import type { BillingAdapter } from './types';
import { createFakeBillingAdapter } from './fake';
import { createStripeBillingAdapter } from './stripe';

let cached: BillingAdapter | null = null;
export function getBillingAdapter(): BillingAdapter {
  if (cached) return cached;
  cached = env.BILLING_DRIVER === 'stripe' ? createStripeBillingAdapter() : createFakeBillingAdapter();
  return cached;
}
```

- [ ] **Step 8: Unit-Tests Mapping + Fake-Parse**

Create `tests/billing-stripe-mapping.test.ts`:

```ts
// Slice 6 T5 — mapStripeEvent (Spec §14): aufgezeichnete Test-Payload-Formen → BillingEvent,
// fehlende Metadata → ignored, unbekannte Typen → ignored, Basil-Item-PeriodEnd.
import { describe, it, expect } from 'vitest';
import type Stripe from 'stripe';
import { mapStripeEvent } from '@/lib/billing/stripe';

function ev(type: string, object: unknown, id = 'evt_test_1'): Stripe.Event {
  return { id, type, data: { object } } as unknown as Stripe.Event;
}

describe('mapStripeEvent', () => {
  it('checkout.session.completed mit Metadata → checkout_completed', () => {
    const e = mapStripeEvent(
      ev('checkout.session.completed', {
        customer: 'cus_123',
        subscription: 'sub_123',
        client_reference_id: '7',
        metadata: { tenantId: '7', planSlug: 'small' },
      }),
    );
    expect(e).toEqual({
      kind: 'checkout_completed',
      eventId: 'evt_test_1',
      type: 'checkout.session.completed',
      tenantId: 7,
      planSlug: 'small',
      customerId: 'cus_123',
      subscriptionId: 'sub_123',
    });
  });

  it('checkout ohne Metadata → ignored (kein Throw)', () => {
    const e = mapStripeEvent(
      ev('checkout.session.completed', { customer: 'cus_x', subscription: 'sub_x', metadata: {} }),
    );
    expect(e.kind).toBe('ignored');
  });

  it('customer.subscription.updated → priceId + Item-PeriodEnd (Basil) + cancelAtPeriodEnd', () => {
    const e = mapStripeEvent(
      ev('customer.subscription.updated', {
        id: 'sub_123',
        customer: 'cus_123',
        status: 'active',
        cancel_at_period_end: true,
        items: { data: [{ price: { id: 'price_small' }, current_period_end: 1_790_000_000 }] },
      }),
    );
    expect(e).toMatchObject({
      kind: 'subscription_updated',
      subscriptionId: 'sub_123',
      customerId: 'cus_123',
      status: 'active',
      priceId: 'price_small',
      cancelAtPeriodEnd: true,
    });
    expect((e as { currentPeriodEnd: Date }).currentPeriodEnd.getTime()).toBe(1_790_000_000_000);
  });

  it('updated ohne Item-PeriodEnd fällt auf Subscription-Level zurück; ohne Price → priceId null', () => {
    const e = mapStripeEvent(
      ev('customer.subscription.updated', {
        id: 'sub_9',
        customer: { id: 'cus_9' },
        status: 'past_due',
        cancel_at_period_end: false,
        current_period_end: 1_790_000_000,
        items: { data: [] },
      }),
    );
    expect(e).toMatchObject({ priceId: null, customerId: 'cus_9', status: 'past_due' });
    expect((e as { currentPeriodEnd: Date }).currentPeriodEnd.getTime()).toBe(1_790_000_000_000);
  });

  it('customer.subscription.deleted → subscription_deleted', () => {
    const e = mapStripeEvent(
      ev('customer.subscription.deleted', { id: 'sub_del', customer: 'cus_del' }),
    );
    expect(e).toEqual({
      kind: 'subscription_deleted',
      eventId: 'evt_test_1',
      type: 'customer.subscription.deleted',
      customerId: 'cus_del',
      subscriptionId: 'sub_del',
    });
  });

  it('unbekannter Event-Typ → ignored', () => {
    expect(mapStripeEvent(ev('invoice.paid', {})).kind).toBe('ignored');
  });
});
```

Create `tests/billing-fake.test.ts`:

```ts
// Slice 6 T5 — Fake-Driver-Parse (DB-Effekte des Fake-Checkouts testet tests/billing.integration.test.ts).
import { describe, it, expect } from 'vitest';
import { createFakeBillingAdapter, fakeCustomerId, fakeSubscriptionId, FAKE_SIGNATURE } from '@/lib/billing/fake';
import { BillingSignatureError } from '@/lib/billing/types';

describe('fake billing adapter — parse/ids', () => {
  it('deterministische IDs', () => {
    expect(fakeCustomerId(42)).toBe('fake_cus_42');
    expect(fakeSubscriptionId(42)).toBe('fake_sub_42');
  });

  it('parseWebhookEvent akzeptiert nur Signatur "fake" und valide BillingEvent-JSON', () => {
    const adapter = createFakeBillingAdapter();
    const body = JSON.stringify({
      kind: 'subscription_updated', eventId: 'fake_evt_1', customerId: 'fake_cus_1',
      subscriptionId: 'fake_sub_1', status: 'active', priceId: null,
      currentPeriodEnd: '2026-08-01T00:00:00.000Z', cancelAtPeriodEnd: false,
    });
    expect(() => adapter.parseWebhookEvent(body, 'wrong')).toThrow(BillingSignatureError);
    expect(() => adapter.parseWebhookEvent('not json', FAKE_SIGNATURE)).toThrow(BillingSignatureError);
    expect(() => adapter.parseWebhookEvent('{"kind":"nope","eventId":"x"}', FAKE_SIGNATURE)).toThrow(BillingSignatureError);
    const parsed = adapter.parseWebhookEvent(body, FAKE_SIGNATURE);
    expect(parsed.kind).toBe('subscription_updated');
    expect(parsed.type).toBe('subscription_updated'); // type fällt auf kind zurück
    expect((parsed as { currentPeriodEnd: Date }).currentPeriodEnd).toBeInstanceOf(Date);
  });
});
```

Run: `pnpm test tests/billing-stripe-mapping.test.ts tests/billing-fake.test.ts`
Expected: PASS. (Beide importieren transitiv `@/env` über store/stripe — vitest lädt env aus den in `tests/helpers/db.ts` gesetzten bzw. den Projekt-Test-Defaults; falls der Import von `@/lib/billing/fake` wegen `@/db/client`-Bindung an nicht-existente DB knallt: NICHT die DB anfassen — `fake.ts` importiert store nur, verbindet aber erst bei Aufruf. Pool-Konstruktion in client.ts ist lazy genug, sie öffnet keine Verbindung beim Import.)

- [ ] **Step 9: Env-Dateien dokumentieren**

In `.env.example` nach dem Discogs-Block:

```
# ── Billing ──────────────────────────────────────────────────
# 'fake' = In-Process-Driver (Dev/E2E, kein Stripe-Account nötig); 'stripe' = echtes Stripe (Test-Mode).
BILLING_DRIVER=fake
# Pflicht bei BILLING_DRIVER=stripe (Test-Mode-Keys: https://dashboard.stripe.com/test/apikeys):
# STRIPE_SECRET_KEY=sk_test_...
# STRIPE_WEBHOOK_SECRET=whsec_...
```

In `.env.compose` nach dem `DISCOGS_DRIVER=fake`-Block:

```
# BILLING_DRIVER=fake → In-Process-Fake-Checkout; die Billing-E2E (Szenario 4) hängt daran.
BILLING_DRIVER=fake
```

- [ ] **Step 10: Lint/Typecheck + Commit**

Run: `pnpm lint && pnpm typecheck`
Expected: 0 Fehler.

```bash
git add package.json pnpm-lock.yaml src/env.ts src/lib/billing .env.example .env.compose tests/env-billing.test.ts tests/billing-stripe-mapping.test.ts tests/billing-fake.test.ts
git commit -m "feat(slice6): T5 Billing-Adapter — BILLING_DRIVER=fake|stripe, Stripe-Event-Mapping, Fake-Sofort-Checkout, Store

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Webhook — Apply-Handler (Dedup + Effekte in EINER Owner-Tx) + Route

**Files:**
- Create: `src/lib/billing/apply.ts`
- Create: `src/app/api/billing/webhook/route.ts`
- Test: `tests/billing.integration.test.ts`

**Interfaces:**
- Consumes: `BillingEvent`/`BillingSignatureError` (T5), `upsertSubscriptionAndPlanTx` (T5), `webhookEvents`/`subscriptions`/`plans`/`tenants`-Schema (T1), `getBillingAdapter` (T5), Middleware-Allowlist `/api/billing/webhook` (T3).
- Produces (CONTRACTS C6):
  - `processBillingEvent(event: BillingEvent): Promise<'applied' | 'duplicate' | 'ignored' | 'unknown_target'>` — Dedup-Insert + Anwendung in EINER `withOwner`-Transaktion (Fehler rollt beides zurück → Stripe-Retry verarbeitet sauber neu)
  - `POST /api/billing/webhook`: 400 bei Signaturfehler, sonst immer 200 `{"received":true}` (auch duplicate/ignored/unknown_target), 500 nur bei DB-Fehler

- [ ] **Step 1: Apply-Handler**

Create `src/lib/billing/apply.ts`:

```ts
import 'server-only';
import { eq } from 'drizzle-orm';
import { withOwner } from '@/db/tenant';
import { plans, subscriptions, tenants, webhookEvents } from '@/db/schema';
import { upsertSubscriptionAndPlanTx } from './store';
import type { BillingEvent } from './types';

export type ApplyResult = 'applied' | 'duplicate' | 'ignored' | 'unknown_target';

/**
 * Webhook-Verarbeitung (Spec §9): Dedup-Insert + Effekt in EINER Owner-Transaktion.
 * Wirft die Tx (z. B. DB down) NACH dem Dedup-Insert, rollt der Insert mit zurück —
 * der Stripe-Retry läuft dann sauber erneut durch. Unbekannte Ziele (Customer/Subscription/
 * Tenant/Plan) sind KEIN Fehler: warn + 'unknown_target' → Route antwortet 200
 * (kein Retry-Sturm für verwaiste Test-Events, Spec §9.4).
 */
export async function processBillingEvent(event: BillingEvent): Promise<ApplyResult> {
  return withOwner(async (tx) => {
    const inserted = await tx
      .insert(webhookEvents)
      .values({ id: event.eventId, type: event.type })
      .onConflictDoNothing()
      .returning({ id: webhookEvents.id });
    if (inserted.length === 0) return 'duplicate';

    switch (event.kind) {
      case 'checkout_completed': {
        const [tenant] = await tx
          .select({ id: tenants.id })
          .from(tenants)
          .where(eq(tenants.id, event.tenantId))
          .limit(1);
        if (!tenant) {
          console.warn(`[billing] checkout für unbekannten Tenant ${event.tenantId} — übersprungen (${event.eventId})`);
          return 'unknown_target';
        }
        const [plan] = await tx
          .select({ slug: plans.slug })
          .from(plans)
          .where(eq(plans.slug, event.planSlug))
          .limit(1);
        if (!plan) {
          console.warn(`[billing] checkout mit unbekanntem Plan "${event.planSlug}" — übersprungen (${event.eventId})`);
          return 'unknown_target';
        }
        await upsertSubscriptionAndPlanTx(tx, {
          tenantId: event.tenantId,
          planSlug: event.planSlug,
          customerId: event.customerId,
          subscriptionId: event.subscriptionId,
          status: 'active',
          currentPeriodEnd: null, // folgt mit dem ersten subscription_updated
          cancelAtPeriodEnd: false,
        });
        return 'applied';
      }

      case 'subscription_updated': {
        const [sub] = await tx
          .select({ id: subscriptions.id, tenantId: subscriptions.tenantId })
          .from(subscriptions)
          .where(eq(subscriptions.stripeSubscriptionId, event.subscriptionId))
          .limit(1);
        if (!sub) {
          console.warn(`[billing] update für unbekannte Subscription ${event.subscriptionId} — übersprungen (${event.eventId})`);
          return 'unknown_target';
        }
        // priceId → plans.slug (Spec §7-Amendment: Auflösung HIER, nicht im Driver).
        let planSlug: string | null = null;
        if (event.priceId) {
          const [p] = await tx
            .select({ slug: plans.slug })
            .from(plans)
            .where(eq(plans.stripePriceId, event.priceId))
            .limit(1);
          planSlug = p?.slug ?? null;
          if (!planSlug) {
            console.warn(`[billing] unbekannte priceId ${event.priceId} — Zeile wird ohne Plan-Wechsel aktualisiert (${event.eventId})`);
          }
        }
        await tx
          .update(subscriptions)
          .set({
            status: event.status,
            currentPeriodEnd: event.currentPeriodEnd,
            cancelAtPeriodEnd: event.cancelAtPeriodEnd,
            ...(planSlug ? { planSlug } : {}),
            updatedAt: new Date(),
          })
          .where(eq(subscriptions.id, sub.id));
        if (planSlug) {
          await tx
            .update(tenants)
            .set({ plan: planSlug, updatedAt: new Date() })
            .where(eq(tenants.id, sub.tenantId));
        }
        return 'applied';
      }

      case 'subscription_deleted': {
        const [sub] = await tx
          .select({ id: subscriptions.id, tenantId: subscriptions.tenantId })
          .from(subscriptions)
          .where(eq(subscriptions.stripeSubscriptionId, event.subscriptionId))
          .limit(1);
        if (!sub) {
          console.warn(`[billing] delete für unbekannte Subscription ${event.subscriptionId} — übersprungen (${event.eventId})`);
          return 'unknown_target';
        }
        await tx.delete(subscriptions).where(eq(subscriptions.id, sub.id));
        await tx
          .update(tenants)
          .set({ plan: 'free', updatedAt: new Date() })
          .where(eq(tenants.id, sub.tenantId));
        return 'applied';
      }

      case 'ignored':
        return 'ignored';
    }
  });
}
```

- [ ] **Step 2: Route**

Create `src/app/api/billing/webhook/route.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { getBillingAdapter } from '@/lib/billing';
import { BillingSignatureError } from '@/lib/billing/types';
import { processBillingEvent } from '@/lib/billing/apply';

// Node-Runtime (Default) — Owner-Pool + Stripe-SDK sind Node-only.
// Raw-Body VOR jedem JSON-Parse lesen: die Stripe-Signatur deckt die exakten Bytes (Spec §9).
export async function POST(request: NextRequest): Promise<Response> {
  const rawBody = await request.text();
  const signature = request.headers.get('stripe-signature') ?? '';

  let event;
  try {
    event = getBillingAdapter().parseWebhookEvent(rawBody, signature);
  } catch (err) {
    if (err instanceof BillingSignatureError) {
      return new NextResponse(null, { status: 400 });
    }
    throw err;
  }

  try {
    await processBillingEvent(event);
  } catch (err) {
    // Tx (inkl. Dedup-Insert) ist zurückgerollt → Stripe-Retry verarbeitet sauber neu.
    console.error('[billing] Webhook-Verarbeitung fehlgeschlagen', err);
    return new NextResponse(null, { status: 500 });
  }

  // Immer 200 ohne interne Details (Spec §9.5) — auch für duplicate/ignored/unknown_target.
  return NextResponse.json({ received: true });
}
```

- [ ] **Step 3: Integrationstest (Fake-Checkout-Effekte + Webhook-Lebenszyklus + Route)**

Create `tests/billing.integration.test.ts`:

```ts
// Slice 6 T5/T6 — Fake-Checkout (Sofort-Upsert, deterministische IDs), processBillingEvent
// (Dedup-Idempotenz, Statusübergänge completed→updated→deleted→free, unknown_target),
// Route (400 bei Signaturfehler, 200 sonst). Spec §14 Integration.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { setupTestDatabase, seedTenant, type TestDatabase } from './helpers/db';

let db: TestDatabase;
let owner: Pool;
let tenantId: number;

beforeAll(async () => {
  db = await setupTestDatabase();
  process.env.BILLING_DRIVER = 'fake';
  owner = new Pool({ connectionString: db.ownerUrl, max: 2 });
  const t = await seedTenant({ slug: 'billing', name: 'Billing Shop' });
  tenantId = t.tenantId;
  await owner.query(`UPDATE plans SET stripe_price_id = 'price_small' WHERE slug = 'small'`);
  await owner.query(`UPDATE plans SET stripe_price_id = 'price_big' WHERE slug = 'big'`);
}, 180_000);

afterAll(async () => {
  await owner.end();
  await db.teardown();
});

async function tenantPlan(): Promise<string> {
  const r = await owner.query(`SELECT plan FROM tenants WHERE id = $1`, [tenantId]);
  return r.rows[0].plan as string;
}

describe('fake checkout', () => {
  it('createCheckoutSession upsertet Abo + flippt Plan sofort und liefert successUrl', async () => {
    const { createFakeBillingAdapter } = await import('@/lib/billing/fake');
    const adapter = createFakeBillingAdapter();
    const { url } = await adapter.createCheckoutSession({
      tenantId,
      planSlug: 'small',
      successUrl: 'http://x.localhost/einstellungen?tab=abo&checkout=success',
      cancelUrl: 'http://x.localhost/einstellungen?tab=abo',
    });
    expect(url).toBe('http://x.localhost/einstellungen?tab=abo&checkout=success');
    expect(await tenantPlan()).toBe('small');
    const sub = await owner.query(`SELECT * FROM subscriptions WHERE tenant_id = $1`, [tenantId]);
    expect(sub.rows[0]).toMatchObject({
      stripe_customer_id: `fake_cus_${tenantId}`,
      stripe_subscription_id: `fake_sub_${tenantId}`,
      plan_slug: 'small',
      status: 'active',
    });
    // Zweiter Checkout (big) UPSERTET dieselbe Zeile (UNIQUE tenant_id):
    await adapter.createCheckoutSession({
      tenantId, planSlug: 'big', successUrl: 'http://x/s', cancelUrl: 'http://x/c',
    });
    const again = await owner.query(`SELECT count(*)::int AS n FROM subscriptions WHERE tenant_id = $1`, [tenantId]);
    expect(again.rows[0].n).toBe(1);
    expect(await tenantPlan()).toBe('big');
  });
});

describe('processBillingEvent', () => {
  it('Lebenszyklus completed → updated (Price-Auflösung) → deleted → plan free', async () => {
    const { processBillingEvent } = await import('@/lib/billing/apply');

    expect(
      await processBillingEvent({
        kind: 'checkout_completed', eventId: 'evt_1', type: 'checkout.session.completed',
        tenantId, planSlug: 'small', customerId: 'cus_w', subscriptionId: 'sub_w',
      }),
    ).toBe('applied');
    expect(await tenantPlan()).toBe('small');

    expect(
      await processBillingEvent({
        kind: 'subscription_updated', eventId: 'evt_2', type: 'customer.subscription.updated',
        customerId: 'cus_w', subscriptionId: 'sub_w', status: 'active',
        priceId: 'price_big', currentPeriodEnd: new Date('2026-08-01T00:00:00Z'), cancelAtPeriodEnd: false,
      }),
    ).toBe('applied');
    expect(await tenantPlan()).toBe('big');
    const row = await owner.query(`SELECT plan_slug, current_period_end FROM subscriptions WHERE tenant_id = $1`, [tenantId]);
    expect(row.rows[0].plan_slug).toBe('big');
    expect(new Date(row.rows[0].current_period_end).toISOString()).toBe('2026-08-01T00:00:00.000Z');

    // Unbekannte priceId → Zeile aktualisiert, Plan bleibt:
    expect(
      await processBillingEvent({
        kind: 'subscription_updated', eventId: 'evt_3', type: 'customer.subscription.updated',
        customerId: 'cus_w', subscriptionId: 'sub_w', status: 'past_due',
        priceId: 'price_unknown', currentPeriodEnd: null, cancelAtPeriodEnd: true,
      }),
    ).toBe('applied');
    expect(await tenantPlan()).toBe('big');
    const st = await owner.query(`SELECT status, cancel_at_period_end FROM subscriptions WHERE tenant_id = $1`, [tenantId]);
    expect(st.rows[0]).toMatchObject({ status: 'past_due', cancel_at_period_end: true });

    expect(
      await processBillingEvent({
        kind: 'subscription_deleted', eventId: 'evt_4', type: 'customer.subscription.deleted',
        customerId: 'cus_w', subscriptionId: 'sub_w',
      }),
    ).toBe('applied');
    expect(await tenantPlan()).toBe('free');
    const gone = await owner.query(`SELECT count(*)::int AS n FROM subscriptions WHERE tenant_id = $1`, [tenantId]);
    expect(gone.rows[0].n).toBe(0);
  });

  it('idempotent: gleiches Event zweimal → ein Effekt, zweiter Aufruf duplicate', async () => {
    const { processBillingEvent } = await import('@/lib/billing/apply');
    const event = {
      kind: 'checkout_completed' as const, eventId: 'evt_dup', type: 'checkout.session.completed',
      tenantId, planSlug: 'small', customerId: 'cus_d', subscriptionId: 'sub_d',
    };
    expect(await processBillingEvent(event)).toBe('applied');
    expect(await processBillingEvent(event)).toBe('duplicate');
    const n = await owner.query(`SELECT count(*)::int AS n FROM webhook_events WHERE id = 'evt_dup'`);
    expect(n.rows[0].n).toBe(1);
    // Aufräumen für Folge-Tests:
    await processBillingEvent({
      kind: 'subscription_deleted', eventId: 'evt_dup_del', type: 'customer.subscription.deleted',
      customerId: 'cus_d', subscriptionId: 'sub_d',
    });
  });

  it('unknown_target: unbekannte Subscription/Tenant → warn, kein Throw, Event bleibt dedupt', async () => {
    const { processBillingEvent } = await import('@/lib/billing/apply');
    expect(
      await processBillingEvent({
        kind: 'subscription_updated', eventId: 'evt_unknown', type: 'customer.subscription.updated',
        customerId: 'cus_x', subscriptionId: 'sub_niemals', status: 'active',
        priceId: null, currentPeriodEnd: null, cancelAtPeriodEnd: false,
      }),
    ).toBe('unknown_target');
    expect(
      await processBillingEvent({
        kind: 'checkout_completed', eventId: 'evt_ghost', type: 'checkout.session.completed',
        tenantId: 999_999, planSlug: 'small', customerId: 'cus_g', subscriptionId: 'sub_g',
      }),
    ).toBe('unknown_target');
  });

  it('ignored wird dedupt, hat aber keinen Effekt', async () => {
    const { processBillingEvent } = await import('@/lib/billing/apply');
    expect(
      await processBillingEvent({ kind: 'ignored', eventId: 'evt_ign', type: 'invoice.paid' }),
    ).toBe('ignored');
    const n = await owner.query(`SELECT type FROM webhook_events WHERE id = 'evt_ign'`);
    expect(n.rows[0].type).toBe('invoice.paid');
  });
});

describe('webhook route', () => {
  it('400 bei falscher Signatur, 200 {received:true} bei validem Fake-Event', async () => {
    const { POST } = await import('@/app/api/billing/webhook/route');
    const { NextRequest } = await import('next/server');

    const bad = await POST(
      new NextRequest('http://demo.localhost/api/billing/webhook', {
        method: 'POST',
        body: '{}',
        headers: { 'stripe-signature': 'wrong' },
      }),
    );
    expect(bad.status).toBe(400);

    const ok = await POST(
      new NextRequest('http://demo.localhost/api/billing/webhook', {
        method: 'POST',
        body: JSON.stringify({ kind: 'ignored', eventId: 'evt_route_1', type: 'invoice.paid' }),
        headers: { 'stripe-signature': 'fake' },
      }),
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ received: true });
  });
});
```

Run: `pnpm test tests/billing.integration.test.ts`
Expected: PASS (6 Tests).

- [ ] **Step 4: Lint/Typecheck + Commit**

Run: `pnpm lint && pnpm typecheck`
Expected: 0 Fehler.

```bash
git add src/lib/billing/apply.ts src/app/api/billing/webhook tests/billing.integration.test.ts
git commit -m "feat(slice6): T6 Billing-Webhook — Dedup+Apply in einer Owner-Tx, Statusuebergaenge, Route mit Signatur-Gate

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Einstellungen-Shell + Info-Tab + Nav-Einstieg (Sidebar + Mobile-Gear)

**Files:**
- Create: `src/lib/tenant-settings.ts`
- Create: `src/app/(app)/einstellungen/page.tsx`
- Create: `src/app/(app)/einstellungen/actions.ts` (T8/T9 hängen weitere Actions an dieselbe Datei an)
- Create: `src/app/(app)/einstellungen/_components/TabNav.tsx`
- Create: `src/app/(app)/einstellungen/_components/ShopInfoForm.tsx`
- Modify: `src/app/(app)/_components/SidebarNav.tsx` (+`adminOnly`-Flag + Einstellungen-Eintrag)
- Modify: `src/app/(app)/_components/MobileHeader.tsx` (+Gear-Icon-Link für Admins, +TITLES-Eintrag)
- Test: `tests/einstellungen-tabs.test.tsx`, Erweiterung `tests/slice6-actions.integration.test.ts`

**Interfaces:**
- Consumes: `requireSession`, `getCurrentTenant` (inkl. `onboardingCompletedAt` aus T1), `isValidOrigin`, `assertAccessibleAccent`, `HEX_COLOR_REGEX` (T1-Export), `withOwner`.
- Produces:
  - `updateTenantInfo(tenantId: number, input: { name: string; primaryColor: string }): Promise<void>` und `completeOnboarding(tenantId: number): Promise<void>` (`src/lib/tenant-settings.ts`)
  - `type SettingsTab = 'info' | 'discogs' | 'team' | 'abo'`
  - Action `updateShopInfoAction(prev, formData): Promise<ShopInfoState>` mit `ShopInfoState = { ok: boolean; error: string | null }`; FormData-Felder: `name`, `primaryColor`, `next: 'stay' | 'wizard'` (wizard → `redirect('/onboarding?step=2')` — geschlossene Whitelist statt freiem returnTo)
  - `ShopInfoForm`-Props: `{ initialName: string; initialColor: string; next?: 'stay' | 'wizard'; submitLabel?: string }` (Default `next='stay'`, `submitLabel='Speichern'`) — WIRD IN T11 WIEDERVERWENDET (ein Formular, zwei Einbettungen, Spec §12)
  - Route `/einstellungen?tab=<SettingsTab>` (Deep-Links aus Upsell/Checkout), admin-only (`forbidden()` für mitarbeiter/kunde)

- [ ] **Step 1: tenant-settings-Bibliothek**

Create `src/lib/tenant-settings.ts`:

```ts
import 'server-only';
import { eq } from 'drizzle-orm';
import { withOwner } from '@/db/tenant';
import { tenants } from '@/db/schema';

/**
 * Registry-Write (qr_owner): Shop-Name + Branding-Farbe. config wird gemerged —
 * logo bleibt erhalten. WCAG-Validierung (assertAccessibleAccent) macht der Aufrufer
 * VOR diesem Call (identisch zu provisionTenant).
 */
export async function updateTenantInfo(
  tenantId: number,
  input: { name: string; primaryColor: string },
): Promise<void> {
  await withOwner(async (tx) => {
    const [t] = await tx
      .select({ config: tenants.config })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (!t) throw new Error(`updateTenantInfo: Tenant ${tenantId} nicht gefunden`);
    const config = (t.config ?? {}) as {
      branding?: { primaryColor?: string; logo?: string | null };
    };
    const nextConfig = {
      ...config,
      branding: { primaryColor: input.primaryColor, logo: config.branding?.logo ?? null },
    };
    await tx
      .update(tenants)
      .set({ name: input.name, config: nextConfig, updatedAt: new Date() })
      .where(eq(tenants.id, tenantId));
  });
}

/** Setzt den Wizard-Abschluss (auch „Überspringen" — der Wizard erscheint nie zweimal, Spec §11). */
export async function completeOnboarding(tenantId: number): Promise<void> {
  await withOwner((tx) =>
    tx
      .update(tenants)
      .set({ onboardingCompletedAt: new Date(), updatedAt: new Date() })
      .where(eq(tenants.id, tenantId)),
  );
}
```

- [ ] **Step 2: Actions-Datei anlegen (Info-Tab-Teil)**

Create `src/app/(app)/einstellungen/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { forbidden, redirect } from 'next/navigation';
import { z } from 'zod';
import { requireSession } from '@/auth/session';
import { getCurrentTenant, assertAccessibleAccent } from '@/lib/tenant';
import { isValidOrigin } from '@/lib/csrf';
import { HEX_COLOR_REGEX } from '@/lib/provisioning';
import { updateTenantInfo } from '@/lib/tenant-settings';

export type ShopInfoState = { ok: boolean; error: string | null };

const shopInfoSchema = z.object({
  name: z.string().trim().min(1, 'Name darf nicht leer sein.'),
  primaryColor: z
    .string()
    .trim()
    .regex(HEX_COLOR_REGEX, 'Primärfarbe muss #RGB oder #RRGGBB sein.'),
  // Geschlossene Whitelist statt freiem returnTo (kein Open-Redirect):
  next: z.enum(['stay', 'wizard']).default('stay'),
});

export async function updateShopInfoAction(
  _prev: ShopInfoState,
  formData: FormData,
): Promise<ShopInfoState> {
  const user = await requireSession();
  if (!(user.role === 'admin' || user.isSuperadmin)) forbidden();
  if (!(await isValidOrigin())) return { ok: false, error: 'Ungültige Herkunft (Origin).' };

  const parsed = shopInfoSchema.safeParse({
    name: formData.get('name'),
    primaryColor: formData.get('primaryColor'),
    next: formData.get('next') ?? 'stay',
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Ungültige Eingaben.' };
  }

  try {
    assertAccessibleAccent(parsed.data.primaryColor); // WCAG AA 4.5:1 wie Provisioning (Spec §11.1)
  } catch {
    return {
      ok: false,
      error: 'Diese Farbe erreicht keinen ausreichenden Kontrast (WCAG AA 4.5:1) — bitte eine andere wählen.',
    };
  }

  const tenant = await getCurrentTenant();
  await updateTenantInfo(tenant.id, {
    name: parsed.data.name,
    primaryColor: parsed.data.primaryColor,
  });

  // Branding wirkt im gesamten Layout (Accent-Variablen) → Layout-weit revalidieren.
  revalidatePath('/', 'layout');

  if (parsed.data.next === 'wizard') redirect('/onboarding?step=2');
  return { ok: true, error: null };
}
```

- [ ] **Step 3: ShopInfoForm (geteilt Einstellungen ↔ Wizard)**

Create `src/app/(app)/einstellungen/_components/ShopInfoForm.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { Button, Input } from '@/components/ui';
import { updateShopInfoAction, type ShopInfoState } from '../actions';

const initialState: ShopInfoState = { ok: false, error: null };

/**
 * EIN Formular, zwei Einbettungen (Spec §12): Einstellungen-Info-Tab (next='stay')
 * und Wizard Schritt 1 (next='wizard' → Redirect auf ?step=2).
 */
export function ShopInfoForm({
  initialName,
  initialColor,
  next = 'stay',
  submitLabel = 'Speichern',
}: {
  initialName: string;
  initialColor: string;
  next?: 'stay' | 'wizard';
  submitLabel?: string;
}) {
  const [state, action, pending] = useActionState(updateShopInfoAction, initialState);
  return (
    <form
      action={action}
      data-testid="shop-info-form"
      style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 420 }}
    >
      <input type="hidden" name="next" value={next} />
      <label htmlFor="shop-name">Shop-Name</label>
      <Input id="shop-name" name="name" defaultValue={initialName} required aria-label="Shop-Name" />
      <label htmlFor="shop-color">Primärfarbe</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Input
          id="shop-color"
          name="primaryColor"
          defaultValue={initialColor}
          required
          aria-label="Primärfarbe"
          style={{ flex: 1 }}
        />
        <span
          aria-hidden="true"
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            background: initialColor,
            border: '1px solid var(--border-strong)',
            flexShrink: 0,
          }}
        />
      </div>
      {state.error ? <p role="alert">{state.error}</p> : null}
      {state.ok ? <p data-testid="shop-info-saved">Gespeichert.</p> : null}
      <Button type="submit" loading={pending}>
        {submitLabel}
      </Button>
    </form>
  );
}
```

(Falls `Input` kein `style`-Prop durchreicht: den Wrapper-`div` weglassen und den Swatch unter das Feld setzen — API von `src/components/ui/Input.tsx` vor Verwendung prüfen.)

- [ ] **Step 4: TabNav + Seite**

Create `src/app/(app)/einstellungen/_components/TabNav.tsx`:

```tsx
import Link from 'next/link';
import type { SettingsTab } from '../page';

const TABS: { key: SettingsTab; label: string }[] = [
  { key: 'info', label: 'Info' },
  { key: 'discogs', label: 'Discogs' },
  { key: 'team', label: 'Team' },
  { key: 'abo', label: 'Abo' },
];

export function TabNav({ active }: { active: SettingsTab }) {
  return (
    <nav
      aria-label="Einstellungen-Tabs"
      data-testid="einstellungen-tabs"
      style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 18 }}
    >
      {TABS.map(({ key, label }) => {
        const isActive = key === active;
        return (
          <Link
            key={key}
            href={`/einstellungen?tab=${key}`}
            aria-current={isActive ? 'page' : undefined}
            style={{
              minHeight: 'var(--tap)',
              display: 'inline-flex',
              alignItems: 'center',
              padding: '0 16px',
              borderRadius: 'var(--r-pill)',
              textDecoration: 'none',
              fontWeight: isActive ? 700 : 600,
              fontSize: '14px',
              background: isActive ? 'var(--accent)' : 'var(--surface-2)',
              color: isActive ? 'var(--on-accent)' : 'var(--text-2)',
              border: isActive ? '1px solid transparent' : '1px solid var(--border)',
            }}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
```

Create `src/app/(app)/einstellungen/page.tsx` (T7-Fassung: Info live, die drei anderen Tabs als Platzhalter-Karten, die T8/T9 ersetzen):

```tsx
import { forbidden } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { getCurrentTenant } from '@/lib/tenant';
import { TabNav } from './_components/TabNav';
import { ShopInfoForm } from './_components/ShopInfoForm';

export type SettingsTab = 'info' | 'discogs' | 'team' | 'abo';
const SETTINGS_TABS: readonly SettingsTab[] = ['info', 'discogs', 'team', 'abo'];

export default async function EinstellungenPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireSession();
  // Admin-only (Spec §12): mitarbeiter/kunde → 403.
  if (!(user.role === 'admin' || user.isSuperadmin)) forbidden();
  const tenant = await getCurrentTenant();

  const sp = await searchParams;
  const raw = typeof sp.tab === 'string' ? sp.tab : 'info';
  const tab: SettingsTab = (SETTINGS_TABS as readonly string[]).includes(raw)
    ? (raw as SettingsTab)
    : 'info';

  return (
    <section data-testid="einstellungen-screen" style={{ maxWidth: 760 }}>
      <header className="qr-page-header" style={{ marginBottom: 14 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 24, margin: 0 }}>
          Einstellungen
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 13.5, color: 'var(--text-3)' }}>{tenant.name}</p>
      </header>
      <TabNav active={tab} />
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-lg)',
          padding: 20,
        }}
      >
        {tab === 'info' ? (
          <ShopInfoForm initialName={tenant.name} initialColor={tenant.branding.primaryColor} />
        ) : null}
        {tab === 'discogs' ? <p data-testid="tab-discogs">Discogs-Tab folgt (T8).</p> : null}
        {tab === 'team' ? <p data-testid="tab-team">Team-Tab folgt (T8).</p> : null}
        {tab === 'abo' ? <p data-testid="tab-abo">Abo-Tab folgt (T9).</p> : null}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Nav-Einstieg (Sidebar admin-only + Mobile-Gear)**

In `src/app/(app)/_components/SidebarNav.tsx`:

1. Icon-Import ergänzen: `Settings` zu den lucide-Imports.
2. `NavItem`-Typ erweitern und Eintrag anhängen:

```ts
type NavItem = {
  href: string;
  label: string;
  Icon: LucideIcon;
  /** Visible only to staff (role ∈ {mitarbeiter, admin, superadmin}); hidden from `kunde`. */
  staffOnly?: boolean;
  /** Visible only to admin/superadmin (Spec §12: Einstellungen ist admin-only). */
  adminOnly?: boolean;
};
```

```ts
  { href: '/einstellungen', label: 'Einstellungen', Icon: Settings, adminOnly: true },
```

3. Filter erweitern (in `SidebarNav`):

```ts
  const isStaff = role !== 'kunde';
  const isAdmin = role === 'admin' || role === 'superadmin';
  const items = NAV_ITEMS.filter(
    (item) => (!item.staffOnly || isStaff) && (!item.adminOnly || isAdmin),
  );
```

In `src/app/(app)/_components/MobileHeader.tsx` (Spec-§12-Amendment: es gibt kein Mobile-Header-„Menü" — Einstieg ist ein Gear-Icon-Link):

1. Imports ergänzen: `import Link from 'next/link';` und `import { Settings } from 'lucide-react';`
2. TITLES-Eintrag anhängen:

```ts
  { match: (p) => p.startsWith('/einstellungen'), title: 'Einstellungen', subtitle: (t) => t },
```

3. Nach `<ThemeToggle />` einfügen:

```tsx
      {(role === 'admin' || role === 'superadmin') && (
        <Link
          href="/einstellungen"
          aria-label="Einstellungen"
          data-testid="mobile-settings-link"
          style={{
            width: 38,
            height: 38,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            color: 'var(--text-2)',
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            flexShrink: 0,
          }}
        >
          <Settings size={18} aria-hidden="true" />
        </Link>
      )}
```

- [ ] **Step 6: jsdom-Test für Tab-Shell + Nav-Gates**

Create `tests/einstellungen-tabs.test.tsx`:

```tsx
// Slice 6 T7 — TabNav (aktiver Tab, 4 Links, Deep-Link-Hrefs) + SidebarNav/MobileHeader-Gates.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TabNav } from '@/app/(app)/einstellungen/_components/TabNav';
import { SidebarNav } from '@/app/(app)/_components/SidebarNav';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

describe('TabNav', () => {
  it('rendert 4 Tabs mit ?tab=-Hrefs, aktiver Tab trägt aria-current', () => {
    render(<TabNav active="abo" />);
    const nav = screen.getByTestId('einstellungen-tabs');
    const links = nav.querySelectorAll('a');
    expect(links).toHaveLength(4);
    expect(links[0]!.getAttribute('href')).toBe('/einstellungen?tab=info');
    expect(links[3]!.getAttribute('href')).toBe('/einstellungen?tab=abo');
    expect(links[3]!.getAttribute('aria-current')).toBe('page');
    expect(links[0]!.getAttribute('aria-current')).toBeNull();
  });
});

describe('SidebarNav Einstellungen-Gate', () => {
  it('admin sieht Einstellungen, mitarbeiter und kunde nicht', () => {
    const { unmount } = render(<SidebarNav role="admin" />);
    expect(screen.getByText('Einstellungen')).toBeInTheDocument();
    unmount();
    const second = render(<SidebarNav role="mitarbeiter" />);
    expect(screen.queryByText('Einstellungen')).not.toBeInTheDocument();
    second.unmount();
    render(<SidebarNav role="kunde" />);
    expect(screen.queryByText('Einstellungen')).not.toBeInTheDocument();
  });
});
```

Run: `pnpm test tests/einstellungen-tabs.test.tsx`
Expected: PASS. (Bestehende `.tsx`-Tests laufen via environmentMatchGlobs in jsdom; `@testing-library/jest-dom`-Setup existiert bereits.)

- [ ] **Step 7: Integrationstest updateTenantInfo (an tests/slice6-actions.integration.test.ts anhängen)**

```ts
describe('T7 tenant settings', () => {
  it('updateTenantInfo schreibt Name + Farbe und erhält logo im config-Merge', async () => {
    const { provisionTenant } = await import('@/lib/provisioning');
    const { tenantId } = await provisionTenant({
      slug: 'settings-shop', name: 'Vorher', adminEmail: 'a@settings.test', primaryColor: '#C84B31',
    });
    await owner.query(
      `UPDATE tenants SET config = jsonb_set(config, '{branding,logo}', '"logo.png"') WHERE id = $1`,
      [tenantId],
    );
    const { updateTenantInfo, completeOnboarding } = await import('@/lib/tenant-settings');
    await updateTenantInfo(tenantId, { name: 'Nachher', primaryColor: '#5B4FCF' });
    const row = await owner.query(`SELECT name, config, onboarding_completed_at FROM tenants WHERE id = $1`, [tenantId]);
    expect(row.rows[0].name).toBe('Nachher');
    expect(row.rows[0].config.branding).toEqual({ primaryColor: '#5B4FCF', logo: 'logo.png' });
    expect(row.rows[0].onboarding_completed_at).toBeNull();

    await completeOnboarding(tenantId);
    const after = await owner.query(`SELECT onboarding_completed_at FROM tenants WHERE id = $1`, [tenantId]);
    expect(after.rows[0].onboarding_completed_at).not.toBeNull();
  });
});
```

Run: `pnpm test tests/slice6-actions.integration.test.ts`
Expected: PASS.

- [ ] **Step 8: Lint/Typecheck + Commit**

Run: `pnpm lint && pnpm typecheck`
Expected: 0 Fehler.

```bash
git add src/lib/tenant-settings.ts "src/app/(app)/einstellungen" "src/app/(app)/_components/SidebarNav.tsx" "src/app/(app)/_components/MobileHeader.tsx" tests/einstellungen-tabs.test.tsx tests/slice6-actions.integration.test.ts
git commit -m "feat(slice6): T7 Einstellungen-Shell (?tab=-Deep-Links, admin-only) + Info-Tab + Sidebar-/Mobile-Gear-Einstieg

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Discogs-Tab (OAuth-Reuse + identity()) + Team-Tab (maxUsers-Gate)

**Files:**
- Modify: `src/lib/discogs/types.ts`, `src/lib/discogs/client.ts`, `src/lib/discogs/fake.ts` (+`identity()`)
- Modify: `src/app/api/discogs/_shared.ts`, `connect/route.ts`, `callback/route.ts` (+returnTo-Whitelist)
- Create: `src/lib/team.ts`
- Modify: `src/app/(app)/einstellungen/actions.ts` (+Discogs-/Team-Actions)
- Create: `src/app/(app)/einstellungen/_components/DiscogsTab.tsx`, `_components/TestConnectionButton.tsx`, `_components/TeamTab.tsx`, `_components/CreateUserForm.tsx`, `_components/ResetPasswordButton.tsx`
- Modify: `src/app/(app)/einstellungen/page.tsx` (Platzhalter discogs/team ersetzen)
- Test: Erweiterung `tests/slice6-actions.integration.test.ts`; `tests/discogs-fake.test.ts` um identity()-Fall erweitern

**Interfaces:**
- Consumes: `getConnection`/`deleteConnection` (bestehend), `getDiscogsAdapter`, `checkUserCapacity`/`getEntitlements`/`LimitExceededError` (T2), `generateTempPassword` (T1), `sendCredentialsEmail`, `tenantUrl`.
- Produces:
  - `DiscogsAdapter.identity(auth: DiscogsAuth): Promise<{ username: string }>` (http: GET /oauth/identity; fake: `{ username: 'fake-seller' }`)
  - `_shared.ts`: `type DiscogsReturnTarget = 'ankauf' | 'einstellungen' | 'onboarding'`, `resolveReturnTarget(v: unknown): DiscogsReturnTarget` (Default `'ankauf'`), `RETURN_PATHS: Record<DiscogsReturnTarget, { ok: string; err: string }>`
  - Connect-Route akzeptiert `?from=einstellungen|onboarding`; Callback redirectet auf `RETURN_PATHS[target]`
  - `src/lib/team.ts`: `type TeamUser = { id: number; email: string; role: Role; createdAt: Date | null; mustChangePassword: boolean }`; `listTeamUsers(ctx): Promise<TeamUser[]>`; `class DuplicateEmailError`; `createTeamUser(ctx, ent, input: { email: string; role: 'mitarbeiter' | 'kunde' }): Promise<{ userId: number; temporaryPassword: string }>` (Staff-Rolle → `checkUserCapacity` in derselben Tx); `resetTeamUserPassword(ctx, userId): Promise<{ email: string; temporaryPassword: string } | null>`
  - Actions: `testDiscogsConnectionAction(): Promise<{ ok: boolean; message: string }>`; `createTeamUserAction(prev, formData): Promise<TeamActionState>`; `resetTeamPasswordAction(prev, formData): Promise<TeamActionState>` mit `TeamActionState = { ok: boolean; error: string | null; info: string | null }` — WERDEN IN T11 (Wizard Schritt 2/3) WIEDERVERWENDET

- [ ] **Step 1: identity() im Adapter (Test zuerst)**

In `tests/discogs-fake.test.ts` einen Fall anhängen:

```ts
  it('identity liefert den statischen Fake-Usernamen', async () => {
    const adapter = createFakeDiscogsAdapter();
    await expect(adapter.identity({ token: 't', tokenSecret: 's' })).resolves.toEqual({
      username: 'fake-seller',
    });
  });
```

Run: `pnpm test tests/discogs-fake.test.ts` — Expected: FAIL (identity fehlt). Dann implementieren:

`src/lib/discogs/types.ts` — im Interface nach `getAccessToken`:

```ts
  /** GET /oauth/identity — verifiziert Token-Gültigkeit („Verbindung testen", Spec §11.2/§12). */
  identity(auth: DiscogsAuth): Promise<{ username: string }>;
```

`src/lib/discogs/client.ts` — im Adapter-Objekt nach `getAccessToken`:

```ts
    async identity(auth: DiscogsAuth) {
      const body = (await requestJson('GET', '/oauth/identity', auth)) as { username: string };
      return { username: body.username };
    },
```

`src/lib/discogs/fake.ts` — im Adapter-Objekt nach `getAccessToken`:

```ts
    async identity(_auth: DiscogsAuth) {
      return { username: 'fake-seller' };
    },
```

Falls `tests/discogs-types.test-d.ts` oder Test-Doubles das Interface implementieren: dort ebenfalls `identity` ergänzen (Compiler zeigt die Stellen — `pnpm typecheck`).

Run: `pnpm test tests/discogs-fake.test.ts` — Expected: PASS.

- [ ] **Step 2: Connect/Callback-returnTo**

Replace `src/app/api/discogs/_shared.ts`:

```ts
export function discogsOAuthCookieName(protocol: 'http' | 'https'): string {
  return protocol === 'https' ? '__Host-discogs_oauth' : 'discogs_oauth';
}

export function parseCallbackParams(sp: URLSearchParams): {
  oauthToken: string | null;
  verifier: string | null;
} {
  return { oauthToken: sp.get('oauth_token'), verifier: sp.get('oauth_verifier') };
}

// Spec-§11.2-Amendment: Wizard/Einstellungen nutzen den BESTEHENDEN OAuth-Connect-Flow
// (keine manuellen Token-Felder). Geschlossene Whitelist statt freiem returnTo.
export type DiscogsReturnTarget = 'ankauf' | 'einstellungen' | 'onboarding';

export const RETURN_PATHS: Record<DiscogsReturnTarget, { ok: string; err: string }> = {
  ankauf: { ok: '/ankauf?connected=1', err: '/ankauf?error=connect' },
  einstellungen: {
    ok: '/einstellungen?tab=discogs&connected=1',
    err: '/einstellungen?tab=discogs&error=connect',
  },
  onboarding: { ok: '/onboarding?step=2&connected=1', err: '/onboarding?step=2&error=connect' },
};

export function resolveReturnTarget(v: unknown): DiscogsReturnTarget {
  return v === 'einstellungen' || v === 'onboarding' ? v : 'ankauf';
}
```

In `src/app/api/discogs/connect/route.ts`: Signatur auf `GET(request: NextRequest)` ändern (`import { NextResponse, type NextRequest } from 'next/server';`), Import `resolveReturnTarget` aus `../_shared`, und den Cookie-Payload erweitern:

```ts
export async function GET(request: NextRequest): Promise<Response> {
  const user = await requireSession();
  if (!(user.role === 'admin' || user.isSuperadmin)) forbidden();
  const tenant = await getCurrentTenant();
  const callbackUrl = `${tenantUrl(tenant.slug)}/api/discogs/callback`;
  const { token, tokenSecret, authorizeUrl } =
    await getDiscogsAdapter().getRequestToken(callbackUrl);

  const returnTo = resolveReturnTarget(request.nextUrl.searchParams.get('from'));
  const cookieValue = encryptSecret(JSON.stringify({ token, tokenSecret, returnTo }), {
    tenantId: user.tenantId,
  });
  (await cookies()).set(discogsOAuthCookieName(env.APP_PROTOCOL), cookieValue, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: env.APP_PROTOCOL === 'https',
    maxAge: 600,
  });
  return NextResponse.redirect(authorizeUrl);
}
```

In `src/app/api/discogs/callback/route.ts`: Imports um `resolveReturnTarget, RETURN_PATHS` erweitern; `back` und Cookie-Parse ersetzen:

```ts
  const jar = await cookies();
  const name = discogsOAuthCookieName(env.APP_PROTOCOL);
  const raw = jar.get(name)?.value;

  // returnTo steckt im verschlüsselten State-Cookie; ohne Cookie → Default 'ankauf'.
  let returnTo = resolveReturnTarget(null);
  let state: { token: string; tokenSecret: string } | null = null;
  if (raw) {
    try {
      const parsedState = JSON.parse(decryptSecret(raw, { tenantId: user.tenantId })) as {
        token: string;
        tokenSecret: string;
        returnTo?: unknown;
      };
      returnTo = resolveReturnTarget(parsedState.returnTo);
      state = { token: parsedState.token, tokenSecret: parsedState.tokenSecret };
    } catch {
      state = null;
    }
  }
  const back = (kind: 'ok' | 'err'): NextResponse =>
    NextResponse.redirect(`${tenantUrl(tenant.slug)}${RETURN_PATHS[returnTo][kind]}`);

  const { oauthToken, verifier } = parseCallbackParams(request.nextUrl.searchParams);
  if (!state || !oauthToken || !verifier) return back('err');
  try {
    if (state.token !== oauthToken) return back('err');
    const access = await getDiscogsAdapter().getAccessToken({
      requestToken: state.token,
      requestTokenSecret: state.tokenSecret,
      verifier,
    });
    await upsertConnection(
      { tenantId: user.tenantId, userId: user.id },
      {
        discogsUsername: access.username,
        auth: { token: access.token, tokenSecret: access.tokenSecret },
        connectedByUserId: user.id,
      },
    );
    jar.delete(name);
    return back('ok');
  } catch {
    return back('err');
  }
```

Run: `pnpm test tests/discogs-oauth-routes.integration.test.ts` — Expected: PASS (Default-Redirects `/ankauf?...` unverändert; falls der Test das Cookie-JSON-Format `{token, tokenSecret}` exakt asserted, um das optionale `returnTo`-Feld erweitern).

- [ ] **Step 3: Team-Bibliothek**

Create `src/lib/team.ts`:

```ts
import 'server-only';
import { eq } from 'drizzle-orm';
import { withTenant, type TenantCtx } from '@/db/tenant';
import { users, type Role } from '@/db/schema';
import { generateTempPassword } from '@/lib/provisioning';
import { hashPassword } from '@/lib/password';
import { checkUserCapacity, type Entitlements } from '@/lib/gating';

export type TeamUser = {
  id: number;
  email: string;
  role: Role;
  createdAt: Date | null;
  mustChangePassword: boolean;
};

export class DuplicateEmailError extends Error {
  constructor(email: string) {
    super(`E-Mail ${email} ist in diesem Shop bereits vergeben.`);
    this.name = 'DuplicateEmailError';
  }
}

export async function listTeamUsers(ctx: TenantCtx): Promise<TeamUser[]> {
  return withTenant(ctx, async (tx) => {
    const rows = await tx
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        createdAt: users.createdAt,
        mustChangePassword: users.mustChangePassword,
      })
      .from(users)
      .orderBy(users.id);
    return rows;
  });
}

function pgErrorCode(err: unknown): string | undefined {
  return (
    (err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code
  );
}

/**
 * User-Anlage (Wizard Schritt 3 + Team-Tab, Spec §11.3/§12): maxUsers-Gate NUR für
 * Staff-Rollen (kunde zählt nicht, Spec §10), Kapazitätsprüfung in DERSELBEN Tx wie der
 * Insert. Passwort generiert + mustChangePassword=true; Mail ist Sache des Aufrufers.
 */
export async function createTeamUser(
  ctx: TenantCtx,
  ent: Entitlements,
  input: { email: string; role: 'mitarbeiter' | 'kunde' },
): Promise<{ userId: number; temporaryPassword: string }> {
  const temporaryPassword = generateTempPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  const userId = await withTenant(ctx, async (tx) => {
    if (input.role !== 'kunde') {
      await checkUserCapacity(tx, ent, 1); // wirft LimitExceededError (CONTRACTS C8)
    }
    try {
      const [u] = await tx
        .insert(users)
        .values({
          tenantId: ctx.tenantId,
          email: input.email,
          password: passwordHash,
          role: input.role,
          mustChangePassword: true,
        })
        .returning({ id: users.id });
      return u!.id;
    } catch (err) {
      if (pgErrorCode(err) === '23505') throw new DuplicateEmailError(input.email);
      throw err;
    }
  });

  return { userId, temporaryPassword };
}

/** Neues temp. Passwort + mustChangePassword=true. null, wenn der User nicht (im Tenant) existiert. */
export async function resetTeamUserPassword(
  ctx: TenantCtx,
  userId: number,
): Promise<{ email: string; temporaryPassword: string } | null> {
  const temporaryPassword = generateTempPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  return withTenant(ctx, async (tx) => {
    const [u] = await tx.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    if (!u) return null;
    await tx
      .update(users)
      .set({ password: passwordHash, mustChangePassword: true, updatedAt: new Date() })
      .where(eq(users.id, userId));
    return { email: u.email, temporaryPassword };
  });
}
```

- [ ] **Step 4: Actions ergänzen**

In `src/app/(app)/einstellungen/actions.ts` anhängen (Imports oben ergänzen: `getConnection, deleteConnection` aus `@/lib/discogs-connection`, `getDiscogsAdapter` aus `@/lib/discogs`, `getEntitlements, LimitExceededError` aus `@/lib/gating`, `createTeamUser, resetTeamUserPassword, DuplicateEmailError` aus `@/lib/team`, `getEmailAdapter, sendCredentialsEmail` aus `@/lib/email`, `tenantUrl` aus `@/env`):

```ts
// ---------------------------------------------------------------------------
// Discogs-Tab (Spec §12 — OAuth-Reuse-Amendment: Verbinden läuft über
// /api/discogs/connect?from=einstellungen; hier nur Test + Trennen)
// ---------------------------------------------------------------------------

export async function testDiscogsConnectionAction(): Promise<{ ok: boolean; message: string }> {
  const user = await requireSession();
  if (!(user.role === 'admin' || user.isSuperadmin)) forbidden();
  // Lesend — kein Origin-Check (Konvention wie searchDiscogs).
  const conn = await getConnection({ tenantId: user.tenantId, userId: user.id });
  if (!conn) return { ok: false, message: 'Keine Verbindung konfiguriert.' };
  try {
    const { username } = await getDiscogsAdapter().identity(conn.auth);
    return { ok: true, message: `Verbunden als ${username}.` };
  } catch {
    return { ok: false, message: 'Verbindung fehlgeschlagen — bitte neu verbinden.' };
  }
}

// ---------------------------------------------------------------------------
// Team-Tab + Wizard Schritt 3 (Spec §11.3/§12)
// ---------------------------------------------------------------------------

export type TeamActionState = { ok: boolean; error: string | null; info: string | null };

const createUserSchema = z.object({
  email: z.string().trim().email('Bitte eine gültige E-Mail angeben.'),
  role: z.enum(['mitarbeiter', 'kunde']),
});

export async function createTeamUserAction(
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const user = await requireSession();
  if (!(user.role === 'admin' || user.isSuperadmin)) forbidden();
  if (!(await isValidOrigin())) return { ok: false, error: 'Ungültige Herkunft (Origin).', info: null };

  const parsed = createUserSchema.safeParse({
    email: formData.get('email'),
    role: formData.get('role'),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Ungültige Eingaben.', info: null };
  }

  const tenant = await getCurrentTenant();
  const ent = await getEntitlements(tenant.id);

  let temporaryPassword: string;
  try {
    ({ temporaryPassword } = await createTeamUser(
      { tenantId: tenant.id, userId: user.id },
      ent,
      parsed.data,
    ));
  } catch (err) {
    if (err instanceof LimitExceededError) return { ok: false, error: err.message, info: null };
    if (err instanceof DuplicateEmailError) {
      return { ok: false, error: 'Diese E-Mail ist bereits vergeben.', info: null };
    }
    console.error('[team] createTeamUser fehlgeschlagen', err);
    return { ok: false, error: 'Anlegen fehlgeschlagen.', info: null };
  }

  // Temp. Passwort NUR per Mail (Spec §11.3/§13.9) — soft-fail mit Hinweis.
  let info = `Zugangsdaten wurden an ${parsed.data.email} geschickt.`;
  try {
    await sendCredentialsEmail(getEmailAdapter(), {
      to: parsed.data.email,
      tenantName: tenant.name,
      loginUrl: `${tenantUrl(tenant.slug)}/login`,
      temporaryPassword,
    });
  } catch (err) {
    console.error('[team] Credentials-Mail fehlgeschlagen', err);
    info = 'User angelegt, aber die Mail konnte nicht verschickt werden — „Passwort zurücksetzen" schickt sie erneut.';
  }

  revalidatePath('/einstellungen');
  return { ok: true, error: null, info };
}

const resetPasswordSchema = z.object({ userId: z.coerce.number().int().positive() });

export async function resetTeamPasswordAction(
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const user = await requireSession();
  if (!(user.role === 'admin' || user.isSuperadmin)) forbidden();
  if (!(await isValidOrigin())) return { ok: false, error: 'Ungültige Herkunft (Origin).', info: null };

  const parsed = resetPasswordSchema.safeParse({ userId: formData.get('userId') });
  if (!parsed.success) return { ok: false, error: 'Ungültige Eingaben.', info: null };

  const tenant = await getCurrentTenant();
  const result = await resetTeamUserPassword(
    { tenantId: tenant.id, userId: user.id },
    parsed.data.userId,
  );
  if (!result) return { ok: false, error: 'User nicht gefunden.', info: null };

  try {
    await sendCredentialsEmail(getEmailAdapter(), {
      to: result.email,
      tenantName: tenant.name,
      loginUrl: `${tenantUrl(tenant.slug)}/login`,
      temporaryPassword: result.temporaryPassword,
    });
  } catch (err) {
    console.error('[team] Reset-Mail fehlgeschlagen', err);
    return { ok: false, error: 'Passwort zurückgesetzt, aber Mail-Versand fehlgeschlagen.', info: null };
  }
  revalidatePath('/einstellungen');
  return { ok: true, error: null, info: `Neues temporäres Passwort an ${result.email} geschickt.` };
}
```

- [ ] **Step 5: Tab-Komponenten**

Create `src/app/(app)/einstellungen/_components/TestConnectionButton.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui';
import { testDiscogsConnectionAction } from '../actions';

export function TestConnectionButton() {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Button
        type="button"
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await testDiscogsConnectionAction();
            setMessage(result.message);
          })
        }
      >
        Verbindung testen
      </Button>
      {message ? <p data-testid="discogs-test-result">{message}</p> : null}
    </div>
  );
}
```

Create `src/app/(app)/einstellungen/_components/DiscogsTab.tsx` (Server-Komponente):

```tsx
import { TestConnectionButton } from './TestConnectionButton';

/**
 * Verbindungsstatus + OAuth-Connect (Spec-§12-Amendment: Verbinden über den bestehenden
 * OAuth-Flow mit ?from=einstellungen — vorhandene Secrets werden NIE angezeigt).
 * Trennen bleibt beim bestehenden disconnectDiscogs auf /ankauf — hier nur Status/Test/Connect.
 */
export function DiscogsTab({
  connectedUsername,
  from,
}: {
  connectedUsername: string | null;
  from: 'einstellungen' | 'onboarding';
}) {
  return (
    <div data-testid="discogs-tab" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {connectedUsername ? (
        <>
          <p style={{ margin: 0 }}>
            Status: <strong data-testid="discogs-status">verbunden als {connectedUsername}</strong>
          </p>
          <TestConnectionButton />
          <a
            href={`/api/discogs/connect?from=${from}`}
            style={{ fontSize: 13.5, color: 'var(--accent-ink)' }}
          >
            Neu verbinden (überschreibt die bestehende Verbindung)
          </a>
        </>
      ) : (
        <>
          <p style={{ margin: 0 }} data-testid="discogs-status">
            Status: nicht verbunden
          </p>
          <a
            href={`/api/discogs/connect?from=${from}`}
            data-testid="discogs-connect-link"
            style={{
              minHeight: 'var(--tap)',
              display: 'inline-flex',
              alignItems: 'center',
              alignSelf: 'flex-start',
              padding: '0 16px',
              borderRadius: 'var(--r-pill)',
              background: 'var(--accent)',
              color: 'var(--on-accent)',
              fontWeight: 700,
              fontSize: 14,
              textDecoration: 'none',
            }}
          >
            Mit Discogs verbinden
          </a>
        </>
      )}
    </div>
  );
}
```

Create `src/app/(app)/einstellungen/_components/CreateUserForm.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { Button, Input } from '@/components/ui';
import { createTeamUserAction, type TeamActionState } from '../actions';

const initialState: TeamActionState = { ok: false, error: null, info: null };

// Natives <select> statt UI-Select: dessen options/value/onChange sind Pflicht (controlled-only),
// hier reicht ein unkontrolliertes FormData-Feld (siehe Task 4, Step 4).
const selectStyle: React.CSSProperties = {
  minHeight: 'var(--tap)',
  padding: '0 14px',
  border: '1.5px solid var(--border-strong)',
  borderRadius: 'var(--r-md)',
  background: 'var(--surface-2)',
  color: 'var(--text)',
  fontFamily: 'var(--font-body)',
  fontSize: 15,
  cursor: 'pointer',
};

export function CreateUserForm() {
  const [state, action, pending] = useActionState(createTeamUserAction, initialState);
  return (
    <form
      action={action}
      data-testid="create-user-form"
      style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 420 }}
    >
      <label htmlFor="team-email">E-Mail</label>
      <Input id="team-email" name="email" type="email" required aria-label="E-Mail" />
      <label htmlFor="team-role">Rolle</label>
      <select id="team-role" name="role" defaultValue="mitarbeiter" aria-label="Rolle" className="focus-ring-field" style={selectStyle}>
        <option value="mitarbeiter">Mitarbeiter</option>
        <option value="kunde">Kunde</option>
      </select>
      {state.error ? <p role="alert" data-testid="create-user-error">{state.error}</p> : null}
      {state.ok && state.info ? <p data-testid="create-user-ok">{state.info}</p> : null}
      <Button type="submit" loading={pending}>
        User anlegen
      </Button>
    </form>
  );
}
```

Create `src/app/(app)/einstellungen/_components/ResetPasswordButton.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui';
import { resetTeamPasswordAction, type TeamActionState } from '../actions';

const initialState: TeamActionState = { ok: false, error: null, info: null };

export function ResetPasswordButton({ userId }: { userId: number }) {
  const [state, action, pending] = useActionState(resetTeamPasswordAction, initialState);
  return (
    <form action={action} style={{ display: 'inline' }}>
      <input type="hidden" name="userId" value={userId} />
      <Button type="submit" loading={pending}>
        Passwort zurücksetzen
      </Button>
      {state.info ? <span style={{ marginLeft: 8, fontSize: 12.5 }}>{state.info}</span> : null}
      {state.error ? <span role="alert" style={{ marginLeft: 8, fontSize: 12.5 }}>{state.error}</span> : null}
    </form>
  );
}
```

Create `src/app/(app)/einstellungen/_components/TeamTab.tsx` (Server-Komponente):

```tsx
import type { TeamUser } from '@/lib/team';
import { CreateUserForm } from './CreateUserForm';
import { ResetPasswordButton } from './ResetPasswordButton';

const dateDE = (d: Date | null): string =>
  d ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(d) : '—';

/** User-Liste + Anlage (Spec §12) — KEIN Löschen in diesem Slice (Verkaufs-/Audit-Bezüge). */
export function TeamTab({ users }: { users: TeamUser[] }) {
  return (
    <div data-testid="team-tab" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--text-2)' }}>
              <th style={{ padding: '8px 10px' }}>E-Mail</th>
              <th style={{ padding: '8px 10px' }}>Rolle</th>
              <th style={{ padding: '8px 10px' }}>Angelegt am</th>
              <th style={{ padding: '8px 10px' }} aria-label="Aktionen" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} data-testid="team-user-row" style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '8px 10px', fontWeight: 600 }}>{u.email}</td>
                <td style={{ padding: '8px 10px', textTransform: 'capitalize' }}>{u.role}</td>
                <td style={{ padding: '8px 10px', color: 'var(--text-3)' }}>{dateDE(u.createdAt)}</td>
                <td style={{ padding: '8px 10px' }}>
                  <ResetPasswordButton userId={u.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <h2 style={{ fontSize: 16, margin: '0 0 10px' }}>Neuen User anlegen</h2>
        <CreateUserForm />
      </div>
    </div>
  );
}
```

In `src/app/(app)/einstellungen/page.tsx`: Imports ergänzen (`getConnection` aus `@/lib/discogs-connection`, `listTeamUsers` aus `@/lib/team`, `DiscogsTab`, `TeamTab`) und die Platzhalter ersetzen:

```tsx
        {tab === 'discogs' ? (
          <DiscogsTab
            connectedUsername={
              (await getConnection({ tenantId: tenant.id, userId: user.id }))?.discogsUsername ?? null
            }
            from="einstellungen"
          />
        ) : null}
        {tab === 'team' ? (
          <TeamTab users={await listTeamUsers({ tenantId: tenant.id, userId: user.id })} />
        ) : null}
```

(Hinweis: `await` in JSX ist in Server Components erlaubt; wer es klarer mag, lädt beide Werte oberhalb des `return` bedingt per `tab === 'discogs'`/`'team'` — funktional identisch, Daten nur für den aktiven Tab laden.)

- [ ] **Step 6: Integrationstests anhängen (tests/slice6-actions.integration.test.ts)**

```ts
describe('T8 team lib', () => {
  it('createTeamUser: Staff zählt gegen maxUsers, kunde nicht, Duplikat wirft DuplicateEmailError', async () => {
    const { provisionTenant } = await import('@/lib/provisioning');
    const { tenantId } = await provisionTenant({
      slug: 'team-shop', name: 'Team', adminEmail: 'boss@team.test',
    });
    const { createTeamUser, DuplicateEmailError } = await import('@/lib/team');
    const { LimitExceededError, FREE_FALLBACK_ENTITLEMENTS } = await import('@/lib/gating');
    const ctx = { tenantId, userId: null };
    const ent = { ...FREE_FALLBACK_ENTITLEMENTS, limits: { maxRecords: 100, maxUsers: 2 } };

    // Staff aktuell 1 (admin) → +1 mitarbeiter ok (==2):
    const created = await createTeamUser(ctx, ent, { email: 'm1@team.test', role: 'mitarbeiter' });
    expect(created.temporaryPassword).toMatch(/^[A-Z2-7]{16}$/);
    const flag = await owner.query(`SELECT must_change_password, role FROM users WHERE id = $1`, [created.userId]);
    expect(flag.rows[0]).toMatchObject({ must_change_password: true, role: 'mitarbeiter' });

    // Staff jetzt 2 → dritter Staff wirft:
    await expect(
      createTeamUser(ctx, ent, { email: 'm2@team.test', role: 'mitarbeiter' }),
    ).rejects.toBeInstanceOf(LimitExceededError);

    // kunde geht trotz vollem Staff-Limit:
    await createTeamUser(ctx, ent, { email: 'k1@team.test', role: 'kunde' });

    // Duplikat (gleiche Mail, gleicher Tenant):
    await expect(
      createTeamUser(ctx, ent, { email: 'k1@team.test', role: 'kunde' }),
    ).rejects.toBeInstanceOf(DuplicateEmailError);
  });

  it('resetTeamUserPassword setzt Hash neu + mustChangePassword, unbekannte Id → null', async () => {
    const { resetTeamUserPassword } = await import('@/lib/team');
    const u = await owner.query(`SELECT id, tenant_id, password FROM users WHERE email = 'm1@team.test'`);
    const result = await resetTeamUserPassword(
      { tenantId: u.rows[0].tenant_id, userId: null },
      u.rows[0].id,
    );
    expect(result).toMatchObject({ email: 'm1@team.test' });
    const after = await owner.query(`SELECT password, must_change_password FROM users WHERE id = $1`, [u.rows[0].id]);
    expect(after.rows[0].password).not.toBe(u.rows[0].password);
    expect(after.rows[0].must_change_password).toBe(true);

    expect(
      await resetTeamUserPassword({ tenantId: u.rows[0].tenant_id, userId: null }, 999_999),
    ).toBeNull();
  });
});
```

Run: `pnpm test tests/slice6-actions.integration.test.ts`
Expected: PASS.

- [ ] **Step 7: Lint/Typecheck + Discogs-Regression + Commit**

Run: `pnpm lint && pnpm typecheck && pnpm test tests/discogs-fake.test.ts tests/discogs-client.test.ts tests/discogs-oauth-routes.integration.test.ts`
Expected: 0 Fehler, Tests PASS.

```bash
git add src/lib/discogs src/app/api/discogs src/lib/team.ts "src/app/(app)/einstellungen" tests/discogs-fake.test.ts tests/slice6-actions.integration.test.ts
git commit -m "feat(slice6): T8 Discogs-Tab (OAuth-Reuse, identity()-Test) + Team-Tab (maxUsers-Gate, Passwort-Reset)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Abo-Tab — Checkout/Portal über den Billing-Adapter

**Files:**
- Modify: `src/app/(app)/einstellungen/actions.ts` (+`startCheckoutAction`, `openPortalAction`)
- Create: `src/app/(app)/einstellungen/_components/AboTab.tsx`
- Modify: `src/app/(app)/einstellungen/page.tsx` (Abo-Platzhalter ersetzen)
- Test: keine neue Datei — der Flow ist durch `tests/billing.integration.test.ts` (Adapter) + E2E-Szenario 4 abgedeckt; Action-Kette ist identisch zu T7/T8-geprüften Mustern.

**Interfaces:**
- Consumes: `getBillingAdapter` (T5), `getSubscriptionForTenant`/`listPlans` (T5), `getEntitlements` (T2), `fromCents` aus `@/lib/money`, `tenantUrl`.
- Produces: `startCheckoutAction(formData): Promise<void>` (redirect auf Checkout-URL; FormData-Feld `plan` ∈ {small, big}); `openPortalAction(): Promise<void>` (redirect auf Portal-URL); `AboTab`-Props `{ ent: Entitlements; sub: SubscriptionInfo | null; plans: { slug: string; name: string; priceMonthlyCents: number }[]; checkoutSuccess: boolean }`.

- [ ] **Step 1: Actions anhängen**

In `src/app/(app)/einstellungen/actions.ts` (Imports ergänzen: `getBillingAdapter` aus `@/lib/billing`, `getSubscriptionForTenant` aus `@/lib/billing/store`):

```ts
// ---------------------------------------------------------------------------
// Abo-Tab (Spec §9): Checkout + Portal. redirect() wirft NEXT_REDIRECT — nach
// dem Aufruf läuft nichts mehr. Fehler enden als Redirect zurück auf den Tab.
// ---------------------------------------------------------------------------

const checkoutSchema = z.enum(['small', 'big']);

export async function startCheckoutAction(formData: FormData): Promise<void> {
  const user = await requireSession();
  if (!(user.role === 'admin' || user.isSuperadmin)) forbidden();
  if (!(await isValidOrigin())) redirect('/einstellungen?tab=abo');

  const parsed = checkoutSchema.safeParse(formData.get('plan'));
  if (!parsed.success) redirect('/einstellungen?tab=abo');

  const tenant = await getCurrentTenant();
  const base = tenantUrl(tenant.slug);
  const { url } = await getBillingAdapter().createCheckoutSession({
    tenantId: tenant.id,
    planSlug: parsed.data,
    successUrl: `${base}/einstellungen?tab=abo&checkout=success`,
    cancelUrl: `${base}/einstellungen?tab=abo`,
  });
  redirect(url);
}

export async function openPortalAction(): Promise<void> {
  const user = await requireSession();
  if (!(user.role === 'admin' || user.isSuperadmin)) forbidden();
  if (!(await isValidOrigin())) redirect('/einstellungen?tab=abo');

  const tenant = await getCurrentTenant();
  const sub = await getSubscriptionForTenant({ tenantId: tenant.id, userId: user.id });
  if (!sub) redirect('/einstellungen?tab=abo');

  const { url } = await getBillingAdapter().createPortalSession({
    customerId: sub.stripeCustomerId,
    returnUrl: `${tenantUrl(tenant.slug)}/einstellungen?tab=abo`,
  });
  redirect(url);
}
```

- [ ] **Step 2: AboTab-Komponente**

Create `src/app/(app)/einstellungen/_components/AboTab.tsx`:

```tsx
import type { Entitlements } from '@/lib/gating';
import type { SubscriptionInfo } from '@/lib/billing/store';
import { fromCents } from '@/lib/money';
import { startCheckoutAction, openPortalAction } from '../actions';

const dateDE = (d: Date | null): string =>
  d ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(d) : '—';

export function AboTab({
  ent,
  sub,
  plans,
  checkoutSuccess,
}: {
  ent: Entitlements;
  sub: SubscriptionInfo | null;
  plans: { slug: string; name: string; priceMonthlyCents: number }[];
  checkoutSuccess: boolean;
}) {
  const upgradeTargets = plans.filter((p) => p.slug !== ent.plan && p.slug !== 'free');
  return (
    <div data-testid="abo-tab" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {checkoutSuccess && sub === null ? (
        <p
          data-testid="checkout-pending"
          style={{
            margin: 0,
            padding: '10px 14px',
            borderRadius: 'var(--r-md)',
            background: 'var(--surface-2)',
            border: '1px solid var(--border-strong)',
          }}
        >
          Zahlung ausstehend — wird nach Bestätigung aktiv.
        </p>
      ) : null}

      <div>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--text-2)' }}>Aktueller Plan</p>
        <p data-testid="abo-current-plan" style={{ margin: '2px 0 0', fontSize: 20, fontWeight: 800, fontFamily: 'var(--font-display)' }}>
          {ent.planName} · {fromCents(ent.priceMonthlyCents)} € / Monat
        </p>
        {sub ? (
          <p data-testid="abo-subscription" style={{ margin: '6px 0 0', fontSize: 13.5, color: 'var(--text-3)' }}>
            Abo-Status: {sub.status}
            {sub.currentPeriodEnd ? ` · verlängert sich am ${dateDE(sub.currentPeriodEnd)}` : ''}
            {sub.cancelAtPeriodEnd ? ' · gekündigt zum Periodenende' : ''}
          </p>
        ) : (
          <p style={{ margin: '6px 0 0', fontSize: 13.5, color: 'var(--text-3)' }}>
            Kein aktives Abo.
          </p>
        )}
      </div>

      {upgradeTargets.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>Plan wechseln</h2>
          {upgradeTargets.map((p) => (
            <form key={p.slug} action={startCheckoutAction}>
              <input type="hidden" name="plan" value={p.slug} />
              <button
                type="submit"
                data-testid={`upgrade-${p.slug}`}
                className="focus-ring-button"
                style={{
                  minHeight: 'var(--tap)',
                  padding: '0 18px',
                  borderRadius: 'var(--r-pill)',
                  border: 'none',
                  background: 'var(--accent)',
                  color: 'var(--on-accent)',
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: 'pointer',
                }}
              >
                Upgrade auf {p.name} — {fromCents(p.priceMonthlyCents)} €/Monat
              </button>
            </form>
          ))}
        </div>
      ) : null}

      {sub ? (
        <form action={openPortalAction}>
          <button
            type="submit"
            data-testid="abo-portal"
            className="focus-ring-button"
            style={{
              minHeight: 'var(--tap)',
              padding: '0 18px',
              borderRadius: 'var(--r-pill)',
              border: '1px solid var(--border-strong)',
              background: 'var(--surface-2)',
              color: 'var(--text-2)',
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Abo verwalten
          </button>
        </form>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Seite verdrahten**

In `src/app/(app)/einstellungen/page.tsx`: Imports ergänzen (`AboTab`, `getEntitlements` aus `@/lib/gating`, `getSubscriptionForTenant` aus `@/lib/billing/store`, `listPlans` aus `@/lib/billing/store`) und den Abo-Platzhalter ersetzen:

```tsx
        {tab === 'abo' ? (
          <AboTab
            ent={await getEntitlements(tenant.id)}
            sub={await getSubscriptionForTenant({ tenantId: tenant.id, userId: user.id })}
            plans={await listPlans()}
            checkoutSuccess={sp.checkout === 'success'}
          />
        ) : null}
```

- [ ] **Step 4: Lint/Typecheck + Commit**

Run: `pnpm lint && pnpm typecheck && pnpm test tests/billing.integration.test.ts`
Expected: 0 Fehler, PASS.

```bash
git add "src/app/(app)/einstellungen"
git commit -m "feat(slice6): T9 Abo-Tab — Plan-Anzeige (Integer-Cents), Fake/Stripe-Checkout, Customer-Portal, checkout=success-Hinweis

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Erst-Login — SessionUser.mustChangePassword + /passwort + Layout-Redirect

**Files:**
- Modify: `src/auth/schema-types.ts`, `src/auth/adapter.ts`, `src/auth/config.ts`, `src/auth/session.ts` (Flag durch alle Session-Schichten)
- Create: `src/lib/account.ts`
- Create: `src/app/passwort/page.tsx`, `src/app/passwort/actions.ts`, `src/app/passwort/ChangePasswordForm.tsx`
- Modify: `src/app/(app)/layout.tsx` (Redirects)
- Test: Erweiterung `tests/slice6-actions.integration.test.ts`

**Interfaces:**
- Consumes: `users.mustChangePassword` (T1), `Tenant.onboardingCompletedAt` (T1), `DUMMY_BCRYPT_HASH`/`hashPassword` (T3/T1), `requireSession`, `isValidOrigin`.
- Produces (CONTRACTS C9):
  - `SessionUser` += `mustChangePassword: boolean` (DB-Session-Strategie liest die User-Zeile pro Request → Flag ist nach Änderung sofort aktuell, kein Session-Rebuild)
  - `verifyAndChangePassword(ctx: TenantCtx, currentPassword: string, newPassword: string): Promise<boolean>` (`src/lib/account.ts`; false = aktuelles Passwort falsch)
  - Route `/passwort` (AUSSERHALB der `(app)`-Gruppe — keine Redirect-Schleife), jede Rolle inkl. `kunde`
  - `(app)`-Layout: `mustChangePassword` → `redirect('/passwort')`; danach Admin && `!tenant.onboardingCompletedAt` → `redirect('/onboarding')` (Ziel-Seite kommt in T11; bis dahin 404 bei frisch provisionierten Tenants — akzeptiert, T11 folgt unmittelbar)
  - Passwort-Policy: zod `min(12)` (Spec §11)

- [ ] **Step 1: SessionUser um das Flag erweitern (4 Dateien)**

`src/auth/schema-types.ts`:

```ts
export type SessionUser = {
  id: number;
  email: string;
  tenantId: number;
  role: Role;
  isSuperadmin: boolean;
  mustChangePassword: boolean;
};
```

`src/auth/adapter.ts` — drei Stellen:

1. `getTenantSessionAndUser`: im Select `uMust: users.mustChangePassword,` ergänzen; im Rückgabe-Mapping `user: { …, isSuperadmin: r.uSuper, mustChangePassword: r.uMust }`.
2. `getTenantUser`: Mapping ergänzen `mustChangePassword: u.mustChangePassword`.
3. `toAdapterUser`: `mustChangePassword: user.mustChangePassword,` in das Objekt aufnehmen.

`src/auth/config.ts` — zwei Stellen:

1. `verifyCredentials`-Rückgabe: `return { id: u.id, email: u.email, tenantId: u.tenantId, role: u.role, isSuperadmin: u.isSuperadmin, mustChangePassword: u.mustChangePassword };`
2. `session`-Callback: Typ-Cast und Zuweisung erweitern:

```ts
    session({ session, user }) {
      if (session.user) {
        const u = user as unknown as {
          tenantId: number;
          role: Role;
          isSuperadmin: boolean;
          mustChangePassword: boolean;
        };
        const target = session.user as unknown as Record<string, unknown>;
        target.tenantId = u.tenantId;
        target.role = u.role;
        target.isSuperadmin = u.isSuperadmin;
        target.mustChangePassword = u.mustChangePassword;
      }
      return session;
    },
```

`src/auth/session.ts` — `getSessionUser`-Mapping ergänzen:

```ts
    mustChangePassword: Boolean(u.mustChangePassword),
```

Danach `pnpm typecheck`: Der Compiler zeigt jede weitere Stelle, die `SessionUser` konstruiert (z. B. Test-Fixtures) — dort `mustChangePassword: false` ergänzen. Verhalten bestehender Tests ändert sich nicht (Seed-User haben `false`).

- [ ] **Step 2: account-Bibliothek**

Create `src/lib/account.ts`:

```ts
import 'server-only';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { withTenant, type TenantCtx } from '@/db/tenant';
import { users } from '@/db/schema';
import { DUMMY_BCRYPT_HASH, hashPassword } from '@/lib/password';

/**
 * Passwortwechsel (Spec §11): altes Passwort verifizieren (Dummy-Hash-Fallback gegen
 * Timing-Orakel), neues hashen, mustChangePassword=false — alles in einer Tenant-Tx.
 * false = aktuelles Passwort falsch (oder User-Zeile weg).
 */
export async function verifyAndChangePassword(
  ctx: TenantCtx,
  currentPassword: string,
  newPassword: string,
): Promise<boolean> {
  const newHash = await hashPassword(newPassword);
  return withTenant(ctx, async (tx) => {
    if (ctx.userId === null) return false;
    const [u] = await tx.select().from(users).where(eq(users.id, ctx.userId)).limit(1);
    const ok = await bcrypt.compare(currentPassword, u?.password ?? DUMMY_BCRYPT_HASH);
    if (!u || !ok) return false;
    await tx
      .update(users)
      .set({ password: newHash, mustChangePassword: false, updatedAt: new Date() })
      .where(eq(users.id, u.id));
    return true;
  });
}
```

- [ ] **Step 3: /passwort-Seite + Action**

Create `src/app/passwort/actions.ts`:

```ts
'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireSession } from '@/auth/session';
import { getCurrentTenant } from '@/lib/tenant';
import { isValidOrigin } from '@/lib/csrf';
import { verifyAndChangePassword } from '@/lib/account';

export type ChangePasswordState = { error: string | null };

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Bitte das aktuelle Passwort eingeben.'),
    newPassword: z.string().min(12, 'Das neue Passwort muss mindestens 12 Zeichen haben.'),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: 'Die Passwörter stimmen nicht überein.',
    path: ['confirmPassword'],
  });

export async function changePasswordAction(
  _prev: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const user = await requireSession(); // jede Rolle — kunde unterliegt demselben Zwang (Spec §11)
  if (!(await isValidOrigin())) return { error: 'Ungültige Herkunft (Origin).' };

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get('currentPassword'),
    newPassword: formData.get('newPassword'),
    confirmPassword: formData.get('confirmPassword'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Ungültige Eingaben.' };

  const changed = await verifyAndChangePassword(
    { tenantId: user.tenantId, userId: user.id },
    parsed.data.currentPassword,
    parsed.data.newPassword,
  );
  if (!changed) return { error: 'Aktuelles Passwort ist falsch.' };

  // Danach: Admin ohne abgeschlossenes Onboarding → Wizard, sonst Dashboard (Spec §11).
  const tenant = await getCurrentTenant();
  if ((user.role === 'admin' || user.isSuperadmin) && !tenant.onboardingCompletedAt) {
    redirect('/onboarding');
  }
  redirect('/');
}
```

Create `src/app/passwort/ChangePasswordForm.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { Button, Input } from '@/components/ui';
import { changePasswordAction, type ChangePasswordState } from './actions';

const initialState: ChangePasswordState = { error: null };

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, initialState);
  return (
    <form
      action={action}
      data-testid="change-password-form"
      style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      <label htmlFor="currentPassword">Aktuelles Passwort</label>
      <Input
        id="currentPassword"
        name="currentPassword"
        type="password"
        autoComplete="current-password"
        required
        aria-label="Aktuelles Passwort"
      />
      <label htmlFor="newPassword">Neues Passwort (mind. 12 Zeichen)</label>
      <Input
        id="newPassword"
        name="newPassword"
        type="password"
        autoComplete="new-password"
        required
        minLength={12}
        aria-label="Neues Passwort"
      />
      <label htmlFor="confirmPassword">Neues Passwort wiederholen</label>
      <Input
        id="confirmPassword"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        required
        aria-label="Neues Passwort wiederholen"
      />
      {state.error ? <p role="alert">{state.error}</p> : null}
      <Button type="submit" loading={pending}>
        Passwort ändern
      </Button>
    </form>
  );
}
```

Create `src/app/passwort/page.tsx`:

```tsx
import { requireSession } from '@/auth/session';
import { getCurrentTenant } from '@/lib/tenant';
import { ChangePasswordForm } from './ChangePasswordForm';

/**
 * AUSSERHALB der (app)-Gruppe (Spec §11): das (app)-Layout redirectet mustChangePassword-User
 * hierher — läge die Seite in der Gruppe, wäre das eine Redirect-Schleife.
 * Erreichbar für JEDE Rolle (kunde unterliegt demselben Zwang), auch ohne gesetztes Flag
 * (freiwilliger Passwortwechsel).
 */
export default async function PasswortPage() {
  const user = await requireSession();
  const tenant = await getCurrentTenant();
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: 'var(--bg)',
        color: 'var(--text)',
        fontFamily: 'var(--font-body)',
        padding: 24,
      }}
    >
      <section
        style={{
          width: 'min(420px, 100%)',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-lg)',
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22, margin: 0 }}>
          Passwort ändern
        </h1>
        {user.mustChangePassword ? (
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-3)' }}>
            Dein Zugang wurde mit einem temporären Passwort angelegt — bitte vergib jetzt ein
            eigenes Passwort für {tenant.name}.
          </p>
        ) : null}
        <ChangePasswordForm />
      </section>
    </main>
  );
}
```

- [ ] **Step 4: (app)-Layout-Redirects**

In `src/app/(app)/layout.tsx` — die ersten Zeilen der Komponente ersetzen:

```ts
import { redirect } from 'next/navigation';
```

```ts
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Enforces session↔tenant invariant; redirects to /login if no session.
  const user = await requireSession();
  const tenant = await getCurrentTenant();

  // Erst-Login-Zwang (Spec §11): /passwort und /onboarding liegen AUSSERHALB dieser
  // Route-Gruppe — kein Redirect-Loop. Reihenfolge bindend: Passwortzwang vor Wizard.
  if (user.mustChangePassword) redirect('/passwort');
  if ((user.role === 'admin' || user.isSuperadmin) && !tenant.onboardingCompletedAt) {
    redirect('/onboarding');
  }

  const initial = (user.email[0] ?? '?').toUpperCase();
```

(Rest der Datei unverändert — die `lockedHrefs`-Erweiterung folgt in T12.)

- [ ] **Step 5: Integrationstest anhängen (tests/slice6-actions.integration.test.ts)**

```ts
describe('T10 mustChangePassword flow', () => {
  it('verifyAndChangePassword: falsches Altpasswort → false, korrektes → Hash neu + Flag weg', async () => {
    const { provisionTenant } = await import('@/lib/provisioning');
    const { tenantId, adminUserId } = await provisionTenant({
      slug: 'pw-shop', name: 'PW', adminEmail: 'a@pw.test', password: 'AltesPasswort123!',
    });
    await owner.query(`UPDATE users SET must_change_password = true WHERE id = $1`, [adminUserId]);

    const { verifyAndChangePassword } = await import('@/lib/account');
    const ctx = { tenantId, userId: adminUserId };

    expect(await verifyAndChangePassword(ctx, 'falsch', 'NeuesPasswort123!')).toBe(false);
    const still = await owner.query(`SELECT must_change_password FROM users WHERE id = $1`, [adminUserId]);
    expect(still.rows[0].must_change_password).toBe(true);

    expect(await verifyAndChangePassword(ctx, 'AltesPasswort123!', 'NeuesPasswort123!')).toBe(true);
    const after = await owner.query(`SELECT must_change_password FROM users WHERE id = $1`, [adminUserId]);
    expect(after.rows[0].must_change_password).toBe(false);

    // Neues Passwort verifiziert (verifyCredentials nutzt jetzt den neuen Hash):
    const { verifyCredentials } = await import('@/auth/config');
    const session = await verifyCredentials({ email: 'a@pw.test', password: 'NeuesPasswort123!', tenantId });
    expect(session).toMatchObject({ email: 'a@pw.test', mustChangePassword: false });
    expect(await verifyCredentials({ email: 'a@pw.test', password: 'AltesPasswort123!', tenantId })).toBeNull();
  });
});
```

Run: `pnpm test tests/slice6-actions.integration.test.ts`
Expected: PASS.

- [ ] **Step 6: Lint/Typecheck + Auth-Regression + Commit**

Run: `pnpm lint && pnpm typecheck && pnpm test tests/rls.integration.test.ts tests/provisioning.integration.test.ts`
Expected: 0 Fehler, PASS.

```bash
git add src/auth src/lib/account.ts src/app/passwort "src/app/(app)/layout.tsx" tests/slice6-actions.integration.test.ts
git commit -m "feat(slice6): T10 Erst-Login — SessionUser.mustChangePassword, /passwort (min. 12 Zeichen, Timing-sicher), Layout-Zwangs-Redirects

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Onboarding-Wizard /onboarding (4 Schritte, Stepper pixel-treu)

**Files:**
- Create: `src/app/onboarding/page.tsx`, `src/app/onboarding/actions.ts`
- Create: `src/app/onboarding/_components/WizardStepper.tsx`, `_components/WizardFrame.tsx`
- Test: `tests/wizard-stepper.test.tsx`, Erweiterung `tests/slice6-actions.integration.test.ts` (completeOnboarding ist schon in T7 getestet — hier nichts Neues nötig; Datei unangetastet lassen)

**Interfaces:**
- Consumes: `ShopInfoForm` mit `next="wizard"` (T7), `DiscogsTab` mit `from="onboarding"` (T8), `CreateUserForm`/`TeamTab` (T8), `listTeamUsers` (T8), `getConnection`, `completeOnboarding` (T7), `requireSession`, `Tenant.onboardingCompletedAt`.
- Produces (CONTRACTS C10):
  - Route `/onboarding?step=1..4` (außerhalb `(app)`; nur admin — andere Rollen `redirect('/')`; abgeschlossen → `redirect('/')`; `mustChangePassword` → `redirect('/passwort')`)
  - `completeOnboardingAction(): Promise<void>` (volle Kette, setzt Timestamp, `redirect('/')`) — von „Los geht's" UND „Überspringen" benutzt
  - `WizardStepper`-Props: `{ current: 1 | 2 | 3 | 4 }`; Labels EXAKT `Info`, `Discogs`, `Admin`, `Review` (Handoff)

- [ ] **Step 1: Stepper-Test (TDD, jsdom)**

Create `tests/wizard-stepper.test.tsx`:

```tsx
// Slice 6 T11 — Stepper pixel-treu zum Handoff: 4 Kreise (30px), Labels Info/Discogs/Admin/Review,
// done/current = accent, future = surface-3 + border-strong, aria-current auf dem aktuellen Schritt.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WizardStepper } from '@/app/onboarding/_components/WizardStepper';

describe('WizardStepper', () => {
  it('rendert 4 Schritte mit den Handoff-Labels', () => {
    render(<WizardStepper current={2} />);
    for (const label of ['Info', 'Discogs', 'Admin', 'Review']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('markiert den aktuellen Schritt mit aria-current="step"', () => {
    render(<WizardStepper current={3} />);
    const items = screen.getAllByTestId('wizard-step');
    expect(items).toHaveLength(4);
    expect(items[2]!.getAttribute('aria-current')).toBe('step');
    expect(items[0]!.getAttribute('aria-current')).toBeNull();
    expect(items[0]!.getAttribute('data-state')).toBe('done');
    expect(items[2]!.getAttribute('data-state')).toBe('current');
    expect(items[3]!.getAttribute('data-state')).toBe('future');
  });
});
```

Run: `pnpm test tests/wizard-stepper.test.tsx` — Expected: FAIL (Komponente fehlt).

- [ ] **Step 2: Stepper implementieren (Handoff-Markup)**

Create `src/app/onboarding/_components/WizardStepper.tsx`:

```tsx
// Stepper nach Design-Handoff (Design System 2026.dc.html): 30px-Kreise, done/current in
// var(--accent)/var(--on-accent), future var(--surface-3)+var(--border-strong), 2px-Connectoren.
const STEPS = ['Info', 'Discogs', 'Admin', 'Review'] as const;

export function WizardStepper({ current }: { current: 1 | 2 | 3 | 4 }) {
  return (
    <ol
      data-testid="wizard-stepper"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        listStyle: 'none',
        margin: 0,
        padding: 0,
      }}
    >
      {STEPS.map((label, i) => {
        const step = i + 1;
        const state = step < current ? 'done' : step === current ? 'current' : 'future';
        const filled = state !== 'future';
        return (
          <li
            key={label}
            data-testid="wizard-step"
            data-state={state}
            aria-current={state === 'current' ? 'step' : undefined}
            style={{ display: 'flex', alignItems: 'center', flex: i === 0 ? '0 0 auto' : '1 1 0' }}
          >
            {i > 0 ? (
              <span
                aria-hidden="true"
                style={{
                  flex: 1,
                  height: 2,
                  background: filled ? 'var(--accent)' : 'var(--border-strong)',
                  margin: '0 8px',
                }}
              />
            ) : null}
            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <span
                aria-hidden="true"
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: '50%',
                  display: 'grid',
                  placeItems: 'center',
                  fontWeight: 700,
                  fontSize: 13,
                  background: filled ? 'var(--accent)' : 'var(--surface-3)',
                  color: filled ? 'var(--on-accent)' : 'var(--text-3)',
                  border: filled ? '1px solid transparent' : '1px solid var(--border-strong)',
                }}
              >
                {state === 'done' ? '✓' : step}
              </span>
              <span
                style={{
                  fontSize: 11.5,
                  fontWeight: state === 'current' ? 700 : 600,
                  color: state === 'current' ? 'var(--text)' : 'var(--text-3)',
                }}
              >
                {label}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
```

Run: `pnpm test tests/wizard-stepper.test.tsx` — Expected: PASS.

- [ ] **Step 3: Wizard-Actions**

Create `src/app/onboarding/actions.ts`:

```ts
'use server';

import { forbidden, redirect } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { getCurrentTenant } from '@/lib/tenant';
import { isValidOrigin } from '@/lib/csrf';
import { completeOnboarding } from '@/lib/tenant-settings';

/**
 * „Los geht's" (Schritt 4) UND „Überspringen" (global) — beide setzen den Timestamp,
 * der Wizard erscheint nie zweimal (Spec §11). Volle Kette (Global Constraint 2).
 */
export async function completeOnboardingAction(): Promise<void> {
  const user = await requireSession();
  if (!(user.role === 'admin' || user.isSuperadmin)) forbidden();
  if (!(await isValidOrigin())) redirect('/onboarding');
  const tenant = await getCurrentTenant();
  await completeOnboarding(tenant.id);
  redirect('/');
}
```

- [ ] **Step 4: Wizard-Frame + Seite**

Create `src/app/onboarding/_components/WizardFrame.tsx` (Server-Komponente — Rahmen, Stepper, Zurück/Weiter-Leiste):

```tsx
import Link from 'next/link';
import { WizardStepper } from './WizardStepper';
import { completeOnboardingAction } from '../actions';

const pillLink: React.CSSProperties = {
  minHeight: 'var(--tap)',
  display: 'inline-flex',
  alignItems: 'center',
  padding: '0 18px',
  borderRadius: 'var(--r-pill)',
  textDecoration: 'none',
  fontWeight: 600,
  fontSize: 14,
  border: '1px solid var(--border-strong)',
  background: 'var(--surface-2)',
  color: 'var(--text-2)',
};

export function WizardFrame({
  step,
  title,
  hint,
  children,
  showNext,
  nextLabel = 'Weiter',
}: {
  step: 1 | 2 | 3 | 4;
  title: string;
  hint?: string;
  children: React.ReactNode;
  /** Schritte 2/3 haben einen „Später"-Link als Weiter; Schritt 1 submitted sein Formular selbst. */
  showNext: boolean;
  nextLabel?: string;
}) {
  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'var(--bg)',
        color: 'var(--text)',
        fontFamily: 'var(--font-body)',
        padding: 24,
        display: 'grid',
        placeItems: 'start center',
      }}
    >
      <section
        data-testid="onboarding-wizard"
        style={{
          width: 'min(640px, 100%)',
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
          marginTop: 32,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 24, margin: 0 }}>
            Onboarding
          </h1>
          <form action={completeOnboardingAction} style={{ marginLeft: 'auto' }}>
            <button
              type="submit"
              data-testid="wizard-skip"
              className="focus-ring-button"
              style={{
                border: 'none',
                background: 'none',
                color: 'var(--text-3)',
                fontSize: 13.5,
                fontWeight: 600,
                cursor: 'pointer',
                minHeight: 'var(--tap)',
              }}
            >
              Überspringen
            </button>
          </form>
        </div>
        <WizardStepper current={step} />
        <div
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-lg)',
            padding: 22,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 17 }}>
            Schritt {step} · {title}
          </h2>
          {hint ? <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-3)' }}>{hint}</p> : null}
          {children}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {step > 1 ? (
            <Link href={`/onboarding?step=${step - 1}`} data-testid="wizard-back" style={pillLink}>
              Zurück
            </Link>
          ) : null}
          {showNext ? (
            <Link
              href={`/onboarding?step=${step + 1}`}
              data-testid="wizard-next"
              style={{ ...pillLink, marginLeft: 'auto', background: 'var(--accent)', color: 'var(--on-accent)', border: '1px solid transparent', fontWeight: 700 }}
            >
              {nextLabel}
            </Link>
          ) : null}
        </div>
      </section>
    </main>
  );
}
```

Create `src/app/onboarding/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { getCurrentTenant } from '@/lib/tenant';
import { getConnection } from '@/lib/discogs-connection';
import { listTeamUsers } from '@/lib/team';
import { ShopInfoForm } from '@/app/(app)/einstellungen/_components/ShopInfoForm';
import { DiscogsTab } from '@/app/(app)/einstellungen/_components/DiscogsTab';
import { TeamTab } from '@/app/(app)/einstellungen/_components/TeamTab';
import { WizardFrame } from './_components/WizardFrame';
import { completeOnboardingAction } from './actions';

/**
 * 4-Schritt-Wizard (Spec §11), AUSSERHALB der (app)-Gruppe (Redirect-Quelle ist das
 * (app)-Layout). Speichern pro Schritt — kein Big-Bang-Submit. Schritt 2 nutzt den
 * bestehenden Discogs-OAuth-Flow (?from=onboarding, Spec-Amendment).
 */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireSession();
  if (user.mustChangePassword) redirect('/passwort'); // Passwortzwang geht vor (Spec §11)
  if (!(user.role === 'admin' || user.isSuperadmin)) redirect('/'); // nur Admins
  const tenant = await getCurrentTenant();
  if (tenant.onboardingCompletedAt) redirect('/'); // nie zweimal

  const sp = await searchParams;
  const rawStep = Number(typeof sp.step === 'string' ? sp.step : '1');
  const step = (rawStep >= 1 && rawStep <= 4 ? rawStep : 1) as 1 | 2 | 3 | 4;

  if (step === 1) {
    return (
      <WizardFrame step={1} title="Shop-Infos" showNext={false}>
        <ShopInfoForm
          initialName={tenant.name}
          initialColor={tenant.branding.primaryColor}
          next="wizard"
          submitLabel="Weiter"
        />
      </WizardFrame>
    );
  }

  if (step === 2) {
    const conn = await getConnection({ tenantId: tenant.id, userId: user.id });
    return (
      <WizardFrame
        step={2}
        title="Discogs verbinden"
        hint="Verbinde deinen Discogs-Seller-Account, um Suche, Preisvorschläge und Listings zu nutzen. Du kannst das jederzeit unter Einstellungen → Discogs nachholen."
        showNext
        nextLabel="Später"
      >
        <DiscogsTab connectedUsername={conn?.discogsUsername ?? null} from="onboarding" />
      </WizardFrame>
    );
  }

  if (step === 3) {
    const users = await listTeamUsers({ tenantId: tenant.id, userId: user.id });
    return (
      <WizardFrame
        step={3}
        title="Team anlegen"
        hint="Lege Mitarbeiter- oder Kunden-Zugänge an — die Zugangsdaten gehen per Mail raus. Auch später unter Einstellungen → Team möglich."
        showNext
        nextLabel="Später"
      >
        <TeamTab users={users} />
      </WizardFrame>
    );
  }

  const conn = await getConnection({ tenantId: tenant.id, userId: user.id });
  const users = await listTeamUsers({ tenantId: tenant.id, userId: user.id });
  return (
    <WizardFrame step={4} title="Review" showNext={false}>
      <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 18px', fontSize: 14 }}>
        <dt style={{ color: 'var(--text-3)' }}>Shop-Name</dt>
        <dd style={{ margin: 0, fontWeight: 700 }}>{tenant.name}</dd>
        <dt style={{ color: 'var(--text-3)' }}>Primärfarbe</dt>
        <dd style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            aria-hidden="true"
            style={{
              width: 16,
              height: 16,
              borderRadius: 4,
              background: tenant.branding.primaryColor,
              border: '1px solid var(--border-strong)',
              display: 'inline-block',
            }}
          />
          <code>{tenant.branding.primaryColor}</code>
        </dd>
        <dt style={{ color: 'var(--text-3)' }}>Discogs</dt>
        <dd style={{ margin: 0 }}>{conn ? `verbunden als ${conn.discogsUsername}` : 'nicht verbunden'}</dd>
        <dt style={{ color: 'var(--text-3)' }}>Team</dt>
        <dd style={{ margin: 0 }}>{users.length} {users.length === 1 ? 'Zugang' : 'Zugänge'}</dd>
      </dl>
      <form action={completeOnboardingAction}>
        <button
          type="submit"
          data-testid="wizard-finish"
          className="focus-ring-button"
          style={{
            minHeight: 'var(--tap)',
            padding: '0 22px',
            borderRadius: 'var(--r-pill)',
            border: 'none',
            background: 'var(--accent)',
            color: 'var(--on-accent)',
            fontWeight: 700,
            fontSize: 15,
            cursor: 'pointer',
          }}
        >
          Los geht&apos;s
        </button>
      </form>
    </WizardFrame>
  );
}
```

- [ ] **Step 5: Tests + Lint + Commit**

Run: `pnpm test tests/wizard-stepper.test.tsx tests/einstellungen-tabs.test.tsx && pnpm lint && pnpm typecheck`
Expected: PASS, 0 Fehler.

```bash
git add src/app/onboarding tests/wizard-stepper.test.tsx
git commit -m "feat(slice6): T11 Onboarding-Wizard — 4 Schritte mit Handoff-Stepper, Speichern pro Schritt, Ueberspringen setzt onboardingCompletedAt

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: Gating-Enforcement — Ankauf/Sammlung/Listing/Analytik-Upsell/Nav-Locks

**Files:**
- Modify: `src/lib/ankauf.ts` (`performAnkauf` + Entitlements-Param), `src/lib/collections.ts` (`createCollection` + Entitlements-Param)
- Modify: `src/app/(app)/ankauf/actions.ts`, `src/app/(app)/ankauf/sammlung/actions.ts`
- Modify: `scripts/seed.ts` (createCollection-Aufruf in `ensureDemoCollection`)
- Modify: `src/app/(app)/analytik/page.tsx` + Create: `src/app/(app)/analytik/_components/AnalytikUpsell.tsx`
- Modify: `src/app/(app)/layout.tsx`, `SidebarNav.tsx`, `BottomTabBar.tsx` (+`lockedHrefs`)
- Modify: Sammlung-Wizard-Fehleranzeige (prüfen; Datei unter `src/app/(app)/ankauf/sammlung/_components/`)
- Test: bestehende betroffene Tests anpassen; Gating-Fälle an `tests/gating.integration.test.ts` anhängen

**Interfaces:**
- Consumes: `getEntitlements`/`checkRecordCapacity`/`LimitExceededError`/`UNLIMITED_ENTITLEMENTS` (T2), `Entitlements`-Typ.
- Produces (CONTRACTS C8):
  - `performAnkauf(ctx: TenantCtx, input: AnkaufInput, ent: Entitlements)` — Kapazitäts-Check INNERHALB der withTenant-Tx, vor `acquireOne`
  - `createCollection(ctx: TenantCtx, input: CreateCollectionInput, ent: Entitlements)` — Check mit `addCount = input.items.length` (konservativ: Batchgröße; Dedupe wird nicht vorweggenommen), VOR dem Collection-Insert
  - Actions liefern Limit-/Feature-Verstöße als `{ ok: false, reason: 'validation', message: <exakter Text> }` — kein UI-Umbau nötig, die bestehende Fehleranzeige greift
  - Analytik ohne Feature: `AnalytikUpsell` (data-testid `analytik-upsell`) statt Charts, Queries werden NICHT ausgeführt
  - Nav: `SidebarNav`/`BottomTabBar` bekommen `lockedHrefs?: string[]` (Default `[]`) — Schloss-Icon + erweitertes `aria-label`, Klick führt weiter zur Upsell-Karte (kein Layout-Shift)

- [ ] **Step 1: Kapazitäts-Gate in die Transaktionen**

`src/lib/ankauf.ts` — Import + `performAnkauf` ersetzen:

```ts
import { checkRecordCapacity, type Entitlements } from '@/lib/gating';
```

```ts
/**
 * ONE withTenant transaction wrapping a single `acquireOne` (collectionId always null).
 * Kapazitäts-Gate (Spec §10) läuft IN der Tx: Entitlements lädt der Aufrufer VOR der Tx
 * (getEntitlements); die harmlose Race zwischen Count und Insert zweier paralleler Ankäufe
 * ist akzeptiert (Limit ist Produkt-, keine Sicherheitsgrenze).
 */
export async function performAnkauf(
  ctx: TenantCtx,
  input: AnkaufInput,
  ent: Entitlements,
): Promise<{ recordId: number; purchaseId: number }> {
  return withTenant(ctx, async (tx) => {
    await checkRecordCapacity(tx, ent, 1);
    return acquireOne(tx, ctx, input, null);
  });
}
```

`src/lib/collections.ts` — Import + `createCollection`-Kopf ändern:

```ts
import { checkRecordCapacity, type Entitlements } from '@/lib/gating';
```

```ts
export async function createCollection(
  ctx: TenantCtx,
  input: CreateCollectionInput,
  ent: Entitlements,
): Promise<{ collectionId: number; purchaseIds: number[]; recordIds: number[] }> {
  return withTenant(ctx, async (tx) => {
    // Konservativ mit Batchgröße prüfen (aktuell + items.length ≤ max) — Dedupe auf
    // bestehende records wird bewusst nicht vorweggenommen (Spec §10 „aktuell + Batchgröße").
    await checkRecordCapacity(tx, ent, input.items.length);

    const [col] = await tx
      .insert(collections)
      // … Rest des bestehenden Bodys UNVERÄNDERT …
```

`scripts/seed.ts` — in `ensureDemoCollection` den Aufruf erweitern (Import ergänzen: `import { UNLIMITED_ENTITLEMENTS } from '../src/lib/gating';`):

```ts
  const { collectionId, purchaseIds } = await createCollection(
    { tenantId, userId: adminUserId },
    { sellerName: input.sellerName, items: input.items },
    // Vertrauenswürdiger Fixture-Pfad — Request-Pfade laden IMMER getEntitlements (Spec §10).
    UNLIMITED_ENTITLEMENTS,
  );
```

WICHTIG: `src/lib/gating.ts` importiert `server-only` — `scripts/seed.ts` läuft via tsx OHNE RSC-Bundler. Prüfen, ob `server-only` beim tsx-Import wirft: `scripts/seed.ts` importiert bereits heute transitiv `src/lib/collections.ts` → `@/db/tenant` → `server-only` und funktioniert (das Paket wirft nur im Client-Bundle-Kontext). Es ändert sich also nichts — kein Umbau nötig.

- [ ] **Step 2: Actions gaten**

`src/app/(app)/ankauf/actions.ts` — Imports ergänzen:

```ts
import { getEntitlements, LimitExceededError } from '@/lib/gating';
```

In `ankaufRecord` den Block ab `const ctx = …` ersetzen:

```ts
  const ctx = { tenantId: user.tenantId, userId: user.id };
  const ent = await getEntitlements(user.tenantId);

  // Modul-Gate VOR der Tx (Spec §10): „Bei Discogs listen" braucht das Feature; die
  // Discogs-SUCHE bleibt ungated (Produktkern).
  if (parsed.data.listOnDiscogs && !ent.features.discogsListing) {
    return {
      ok: false,
      reason: 'validation',
      message: `Discogs-Listing ist im ${ent.planName}-Plan nicht verfügbar. Upgrade unter Einstellungen → Abo.`,
    };
  }

  let recordId: number;
  let purchaseId: number;
  try {
    ({ recordId, purchaseId } = await performAnkauf(ctx, parsed.data, ent));
  } catch (err) {
    if (err instanceof LimitExceededError) {
      // Exakter Meldungstext aus der Lib (CONTRACTS C8) — als Formularfehler (Spec §10).
      return { ok: false, reason: 'validation', message: err.message };
    }
    return { ok: false, reason: 'error' };
  }
```

`src/app/(app)/ankauf/sammlung/actions.ts` — Imports ergänzen (wie oben) und in `createCollectionAction` den Block ab `const ctx = …` ersetzen:

```ts
  const ctx = { tenantId: user.tenantId, userId: user.id };
  const ent = await getEntitlements(user.tenantId);

  if (parsed.data.items.some((i) => i.listOnDiscogs) && !ent.features.discogsListing) {
    return {
      ok: false,
      reason: 'validation',
      message: `Discogs-Listing ist im ${ent.planName}-Plan nicht verfügbar. Upgrade unter Einstellungen → Abo.`,
    };
  }

  let collectionId: number;
  let purchaseIds: number[];
  let recordIds: number[];
  try {
    ({ collectionId, purchaseIds, recordIds } = await createCollection(ctx, parsed.data, ent));
  } catch (err) {
    if (err instanceof LimitExceededError) {
      return { ok: false, reason: 'validation', message: err.message };
    }
    console.error('[sammlung] createCollection failed', err);
    return { ok: false, reason: 'error' };
  }
```

Sammlung-Wizard-Fehleranzeige VERIFIZIEREN: `grep -n "reason\|message" src/app/\(app\)/ankauf/sammlung/_components/*.tsx` — die Komponente, die `createCollectionAction` aufruft, muss `result.message` (falls vorhanden) anzeigen, sonst nur generischen Text. Falls `message` dort verschluckt wird: die Fehleranzeige um `{message ?? 'Speichern fehlgeschlagen.'}` erweitern und ein `data-testid="sammlung-error"` am Fehler-Element ergänzen (E2E-Szenario 3 asserted auf den Text „Plan-Limit erreicht"). Gleiches für den Einzel-Ankauf-Modal (`AnkaufModal` zeigt `message` bei `reason: 'validation'` bereits für Preisfehler — verifizieren, nicht umbauen).

- [ ] **Step 3: Bestehende Tests an die neuen Signaturen anpassen**

`pnpm typecheck` listet alle Aufrufer. Erwartete Anpassungen (mechanisch, Verhalten unverändert):
- `tests/ankauf.integration.test.ts`: jeden `performAnkauf(ctx, input)`-Aufruf um `UNLIMITED_ENTITLEMENTS` ergänzen (`import { UNLIMITED_ENTITLEMENTS } from '@/lib/gating';` — dynamisch wie die übrigen Imports der Datei).
- Aufrufer von `createCollection` in Tests (z. B. `tests/seed-collections.integration.test.ts`, falls direkt): ebenfalls `UNLIMITED_ENTITLEMENTS` (läuft über die Seed-Helper meist automatisch mit).
- `tests/ankauf-actions.integration.test.ts` + `tests/slice5-actions.integration.test.ts`: Diese testen die ACTIONS — die laden jetzt `getEntitlements` aus der DB. Die dort geseedeten Tenants haben `plan='free'` (Spalten-Default) → `listOnDiscogs: true`-Fälle würden neu am Feature-Gate scheitern und >100-Records-Fixtures am Limit. Fix im Fixture, nicht im Test: nach dem Tenant-Seed `UPDATE tenants SET plan = 'big' WHERE id = $1` (ownerPool) ergänzen. KEINE Assertions ändern.

Run: `pnpm test tests/ankauf.integration.test.ts tests/ankauf-actions.integration.test.ts tests/slice5-actions.integration.test.ts tests/seed-collections.integration.test.ts`
Expected: PASS.

- [ ] **Step 4: Gating-Integrationsfälle anhängen (tests/gating.integration.test.ts)**

```ts
  it('performAnkauf/createCollection erzwingen das Limit in der Tx (Ende-zu-Ende)', async () => {
    const t = await seedTenant({ slug: 'gate2', name: 'Gate 2' });
    const { FREE_FALLBACK_ENTITLEMENTS, LimitExceededError } = await import('@/lib/gating');
    const { performAnkauf } = await import('@/lib/ankauf');
    const { createCollection } = await import('@/lib/collections');
    const ent = { ...FREE_FALLBACK_ENTITLEMENTS, limits: { maxRecords: 2, maxUsers: 2 } };
    const ctx = { tenantId: t.tenantId, userId: t.adminUserId };
    const item = (title: string) => ({
      release: { discogsId: null, title, artist: 'Gate Artist', country: null, year: null, format: 'Vinyl', genre: [], label: [], coverImage: null },
      purchasePrice: '1.00', targetPrice: '2.00', conditionRecord: 5, conditionCover: 5, listOnDiscogs: false,
    });

    await performAnkauf(ctx, item('Erste'), ent);          // 0+1 ≤ 2
    await performAnkauf(ctx, item('Zweite'), ent);         // 1+1 ≤ 2
    await expect(performAnkauf(ctx, item('Dritte'), ent)).rejects.toBeInstanceOf(LimitExceededError);

    // Batch: 2 vorhanden, Limit 4, Batchgröße 3 → wirft (2+3 > 4), NICHTS committed:
    const ent4 = { ...ent, limits: { maxRecords: 4, maxUsers: 2 } };
    await expect(
      createCollection(ctx, { sellerName: 'Zu groß', items: [item('A'), item('B'), item('C')] }, ent4),
    ).rejects.toBeInstanceOf(LimitExceededError);
    const count = await owner.query(
      `SELECT (SELECT count(*)::int FROM records WHERE tenant_id = $1) AS records,
              (SELECT count(*)::int FROM collections WHERE tenant_id = $1) AS collections`,
      [t.tenantId],
    );
    expect(count.rows[0]).toEqual({ records: 2, collections: 0 });

    // Batchgröße 2 → passt exakt (2+2 == 4):
    await createCollection(ctx, { sellerName: 'Passt', items: [item('A'), item('B')] }, ent4);
  });
```

Run: `pnpm test tests/gating.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Analytik-Upsell**

Create `src/app/(app)/analytik/_components/AnalytikUpsell.tsx`:

```tsx
import Link from 'next/link';
import { BarChart3 } from 'lucide-react';

/** Upsell-Karte statt Charts (Spec §10): die Analytics-Queries laufen dann GAR NICHT. */
export function AnalytikUpsell({ planName, isAdmin }: { planName: string; isAdmin: boolean }) {
  return (
    <section
      data-testid="analytik-upsell"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        textAlign: 'center',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-lg)',
        padding: '48px 24px',
        maxWidth: 560,
        margin: '32px auto',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 56,
          height: 56,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          background: 'var(--surface-3)',
          border: '1px solid var(--border-strong)',
          color: 'var(--text-3)',
        }}
      >
        <BarChart3 size={26} />
      </span>
      <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22, margin: 0 }}>
        Analytik ist im {planName}-Plan nicht enthalten
      </h1>
      <p style={{ margin: 0, fontSize: 14, color: 'var(--text-2)' }}>
        Umsatz, Rohmarge, Kategorien und Top-Seller — verfügbar ab Small.
      </p>
      {isAdmin ? (
        <Link
          href="/einstellungen?tab=abo"
          data-testid="analytik-upsell-cta"
          style={{
            minHeight: 'var(--tap)',
            display: 'inline-flex',
            alignItems: 'center',
            padding: '0 20px',
            borderRadius: 'var(--r-pill)',
            background: 'var(--accent)',
            color: 'var(--on-accent)',
            fontWeight: 700,
            fontSize: 14,
            textDecoration: 'none',
          }}
        >
          Zum Abo-Tab
        </Link>
      ) : (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-3)' }}>
          Bitte wende dich an deinen Admin für ein Upgrade.
        </p>
      )}
    </section>
  );
}
```

In `src/app/(app)/analytik/page.tsx` — Imports ergänzen (`getEntitlements` aus `@/lib/gating`, `AnalytikUpsell`) und direkt nach `const tenant = await getCurrentTenant();` einfügen (VOR jedem Analytics-Query):

```ts
  const ent = await getEntitlements(tenant.id);
  if (!ent.features.analytik) {
    return (
      <AnalytikUpsell
        planName={ent.planName}
        isAdmin={user.role === 'admin' || user.isSuperadmin}
      />
    );
  }
```

(Der bestehende `kunde → forbidden()`-Gate davor bleibt unverändert. Auch die CSV-Export-Route der Analytik — `src/app/(app)/analytik/export/` — bekommt denselben Entitlements-Gate: `if (!ent.features.analytik) forbidden();` nach dem Rollen-Check.)

- [ ] **Step 6: Nav-Locks (Sidebar + BottomTab, kein Layout-Shift)**

`src/app/(app)/_components/SidebarNav.tsx`:

1. `Lock` zu den lucide-Imports.
2. Signatur + Filter + Link-Body:

```tsx
export function SidebarNav({ role, lockedHrefs = [] }: { role: Role; lockedHrefs?: string[] }) {
  const pathname = usePathname();
  const isStaff = role !== 'kunde';
  const isAdmin = role === 'admin' || role === 'superadmin';
  const items = NAV_ITEMS.filter(
    (item) => (!item.staffOnly || isStaff) && (!item.adminOnly || isAdmin),
  );

  return (
    <nav aria-label="Hauptnavigation" style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
      {items.map(({ href, label, Icon }) => {
        // Exact match for dashboard, prefix match for others
        const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href);
        const isLocked = lockedHrefs.includes(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={isActive ? 'page' : undefined}
            aria-label={isLocked ? `${label} (gesperrt im aktuellen Plan)` : undefined}
            style={{
              /* … bestehende Styles UNVERÄNDERT … */
            }}
          >
            <Icon size={18} aria-hidden="true" />
            {label}
            {isLocked ? (
              <Lock size={13} aria-hidden="true" data-testid={`nav-lock-${href.replace('/', '')}`} style={{ marginLeft: 'auto', color: 'var(--text-3)' }} />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
```

`src/app/(app)/_components/BottomTabBar.tsx` — analog: `Lock` importieren, Signatur `({ role, lockedHrefs = [] }: { role: Role; lockedHrefs?: string[] })`, im Tab-Link:

```tsx
            aria-label={isLocked ? `${label} (gesperrt im aktuellen Plan)` : undefined}
```

und neben dem Icon (absolut positioniertes Mini-Schloss, kein Layout-Shift):

```tsx
            <span style={{ position: 'relative', display: 'inline-flex' }}>
              <Icon size={20} aria-hidden="true" />
              {isLocked ? (
                <Lock
                  size={10}
                  aria-hidden="true"
                  style={{ position: 'absolute', right: -6, top: -3, color: 'var(--text-3)' }}
                />
              ) : null}
            </span>
```

(`const isLocked = lockedHrefs.includes(href);` jeweils im map-Callback.)

`src/app/(app)/layout.tsx` — nach den T10-Redirects:

```ts
  const ent = await getEntitlements(tenant.id);
  // Gated Module bleiben sichtbar mit Schloss (Spec §10) — Klick landet auf der Upsell-Karte.
  const lockedHrefs = ent.features.analytik ? [] : ['/analytik'];
```

Import `getEntitlements` ergänzen; `<SidebarNav role={user.role} lockedHrefs={lockedHrefs} />` und `<BottomTabBar role={user.role} lockedHrefs={lockedHrefs} />` übergeben.

- [ ] **Step 7: Voller Testlauf + Commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: ALLE Tests grün (bestehende 643 + neue). Bei Failures in Bestandstests: prüfen, ob es die Step-3-Fixture-Fälle sind (Tenant-Plan), NICHT Assertions aufweichen.

```bash
git add src/lib/ankauf.ts src/lib/collections.ts scripts/seed.ts "src/app/(app)/ankauf" "src/app/(app)/analytik" "src/app/(app)/layout.tsx" "src/app/(app)/_components" tests/
git commit -m "feat(slice6): T12 Gating-Enforcement — Kapazitäts-Gate in performAnkauf/createCollection, Listing-Feature-Gate, Analytik-Upsell, Nav-Locks

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 13: E2E (5 Szenarien) + Helpers + Doku-Feinschliff

**Files:**
- Modify: `e2e/helpers.ts` (+Platform-/Freeshop-Konstanten + platformLogin)
- Create: `e2e/platform-billing.spec.ts`
- Test: kompletter E2E-Lauf gegen den Compose-Stack

**Interfaces:**
- Consumes: Seed (T2: freeshop maxRecords-Override 2, Platform-User, demo=big), Fake-Billing (T5), Wizard/Passwort (T10/T11), Gating (T12), Middleware (T3).
- Produces: `PLATFORM_URL = 'http://admin.localhost:3000'`, `FREESHOP_URL = 'http://freeshop.localhost:3000'`, `PLATFORM_EMAIL`/`PLATFORM_PASSWORD`, `FREESHOP_EMAIL`/`FREESHOP_PASSWORD`, `platformLogin(page)`.

- [ ] **Step 1: Helpers erweitern**

In `e2e/helpers.ts` anhängen:

```ts
// ── Slice-6 additions (Platform-Zone + Billing + Gating) ────────────────────

export const PLATFORM_URL = 'http://admin.localhost:3000';
export const FREESHOP_URL = 'http://freeshop.localhost:3000';

/** Muss mit scripts/seed.ts PLATFORM_ADMIN_EMAIL + SEED_ADMIN_PASSWORD (.env.compose) übereinstimmen. */
export const PLATFORM_EMAIL = process.env.E2E_PLATFORM_EMAIL ?? 'platform@qrecords.test';
export const PLATFORM_PASSWORD = process.env.E2E_PLATFORM_PASSWORD ?? 'E2eDevPassword1!';
export const FREESHOP_EMAIL = process.env.E2E_FREESHOP_EMAIL ?? 'admin@freeshop.test';
export const FREESHOP_PASSWORD = process.env.E2E_FREESHOP_PASSWORD ?? 'E2eDevPassword1!';

/** Login in der Platform-Zone (eigene Session, NICHT Auth.js — Submit-Button „Anmelden"). */
export async function platformLogin(page: Page): Promise<void> {
  await page.goto(`${PLATFORM_URL}/login`);
  await page.getByLabel(/e-mail/i).fill(PLATFORM_EMAIL);
  await page.getByLabel(/passwort/i).fill(PLATFORM_PASSWORD);
  await page.getByRole('button', { name: /anmelden/i }).click();
  await expect(page.getByTestId('platform-tenant-list')).toBeVisible();
}

/** Freeshop-Tenant-Id aus der Registry (Gating-Szenarien). */
export async function freeshopTenantId(): Promise<number> {
  const rows = await dbQuery<{ id: number }>(`SELECT id FROM tenants WHERE slug = 'freeshop' LIMIT 1`);
  if (!rows[0]) throw new Error('freeshop tenant not found — is the stack seeded?');
  return rows[0].id;
}
```

- [ ] **Step 2: E2E-Spec schreiben**

Create `e2e/platform-billing.spec.ts`:

```ts
/**
 * E2E acceptance — Slice 6: Platform-Zone + Onboarding + Billing + Gating (Spec §14).
 * Serial (workers:1): Szenario 2 verbraucht den in Szenario 1 angelegten Tenant.
 * Stack: docker compose up -d --build (BILLING_DRIVER=fake, DISCOGS_DRIVER=fake, seeded).
 * Re-Seed setzt freeshop zurück (plan free, limits {maxRecords:2}, Bestände) — Szenarien 3/4
 * sind daher über Läufe hinweg deterministisch, solange vor dem Lauf geseedet wurde.
 */
import { test, expect } from '@playwright/test';
import {
  DEMO_URL,
  FREESHOP_URL,
  FREESHOP_EMAIL,
  FREESHOP_PASSWORD,
  PLATFORM_URL,
  platformLogin,
  login,
} from './helpers';

test.describe.configure({ mode: 'serial' });

const RUN = Date.now();
const NEW_SLUG = `e2e${RUN}`; // 16 Zeichen — im SLUG_REGEX-Rahmen (3–32)
const NEW_URL = `http://${NEW_SLUG}.localhost:3000`;
const NEW_ADMIN_EMAIL = `admin@${NEW_SLUG}.test`;
const NEW_PASSWORD = 'WizardTest123!';
let tempPassword = '';

test('1. Platform-Login → Tenant anlegen → temp. Passwort sichtbar → Tenant lädt', async ({ page }) => {
  await platformLogin(page);

  await page.getByTestId('platform-tenant-create-link').click();
  await page.getByLabel('Slug').fill(NEW_SLUG);
  await page.getByLabel('Name').fill('E2E Wizardshop');
  await page.getByLabel('Admin-E-Mail').fill(NEW_ADMIN_EMAIL);
  await page.getByLabel('Primärfarbe').fill('#C84B31');
  await page.getByLabel('Plan').selectOption('free');
  await page.getByRole('button', { name: 'Anlegen' }).click();

  await expect(page.getByTestId('platform-tenant-created')).toBeVisible();
  tempPassword = (await page.getByTestId('temp-password').textContent())!.trim();
  expect(tempPassword).toMatch(/^[A-Z2-7]{16}$/);

  // Neuer Tenant lädt unter <slug>.localhost mit Login-Seite:
  await page.goto(`${NEW_URL}/login`);
  await expect(page.getByRole('button', { name: /anmelden/i })).toBeVisible();
});

test('2. Erst-Login → Passwortzwang → Wizard (4 Schritte, Discogs überspringen) → nie wieder', async ({ page }) => {
  // Login mit temp. Passwort → (app)-Layout redirectet auf /passwort:
  await page.goto(`${NEW_URL}/login`);
  await page.getByLabel(/e-mail/i).fill(NEW_ADMIN_EMAIL);
  await page.getByLabel(/passwort/i).fill(tempPassword);
  await page.getByRole('button', { name: /anmelden/i }).click();
  await expect(page).toHaveURL(`${NEW_URL}/passwort`);

  // Accessible Name = aria-label der Inputs (gewinnt über den <label>-Text) →
  // exact-Matching, weil „Neues Passwort" ein Präfix von „Neues Passwort wiederholen" ist:
  await page.getByLabel('Aktuelles Passwort', { exact: true }).fill(tempPassword);
  await page.getByLabel('Neues Passwort', { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel('Neues Passwort wiederholen', { exact: true }).fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Passwort ändern' }).click();

  // Admin ohne Onboarding → Wizard Schritt 1:
  await expect(page).toHaveURL(new RegExp(`${NEW_URL}/onboarding`));
  await expect(page.getByTestId('wizard-stepper')).toBeVisible();

  // Schritt 1: Name ändern + Weiter (Submit):
  await page.getByLabel('Shop-Name').fill('E2E Wizardshop GmbH');
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(page).toHaveURL(`${NEW_URL}/onboarding?step=2`);

  // Schritt 2 (Discogs): überspringen via „Später":
  await page.getByTestId('wizard-next').click();
  await expect(page).toHaveURL(`${NEW_URL}/onboarding?step=3`);

  // Schritt 3 (Team): überspringen:
  await page.getByTestId('wizard-next').click();
  await expect(page).toHaveURL(`${NEW_URL}/onboarding?step=4`);

  // Schritt 4 (Review): Zusammenfassung zeigt den neuen Namen; „Los geht's" → Dashboard:
  await expect(page.getByTestId('onboarding-wizard')).toContainText('E2E Wizardshop GmbH');
  await page.getByTestId('wizard-finish').click();
  await expect(page).toHaveURL(`${NEW_URL}/`);

  // Erneuter Login zeigt keinen Wizard mehr:
  await page.context().clearCookies();
  await login(page, NEW_URL, NEW_ADMIN_EMAIL, NEW_PASSWORD);
  await expect(page).toHaveURL(`${NEW_URL}/`);
});

test('3. freeshop (free, maxRecords=2): Analytik-Upsell + Limit-Fehler beim Ankauf', async ({ page }) => {
  await login(page, FREESHOP_URL, FREESHOP_EMAIL, FREESHOP_PASSWORD);

  // Analytik zeigt Upsell-Karte statt Charts:
  await page.goto(`${FREESHOP_URL}/analytik`);
  await expect(page.getByTestId('analytik-upsell')).toBeVisible();
  await expect(page.getByTestId('analytik-upsell')).toContainText('verfügbar ab Small');

  // Positive Kontrolle UNTER dem Limit (Seed: 1 Platte, Limit 2) — Sammlungs-Ankauf,
  // manuelle Erfassung (freeshop hat KEINE Discogs-Verbindung; Muster aus
  // e2e/analytics-batch-labels.spec.ts):
  await page.goto(`${FREESHOP_URL}/ankauf/sammlung`);
  await expect(page.getByTestId('sammlung-screen')).toBeVisible();
  await page.getByTestId('sammlung-seller-input').fill(`E2E Limit ${RUN}`);
  await page.getByTestId('sammlung-add-item').click();
  await page.getByRole('button', { name: 'Manuell erfassen' }).click();
  await page.getByLabel('Titel').fill(`Unter Limit ${RUN}`);
  await page.getByLabel('Künstler').fill('E2E Gate');
  await page.getByLabel('Einkaufspreis (EK)').fill('5.00');
  await page.getByLabel('Verkaufspreis (VK)').fill('10.00');
  await page.getByTestId('sammlung-submit').click();
  await expect(page).toHaveURL(new RegExp('/ankauf/sammlungen'), { timeout: 15_000 });

  // Jetzt 2/2 — der nächste Ankauf schlägt mit dem exakten Limit-Formularfehler fehl:
  await page.goto(`${FREESHOP_URL}/ankauf/sammlung`);
  await page.getByTestId('sammlung-seller-input').fill(`E2E Über Limit ${RUN}`);
  await page.getByTestId('sammlung-add-item').click();
  await page.getByRole('button', { name: 'Manuell erfassen' }).click();
  await page.getByLabel('Titel').fill(`Über Limit ${RUN}`);
  await page.getByLabel('Künstler').fill('E2E Gate');
  await page.getByLabel('Einkaufspreis (EK)').fill('5.00');
  await page.getByLabel('Verkaufspreis (VK)').fill('10.00');
  await page.getByTestId('sammlung-submit').click();
  await expect(page.getByText(/Plan-Limit erreicht: max\. 2 Platten im Free-Plan/)).toBeVisible();
});

test('4. Upgrade freeshop → Small via Fake-Checkout: Plan sichtbar, Analytik rendert', async ({ page }) => {
  await login(page, FREESHOP_URL, FREESHOP_EMAIL, FREESHOP_PASSWORD);

  await page.goto(`${FREESHOP_URL}/einstellungen?tab=abo`);
  await expect(page.getByTestId('abo-current-plan')).toContainText('Free');
  await page.getByTestId('upgrade-small').click();

  // Fake-Checkout redirectet direkt zurück mit checkout=success:
  await expect(page).toHaveURL(`${FREESHOP_URL}/einstellungen?tab=abo&checkout=success`);
  await expect(page.getByTestId('abo-current-plan')).toContainText('Small');
  await expect(page.getByTestId('abo-subscription')).toContainText('active');

  // Analytik rendert jetzt Charts statt Upsell:
  await page.goto(`${FREESHOP_URL}/analytik`);
  await expect(page.getByTestId('analytik-screen')).toBeVisible();
  await expect(page.getByTestId('analytik-upsell')).toHaveCount(0);
});

test('5. Zonen-Isolation: /platform auf Tenant-Host 404, admin-Host ohne Session → Login', async ({ request }) => {
  // Request-Fixture mit explizitem Host-Header (Muster aus Slice 5):
  const onTenant = await request.get('http://127.0.0.1:3000/platform', {
    headers: { host: 'demo.localhost:3000' },
    maxRedirects: 0,
  });
  expect(onTenant.status()).toBe(404);

  const directOnAdmin = await request.get('http://127.0.0.1:3000/platform', {
    headers: { host: 'admin.localhost:3000' },
    maxRedirects: 0,
  });
  expect(directOnAdmin.status()).toBe(404); // direkter Pfad ist AUCH auf dem Admin-Host 404

  const adminRoot = await request.get('http://127.0.0.1:3000/', {
    headers: { host: 'admin.localhost:3000' },
    maxRedirects: 0,
  });
  expect([302, 303, 307, 308]).toContain(adminRoot.status());
  expect(adminRoot.headers()['location']).toContain('/login');
});
```

- [ ] **Step 3: Kompletter E2E-Lauf**

Run:
```bash
docker compose up -d --build
pnpm e2e
```
Expected: ALLE Specs grün — die bestehenden 59 UND `platform-billing.spec.ts` (5 neue). Häufigste Stolperstellen, falls rot:
- Szenario 3/4 nicht deterministisch → wurde vor dem Lauf geseedet? (Compose-`seed`-Service bzw. `pnpm db:seed` führt `resetFreeshopGatingState` aus.)
- Bestehende Logins landen auf `/passwort` oder `/onboarding` → Seed-Schritt `markTenantOnboarded` fehlt/lief nicht (T2).
- `admin.localhost` löst im Browser nicht auf → wie `demo.localhost` behandeln (localhost-Subdomains lösen unter macOS/Chromium nativ auf; Playwright nutzt dieselbe Mechanik wie die bestehenden Specs).

- [ ] **Step 4: Finale Gates + Commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: alles grün.

```bash
git add e2e/helpers.ts e2e/platform-billing.spec.ts
git commit -m "test(slice6): T13 E2E — Platform-Provisioning, Erst-Login+Wizard, Gating-Limit, Fake-Upgrade, Zonen-Isolation

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Selbstreview-Anker (für den Plan-Reviewer)

- Spec §4 → T3 · §5 → T3 · §6 → T4 · §7 → T5 · §8 → T1+T2 · §9 → T6+T9 · §10 → T2+T12 · §11 → T10+T11 · §12 → T7+T8+T9 · §13 → Global Constraints · §14 → Tests in T1–T13.
- Spec-Amendments (werden VOR Ausführung im Spec-Dokument nachgezogen, siehe Commit-Historie): (1) §11.2/§12 Discogs via OAuth-Reuse statt manueller Token-Felder (+`identity()` für „Verbindung testen"); (2) §8 Boot-Assertion braucht keine Registry-Ausnahmeliste (Drift-Guard introspiziert nur tenant_id-Tabellen); (3) §7 `subscription_updated` trägt `priceId`, Auflösung im Apply-Handler; (4) §12 Mobile-Einstieg = Gear-Icon (es gibt kein Mobile-Header-Menü); Plan-Matrix wird per Migration 0012 gepflegt (0002-Nachfolger), nicht per Seed.
