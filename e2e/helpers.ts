// Shared constants + helpers for the E2E acceptance suite.
//
// IMPORTANT: the seeded admin emails are admin@demo.test / admin@vinylcave.test
// (see scripts/seed.ts DEMO_TENANT/VINYLCAVE_TENANT.adminEmail) — NOT *.localhost.
// Passwords are deterministic via SEED_ADMIN_PASSWORD (.env.compose → E2eDevPassword1!).
import { expect, type Page } from '@playwright/test';
import { Pool } from 'pg';

export const DEMO_URL = 'http://demo.localhost:3000';
export const VINYLCAVE_URL = 'http://vinylcave.localhost:3000';
export const MAILPIT_API = 'http://localhost:8025/api/v1';

export const DEMO_EMAIL = process.env.E2E_DEMO_EMAIL ?? 'admin@demo.test';
export const DEMO_PASSWORD = process.env.E2E_DEMO_PASSWORD ?? 'E2eDevPassword1!';
export const VC_EMAIL = process.env.E2E_VC_EMAIL ?? 'admin@vinylcave.test';
export const VC_PASSWORD = process.env.E2E_VC_PASSWORD ?? 'E2eDevPassword1!';

/**
 * Log in on a tenant and assert the dashboard (authenticated shell) rendered.
 * The submit button reads "Anmelden" (src/app/login/page.tsx).
 */
export async function login(
  page: Page,
  baseUrl: string,
  email: string,
  password: string,
): Promise<void> {
  await page.goto(`${baseUrl}/login`);
  await page.getByLabel(/e-mail/i).fill(email);
  await page.getByLabel(/passwort/i).fill(password);
  await page.getByRole('button', { name: /anmelden/i }).click();
  await expect(page).toHaveURL(`${baseUrl}/`);
  await page.waitForLoadState('domcontentloaded');
}

// ── Slice-1 additions ──────────────────────────────────────────────────────

/** Seeded public permalink slugs used in E2E specs (Task 6 ensurePermalink). */
export const DEMO_JAZZ_SLUG = 'jazz';
export const DEMO_NEU_SLUG = 'neu';
export const VC_VINYL_SLUG = 'vinyl';
export const VC_NEU_SLUG = 'neu';

/**
 * Assert the full rendered HTML of the current page contains none of the private
 * inventory field names that must never appear on the public storefront.
 *
 * Covers: purchasePrice / targetPrice / conditionRecord / conditionCover
 * (both camelCase and snake_case forms, to catch RSC payloads and HTML attrs).
 */
export async function assertNoPrivateFields(page: Page): Promise<void> {
  const html = await page.content();
  // Field-name scan (camelCase + snake_case — catches RSC payloads and HTML attrs)
  expect(html).not.toMatch(/purchase_price|purchasePrice/i);
  expect(html).not.toMatch(/target_price|targetPrice/i);
  expect(html).not.toMatch(/condition_record|conditionRecord/i);
  expect(html).not.toMatch(/condition_cover|conditionCover/i);
  // Value-level scan — a known seeded VK must never appear in the rendered output
  // (guards against regressions that emit raw price values into meta strings or attrs).
  // '24.90' is a seeded targetPrice for an in-stock record on BOTH tenants
  // (demo "Kind of Blue" / vinylcave "Unknown Pleasures"), so it is shown on the
  // jazz + vinyl storefronts iff the price leaked.
  expect(html).not.toContain('24.90');
}

// ── Slice-2 additions (Discogs Ankauf) ──────────────────────────────────────

/**
 * Fake Discogs connection seeded for the DEMO tenant ONLY.
 *
 * MUST stay in sync with scripts/seed.ts (DEMO_DISCOGS_* consts + the
 * ensureDiscogsConnection call in main()). The token/secret are the exact
 * plaintext values the no-token-leak scenario scans for — so the scan is
 * non-vacuous (a leak of the real seeded value would be caught).
 */
