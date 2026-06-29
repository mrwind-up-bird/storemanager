/**
 * E2E acceptance — Public Schaufenster (s/[permalink]).
 *
 * Covers §10 criteria 4 (no price/condition leak, 404 on unknown, tenant
 * isolation) and §10 criterion 7 (grid + availability badges + in-results
 * search) against the live, seeded stack. No authentication — public route.
 *
 * Prerequisites: docker compose up -d --build (db → migrate → seed → web).
 *
 * NOTE ON SELECTORS — verified against the real Slice-1 StorefrontGrid:
 *   • Each record card is an <article> (getByRole('article')).
 *   • The card title is the FIRST <p> inside the article (no <h2>/<h3>/data-slot).
 *   • StorefrontSearch is a <form role="search"> that pushes ?q= on SUBMIT
 *     (Enter), not on input change.
 */
import { test, expect } from '@playwright/test';
import {
  DEMO_URL,
  VINYLCAVE_URL,
  DEMO_JAZZ_SLUG,
  VC_VINYL_SLUG,
  assertNoPrivateFields,
} from './helpers';

/** Title of each record card = the first <p> in the article body. */
async function cardTitles(scope: import('@playwright/test').Page): Promise<string[]> {
  const articles = scope.getByRole('article');
  const n = await articles.count();
  const titles: string[] = [];
  for (let i = 0; i < n; i++) {
    titles.push((await articles.nth(i).locator('p').first().innerText()).trim());
  }
  return titles.filter(Boolean);
}

test.describe('Public Schaufenster (s/[permalink])', () => {
  test('demo/jazz permalink renders a grid of record cards with availability badges', async ({
    page,
  }) => {
    const res = await page.goto(`${DEMO_URL}/s/${DEMO_JAZZ_SLUG}`);
    expect(res?.status()).toBe(200); // slug seeded by Task 6
    await page.waitForLoadState('domcontentloaded');

    const cards = page.getByRole('article');
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeGreaterThan(0);

    // Availability badges — exact labels from design handoff (availability.in / .low).
    const badgesIn = await page.getByText('Verfügbar im Store').count();
    const badgesLow = await page.getByText('Nur noch 1×').count();
    expect(badgesIn + badgesLow).toBeGreaterThan(0);
  });

  test('in-results search narrows cards and sets ?q= URL param', async ({ page }) => {
    await page.goto(`${DEMO_URL}/s/${DEMO_JAZZ_SLUG}`);
    await page.waitForLoadState('domcontentloaded');
    const totalCards = await page.getByRole('article').count();
    expect(totalCards).toBeGreaterThan(0);

    // StorefrontSearch — placeholder verbatim from handoff; submits on Enter.
    const search = page.getByPlaceholder(/In diesen Ergebnissen suchen/i);
    await search.fill('miles');
    await search.press('Enter');
    await page.waitForURL(/[?&]q=miles/i);

    // 'miles' matches only Miles Davis records → a real, narrower subset that is still non-empty.
    await expect
      .poll(async () => page.getByRole('article').count(), { timeout: 5_000 })
      .toBeLessThan(totalCards);
    expect(await page.getByRole('article').count()).toBeGreaterThan(0);
  });

  test('storefront page HTML exposes no private inventory field names or prices', async ({
    page,
  }) => {
    await page.goto(`${DEMO_URL}/s/${DEMO_JAZZ_SLUG}`);
    await page.waitForLoadState('domcontentloaded');
    // Scans raw HTML for purchasePrice / targetPrice / conditionRecord / conditionCover
    // (camelCase + snake_case) AND a known seeded VK value.
    await assertNoPrivateFields(page);
  });

  test('unknown permalink slug returns 404', async ({ page }) => {
    const res = await page.goto(`${DEMO_URL}/s/nicht-vorhanden-xqz99`);
    expect(res?.status()).toBe(404);
  });

  test('vinylcave storefront serves vinylcave records, never demo records', async ({ browser }) => {
    // 1. Collect demo's jazz storefront card titles.
    const demoCtx = await browser.newContext();
    const demoPage = await demoCtx.newPage();
    await demoPage.goto(`${DEMO_URL}/s/${DEMO_JAZZ_SLUG}`);
    await demoPage.waitForLoadState('domcontentloaded');
    await expect(demoPage.getByRole('article').first()).toBeVisible();
    const demoTitles = await cardTitles(demoPage);
    expect(demoTitles.length).toBeGreaterThan(0); // guard: titles really were extracted
    await demoCtx.close();

    // 2. Load vinylcave's vinyl storefront (public — no auth).
    const vcCtx = await browser.newContext();
    const vcPage = await vcCtx.newPage();
    const vcRes = await vcPage.goto(`${VINYLCAVE_URL}/s/${VC_VINYL_SLUG}`);
    expect(vcRes?.status()).toBe(200);
    await vcPage.waitForLoadState('domcontentloaded');

    // Stays on the vinylcave domain and shows its own records.
    expect(vcPage.url()).toMatch(/vinylcave\.localhost/);
    await expect(vcPage.getByRole('article').first()).toBeVisible();

    // No cross-tenant contamination in the rendered HTML.
    const vcHtml = await vcPage.content();
    expect(vcHtml).not.toContain('demo.localhost');
    for (const demoTitle of demoTitles) {
      expect(vcHtml, `demo title "${demoTitle}" must not appear on vinylcave storefront`).not.toContain(
        demoTitle,
      );
    }

    // No private fields on the vinylcave page either.
    await assertNoPrivateFields(vcPage);
    await vcCtx.close();
  });
});
