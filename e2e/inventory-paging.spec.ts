/**
 * E2E — /inventar keyset pagination ("Mehr laden").
 * Runs against the seeded `stress` tenant (≥ 70 verfügbare Kopien > page size 50).
 * Prerequisites: docker compose up -d --build (db → migrate → seed → web).
 */
import { test, expect } from '@playwright/test';
import { STRESS_URL, STRESS_EMAIL, STRESS_PASSWORD, login } from './helpers';

test.describe('Lagerbestand paging (/inventar)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, STRESS_URL, STRESS_EMAIL, STRESS_PASSWORD);
  });

  test('first page caps at 50 rows and "Mehr laden" appends the rest', async ({ page }) => {
    await page.goto(`${STRESS_URL}/inventar`);
    await page.waitForLoadState('domcontentloaded');
    // Tiles is the default view; switch to Liste so `tbody tr` is the stable row selector.
    await page.getByRole('radiogroup', { name: /ansicht wechseln/i }).getByText(/liste/i).click();
    await expect(page.locator('table')).toBeVisible();

    // First page: exactly the page size (50), not all 70.
    await expect
      .poll(async () => page.locator('tbody tr').count(), { timeout: 5_000 })
      .toBe(50);

    const loadMore = page.getByTestId('load-more');
    await expect(loadMore).toBeVisible();

    await loadMore.click();

    // After one load-more the accumulated rows exceed the first page …
    await expect
      .poll(async () => page.locator('tbody tr').count(), { timeout: 5_000 })
      .toBeGreaterThan(50);

    // … and with 70 total (< 2×50) the cursor is exhausted → button gone.
    await expect(page.getByTestId('load-more')).toHaveCount(0);
  });
});
