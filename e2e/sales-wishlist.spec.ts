/**
 * E2E acceptance — Slice 3 Verkauf/POS + Wunschlisten (C12).
 *
 * Whole-flow gates: (1) single-item sell from the inventory row → verkauft + transaction;
 * (2) POS cart with inventory + quick item + ad-hoc + transaction discount → server-recomputed
 * total + transaction persisted; (3) reserve → storno round-trip; (4) wishlist → matching Ankauf
 * → async pending match → staff notify → Mailpit mail + match 'notified'; (5) no customer-data leak
 * on the public storefront.
 *
 * Prerequisites: docker compose up -d --build (db → migrate → seed → web + worker + mailpit).
 *   • web AND worker run DISCOGS_DRIVER=fake; MAIL_DRIVER=mailpit comes from .env.compose, so the
 *     worker's notify job actually delivers to Mailpit (:8025 API).
 *   • The demo tenant is seeded WITH a fake Discogs connection (Slice 2) AND, from T13, with
 *     DEMO_QUICK_ITEMS (Kaffee/Plattentasche) + an OPEN 'Miles Davis' wishlist
 *     (klaus.wunsch@example.test).
 *   • Compose Postgres is exposed on host :55432 so dbQuery can assert state with no UI surface.
 *
 * Fake driver: query "blue" → "Kind of Blue" (Miles Davis) + "Blue Lines". We Ankauf "Kind of Blue"
 * so the new purchase's artist (Miles Davis) matches the seeded wishlist.
 */
import { test, expect, type Page } from '@playwright/test';
import {
  DEMO_URL,
  DEMO_EMAIL,
  DEMO_PASSWORD,
  DEMO_JAZZ_SLUG,
  login,
  dbQuery,
  demoTenantId,
  assertNoPrivateFields,
  salesCounts,
  mailpitMessages,
} from './helpers';

// Run serially: scenarios mutate shared tenant state (sold copies, matches) and assert deltas.
test.describe.configure({ mode: 'serial' });

/** Open the first enabled "Verkaufen" row action on the inventory page (no registry testid for the
 *  trigger — it is selected by accessible name, per C12).
 *  Note: :enabled filters out 'verliehen' rows which render a disabled "Verkaufen" button.
 *  Note: :visible is required since Slice 5 — InventoryList renders BOTH the mobile card list
 *  (.qr-mobile-only, hidden at this desktop viewport) and the desktop table with the identical
 *  "Verkaufen" button text; without :visible, .first() picks the hidden mobile-card button (DOM
 *  order: mobile block precedes the desktop table) and the click never becomes actionable. */
async function firstSellButton(page: Page) {
  return page.locator('button:enabled:visible').filter({ hasText: /^Verkaufen$/i }).first();
}

