/**
 * E2E acceptance — Dashboard / Übersicht (/).
 *
 * Covers §10 criterion 3 (real KPIs + calm empty states) and §10 criterion 7
 * against the live, seeded stack.
 *
 * Prerequisites: docker compose up -d --build (db → migrate → seed → web).
 *
 * The "Artikel im Lager" KPI must equal the LIVE count of 'verfuegbar' copies in
 * the DB. That real-count check is load-bearing — asserted against a tenant-scoped
 * query instead of a hardcoded seed constant, because the seeded baseline moves
 * (Slice 4's demo collection adds copies) and earlier specs in the serial run
 * legitimately create more (batch-Ankauf).
 */
import { test, expect } from '@playwright/test';
import { DEMO_URL, DEMO_EMAIL, DEMO_PASSWORD, login, dbQuery, demoTenantId } from './helpers';

test.describe('Dashboard / Übersicht (/)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, DEMO_URL, DEMO_EMAIL, DEMO_PASSWORD);
  });

  test('shows the REAL "Artikel im Lager" KPI equal to the live available count', async ({
    page,
  }) => {
    const tenantId = await demoTenantId();
    const rows = await dbQuery<{ n: string }>(
      `SELECT COUNT(*) AS n FROM purchases WHERE tenant_id = $1 AND status = 'verfuegbar'`,
      [tenantId],
    );
    const expected = Number(rows[0]!.n);
    expect(expected).toBeGreaterThan(0); // seed guarantees stock — a 0 here means a broken stack

    await page.goto(`${DEMO_URL}/`);
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByText(/artikel im lager/i)).toBeVisible();

    // data-testid="kpi-inventory-available" holds the real count of verfuegbar copies.
    const countEl = page.locator('[data-testid="kpi-inventory-available"]');
    await expect(countEl).toBeVisible();
    const raw = (await countEl.innerText()).trim();
    const n = parseInt(raw.replace(/[^\d]/g, ''), 10);
    expect(n).toBe(expected);
  });

  test('format-split labels (Vinyl / CD) visible inside the inventory KPI area', async ({
    page,
  }) => {
    await page.goto(`${DEMO_URL}/`);
    await page.waitForLoadState('domcontentloaded');

    // Seed has Vinyl + CD copies → the format caption must surface both labels.
    const vinylCount = await page.getByText(/\bvinyl\b/i).count();
    const cdCount = await page.getByText(/\bcd\b/i).count();
    expect(vinylCount + cdCount).toBeGreaterThan(0);
  });

  test('"Tagesumsatz" card shows a calm empty state — no fabricated non-zero revenue', async ({
    page,
  }) => {
    await page.goto(`${DEMO_URL}/`);
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByText(/tagesumsatz/i)).toBeVisible();

    // The card's calm empty-state copy must be present.
    await expect(page.getByText(/noch keine verkäufe/i).first()).toBeVisible();

    // Scope to the Tagesumsatz card (the nearest ancestor of the label that also
    // contains its calm "€ 0" value) and assert it carries NO non-zero euro amount.
    const card = page
      .getByText('Tagesumsatz', { exact: true })
      .locator('xpath=ancestor::*[.//text()[contains(., "€ 0")]][1]');
    const cardText = await card.innerText();
    expect(cardText).toContain('€ 0');
    expect(cardText).not.toMatch(/€\s*[1-9]/); // never a fake "€ 1.234"
  });

  test('"Letzte Verkäufe" panel shows its empty-state placeholder text', async ({ page }) => {
    await page.goto(`${DEMO_URL}/`);
    await page.waitForLoadState('domcontentloaded');

    const panel = page.locator('[data-testid="panel-letzte-verkaeufe"]');
    await expect(panel).toBeVisible();
    await expect(panel.getByText(/noch keine verkäufe/i)).toBeVisible();
  });

  test('"Wunschlisten-Treffer" panel shows its empty-state placeholder text', async ({ page }) => {
    await page.goto(`${DEMO_URL}/`);
    await page.waitForLoadState('domcontentloaded');

    const panel = page.locator('[data-testid="panel-wunschlisten"]');
    await expect(panel).toBeVisible();
    await expect(panel.getByText(/noch keine treffer/i)).toBeVisible();
  });
});
