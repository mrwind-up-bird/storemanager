import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../src/db/schema';
import { setupTestDatabase } from './helpers/db';

/**
 * Integration tests for provisionTenant (§9.9 — atomic tenant provisioning).
 *
 * CRITICAL: env vars are set in beforeAll BEFORE any dynamic import of @/lib/provisioning
 * (which transitively imports @/db/client, which binds pools at module-eval time).
 * All spec imports of provisionTenant go through `await import('@/lib/provisioning')` to
 * pick up the live test pools.
 */
describe('provisionTenant (integration)', () => {
  let ownerPool: Pool;
  let teardown: () => Promise<void>;

  beforeAll(async () => {
    const db = await setupTestDatabase();
    teardown = db.teardown;
    ownerPool = new Pool({ connectionString: db.ownerUrl });

    // Fresh module graph so @/db/client reads the env vars set by setupTestDatabase().
    vi.resetModules();
  }, 120_000);

  afterAll(async () => {
    await ownerPool.end();
    await teardown();
  });

  // ── Happy path ─────────────────────────────────────────────────────────────

  it('creates exactly 1 tenant, 1 admin user (role=admin), and 1 permalink (slug=lager)', async () => {
    const { provisionTenant } = await import('@/lib/provisioning');
    const bcrypt = await import('bcryptjs');

    const result = await provisionTenant({
      slug: 'testshop',
      name: 'Test Shop',
      adminEmail: 'admin@testshop.example',
      primaryColor: '#4338CA',
      plan: 'free',
    });

    expect(result.tenantId).toBeTypeOf('number');
    expect(result.adminUserId).toBeTypeOf('number');
    // Auto-generated password is 16-char base32 (A-Z + 2-7)
    expect(result.temporaryPassword).toHaveLength(16);
    expect(/^[A-Z2-7]{16}$/.test(result.temporaryPassword)).toBe(true);

    const db = drizzle(ownerPool, { schema });

    // Tenant row
    const [tenant] = await db
      .select()
      .from(schema.tenants)
      .where(eq(schema.tenants.slug, 'testshop'));
    expect(tenant).toBeDefined();
    expect(tenant!.id).toBe(result.tenantId);
    expect(tenant!.plan).toBe('free');
    expect(
      (tenant!.config as { branding: { primaryColor: string } }).branding.primaryColor,
    ).toBe('#4338CA');

    // User row
    const tenantUsers = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.tenantId, result.tenantId));
    expect(tenantUsers).toHaveLength(1);
    expect(tenantUsers[0]!.id).toBe(result.adminUserId);
    expect(tenantUsers[0]!.role).toBe('admin');
    expect(tenantUsers[0]!.email).toBe('admin@testshop.example');
    expect(tenantUsers[0]!.isSuperadmin).toBe(false);

    // Password hash: correct plaintext verifies; bcrypt cost is 12
    const storedHash = tenantUsers[0]!.password;
    expect(await bcrypt.compare(result.temporaryPassword, storedHash)).toBe(true);
    expect(bcrypt.getRounds(storedHash)).toBe(12);

    // Permalink row
    const tenantPermalinks = await db
      .select()
      .from(schema.permalinks)
      .where(eq(schema.permalinks.tenantId, result.tenantId));
    expect(tenantPermalinks).toHaveLength(1);
    expect(tenantPermalinks[0]!.slug).toBe('lager');
  });

  // ── §9.9 atomicity / rollback ─────────────────────────────────────────────

  it('rolls back ALL inserts when the slug already exists (atomicity)', async () => {
    const { provisionTenant } = await import('@/lib/provisioning');
    const db = drizzle(ownerPool, { schema });

    // First provision: must succeed
    const first = await provisionTenant({
      slug: 'rollback-slug',
      name: 'Rollback Test',
      adminEmail: 'admin@rollback.example',
      primaryColor: '#4338CA',
    });
    expect(first.tenantId).toBeTypeOf('number');

    // Second provision with same slug: unique constraint on tenants.slug → rollback
    await expect(
      provisionTenant({
        slug: 'rollback-slug',
        name: 'Rollback Test Duplicate',
        adminEmail: 'admin2@rollback.example',
        primaryColor: '#4338CA',
      }),
    ).rejects.toThrow();

    // State must be exactly what the FIRST provision left — no partial rows from second attempt
    const matchingTenants = await db
      .select()
      .from(schema.tenants)
      .where(eq(schema.tenants.slug, 'rollback-slug'));
    expect(matchingTenants).toHaveLength(1);

    const matchingUsers = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.tenantId, matchingTenants[0]!.id));
    expect(matchingUsers).toHaveLength(1);

    const matchingPermalinks = await db
      .select()
      .from(schema.permalinks)
      .where(eq(schema.permalinks.tenantId, matchingTenants[0]!.id));
    expect(matchingPermalinks).toHaveLength(1);
  });

  // ── Slug validation ────────────────────────────────────────────────────────

  it('rejects a reserved slug before opening a DB transaction', async () => {
    const { provisionTenant } = await import('@/lib/provisioning');
    const db = drizzle(ownerPool, { schema });

    const countBefore = (await db.select({ id: schema.tenants.id }).from(schema.tenants)).length;

    await expect(
      provisionTenant({ slug: 'www', name: 'WWW', adminEmail: 'admin@www.example' }),
    ).rejects.toThrow(/reserved/i);

    const countAfter = (await db.select({ id: schema.tenants.id }).from(schema.tenants)).length;
    expect(countAfter).toBe(countBefore);
  });

  it('rejects a slug that fails the format regex before opening a DB transaction', async () => {
    const { provisionTenant } = await import('@/lib/provisioning');
    const db = drizzle(ownerPool, { schema });

    const countBefore = (await db.select({ id: schema.tenants.id }).from(schema.tenants)).length;

    // 'ab' is only 2 characters — fails ^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$ (needs ≥3)
    await expect(
      provisionTenant({ slug: 'ab', name: 'AB', adminEmail: 'admin@ab.example' }),
    ).rejects.toThrow(/invalid slug/i);

    const countAfter = (await db.select({ id: schema.tenants.id }).from(schema.tenants)).length;
    expect(countAfter).toBe(countBefore);
  });

  it('rejects slugs with uppercase letters', async () => {
    const { provisionTenant } = await import('@/lib/provisioning');
    const db = drizzle(ownerPool, { schema });
    const countBefore = (await db.select({ id: schema.tenants.id }).from(schema.tenants)).length;

    await expect(
      provisionTenant({ slug: 'MyShop', name: 'My Shop', adminEmail: 'admin@myshop.example' }),
    ).rejects.toThrow(/invalid slug/i);

    const countAfter = (await db.select({ id: schema.tenants.id }).from(schema.tenants)).length;
    expect(countAfter).toBe(countBefore);
  });

  it('rejects slugs with a leading hyphen', async () => {
    const { provisionTenant } = await import('@/lib/provisioning');
    const db = drizzle(ownerPool, { schema });
    const countBefore = (await db.select({ id: schema.tenants.id }).from(schema.tenants)).length;

    await expect(
      provisionTenant({ slug: '-bad', name: 'Bad', adminEmail: 'admin@bad.example' }),
    ).rejects.toThrow(/invalid slug/i);

    const countAfter = (await db.select({ id: schema.tenants.id }).from(schema.tenants)).length;
    expect(countAfter).toBe(countBefore);
  });

  // ── Color validation ───────────────────────────────────────────────────────

  it('rejects an unparseable primary color before opening a DB transaction', async () => {
    const { provisionTenant } = await import('@/lib/provisioning');
    const db = drizzle(ownerPool, { schema });

    const countBefore = (await db.select({ id: schema.tenants.id }).from(schema.tenants)).length;

    await expect(
      provisionTenant({
        slug: 'colortest',
        name: 'Color Test',
        adminEmail: 'admin@colortest.example',
        primaryColor: 'not-a-hex',
      }),
    ).rejects.toThrow();

    const countAfter = (await db.select({ id: schema.tenants.id }).from(schema.tenants)).length;
    expect(countAfter).toBe(countBefore);
  });

  // ── Password behaviour ─────────────────────────────────────────────────────

  it('generates a unique temporaryPassword on every call', async () => {
    const { provisionTenant } = await import('@/lib/provisioning');

    const a = await provisionTenant({
      slug: 'uniq-a',
      name: 'Unique A',
      adminEmail: 'admin@uniq-a.example',
      primaryColor: '#4338CA',
    });
    const b = await provisionTenant({
      slug: 'uniq-b',
      name: 'Unique B',
      adminEmail: 'admin@uniq-b.example',
      primaryColor: '#4338CA',
    });

    expect(a.temporaryPassword).not.toBe(b.temporaryPassword);
  });

  it('uses an explicit password when input.password is provided', async () => {
    const { provisionTenant } = await import('@/lib/provisioning');
    const bcrypt = await import('bcryptjs');

    const result = await provisionTenant({
      slug: 'explicit-pw',
      name: 'Explicit PW',
      adminEmail: 'admin@explicit-pw.example',
      primaryColor: '#4338CA',
      password: 'SuperSecret123!',
    });

    expect(result.temporaryPassword).toBe('SuperSecret123!');

    const db = drizzle(ownerPool, { schema });
    const [user] = await db
      .select({ password: schema.users.password })
      .from(schema.users)
      .where(eq(schema.users.tenantId, result.tenantId));

    expect(user).toBeDefined();
    expect(await bcrypt.compare('SuperSecret123!', user!.password)).toBe(true);
    expect(bcrypt.getRounds(user!.password)).toBe(12);
  });
});