test.describe('Slice 3 — Verkauf/POS + Wunschlisten', () => {
  test('1. sell a single copy from the inventory row → verkauft + one transaction', async ({ page }) => {
    const tenantId = await demoTenantId();
    const before = await salesCounts(tenantId);

    await login(page, DEMO_URL, DEMO_EMAIL, DEMO_PASSWORD);
    await page.goto(`${DEMO_URL}/inventar`);

    await (await firstSellButton(page)).click();
    const modal = page.getByTestId('sell-modal');
    await expect(modal).toBeVisible();
    // Inventory sell price is a read-only resolved display (C5/C12) — we do not edit it.
    await expect(modal.getByTestId('sell-price-input')).toBeVisible();
    await modal.getByTestId('sell-pay-bar').click();
    await modal.getByTestId('sell-submit').click();
    await expect(modal).toBeHidden();

    const after = await salesCounts(tenantId);
    expect(after.transactions).toBe(before.transactions + 1);
    expect(after.verkauft).toBe(before.verkauft + 1);

    // The created transaction is a single-line bar sale with subtotal == total (no discount).
    const tx = await dbQuery<{ payment_method: string; subtotal: string; discount: string; total: string }>(
      `SELECT payment_method, subtotal, discount, total
         FROM transactions WHERE tenant_id = $1 ORDER BY id DESC LIMIT 1`,
      [tenantId],
    );
    expect(tx[0]!.payment_method).toBe('bar');
    expect(Number(tx[0]!.discount)).toBe(0);
    expect(Number(tx[0]!.total)).toBeCloseTo(Number(tx[0]!.subtotal), 2);

    const items = await dbQuery<{ n: string }>(
      `SELECT COUNT(*) AS n FROM transaction_items ti
         JOIN transactions t ON t.id = ti.transaction_id
        WHERE t.tenant_id = $1 AND t.id = (SELECT MAX(id) FROM transactions WHERE tenant_id = $1)`,
      [tenantId],
    );
    expect(Number(items[0]!.n)).toBe(1);
  });

  test('2. POS cart: inventory + quick item + ad-hoc + discount → recomputed total + transaction', async ({ page }) => {
    const tenantId = await demoTenantId();
    const before = await salesCounts(tenantId);

    // The seeded "Kaffee" quick item id (templated testid kasse-quick-item-<id>).
    const qi = await dbQuery<{ id: number; price: string }>(
      `SELECT id, price FROM quick_items WHERE tenant_id = $1 AND name = 'Kaffee' AND active = true LIMIT 1`,
      [tenantId],
    );
    const kaffeeId = qi[0]!.id;
    const kaffeePrice = Number(qi[0]!.price); // 2.50

    await login(page, DEMO_URL, DEMO_EMAIL, DEMO_PASSWORD);
    await page.goto(`${DEMO_URL}/kasse`);
    await expect(page.getByTestId('kasse-screen')).toBeVisible();

    // (a) Add one inventory copy by searching a seeded title and clicking the result.
    //     The result is rendered as a clickable element containing the record title (T10); no
    //     registry testid for an individual result row → select by visible title text.
    const inv = await dbQuery<{ title: string; target_price: string }>(
      `SELECT r.title, p.target_price
         FROM purchases p JOIN records r ON r.id = p.record_id
        WHERE p.tenant_id = $1 AND p.status = 'verfuegbar' AND p.target_price IS NOT NULL
        ORDER BY p.id ASC LIMIT 1`,
      [tenantId],
    );
    const invTitle = inv[0]!.title;
    const invPrice = Number(inv[0]!.target_price);
    await page.getByTestId('kasse-inventory-search').fill(invTitle);
    await page.getByText(invTitle, { exact: false }).first().click();

    // (b) Add the Kaffee quick item.
    await page.getByTestId(`kasse-quick-item-${kaffeeId}`).click();

    // (c) Add an ad-hoc line — fill name + price first, then click the submit button.
    //     The kasse-adhoc-add button is disabled until both fields have values, so fields
    //     must be filled before the click. AdhocAdd exposes aria-label on both inputs.
    await page.getByLabel(/bezeichnung/i).fill('Reinigung');
    await page.getByLabel(/^Preis$/i).fill('5.00');
    await page.getByTestId('kasse-adhoc-add').click();
    const adhocPrice = 5.0;

    // Three cart lines present.
    const cart = page.getByTestId('kasse-cart');
    await expect(cart.getByTestId(/^kasse-cart-item-/)).toHaveCount(3);

    // (d) Apply a €3.00 transaction discount (explicitly select amount mode first).
    await page.getByTestId('kasse-discount-mode').selectOption('amount');
    await page.getByTestId('kasse-discount-input').fill('3.00');
    const discount = 3.0;

    const expectedSubtotal = invPrice + kaffeePrice + adhocPrice;
    const expectedTotal = expectedSubtotal - discount;

    // The total control reflects the server-consistent arithmetic (rendered to 2 decimals).
    await expect(page.getByTestId('kasse-total')).toHaveText(
      new RegExp(expectedTotal.toFixed(2).replace('.', '[.,]')),
    );

    // (e) Pay by card and submit.
    await page.getByTestId('kasse-pay-karte').click();
    await page.getByTestId('kasse-submit').click();
    // kasse-screen stays visible throughout (no navigation) — poll until the DB reflects the new
    // transaction instead of relying on the no-op visibility check as a sync point.
    await expect
      .poll(async () => (await salesCounts(tenantId)).transactions, { timeout: 10_000 })
      .toBe(before.transactions + 1);
    await expect(page.getByTestId('kasse-screen')).toBeVisible();

    // Server persisted the transaction with the recomputed total (numeric(10,2)).
    const after = await salesCounts(tenantId);
    expect(after.transactions).toBe(before.transactions + 1);
    expect(after.verkauft).toBe(before.verkauft + 1); // the one inventory line went to verkauft

    const tx = await dbQuery<{ payment_method: string; subtotal: string; discount: string; total: string }>(
      `SELECT payment_method, subtotal, discount, total
         FROM transactions WHERE tenant_id = $1 ORDER BY id DESC LIMIT 1`,
      [tenantId],
    );
    expect(tx[0]!.payment_method).toBe('karte');
    expect(Number(tx[0]!.subtotal)).toBeCloseTo(expectedSubtotal, 2);
    expect(Number(tx[0]!.discount)).toBeCloseTo(discount, 2);
    expect(Number(tx[0]!.total)).toBeCloseTo(expectedTotal, 2);

    const items = await dbQuery<{ n: string }>(
      `SELECT COUNT(*) AS n FROM transaction_items ti
         JOIN transactions t ON t.id = ti.transaction_id
        WHERE t.tenant_id = $1 AND t.id = (SELECT MAX(id) FROM transactions WHERE tenant_id = $1)`,
      [tenantId],
    );
    expect(Number(items[0]!.n)).toBe(3);
  });

  test('3. reserve a copy then cancel the reservation (round-trip)', async ({ page }) => {
    const tenantId = await demoTenantId();
    const before = await salesCounts(tenantId);

    await login(page, DEMO_URL, DEMO_EMAIL, DEMO_PASSWORD);
    await page.goto(`${DEMO_URL}/inventar`);

    // Reserve the first available copy.
    await page.getByTestId('reserve-action').first().click();
    await expect
      .poll(async () => (await salesCounts(tenantId)).reserviert)
      .toBe(before.reserviert + 1);

    // Cancel the reservation → back to verfügbar.
    await page.reload();
    await page.getByTestId('reserve-cancel-action').first().click();
    await expect
      .poll(async () => (await salesCounts(tenantId)).reserviert)
      .toBe(before.reserviert);
  });

  test('4. wishlist match on Ankauf → staff notify → Mailpit mail + match notified', async ({ page, request }) => {
    const tenantId = await demoTenantId();
    const before = await salesCounts(tenantId);

    await login(page, DEMO_URL, DEMO_EMAIL, DEMO_PASSWORD);

    // (a) Ankauf "Kind of Blue" (Miles Davis) via the 1A Ankauf-Zeilen-Flow. Single item is booked
    //     as a 1-item collection → submit navigates to /ankauf/sammlungen; the wishlist-match job is
    //     enqueued by createCollectionAction just like the old single-item path.
    await page.goto(`${DEMO_URL}/ankauf`);
    const row = page.getByTestId('ankauf-item-row').first();
    await row.getByTestId('ankauf-search-input').fill('blue');
    await row.getByRole('button', { name: 'Suchen' }).click();
    const kob = row.getByTestId('ankauf-result').filter({ hasText: /kind of blue/i }).first();
    await expect(kob).toBeVisible();
    await kob.click();
    await row.getByTestId('ankauf-ek-input').fill('8.00');
    // VK auto-suggests from the Discogs median/price-suggestion — wait until it's populated.
    await expect(row.getByTestId('ankauf-vk-input')).not.toHaveValue('');
    await page.getByTestId('ankauf-seller-input').fill('E2E Verkäufer:in');
    await page.getByTestId('ankauf-submit').click();
    await page.waitForURL(/\/ankauf\/sammlungen/);

    // (b) The async match job creates exactly one new pending match for the Miles Davis wishlist.
    await expect
      .poll(async () => (await salesCounts(tenantId)).pendingMatches, { timeout: 30_000 })
      .toBe(before.pendingMatches + 1);

    const match = await dbQuery<{ id: number; customer_email: string }>(
      `SELECT m.id, w.customer_email
         FROM wishlist_matches m JOIN wishlists w ON w.id = m.wishlist_id
        WHERE m.tenant_id = $1 AND m.status = 'pending'
        ORDER BY m.id DESC LIMIT 1`,
      [tenantId],
    );
    const matchId = match[0]!.id;
    const customerEmail = match[0]!.customer_email; // klaus.wunsch@example.test

    // (c) Staff opens the wishlist screen, the pending match is listed, and sends the notification.
    await page.goto(`${DEMO_URL}/wunschlisten`);
    await expect(page.getByTestId('wishlist-screen')).toBeVisible();
    await expect(page.getByTestId('wishlist-matches')).toBeVisible();
    await page.getByTestId(`wl-notify-${matchId}`).click();
    const notify = page.getByTestId('notify-modal');
    await expect(notify).toBeVisible();
    await expect(notify.getByTestId('notify-preview')).toBeVisible(); // read-only preview (C9.4/C12)
    await notify.getByTestId('notify-send').click();
    await expect(notify).toBeHidden();

    // (d) The worker's notify job delivers a mail to the customer in Mailpit, and the match flips
    //     to 'notified'.
    await expect
      .poll(async () => {
        const msgs = await mailpitMessages(request);
        return msgs.some((m) => m.To.some((t) => t.Address === customerEmail));
      }, { timeout: 30_000 })
      .toBe(true);

    await expect
      .poll(async () => (await salesCounts(tenantId)).notifiedMatches)
      .toBe(before.notifiedMatches + 1);
    await expect
      .poll(async () => (await salesCounts(tenantId)).pendingMatches)
      .toBe(before.pendingMatches);
  });

  test('5. no customer wishlist data leaks onto the public storefront', async ({ page }) => {
    // Public storefront is /s/<permalink>, NOT /p/ (which is a 404 — assertions on 404 are trivial).
    await page.goto(`${DEMO_URL}/s/${DEMO_JAZZ_SLUG}`);
    await page.waitForLoadState('domcontentloaded');

    // Positive control: the real storefront rendered — at least one record card is visible.
    // Guards against a 404 body making all no-leak assertions pass trivially.
    const cards = page.getByRole('article');
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeGreaterThan(0);

    await assertNoPrivateFields(page); // Slice-1 price/condition guard still holds

    const html = await page.content();
    // Customer name + email captured on the wishlist must never appear publicly.
    expect(html).not.toMatch(/klaus\.wunsch@example\.test/i);
    expect(html).not.toMatch(/Klaus Wunsch/i);
    // Sales internals must not leak either.
    expect(html).not.toMatch(/payment_method|paymentMethod/i);
  });
});
