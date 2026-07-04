/**
 * E2E acceptance — Slice 5: Mobile Shell + Scanner + PWA (C14).
 *
 * Mobile-Viewport via test.use auf describe-Ebene; Desktop-Positiv-Kontrolle
 * im zweiten describe. Alle Bestands-Asserts gegen die LIVE-DB (Count-Deltas),
 * keine Seed-Konstanten (Slice-4-Lektion).
 */
import { test, expect } from '@playwright/test';
import {
  DEMO_URL,
  DEMO_EMAIL,
  DEMO_PASSWORD,
  login,
  dbQuery,
  demoTenantId,
} from './helpers';

test.describe.configure({ mode: 'serial' });

// MUSS mit src/lib/discogs/fake.ts FAKE_BARCODE_HIT übereinstimmen (C4).
const FAKE_BARCODE_HIT = '4988031234567';

const purchasesCount = async (tenantId: number) =>
  Number(
    (await dbQuery<{ n: string }>(
      `SELECT COUNT(*) AS n FROM purchases WHERE tenant_id = $1`,
      [tenantId],
    ))[0]!.n,
  );
const transactionsCount = async (tenantId: number) =>
  Number(
    (await dbQuery<{ n: string }>(
      `SELECT COUNT(*) AS n FROM transactions WHERE tenant_id = $1`,
      [tenantId],
    ))[0]!.n,
  );
const verkauftCount = async (tenantId: number) =>
  Number(
    (await dbQuery<{ n: string }>(
      `SELECT COUNT(*) AS n FROM purchases WHERE tenant_id = $1 AND status = 'verkauft'`,
      [tenantId],
    ))[0]!.n,
  );

