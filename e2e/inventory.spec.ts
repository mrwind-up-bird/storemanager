/**
 * E2E acceptance — Lagerbestand screen (/inventar).
 *
 * Covers §10 criteria 2 (filter/search/status) and 7 (E2E list↔tiles toggle,
 * format filter, status tab, search, reset) against the live, seeded stack.
 *
 * Prerequisites: docker compose up -d --build (db → migrate → seed → web).
 *
 * NOTE ON SELECTORS — verified against the real Slice-1 components, which differ
 * from the task-brief's illustrative snippets:
 *   • ViewToggle is a SegmentedControl → role="radiogroup" with radios-in-labels
 *     (NOT <button>). We toggle by clicking the radiogroup's option labels.
 *   • The Format filter is a native <select> (role="combobox") → selectOption works.
 *   • StatusTabs ARE <button> elements with a trailing count span.
 * The load-bearing assertions (format filter returns >0 rows; URL params update)
 * are preserved exactly.
 */
import { test, expect } from '@playwright/test';
import { DEMO_URL, DEMO_EMAIL, DEMO_PASSWORD, login } from './helpers';

test.describe('Lagerbestand (/inventar)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, DEMO_URL, DEMO_EMAIL, DEMO_PASSWORD);
  });

  test('renders seeded copies in list view with Treffer count visible', async ({ page }) => {
    await page.goto(`${DEMO_URL}/inventar`);
    await page.waitForLoadState('domcontentloaded');

    // Default view: table is rendered with at least one seeded copy.
    await expect(page.locator('table')).toBeVisible();
    await expect(page.locator('tbody tr').first()).toBeVisible();
    expect(await page.locator('tbody tr').count()).toBeGreaterThan(0);

    // FilterBar right side shows the "N Treffer" server-computed count.
    await expect(page.getByText(/treffer/i).first()).toBeVisible();
  });

  test('ViewToggle switches list → tiles → list', async ({ page }) => {
    await page.goto(`${DEMO_URL}/inventar`);
    await page.waitForLoadState('domcontentloaded');

    const toggle = page.getByRole('radiogroup', { name: /ansicht wechseln/i });

    // Start in list view: table visible, tiles absent.
    await expect(page.locator('table')).toBeVisible();
    await expect(page.locator('[data-testid="inventory-tiles"]')).toHaveCount(0);

    // Switch to tiles.
    await toggle.getByText(/kacheln/i).click();
    await expect(page.locator('[data-testid="inventory-tiles"]')).toBeVisible();
    await expect(page.locator('table')).toHaveCount(0);

    // Switch back to list.
    await toggle.getByText(/liste/i).click();
    await expect(page.locator('table')).toBeVisible();
    await expect(page.locator('[data-testid="inventory-tiles"]')).toHaveCount(0);
  });

  test('format filter sets URL param and returns matching rows (Vinyl > 0)', async ({ page }) => {
    await page.goto(`${DEMO_URL}/inventar`);
    await page.waitForLoadState('domcontentloaded');
    const totalRows = await page.locator('tbody tr').count();
    expect(totalRows).toBeGreaterThan(0);

    // Select "Vinyl" in the Format combobox (aria-label verbatim from handoff).
    await page.getByRole('combobox', { name: /format filtern/i }).selectOption('Vinyl');
    await page.waitForURL(/[?&]format=Vinyl/);
    expect(page.url()).toContain('format=Vinyl');

    // BLOCKER-REGRESSION GUARD: the Vinyl filter must return matching rows, never empty.
    await expect
      .poll(async () => page.locator('tbody tr').count(), { timeout: 5_000 })
      .toBeGreaterThan(0);
    const filteredRows = await page.locator('tbody tr').count();
    expect(filteredRows).toBeLessThanOrEqual(totalRows);
  });

  test('status tab "im Lager" updates URL to status=verfuegbar and matches the tab count', async ({
    page,
  }) => {
    await page.goto(`${DEMO_URL}/inventar`);
    await page.waitForLoadState('domcontentloaded');
    const totalRows = await page.locator('tbody tr').count();

    // The "im Lager" tab label carries its own count, e.g. "im Lager 11".
    const tab = page.getByRole('button', { name: /im lager/i });
    const tabText = await tab.innerText();
    const tabCount = parseInt(tabText.replace(/[^\d]/g, ''), 10);
    expect(tabCount).toBeGreaterThan(0);

    await tab.click();
    await page.waitForURL(/status=verfuegbar/);
    expect(page.url()).toContain('status=verfuegbar');

    // Filtered rows must equal the count shown on the tab, and be a subset of the total.
    await expect
      .poll(async () => page.locator('tbody tr').count(), { timeout: 5_000 })
      .toBe(tabCount);
    expect(tabCount).toBeLessThan(totalRows);
  });

  test('search input narrows rows and sets q URL param', async ({ page }) => {
    await page.goto(`${DEMO_URL}/inventar`);
    await page.waitForLoadState('domcontentloaded');
    const totalBefore = await page.locator('tbody tr').count();

    // FilterBar search field — placeholder verbatim from design handoff. Debounced ?q= push.
    await page.getByPlaceholder(/Im Sortiment suchen/i).fill('coltrane');
    await page.waitForURL(/[?&]q=coltrane/i);

    await expect
      .poll(async () => page.locator('tbody tr').count(), { timeout: 5_000 })
      .toBeLessThanOrEqual(totalBefore);
    // 'coltrane' matches at least the seeded John Coltrane records → still > 0.
    expect(await page.locator('tbody tr').count()).toBeGreaterThan(0);
  });

  test('"Zurücksetzen" clears all filter params and returns to bare /inventar', async ({
    page,
  }) => {
    await page.goto(`${DEMO_URL}/inventar?format=Vinyl&status=verfuegbar&q=test`);
    await page.waitForLoadState('domcontentloaded');

    await page.getByRole('button', { name: /zurücksetzen/i }).click();
    await page.waitForURL(`${DEMO_URL}/inventar`);

    const url = page.url();
    expect(url).not.toContain('format=');
    expect(url).not.toContain('status=');
    expect(url).not.toContain('q=');
  });
});
