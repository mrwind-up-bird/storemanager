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
