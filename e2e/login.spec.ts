import { test, expect } from '@playwright/test';
import { DEMO_URL, DEMO_EMAIL, DEMO_PASSWORD, login } from './helpers';

// §9.8(a): the full Auth.js DB-session round-trip at runtime —
// signIn(credentials) → jwt.encode mints an opaque token + DB session row → Set-Cookie →
// requireSession() reads it back via the tenant adapter → authed shell renders.

test('login on demo.localhost with seed credentials lands on the dashboard', async ({ page }) => {
  await login(page, DEMO_URL, DEMO_EMAIL, DEMO_PASSWORD);
  await expect(page).toHaveURL(`${DEMO_URL}/`);
  // The authenticated shell renders the sidebar <nav> — proof the session resolved server-side.
  await expect(page.getByRole('navigation')).toBeVisible();
});

test('wrong password on demo.localhost stays on /login', async ({ page }) => {
  await page.goto(`${DEMO_URL}/login`);
  await page.getByLabel(/e-mail/i).fill(DEMO_EMAIL);
  await page.getByLabel(/passwort/i).fill('definitely-the-wrong-password');
  await page.getByRole('button', { name: /anmelden/i }).click();
  // Must NOT reach the dashboard.
  await expect(page).toHaveURL(new RegExp(`^${DEMO_URL}/login`));
  await expect(page.getByRole('navigation')).toHaveCount(0);
});
