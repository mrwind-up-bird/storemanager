import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { setupTestDatabase } from '../helpers/db';

let db: Awaited<ReturnType<typeof setupTestDatabase>>;
let tenantApi: typeof import('@/db/tenant');
let schema: typeof import('@/db/schema');
let adapter: typeof import('@/auth/adapter');
let config: typeof import('@/auth/config');

// Local seed helper: tenants is registry (owner write); users insert under the
// tenant's RLS context (tenant_id passed explicitly to satisfy WITH CHECK).
async function seedTenantUser(args: {
  slug: string;
  name: string;
  email: string;
  password: string;
}): Promise<{ tenantId: number; userId: number }> {
  const { withOwner, withTenant } = tenantApi;
  const { tenants, users } = schema;
  const tenantId = await withOwner(async (tx) => {
    const [t] = await tx
      .insert(tenants)
      .values({ slug: args.slug, name: args.name })
      .returning({ id: tenants.id });
    return t.id;
  });
  const password = await bcrypt.hash(args.password, 10);
  const userId = await withTenant({ tenantId, userId: null }, async (tx) => {
    const [u] = await tx
      .insert(users)
      .values({ email: args.email, password, tenantId, role: 'admin' })
      .returning({ id: users.id });
    return u.id;
  });
  return { tenantId, userId };
}

beforeAll(async () => {
  db = await setupTestDatabase();
  process.env.DATABASE_URL = db.appUrl;
  process.env.DATABASE_OWNER_URL = db.ownerUrl;
  // import AFTER env is set so the pg pools bind to the testcontainer URLs
  tenantApi = await import('@/db/tenant');
  schema = await import('@/db/schema');
  adapter = await import('@/auth/adapter');
  config = await import('@/auth/config');
}, 120_000);

afterAll(async () => {
  await db?.teardown();
});

describe('verifyCredentials (keyed on email + tenant)', () => {
  it('returns the SessionUser on correct email + password + tenant', async () => {
    const { tenantId, userId } = await seedTenantUser({
      slug: 'cred-a',
      name: 'A',
      email: 'admin@a.test',
      password: 'pw-correct-123',
    });
    const user = await config.verifyCredentials({
      email: 'admin@a.test',
      password: 'pw-correct-123',
      tenantId,
    });
    expect(user).not.toBeNull();
    expect(user).toMatchObject({
      id: userId,
      email: 'admin@a.test',
      tenantId,
      role: 'admin',
      isSuperadmin: false,
    });
  });

  it('rejects a wrong password', async () => {
    const { tenantId } = await seedTenantUser({
      slug: 'cred-b',
      name: 'B',
      email: 'admin@b.test',
      password: 'pw-correct-123',
    });
    expect(
      await config.verifyCredentials({ email: 'admin@b.test', password: 'nope', tenantId }),
    ).toBeNull();
  });

  it('rejects a correct password under the WRONG tenant (RLS isolation)', async () => {
    const a = await seedTenantUser({
      slug: 'cred-c',
      name: 'C',
      email: 'shared@x.test',
      password: 'pw-correct-123',
    });
    const b = await seedTenantUser({
      slug: 'cred-d',
      name: 'D',
      email: 'other@d.test',
      password: 'pw-correct-123',
    });
    expect(
      await config.verifyCredentials({
        email: 'shared@x.test',
        password: 'pw-correct-123',
        tenantId: b.tenantId,
      }),
    ).toBeNull();
    // sanity: works under its own tenant
    expect(
      await config.verifyCredentials({
        email: 'shared@x.test',
        password: 'pw-correct-123',
        tenantId: a.tenantId,
      }),
    ).not.toBeNull();
  });
});

describe('DB session adapter (tenant-scoped, opaque token)', () => {
  it('round-trips a session inside its tenant and hides it from another tenant', async () => {
    const a = await seedTenantUser({
      slug: 'sess-a',
      name: 'SA',
      email: 'a@sess.test',
      password: 'pw-1',
    });
    const b = await seedTenantUser({
      slug: 'sess-b',
      name: 'SB',
      email: 'b@sess.test',
      password: 'pw-1',
    });

    const sessionToken = randomUUID();
    const expires = new Date(Date.now() + 60_000);
    await adapter.createTenantSession(a.tenantId, {
      sessionToken,
      userId: a.userId,
      expires,
    });

    // opaque token, NOT a JWT (no dotted header.payload.signature structure)
    expect(sessionToken.split('.').length).toBe(1);

    const found = await adapter.getTenantSessionAndUser(a.tenantId, sessionToken);
    expect(found).not.toBeNull();
    expect(found?.session.sessionToken).toBe(sessionToken);
    expect(found?.user).toMatchObject({
      id: a.userId,
      tenantId: a.tenantId,
      email: 'a@sess.test',
    });

    // §9.6 / §9.3: a session minted for tenant A is NOT visible under tenant B
    expect(await adapter.getTenantSessionAndUser(b.tenantId, sessionToken)).toBeNull();

    await adapter.deleteTenantSession(a.tenantId, sessionToken);
    expect(await adapter.getTenantSessionAndUser(a.tenantId, sessionToken)).toBeNull();
  });
});
