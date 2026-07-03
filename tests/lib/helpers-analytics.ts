/**
 * Fixture for `tests/lib/analytics.integration.test.ts`.
 *
 * Mirrors the ordering contract documented in `tests/helpers/db.ts`: this module imports NOTHING
 * from `@/db/*` (or anything that transitively touches it) at the top level — those singleton
 * pools bind to `process.env.DATABASE_URL`/`DATABASE_OWNER_URL` at module-eval time, so they must
 * only be pulled in via dynamic `import()` from inside `seedAnalyticsFixture()`, strictly AFTER
 * the calling spec's `beforeAll` has published env via `setupTestDatabase()`.
 */

export interface AnalyticsFixtureCtx {
  tenantId: number;
  userId: number;
}

let counter = 0;

/** Berlin-Europe UTC offset (minutes east of UTC) in effect at `instant` — computed via Intl, never hardcoded. */
function berlinOffsetMinutes(instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  const hour = Number(get('hour')) % 24; // Intl reports midnight as "24" with hour12: false
  const asUTC = Date.UTC(
    Number(get('year')), Number(get('month')) - 1, Number(get('day')),
    hour, Number(get('minute')), Number(get('second')),
  );
  return Math.round((asUTC - instant.getTime()) / 60_000);
}

/** UTC instant of `hour`:00 Berlin-local time on today's Berlin calendar date — lands the seeded
 *  transaction in a KNOWN Tageszeit bucket regardless of the machine's local timezone or DST. */
function berlinHourToday(hour: number): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date());
  const [y, m, d] = ymd.split('-').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hour, 0, 0));
  return new Date(guess.getTime() - berlinOffsetMinutes(guess) * 60_000);
}

/**
 * Seeds one tenant with a small, realistic slice of this week's activity:
 * - one collection (Sammlungen KPI + a linked purchase),
 * - one sold Vinyl copy from that collection (Kategorie('Vinyl'), Rohmarge, Top-N),
 * - one quick-item sale with no category (Kategorie('Sonstiges')),
 * - two transactions at different times this week (weekday spread; one at a known Berlin hour
 *   — 12:00, inside the 'Vormittag · 11–14 Uhr' bucket — so Tageszeit has real, non-zero data).
 */
export async function seedAnalyticsFixture(): Promise<AnalyticsFixtureCtx> {
  const { withTenant } = await import('@/db/tenant');
  const schema = await import('@/db/schema');
  const { seedTenant } = await import('../helpers/db');

  const n = ++counter;
  const { tenantId, adminUserId } = await seedTenant({ slug: `analytics-${n}`, name: 'Vinyl Palace' });
  const ctx = { tenantId, userId: adminUserId };

  await withTenant(ctx, async (tx) => {
    const [collection] = await tx
      .insert(schema.collections)
      .values({ tenantId, sellerName: 'Nachlass Schmidt', createdByUserId: adminUserId })
      .returning({ id: schema.collections.id });

    const [vinylRecord] = await tx
      .insert(schema.records)
      .values({
        tenantId,
        title: 'Abbey Road',
        artist: 'The Beatles',
        label: ['Apple'],
        format: 'Vinyl',
        genre: ['Rock'],
        hash: `analytics-vinyl-${n}`,
      })
      .returning({ id: schema.records.id });

    const [vinylPurchase] = await tx
      .insert(schema.purchases)
      .values({
        tenantId,
        recordId: vinylRecord!.id,
        collectionId: collection!.id,
        purchasePrice: '10.00',
        targetPrice: '25.00',
        soldPrice: '25.00',
        soldDate: new Date(),
        paymentMethod: 'bar',
        status: 'verkauft',
        conditionRecord: 5,
        conditionCover: 4,
      })
      .returning({ id: schema.purchases.id });

    const [quickItem] = await tx
      .insert(schema.quickItems)
      .values({ tenantId, name: 'Kaffee', price: '3.50', active: true })
      .returning({ id: schema.quickItems.id });

    // tx1: known Berlin hour (12:00 → 'Vormittag · 11–14 Uhr') — the Vinyl sale.
    const [tx1] = await tx
      .insert(schema.transactions)
      .values({
        tenantId,
        soldByUserId: adminUserId,
        paymentMethod: 'bar',
        subtotal: '25.00',
        discount: '0.00',
        total: '25.00',
        createdAt: berlinHourToday(12),
      })
      .returning({ id: schema.transactions.id });
    await tx.insert(schema.transactionItems).values({
      tenantId,
      transactionId: tx1!.id,
      purchaseId: vinylPurchase!.id,
      label: 'Abbey Road',
      unitPrice: '25.00',
      quantity: 1,
    });

    // tx2: a few hours ago — the quick-item (no category) sale, spreads the weekday buckets.
    const [tx2] = await tx
      .insert(schema.transactions)
      .values({
        tenantId,
        soldByUserId: adminUserId,
        paymentMethod: 'karte',
        subtotal: '7.00',
        discount: '0.00',
        total: '7.00',
        createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      })
      .returning({ id: schema.transactions.id });
    await tx.insert(schema.transactionItems).values({
      tenantId,
      transactionId: tx2!.id,
      quickItemId: quickItem!.id,
      label: 'Kaffee',
      unitPrice: '3.50',
      quantity: 2,
    });

    // A second sold Vinyl record with the SAME sales count (quantity 1) as Abbey Road but a
    // LOWER revenue ('9.00' vs '25.00') that nonetheless text-sorts ABOVE '25.00' ('9' > '2'
    // lexicographically) — pins the F3 sales-tie tiebreak fix: `topRecordsQuery` must rank by
    // the numeric revenue expression, not the `revenue`/`::text` alias, once sales tie.
    const [kobRecord] = await tx
      .insert(schema.records)
      .values({
        tenantId,
        title: 'Kind of Blue',
        artist: 'Miles Davis',
        label: ['Columbia'],
        format: 'Vinyl',
        genre: ['Jazz'],
        hash: `analytics-kob-${n}`,
      })
      .returning({ id: schema.records.id });

    const [kobPurchase] = await tx
      .insert(schema.purchases)
      .values({
        tenantId,
        recordId: kobRecord!.id,
        purchasePrice: '4.00',
        targetPrice: '9.00',
        soldPrice: '9.00',
        soldDate: new Date(),
        paymentMethod: 'bar',
        status: 'verkauft',
        conditionRecord: 5,
        conditionCover: 4,
      })
      .returning({ id: schema.purchases.id });

    const [tx3] = await tx
      .insert(schema.transactions)
      .values({
        tenantId,
        soldByUserId: adminUserId,
        paymentMethod: 'bar',
        subtotal: '9.00',
        discount: '0.00',
        total: '9.00',
        createdAt: berlinHourToday(13), // also inside 'Vormittag · 11–14 Uhr'
      })
      .returning({ id: schema.transactions.id });
    await tx.insert(schema.transactionItems).values({
      tenantId,
      transactionId: tx3!.id,
      purchaseId: kobPurchase!.id,
      label: 'Kind of Blue',
      unitPrice: '9.00',
      quantity: 1,
    });
  });

  return ctx;
}