test.describe('Slice 5 — Mobile Shell + Scanner + PWA (390×844)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('1. Mobile Shell: Tab-Bar sichtbar, Sidebar versteckt, Navigation via Tabs', async ({ page }) => {
    await login(page, DEMO_URL, DEMO_EMAIL, DEMO_PASSWORD);
    const tabbar = page.getByTestId('bottom-tabbar');
    await expect(tabbar).toBeVisible();
    await expect(tabbar.getByRole('link')).toHaveCount(5);
    await expect(page.getByRole('navigation', { name: 'Hauptnavigation' })).toBeHidden();
    await expect(page.getByTestId('mobile-header')).toBeVisible();
    await expect(tabbar.getByRole('link', { name: 'Start' })).toHaveAttribute('aria-current', 'page');
    await tabbar.getByRole('link', { name: 'Bestand' }).click();
    await expect(page).toHaveURL(`${DEMO_URL}/inventar`);
    await expect(tabbar.getByRole('link', { name: 'Bestand' })).toHaveAttribute('aria-current', 'page');
  });

  test('3. Scanner-Fallback: manueller EAN → Discogs-Treffer → Ankauf', async ({ page }) => {
    const tenantId = await demoTenantId();
    const before = await purchasesCount(tenantId);

    await login(page, DEMO_URL, DEMO_EMAIL, DEMO_PASSWORD);
    await page.goto(`${DEMO_URL}/ankauf`);
    await page.getByRole('button', { name: 'Barcode scannen' }).click();
    await expect(page.getByTestId('scanner-sheet')).toBeVisible();
    // Headless hat keine Kamera → einer der beiden C8-Fehlertexte MUSS erscheinen.
    await expect(page.getByRole('alert').filter({ hasText: /Kamera/ })).toBeVisible();
    await page.getByTestId('scanner-manual-input').fill(FAKE_BARCODE_HIT);
    await page.getByTestId('scanner-manual-submit').click();
    await expect(page.getByTestId('discogs-result-card')).toHaveCount(2);

    // Ankauf des ersten Treffers (Kind of Blue) — AnkaufModal-Interaktion, Selektoren
    // wörtlich aus e2e/discogs.spec.ts (ankaufFromSearch): EK ausfüllen, VK-Vorschlag
    // stehen lassen (nicht anfassen — median kommt mit dem Suchtreffer, der Vorschlag
    // ist schon beim Öffnen des Modals gesetzt), Zustand default, Submit.
    await page.getByTestId('discogs-result-card').first().getByTestId('ankauf-open').click();

    const modal = page.getByTestId('ankauf-modal');
    await expect(modal).toBeVisible();

    await modal.getByTestId('ek-input').fill('3');
    // VK-Vorschlag steht bereits (median-Fallback, synchron aus dem Suchtreffer) — nicht anfassen.
    await expect(modal.getByTestId('vk-input')).not.toHaveValue('');

    await modal.getByTestId('ankauf-submit').click();
    await expect(modal).toBeHidden();

    await expect
      .poll(() => purchasesCount(tenantId), { timeout: 15_000 })
      .toBe(before + 1);
  });

  test('4. Mobiler Verkauf: Bestand-Karte → SellModal (Bottom-Sheet) → bar', async ({ page }) => {
    const tenantId = await demoTenantId();
    const txBefore = await transactionsCount(tenantId);
    const soldBefore = await verkauftCount(tenantId);

    await login(page, DEMO_URL, DEMO_EMAIL, DEMO_PASSWORD);
    // Das in Szenario 3 angekaufte Exemplar ist verfügbar + hat einen VK-Preis.
    await page.goto(`${DEMO_URL}/inventar?q=Kind%20of%20Blue&status=verfuegbar`);
    const card = page.getByTestId('inventory-mobile-card').first();
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Verkaufen' }).click();
    await expect(page.getByTestId('sell-modal')).toBeVisible();
    await page.getByTestId('sell-pay-bar').click();
    await page.getByTestId('sell-submit').click();
    await expect(page.getByTestId('sell-modal')).toBeHidden();

    await expect
      .poll(() => transactionsCount(tenantId), { timeout: 15_000 })
      .toBe(txBefore + 1);
    await expect
      .poll(() => verkauftCount(tenantId), { timeout: 15_000 })
      .toBe(soldBefore + 1);
  });

  test('5. PWA: Manifest tenant-gebrandet, /offline rendert, sw.js ausgeliefert', async ({ page, request }) => {
    // Live-DB-Wahrheit: Namen + Farben beider Tenants aus der Registry.
    const tenants = await dbQuery<{
      slug: string;
      name: string;
      config: { branding?: { primaryColor?: string } } | null;
    }>(`SELECT slug, name, config FROM tenants WHERE slug IN ('demo','vinylcave') ORDER BY slug`);
    expect(tenants).toHaveLength(2);

    // The `request` fixture runs over Node's networking stack, which — unlike
    // Chromium (page.goto below) — does not special-case *.localhost as loopback.
    // Hit 127.0.0.1 directly and resolve the tenant the same way the app does in
    // production: via the Host header (src/middleware.ts → parseTenantSlug).
    for (const t of tenants) {
      const res = await request.get('http://127.0.0.1:3000/manifest.webmanifest', {
        headers: { host: `${t.slug}.localhost` },
      });
      expect(res.ok()).toBeTruthy();
      const m = (await res.json()) as {
        name: string; theme_color: string; display: string; icons: unknown[];
      };
      expect(m.name).toBe(`${t.name} — Q-Records`);
      expect(m.display).toBe('standalone');
      expect(m.icons).toHaveLength(3);
      const seeded = t.config?.branding?.primaryColor;
      if (seeded) {
        expect(m.theme_color).toBe(seeded); // Tenant-Isolation: jede Origin ihre Farbe
      } else {
        expect(m.theme_color).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }

    const sw = await request.get('http://127.0.0.1:3000/sw.js', {
      headers: { host: 'demo.localhost' },
    });
    expect(sw.status()).toBe(200);
    expect(sw.headers()['content-type'] ?? '').toContain('javascript');

    await page.goto(`${DEMO_URL}/offline`);
    await expect(page.getByRole('heading', { name: 'Du bist offline' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Erneut versuchen' })).toBeVisible();
  });
});

test.describe('Slice 5 — Desktop-Positiv-Kontrolle (1280×800)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('2. Desktop-Guard: Sidebar sichtbar, Tab-Bar/Mobile-Header versteckt', async ({ page }) => {
    await login(page, DEMO_URL, DEMO_EMAIL, DEMO_PASSWORD);
    await expect(page.getByRole('navigation', { name: 'Hauptnavigation' })).toBeVisible();
    await expect(page.getByTestId('bottom-tabbar')).toBeHidden();
    await expect(page.getByTestId('mobile-header')).toBeHidden();
  });
});
