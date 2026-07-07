/**
 * E2E acceptance — Discogs Ankauf flow (Slice 2, C12).
 *
 * The consequential whole-flow gate: connect-prompt → search → Ankauf → inventory,
 * the no-token-leak gate, the listing-status transition, and the double-copy dedup gate.
 *
 * Prerequisites: docker compose up -d --build (db → migrate → seed → web + worker).
 *   • DISCOGS_DRIVER=fake on web AND worker (docker-compose.yml) — never a real network call.
 *   • The demo tenant is seeded WITH a fake Discogs connection; vinylcave WITHOUT one
 *     (scripts/seed.ts ensureDiscogsConnection).
 *   • The compose Postgres is exposed on host :55432 so this spec can assert server-side
 *     state that has no UI surface (listing status + record dedup) — see e2e/helpers.ts.
 *
 * Fixture driver (src/lib/discogs/fake.ts): searching "blue" returns "Kind of Blue"
 * (Miles Davis) and "Blue Lines" (Massive Attack). We Ankauf "Blue Lines" because it
 * does NOT collide (by record-hash) with any seeded record, keeping the inventory +
 * dedup assertions clean. Its discogsId is non-null, so the worker lists it → 'listed'.
 *
 * NOTE — WORKER IS IN THE E2E STACK: docker-compose.yml runs a `worker` service with
 * DISCOGS_DRIVER=fake, so scenario 4 asserts the full pending→listed transition. (The
 * unit-level guarantee is additionally covered by tests/discogs-listing-worker.integration.test.ts.)
 */
import { test, expect, type Page } from '@playwright/test';
import {
  DEMO_URL,
  VINYLCAVE_URL,
  DEMO_EMAIL,
  DEMO_PASSWORD,
  VC_EMAIL,
  VC_PASSWORD,
  DEMO_DISCOGS_FAKE_TOKEN,
  DEMO_DISCOGS_FAKE_SECRET,
  login,
  dbQuery,
  demoTenantId,
} from './helpers';

const BLUE_LINES = 'Blue Lines';

/**
 * Remove every "Blue Lines" copy + record this suite creates for the demo tenant.
 * Run before AND after the suite so:
 *   • each run starts from the seeded baseline (single-row UI assertions stay exact,
 *     no accumulation across re-runs), and
 *   • the suite leaves NO trace — other specs (e.g. dashboard.spec's exact "im Lager"
 *     KPI) see the untouched seeded data regardless of run order.
 * qr_owner (BYPASSRLS) is used, so the explicit tenant_id WHERE is the scope guard.
 */
async function purgeBlueLines(tenantId: number): Promise<void> {
  await dbQuery(
    `DELETE FROM purchases
      WHERE tenant_id = $1
        AND record_id IN (SELECT id FROM records WHERE tenant_id = $1 AND title = $2)`,
    [tenantId, BLUE_LINES],
  );
  // record_embeddings (Slice 7) ist ein weiteres Kind von records mit ON DELETE no action —
  // wie purchases explizit vor dem records-Delete räumen, sonst schlägt die FK fehl, sobald
  // der Worker beim Ankauf ein Embedding angelegt hat.
  await dbQuery(
    `DELETE FROM record_embeddings
      WHERE tenant_id = $1
        AND record_id IN (SELECT id FROM records WHERE tenant_id = $1 AND title = $2)`,
    [tenantId, BLUE_LINES],
  );
  await dbQuery(`DELETE FROM records WHERE tenant_id = $1 AND title = $2`, [tenantId, BLUE_LINES]);
}

/**
 * Drive the connected Ankauf flow from the /ankauf search form:
 * search → pick the result card → fill EK/VK → (optional listing toggle) → submit.
 * Resolves once the modal has closed (the modal closes only on a successful Ankauf).
 */
async function ankaufFromSearch(
  page: Page,
  opts: { searchTerm: string; cardText: string; ek: string; vk: string; listOnDiscogs?: boolean },
): Promise<void> {
  await page.goto(`${DEMO_URL}/ankauf`);
  await page.waitForLoadState('domcontentloaded');

  // Connected tenant → search form (not the connect prompt).
  await expect(page.getByTestId('discogs-search-form')).toBeVisible();

  await page.getByPlaceholder(/Auf Discogs suchen/i).fill(opts.searchTerm);
  await page.getByRole('button', { name: 'Suchen' }).click();

  await expect(page.getByTestId('discogs-results')).toBeVisible();
  const card = page.getByTestId('discogs-result-card').filter({ hasText: opts.cardText });
  await expect(card).toBeVisible();
  await card.getByTestId('ankauf-open').click();

  const modal = page.getByTestId('ankauf-modal');
  await expect(modal).toBeVisible();

  // Fill VK explicitly (sets vkDirty) so the async Discogs price-suggestion effect
  // can't race-overwrite our value before submit.
  await modal.getByTestId('ek-input').fill(opts.ek);
  await modal.getByTestId('vk-input').fill(opts.vk);

  if (opts.listOnDiscogs) {
    await modal.getByTestId('list-on-discogs-toggle').click();
    await expect(modal.getByTestId('list-on-discogs-toggle')).toHaveAttribute('aria-checked', 'true');
  }

  await modal.getByTestId('ankauf-submit').click();
  await expect(modal).toBeHidden();
}

