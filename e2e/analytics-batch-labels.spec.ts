/**
 * E2E acceptance — Slice 4 Analytik + Batch-Ankauf (Sammlungen) + Etikettendruck (C14).
 *
 * Whole-flow gates: (1) Analytik renders KPIs/charts and the period toggle re-fetches via
 * ?period=; (2) CSV export downloads with the frozen C13 header; (3) Batch-Ankauf wizard
 * (manual entry) creates a collection that lands on /ankauf/sammlungen and moves the
 * Analytik 'Sammlungen' KPI; (4) a batch item's arrival fires the Slice-3 wishlist-match
 * job → pending match on /wunschlisten; (5) label PDF download from the inventory
 * multi-select + no customer/PII leak on the public storefront (positive control).
 *
 * Prerequisites: docker compose up -d --build (db → migrate → seed → web + worker + mailpit).
 * Compose Postgres is exposed on host :55432 so dbQuery can assert/prepare state with no
 * UI surface (owner connection — same convention as discogs/sales specs).
 */
import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import {
  DEMO_URL,
  DEMO_EMAIL,
  DEMO_PASSWORD,
  DEMO_JAZZ_SLUG,
  login,
  dbQuery,
  demoTenantId,
  assertNoPrivateFields,
  collectionsCount,
} from './helpers';

// Run serially: scenario 3 creates the collection whose match scenario 4 polls for.
test.describe.configure({ mode: 'serial' });

// Unique strings for this run — also the needles for the storefront no-PII scan (scenario 5).
// RUN-suffixed so the spec stays re-runnable against an already-used stack (each run creates
// its own wishlist + collection; scenario 4's exact-count poll would otherwise double-match).
const RUN = Date.now().toString(36);
const SELLER_NAME = `E2E Nachlass Verkäufer ${RUN}`;
const WISH_ARTIST = `E2E Sammlung Artist ${RUN}`;
const WISH_CUSTOMER = `E2E Wunsch Kunde ${RUN}`;
const WISH_EMAIL = `e2e.batch.${RUN}@example.test`;
const ITEM1 = { artist: WISH_ARTIST, title: `E2E Batch Title Eins ${RUN}` };
const ITEM2 = { artist: `E2E Zweiter Artist ${RUN}`, title: `E2E Batch Title Zwei ${RUN}` };

