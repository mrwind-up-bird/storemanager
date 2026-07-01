import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestDatabase, seedTenant } from './helpers/db';

let reserveCopy: (typeof import('@/lib/reservation'))['reserveCopy'];
let cancelReservation: (typeof import('@/lib/reservation'))['cancelReservation'];
let ReservationConflictError: (typeof import('@/lib/reservation'))['ReservationConflictError'];
let performAnkauf: (typeof import('@/lib/ankauf'))['performAnkauf'];
let withTenant: (typeof import('@/db/tenant'))['withTenant'];
let schema: typeof import('@/db/schema');
let teardown: (() => Promise<void>) | undefined;
let tenantA: number;

const release = {
  discogsId: 7,
  title: 'Spiegel im Spiegel',
  artist: 'Arvo Pärt',
  country: 'DE',
  year: 1978,
  format: 'Vinyl',
  genre: ['Classical'],
  label: ['ECM'],
  coverImage: null,
};

beforeAll(async () => {
  const db = await setupTestDatabase();
  teardown = db.teardown;
  process.env.DATABASE_URL = db.appUrl;
  process.env.DATABASE_OWNER_URL = db.ownerUrl;
  vi.resetModules();
  ({ reserveCopy, cancelReservation, ReservationConflictError } = await import('@/lib/reservation'));
  ({ performAnkauf } = await import('@/lib/ankauf'));
  ({ withTenant } = await import('@/db/tenant'));
  schema = await import('@/db/schema');
  tenantA = (await seedTenant({ slug: 'demo', name: 'Demo' })).tenantId;
});
afterAll(async () => {
  if (teardown) await teardown();
});

const ctx = () => ({ tenantId: tenantA, userId: null });

/** Insert a fresh `verfuegbar` copy and return its purchaseId. */
async function freshCopy(): Promise<number> {
  const { purchaseId } = await performAnkauf(ctx(), {
    release,
    purchasePrice: '3.00',
    targetPrice: '22.50',
    conditionRecord: 5,
    conditionCover: 4,
    listOnDiscogs: false,
  });
  return purchaseId;
}

async function readCopy(id: number) {
  return withTenant(ctx(), async (tx) => {
    const [row] = await tx.select().from(schema.purchases).where(eq(schema.purchases.id, id));
    return row;
  });
}

describe('reserveCopy / cancelReservation', () => {
  it('verfuegbar → reserviert, then reserviert → verfuegbar', async () => {
    const id = await freshCopy();

    await reserveCopy(ctx(), id);
    const reserved = await readCopy(id);
    expect(reserved?.status).toBe('reserviert');
    expect(reserved?.updatedAt).toBeInstanceOf(Date); // SET updatedAt = now() was written

    await cancelReservation(ctx(), id);
    const cancelled = await readCopy(id);
    expect(cancelled?.status).toBe('verfuegbar');
  });

  it('reserveCopy on a non-verfuegbar copy fails closed and leaves status unchanged', async () => {
    const id = await freshCopy();
    await reserveCopy(ctx(), id); // now reserviert

    const err = await reserveCopy(ctx(), id).catch((e) => e);
    expect(err).toBeInstanceOf(ReservationConflictError);
    expect(err.purchaseId).toBe(id);
    expect(err.status).toBe('reserviert');

    const after = await readCopy(id);
    expect(after?.status).toBe('reserviert'); // no spurious transition
  });

  it('cancelReservation on a verfuegbar copy fails closed', async () => {
    const id = await freshCopy(); // verfuegbar

    const err = await cancelReservation(ctx(), id).catch((e) => e);
    expect(err).toBeInstanceOf(ReservationConflictError);
    expect(err.purchaseId).toBe(id);
    expect(err.status).toBe('verfuegbar');

    const after = await readCopy(id);
    expect(after?.status).toBe('verfuegbar');
  });

  it('reserveCopy on a missing/invisible row throws ReservationConflictError(status=null)', async () => {
    const err = await reserveCopy(ctx(), 999_999).catch((e) => e);
    expect(err).toBeInstanceOf(ReservationConflictError);
    expect(err.purchaseId).toBe(999_999);
    expect(err.status).toBeNull();
  });
});