export const DEMO_DISCOGS_USERNAME = 'qrecords-demo-seller';
export const DEMO_DISCOGS_FAKE_TOKEN = 'e2e-fake-oauth-token-demo-DO-NOT-LEAK-7f3a9c';
export const DEMO_DISCOGS_FAKE_SECRET = 'e2e-fake-oauth-secret-demo-DO-NOT-LEAK-2b8e1d';

/**
 * Owner connection string for the compose Postgres, exposed on host port 55432
 * (see docker-compose.yml db.ports). Used ONLY by e2e/discogs.spec.ts to assert
 * server-side state with no UI surface: the Discogs listing-status transition and
 * the record-dedup gate. Override via E2E_DATABASE_URL if your stack differs.
 */
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgresql://qr_owner:owner_secret@localhost:55432/qrecords';

/**
 * Run a one-shot query against the e2e database. Opens + closes a fresh pool per
 * call so no connection handle lingers to keep the Playwright runner alive.
 */
export async function dbQuery<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const pool = new Pool({ connectionString: E2E_DATABASE_URL });
  try {
    const res = await pool.query(sql, params);
    return res.rows as T[];
  } finally {
    await pool.end();
  }
}

/** Resolve the demo tenant's numeric id from the registry. */
export async function demoTenantId(): Promise<number> {
  const rows = await dbQuery<{ id: number }>(`SELECT id FROM tenants WHERE slug = 'demo' LIMIT 1`);
  if (!rows[0]) throw new Error('demo tenant not found — is the stack seeded?');
  return rows[0].id;
}

// ── Slice-3 additions (Task 14) ─────────────────────────────────────────────

/** A Mailpit message shape (subset of its API). */
export interface MailpitMessage {
  ID: string;
  Subject: string;
  To: Array<{ Address: string }>;
}

/** Fetch the current Mailpit inbox (newest first). Used to assert wishlist notification mail. */
export async function mailpitMessages(
  request: import('@playwright/test').APIRequestContext,
): Promise<MailpitMessage[]> {
  const res = await request.get(`${MAILPIT_API}/messages`);
  if (!res.ok()) return [];
  const body = (await res.json()) as { messages?: MailpitMessage[] };
  return body.messages ?? [];
}

// ── Slice-4 additions (Task 11) ─────────────────────────────────────────────

/** Number of Batch-Ankauf collections for a tenant (drives the Analytik 'Sammlungen' KPI sub). */
export async function collectionsCount(tenantId: number): Promise<number> {
  const rows = await dbQuery<{ n: string }>(
    `SELECT COUNT(*) AS n FROM collections WHERE tenant_id = $1`,
    [tenantId],
  );
  return Number(rows[0]!.n);
}

/** Per-tenant sales counters straight from the DB (no UI surface proves these alone). */
export async function salesCounts(tenantId: number): Promise<{
  transactions: number;
  verkauft: number;
  reserviert: number;
  pendingMatches: number;
  notifiedMatches: number;
}> {
  const rows = await dbQuery<{
    transactions: string; verkauft: string; reserviert: string; pending: string; notified: string;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM transactions     WHERE tenant_id = $1)                                AS transactions,
       (SELECT COUNT(*) FROM purchases        WHERE tenant_id = $1 AND status = 'verkauft')        AS verkauft,
       (SELECT COUNT(*) FROM purchases        WHERE tenant_id = $1 AND status = 'reserviert')      AS reserviert,
       (SELECT COUNT(*) FROM wishlist_matches WHERE tenant_id = $1 AND status = 'pending')         AS pending,
       (SELECT COUNT(*) FROM wishlist_matches WHERE tenant_id = $1 AND status = 'notified')        AS notified`,
    [tenantId],
  );
  const r = rows[0]!;
  return {
    transactions: Number(r.transactions),
    verkauft: Number(r.verkauft),
    reserviert: Number(r.reserviert),
    pendingMatches: Number(r.pending),
    notifiedMatches: Number(r.notified),
  };
}
