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
 *  trigger — it is selected by accessible name, per C12). */
async function firstSellButton(page: Page) {
  return page.getByRole('button', { name: /^verkaufen$/i }).first();
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

    // (c) Add an ad-hoc line (name + price selected by accessible label — no registry testid for the
    //     ad-hoc fields; T10 provides labeled inputs).
    await page.getByTestId('kasse-adhoc-add').click();
    await page.getByLabel(/bezeichnung|name/i).last().fill('Reinigung');
    await page.getByLabel(/preis/i).last().fill('5.00');
    const adhocPrice = 5.0;

    // Three cart lines present.
    const cart = page.getByTestId('kasse-cart');
    await expect(cart.getByTestId(/^kasse-cart-item-/)).toHaveCount(3);

    // (d) Apply a €3.00 transaction discount.
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
      `SELECT COUNT(*) AS n FROM transaction_items
        WHERE transaction_id = (SELECT MAX(id) FROM transactions WHERE tenant_id = $1)`,
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

    // (a) Ankauf "Kind of Blue" (Miles Davis) via the Slice-2 fake Discogs flow.
    await page.goto(`${DEMO_URL}/ankauf`);
    await page.getByTestId('discogs-search-form').getByRole('textbox').first().fill('blue');
    await page.getByTestId('discogs-search-form').getByRole('button', { name: /such/i }).click();
    const results = page.getByTestId('discogs-results');
    await expect(results).toBeVisible();
    const kob = results.getByTestId('discogs-result-card').filter({ hasText: /kind of blue/i }).first();
    await kob.getByTestId('ankauf-open').click();
    const ankauf = page.getByTestId('ankauf-modal');
    await expect(ankauf).toBeVisible();
    await ankauf.getByTestId('ek-input').fill('8.00');
    await ankauf.getByTestId('ankauf-submit').click();
    await expect(ankauf).toBeHidden();

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
    expect((await salesCounts(tenantId)).pendingMatches).toBe(before.pendingMatches);
  });

  test('5. no customer wishlist data leaks onto the public storefront', async ({ page }) => {
    await page.goto(`${DEMO_URL}/p/${DEMO_JAZZ_SLUG}`);
    await page.waitForLoadState('domcontentloaded');
    await assertNoPrivateFields(page); // Slice-1 price/condition guard still holds

    const html = await page.content();
    // Customer name + email captured on the wishlist must never appear publicly.
    expect(html).not.toMatch(/klaus\.wunsch@example\.test/i);
    expect(html).not.toMatch(/Klaus Wunsch/i);
    // Sales internals must not leak either.
    expect(html).not.toMatch(/payment_method|paymentMethod/i);
  });
});
