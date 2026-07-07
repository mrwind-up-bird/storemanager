/**
 * E2E acceptance — KI-Suche (semantische Vektor-Suche im Inventar, Slice 7).
 *
 * Prerequisites: docker compose up -d --build (db → migrate → seed → web).
 * Seed-Fakten (scripts/seed.ts / drizzle/0015_slice7_data.sql):
 *   • demo  → plan 'big'  → features.kiSuche = true  (Umschalter aktiv)
 *   • freeshop → plan 'free' → features.kiSuche = false (Lock/Upsell)
 *
 * NOTE ON SELECTORS — verified against the real Slice-7 components, which differ
 * from the task-brief's illustrative snippets (same pattern as e2e/inventory.spec.ts):
 *   • The Klassisch⇄KI-Umschalter is a SegmentedControl → role="radiogroup" with
 *     radios-in-labels (visually hidden inputs), NOT plain radios you can click
 *     directly. We toggle by clicking the radiogroup's option label text.
 *   • StatusTabs ARE <button> elements (aria-pressed), NOT role="tab" — the facet
 *     used here is the "im Lager" tab (maps to ?status=verfuegbar), not "verfügbar".
 */
import { test, expect } from '@playwright/test';
import {
  DEMO_URL,
  DEMO_EMAIL,
  DEMO_PASSWORD,
  FREESHOP_URL,
  FREESHOP_EMAIL,
  FREESHOP_PASSWORD,
  login,
} from './helpers';

test.describe('KI-Suche (/inventar)', () => {
  test('demo (big): KI-Modus liefert gerangte Treffer mit Relevanz-Badge; Facette schränkt ein', async ({
    page,
  }) => {
    await login(page, DEMO_URL, DEMO_EMAIL, DEMO_PASSWORD);
    await page.goto(`${DEMO_URL}/inventar`);
    await page.waitForLoadState('domcontentloaded');

    // Umschalter auf KI-Suche (SegmentedControl-Label, nicht der versteckte Radio-Input).
    await page.getByRole('radiogroup', { name: /suchmodus/i }).getByText(/KI-Suche/i).click();
    await page.waitForURL(/[?&]mode=ki/);

    // Submit-on-Enter: ein Embedding-Call pro Suche statt pro Tastendruck.
    const searchField = page.getByPlaceholder(/Beschreibe, wonach du suchst/i);
    await searchField.fill('jazz vinyl');
    await searchField.press('Enter');
    await page.waitForURL(/[?&]q=jazz/i);

    await expect.poll(() => page.locator('tbody tr').count()).toBeGreaterThan(0);
    // Das Relevanz-Badge rendert in BEIDEN Layouts (Desktop-Tabelle + .qr-mobile-only-Karte);
    // die mobile Karte steht im DOM zuerst, ist aber am Desktop-Viewport display:none. Auf die
    // sichtbare Desktop-Tabelle (tbody) scopen, sonst trifft .first() das versteckte Mobile-Badge.
    await expect(page.locator('tbody').getByTestId('ki-score').first()).toBeVisible();

    // Facette Status "im Lager" (status=verfuegbar) schränkt die sichtbaren Zeilen weiter ein.
    const before = await page.locator('tbody tr').count();
    await page.getByRole('button', { name: /im lager/i }).click();
    await page.waitForURL(/[?&]status=verfuegbar/);
    await expect
      .poll(() => page.locator('tbody tr').count(), { timeout: 5_000 })
      .toBeLessThanOrEqual(before);
  });

  test('freeshop (free): KI-Umschalter gesperrt (Upsell), klassische Suche funktioniert weiter', async ({
    page,
  }) => {
    await login(page, FREESHOP_URL, FREESHOP_EMAIL, FREESHOP_PASSWORD);
    await page.goto(`${FREESHOP_URL}/inventar`);
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('kisuche-lock')).toBeVisible();
    await expect(page.getByTestId('kisuche-lock')).toContainText('nicht im Free-Plan enthalten');

    // Klassische Suche bleibt unangetastet — placeholder + debounced ?q=-Push.
    await page.getByPlaceholder(/Im Sortiment suchen/i).fill('a');
    await page.waitForURL(/[?&]q=a/i);
  });
});