// ── Seed idempotency pattern ───────────────────────────────────────────────

describe('seed.ts idempotency pattern', () => {
  let ownerPool: Pool;
  let teardown: () => Promise<void>;

  beforeAll(async () => {
    const db = await setupTestDatabase();
    teardown = db.teardown;
    ownerPool = new Pool({ connectionString: db.ownerUrl });
    vi.resetModules();
  }, 120_000);

  afterAll(async () => {
    await ownerPool.end();
    await teardown();
  });

  it('running provisionTenant then guard-skipping yields exactly 1 tenant, 1 user, 1 permalink', async () => {
    const { provisionTenant } = await import('@/lib/provisioning');
    const db = drizzle(ownerPool, { schema });
    const slug = 'seed-idempotency-test';

    // First "run": provision normally
    const firstRun = await provisionTenant({
      slug,
      name: 'Seed Idempotency',
      adminEmail: 'admin@seed-idempotency.example',
      primaryColor: '#4338CA',
    });

    // Second "run": guard checks existence and skips
    const existing = await db
      .select({ id: schema.tenants.id })
      .from(schema.tenants)
      .where(eq(schema.tenants.slug, slug))
      .limit(1);

    const tenantId =
      existing.length > 0
        ? existing[0]!.id
        : (
            await provisionTenant({
              slug,
              name: 'Seed Idempotency',
              adminEmail: 'admin@seed-idempotency.example',
              primaryColor: '#4338CA',
            })
          ).tenantId;

    expect(tenantId).toBe(firstRun.tenantId);

    // Final state: exactly 1 of each
    const finalTenants = await db
      .select()
      .from(schema.tenants)
      .where(eq(schema.tenants.slug, slug));
    expect(finalTenants).toHaveLength(1);

    const finalUsers = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.tenantId, tenantId));
    expect(finalUsers).toHaveLength(1);

    const finalPermalinks = await db
      .select()
      .from(schema.permalinks)
      .where(eq(schema.permalinks.tenantId, tenantId));
    expect(finalPermalinks).toHaveLength(1);
  });
});
