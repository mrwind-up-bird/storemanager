import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { setupTestDatabase, seedTenant } from './helpers/db';

let mod: typeof import('@/lib/discogs-connection');
let withTenant: (typeof import('@/db/tenant'))['withTenant'];
let decryptSecret: (typeof import('@/lib/crypto'))['decryptSecret'];
let schema: typeof import('@/db/schema');
let teardown: (() => Promise<void>) | undefined;
let tenantA: number;
let tenantB: number;

beforeAll(async () => {
  const db = await setupTestDatabase();
  teardown = db.teardown;
  process.env.DATABASE_URL = db.appUrl;
  process.env.DATABASE_OWNER_URL = db.ownerUrl;
  vi.resetModules();
  mod = await import('@/lib/discogs-connection');
  ({ withTenant } = await import('@/db/tenant'));
  ({ decryptSecret } = await import('@/lib/crypto'));
  schema = await import('@/db/schema');
  tenantA = (await seedTenant({ slug: 'a', name: 'A' })).tenantId;
  tenantB = (await seedTenant({ slug: 'b', name: 'B' })).tenantId;
});
afterAll(async () => {
  if (teardown) await teardown();
});

const ctxA = () => ({ tenantId: tenantA, userId: null });

describe('discogs-connection', () => {
  // Invariant 1 — round-trip: upsert then getConnection returns decrypted username + auth.
  it('round-trips decrypted auth + username', async () => {
    await mod.upsertConnection(ctxA(), {
      discogsUsername: 'a-shop',
      auth: { token: 'tok', tokenSecret: 'sec' },
      connectedByUserId: null,
    });
    const c = await mod.getConnection(ctxA());
    expect(c).toMatchObject({
      discogsUsername: 'a-shop',
      auth: { token: 'tok', tokenSecret: 'sec' },
    });
  });

  // Invariant 2 — encrypted at rest: raw DB column is NOT plaintext and looks like keyId.iv.tag.ct.
  it('stores tokens ENCRYPTED at rest', async () => {
    const raw = await withTenant(ctxA(), async (tx) =>
      tx.select().from(schema.discogsConnections),
    );
    expect(raw[0]?.oauthToken).not.toBe('tok'); // ciphertext, not plaintext
    expect(raw[0]?.oauthTokenSecret).not.toBe('sec'); // ciphertext, not plaintext
    // keyId.iv.tag.ct → exactly 4 dot-separated, non-empty base64 segments.
    const parts = (raw[0]?.oauthToken ?? '').split('.');
    expect(parts).toHaveLength(4);
    expect(parts.every((p) => p.length > 0)).toBe(true);
  });

  // Invariant 3 — wrong-tenant AAD fails: decrypting A's token with B's tenantId throws (AAD binding).
  it('refuses to decrypt with a different tenant AAD', async () => {
    const raw = await withTenant(ctxA(), async (tx) =>
      tx.select().from(schema.discogsConnections),
    );
    const cipher = raw[0]!.oauthToken;
    // Same key, wrong AAD (tenantB) → GCM auth-tag verification must fail.
    expect(() => decryptSecret(cipher, { tenantId: tenantB })).toThrow();
    // Sanity: the correct AAD (tenantA) still decrypts to the plaintext.
    expect(decryptSecret(cipher, { tenantId: tenantA })).toBe('tok');
  });

  // Invariant 5a — upsert replaces (one row per tenant).
  it('upsert replaces (one per tenant)', async () => {
    await mod.upsertConnection(ctxA(), {
      discogsUsername: 'a-shop-2',
      auth: { token: 't2', tokenSecret: 's2' },
      connectedByUserId: null,
    });
    const c = await mod.getConnection(ctxA());
    expect(c?.discogsUsername).toBe('a-shop-2');
    expect(c?.auth).toEqual({ token: 't2', tokenSecret: 's2' });
    const all = await withTenant(ctxA(), async (tx) =>
      tx.select().from(schema.discogsConnections),
    );
    expect(all).toHaveLength(1);
  });

  // Invariant 4 — RLS isolation: tenant B sees null while tenant A's row still resolves.
  it('is tenant-isolated', async () => {
    expect(await mod.getConnection({ tenantId: tenantB, userId: null })).toBeNull();
    // Non-vacuous: A still has its own connection at the same moment.
    expect((await mod.getConnection(ctxA()))?.discogsUsername).toBe('a-shop-2');
  });

  // Invariant 5b — delete removes it.
  it('delete removes it', async () => {
    await mod.deleteConnection(ctxA());
    expect(await mod.getConnection(ctxA())).toBeNull();
    const all = await withTenant(ctxA(), async (tx) =>
      tx.select().from(schema.discogsConnections),
    );
    expect(all).toHaveLength(0);
  });
});