test.describe('Slice 4 — Analytik + Batch-Ankauf + Etiketten', () => {
  test('1. Analytik rendert: KPIs mit €-Wert, Charts, Periodenwechsel via ?period=', async ({ page }) => {
    await login(page, DEMO_URL, DEMO_EMAIL, DEMO_PASSWORD);
    await page.goto(`${DEMO_URL}/analytik`);

    await expect(page.getByTestId('analytik-screen')).toBeVisible();
    const kpis = page.getByTestId('analytik-kpis');
    await expect(kpis).toBeVisible();
    await expect(kpis).toContainText('€');
    await expect(page.getByTestId('analytik-revenue-bars')).toBeVisible();
    await expect(page.getByTestId('analytik-category-bar')).toBeVisible();

    // Period toggle pushes ?period=month and the RSC re-renders (C14).
    // SegmentedControl hides the radio input behind its label — click the label.
    await page
      .getByTestId('analytik-period-toggle')
      .locator('label', { hasText: 'Monat' })
      .click();
    await expect(page).toHaveURL(/\/analytik\?period=month/);
    await expect(page.getByTestId('analytik-screen')).toBeVisible();
    await expect(page.getByTestId('analytik-revenue-bars')).toBeVisible();
  });

  test('2. CSV-Download: Dateiname analytik-*, erste Zeile = frozen C13-Header', async ({ page }) => {
    await login(page, DEMO_URL, DEMO_EMAIL, DEMO_PASSWORD);
    await page.goto(`${DEMO_URL}/analytik`);

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('analytik-csv-export').click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/^analytik-.*\.csv$/);
    const csvPath = await download.path();
    const firstLine = fs.readFileSync(csvPath, 'utf8').split('\n')[0]!.trim();
    expect(firstLine).toBe('Datum;Bon-Nr;Zahlart;Zwischensumme;Rabatt;Summe');
  });

  test('3. Batch-Ankauf: Wizard (manuelle Erfassung) → Sammlung + Analytik-KPI', async ({ page }) => {
    test.setTimeout(60_000);
    const tenantId = await demoTenantId();
    const collectionsBefore = await collectionsCount(tenantId);

    // Scenario-4 precondition: an OPEN wishlist matching batch item 1's artist must exist
    // BEFORE the Ankauf, so the post-commit match job finds it.
    const users = await dbQuery<{ id: number }>(
      `SELECT id FROM users WHERE tenant_id = $1 ORDER BY id ASC LIMIT 1`,
      [tenantId],
    );
    await dbQuery(
      `INSERT INTO wishlists (tenant_id, created_by_user_id, customer_name, customer_email, artist, status)
       VALUES ($1, $2, $3, $4, $5, 'open')`,
      [tenantId, users[0]!.id, WISH_CUSTOMER, WISH_EMAIL, WISH_ARTIST],
    );

    await login(page, DEMO_URL, DEMO_EMAIL, DEMO_PASSWORD);
    await page.goto(`${DEMO_URL}/ankauf/sammlung`);
    await expect(page.getByTestId('sammlung-screen')).toBeVisible();

    await page.getByTestId('sammlung-seller-input').fill(SELLER_NAME);

    // Item 1 — switch the fresh row to manual entry, fill artist/title/EK/VK.
    await page.getByTestId('sammlung-add-item').click();
    await page.getByRole('button', { name: 'Manuell erfassen' }).click();
    await page.getByLabel('Titel').fill(ITEM1.title);
    await page.getByLabel('Künstler').fill(ITEM1.artist);
    await page.getByLabel('Einkaufspreis (EK)').fill('10.00');
    await page.getByLabel('Verkaufspreis (VK)').fill('20.00');

    // Item 2 — the first row's toggle now reads "Discogs-Suche verwenden", so the
    // remaining "Manuell erfassen" button is unambiguous; fields scoped via .last().
    await page.getByTestId('sammlung-add-item').click();
    await page.getByRole('button', { name: 'Manuell erfassen' }).click();
    await page.getByLabel('Titel').last().fill(ITEM2.title);
    await page.getByLabel('Künstler').last().fill(ITEM2.artist);
    await page.getByLabel('Einkaufspreis (EK)').last().fill('8.00');
    await page.getByLabel('Verkaufspreis (VK)').last().fill('16.00');

    await page.getByTestId('sammlung-submit').click();

    // Lands on the collections list with a row for the new Sammlung.
    await expect(page).toHaveURL(new RegExp('/ankauf/sammlungen'), { timeout: 15_000 });
    await expect(page.getByTestId('sammlungen-list')).toBeVisible();
    await expect(
      page.getByTestId('sammlung-row').filter({ hasText: SELLER_NAME }),
    ).toBeVisible();

    // DB truth + Analytik KPI: one more collection, and the Ankäufe-KPI sub reflects it.
    const collectionsAfter = await collectionsCount(tenantId);
    expect(collectionsAfter).toBe(collectionsBefore + 1);
    await page.goto(`${DEMO_URL}/analytik`);
    await expect(page.getByTestId('analytik-kpis')).toContainText(
      `${collectionsAfter} Sammlungen`,
    );
  });

  test('4. Wishlist-Match feuert: pending Match nach Batch-Ankauf auf /wunschlisten', async ({ page }) => {
    test.setTimeout(60_000);
    const tenantId = await demoTenantId();

    // The worker consumes tenant.wishlist.match asynchronously — poll tenant-scoped DB state.
    await expect
      .poll(
        async () => {
          const rows = await dbQuery<{ n: string }>(
            `SELECT COUNT(*) AS n
               FROM wishlist_matches wm
               JOIN wishlists w ON w.id = wm.wishlist_id
              WHERE wm.tenant_id = $1 AND w.artist = $2 AND wm.status = 'pending'`,
            [tenantId, WISH_ARTIST],
          );
          return Number(rows[0]!.n);
        },
        { timeout: 30_000, message: 'pending wishlist_match for the batch item never appeared' },
      )
      .toBe(1);

    await login(page, DEMO_URL, DEMO_EMAIL, DEMO_PASSWORD);
    await page.goto(`${DEMO_URL}/wunschlisten`);
    // MatchesSection renders "artist – title" per pending match.
    await expect(page.getByTestId('wishlist-matches')).toContainText(WISH_ARTIST);
    await expect(page.getByTestId('wishlist-matches')).toContainText(ITEM1.title);
  });

  test('5. Etiketten-PDF-Download + kein Kunden-/PII-Leak auf dem Storefront', async ({ page }) => {
    test.setTimeout(60_000);
    await login(page, DEMO_URL, DEMO_EMAIL, DEMO_PASSWORD);
    await page.goto(`${DEMO_URL}/inventar`);

    // Select one row for printing via its accessible name (no registry testid). Finding F2:
    // the row checkbox now carries its name via aria-label instead of visible label text, so a
    // `label` element with that text no longer exists to click — target the (visually-hidden,
    // clip-rect) input directly via its accessible name and `force` past the visibility check.
    await page.getByLabel(/für Etikettendruck auswählen/).first().check({ force: true });
    await expect(page.getByLabel(/für Etikettendruck auswählen/).first()).toBeChecked();
    const openBtn = page.getByTestId('label-print-open');
    await expect(openBtn).toBeEnabled();
    await openBtn.click();
    await expect(page.getByTestId('label-print-modal')).toBeVisible();
    await expect(page.getByTestId('label-template-select')).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('label-print-submit').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('etiketten.pdf');

    // Positive control on the public storefront: a product card IS rendered …
    await page.goto(`${DEMO_URL}/s/${DEMO_JAZZ_SLUG}`);
    await expect(page.locator('article').first()).toBeVisible();
    // … and neither Slice-4 customer data (Batch-Ankauf seller, wishlist customer)
    // nor private inventory fields appear anywhere in the rendered output.
    const html = await page.content();
    expect(html).not.toContain(SELLER_NAME);
    expect(html).not.toContain(WISH_CUSTOMER);
    expect(html).not.toContain(WISH_EMAIL);
    expect(html).not.toContain('klaus.wunsch@example.test');
    await assertNoPrivateFields(page);
  });
});
