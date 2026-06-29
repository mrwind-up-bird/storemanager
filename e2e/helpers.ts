// Shared constants + helpers for the E2E acceptance suite.
//
// IMPORTANT: the seeded admin emails are admin@demo.test / admin@vinylcave.test
// (see scripts/seed.ts DEMO_TENANT/VINYLCAVE_TENANT.adminEmail) — NOT *.localhost.
// Passwords are deterministic via SEED_ADMIN_PASSWORD (.env.compose → E2eDevPassword1!).
import { expect, type Page } from '@playwright/test';

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