test.describe('Discogs Ankauf (C12)', () => {
  test.beforeAll(async () => {
    await purgeBlueLines(await demoTenantId());
  });
  test.afterAll(async () => {
    await purgeBlueLines(await demoTenantId());
  });

  // ── 1. connect prompt for an unconnected tenant ───────────────────────────
  test('vinylcave (no connection) → /ankauf shows the connect-discogs prompt', async ({ page }) => {
    await login(page, VINYLCAVE_URL, VC_EMAIL, VC_PASSWORD);
    await page.goto(`${VINYLCAVE_URL}/ankauf`);
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('connect-discogs-prompt')).toBeVisible();
    // The search form must NOT render when there is no connection (fail-closed).
    await expect(page.getByTestId('discogs-search-form')).toHaveCount(0);
  });

  // ── 2. connected tenant can search ────────────────────────────────────────
  test('demo (connected) → search "blue" returns ≥1 result card', async ({ page }) => {
    await login(page, DEMO_URL, DEMO_EMAIL, DEMO_PASSWORD);
    await page.goto(`${DEMO_URL}/ankauf`);
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('discogs-search-form')).toBeVisible();
    await expect(page.getByTestId('connect-discogs-prompt')).toHaveCount(0);

    await page.getByPlaceholder(/Auf Discogs suchen/i).fill('blue');
    await page.getByRole('button', { name: 'Suchen' }).click();

    await expect(page.getByTestId('discogs-results')).toBeVisible();
    expect(await page.getByTestId('discogs-result-card').count()).toBeGreaterThanOrEqual(1);
    // The fixture "Blue Lines" release is among the results.
    await expect(
      page.getByTestId('discogs-result-card').filter({ hasText: BLUE_LINES }),
    ).toBeVisible();
  });

  // ── 3. Ankauf (no listing) lands the copy in inventory ────────────────────
  test('Ankauf without listing → new copy appears in /inventar (EK/VK, status im Lager)', async ({
    page,
  }) => {
    await login(page, DEMO_URL, DEMO_EMAIL, DEMO_PASSWORD);

    const tenantId = await demoTenantId();
    const [{ n: before }] = await dbQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM purchases p
         JOIN records r ON r.id = p.record_id
        WHERE r.tenant_id = $1 AND r.title = $2`,
      [tenantId, BLUE_LINES],
    );

    await ankaufFromSearch(page, {
      searchTerm: 'blue',
      cardText: BLUE_LINES,
      ek: '3.33',
      vk: '9.93',
    });

    // Exactly one new copy was created.
    const [{ n: after }] = await dbQuery<{ n: number }>(
      `SELECT count(*)::int AS n FROM purchases p
         JOIN records r ON r.id = p.record_id
        WHERE r.tenant_id = $1 AND r.title = $2`,
      [tenantId, BLUE_LINES],
    );
    expect(after).toBe(before + 1);

    // And it is visible in inventory with the entered EK/VK and the "im Lager" badge.
    await page.goto(`${DEMO_URL}/inventar?q=${encodeURIComponent(BLUE_LINES)}`);
    await page.waitForLoadState('domcontentloaded');

    const row = page
      .locator('tbody tr')
      .filter({ hasText: BLUE_LINES })
      .filter({ hasText: '3.33' });
    await expect(row).toBeVisible();
    await expect(row).toContainText('9.93');
    await expect(row).toContainText(/im Lager/i);
  });

  // ── 4. Ankauf WITH listing → pending, then listed once the worker runs ────
  test('Ankauf with listing toggle → copy listing status becomes pending then listed', async ({
    page,
  }) => {
    test.setTimeout(60_000); // allow generous time for the pg-boss worker to pick up the job

    await login(page, DEMO_URL, DEMO_EMAIL, DEMO_PASSWORD);
    const tenantId = await demoTenantId();

    await ankaufFromSearch(page, {
      searchTerm: 'blue',
      cardText: BLUE_LINES,
      ek: '4.44',
      vk: '12.44',
      listOnDiscogs: true,
    });

    // Identify the just-created copy by its distinctive EK marker.
    const [created] = await dbQuery<{ id: number; status: string }>(
      `SELECT p.id, p.discogs_listing_status AS status FROM purchases p
         JOIN records r ON r.id = p.record_id
        WHERE r.tenant_id = $1 AND r.title = $2 AND p.purchase_price = '4.44'
        ORDER BY p.id DESC LIMIT 1`,
      [tenantId, BLUE_LINES],
    );
    expect(created, 'the listing-toggled Ankauf copy must exist').toBeTruthy();
    // performAnkauf sets 'pending' synchronously; the worker may already have raced to 'listed'.
    expect(['pending', 'listed']).toContain(created.status);

    // Poll until the worker transitions the copy to 'listed'.
    await expect
      .poll(
        async () => {
          const [row] = await dbQuery<{ status: string }>(
            `SELECT discogs_listing_status AS status FROM purchases WHERE id = $1`,
            [created.id],
          );
          return row?.status;
        },
        { timeout: 45_000, intervals: [1_000, 2_000, 3_000] },
      )
      .toBe('listed');

    // The listing id was written back too.
    const [final] = await dbQuery<{ listing_id: string | null }>(
      `SELECT discogs_listing_id AS listing_id FROM purchases WHERE id = $1`,
      [created.id],
    );
    expect(final.listing_id).toBeTruthy();
  });

  // ── 5. no token leak ──────────────────────────────────────────────────────
  test('no-token-leak: seeded fake token appears in neither /ankauf HTML nor any search/suggestion payload', async ({
    page,
  }) => {
    await login(page, DEMO_URL, DEMO_EMAIL, DEMO_PASSWORD);

    // Capture every network response body returned while exercising the connected flow.
    const bodies: string[] = [];
    page.on('response', (resp) => {
      void resp
        .text()
        .then((t) => bodies.push(t))
        .catch(() => {
          /* non-text / opaque bodies are irrelevant to the token scan */
        });
    });

    await page.goto(`${DEMO_URL}/ankauf`);
    await page.waitForLoadState('domcontentloaded');

    // Search (searchDiscogs server action) + open the modal (getPriceSuggestion server action).
    await page.getByPlaceholder(/Auf Discogs suchen/i).fill('blue');
    await page.getByRole('button', { name: 'Suchen' }).click();
    await expect(page.getByTestId('discogs-results')).toBeVisible();

    const card = page.getByTestId('discogs-result-card').filter({ hasText: BLUE_LINES });
    await card.getByTestId('ankauf-open').click();
    await expect(page.getByTestId('ankauf-modal')).toBeVisible();
    // Let the price-suggestion server-action response arrive and be captured.
    await page.waitForTimeout(2_000);

    // The rendered /ankauf DOM must not contain the token/secret plaintext.
    const html = await page.content();
    expect(html).not.toContain(DEMO_DISCOGS_FAKE_TOKEN);
    expect(html).not.toContain(DEMO_DISCOGS_FAKE_SECRET);

    // No captured network payload (search results / price suggestion / RSC / doc) may contain them.
    expect(bodies.length, 'expected to have captured at least one response body').toBeGreaterThan(0);
    for (const body of bodies) {
      expect(body).not.toContain(DEMO_DISCOGS_FAKE_TOKEN);
      expect(body).not.toContain(DEMO_DISCOGS_FAKE_SECRET);
    }
  });

  // ── 6. double Ankauf of the same release → two purchases, one record ──────
  test('double Ankauf of the same release → two purchases, one record (dedup)', async ({ page }) => {
    await login(page, DEMO_URL, DEMO_EMAIL, DEMO_PASSWORD);
    const tenantId = await demoTenantId();

    const purchaseCount = async (): Promise<number> => {
      const [{ n }] = await dbQuery<{ n: number }>(
        `SELECT count(*)::int AS n FROM purchases p
           JOIN records r ON r.id = p.record_id
          WHERE r.tenant_id = $1 AND r.title = $2`,
        [tenantId, BLUE_LINES],
      );
      return n;
    };
    const recordCount = async (): Promise<number> => {
      const [{ n }] = await dbQuery<{ n: number }>(
        `SELECT count(*)::int AS n FROM records WHERE tenant_id = $1 AND title = $2`,
        [tenantId, BLUE_LINES],
      );
      return n;
    };

    const purchasesBefore = await purchaseCount();

    await ankaufFromSearch(page, { searchTerm: 'blue', cardText: BLUE_LINES, ek: '5.55', vk: '15.55' });
    await ankaufFromSearch(page, { searchTerm: 'blue', cardText: BLUE_LINES, ek: '6.66', vk: '16.66' });

    // Two NEW physical copies (purchases) were created…
    expect(await purchaseCount()).toBe(purchasesBefore + 2);
    // …but the release deduped onto exactly ONE record (onConflictDoUpdate on hash+tenant).
    expect(await recordCount()).toBe(1);
  });
});
