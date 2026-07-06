// Slice 6 — Action-/Lib-Integrationsfälle (T4/T7/T8/T10/T11 teilen sich diesen Container).
// Die Platform-Actions werden ECHT aufgerufen (Spec §14: „provisionTenant über die
// Platform-UI-Action") — Session/Headers/Cache gemockt nach dem etablierten Muster
// von tests/ankauf-actions.integration.test.ts. MAIL_DRIVER=console (Default der
// Test-Helpers) fängt den Credential-Mail-Versand ab.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Pool } from 'pg';
import { setupTestDatabase, type TestDatabase } from './helpers/db';

let db: TestDatabase;
let owner: Pool;
let platformActions: typeof import('@/app/platform/(dashboard)/tenants/actions');

const fd = (entries: Record<string, string>): FormData => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};

beforeAll(async () => {
  db = await setupTestDatabase();
  owner = new Pool({ connectionString: db.ownerUrl, max: 2 });
  vi.doMock('@/auth/platform', () => ({
    requirePlatformSession: async () => ({ id: 1, email: 'platform@qrecords.test' }),
  }));
  vi.doMock('next/headers', () => ({
    headers: async () => new Headers(),
    cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
  }));
  vi.doMock('next/cache', () => ({ revalidatePath: () => undefined }));
  vi.resetModules();
  platformActions = await import('@/app/platform/(dashboard)/tenants/actions');
}, 180_000);

afterAll(async () => {
  await owner.end();
  await db.teardown();
});

describe('T4 platform tenant actions (echte Server Actions) + Lib', () => {
  it('createTenantAction provisioniert Tenant + Admin, liefert das Einmal-Passwort; Lib-Aggregate stimmen', async () => {
    const state = await platformActions.createTenantAction(
      { ok: false, error: null, temporaryPassword: null, slug: null },
      fd({
        slug: 'plattenkiste',
        name: 'Die Plattenkiste',
        adminEmail: 'chef@plattenkiste.test',
        primaryColor: '#C84B31',
        plan: 'small',
      }),
    );
    expect(state.ok).toBe(true);
    expect(state.slug).toBe('plattenkiste');
    expect(state.temporaryPassword).toMatch(/^[A-Z2-7]{16}$/); // Einmal-Anzeige (Spec §13.9)

    const { rows } = await owner.query(`SELECT id FROM tenants WHERE slug = 'plattenkiste'`);
    const tenantId: number = rows[0].id;
    await owner.query(
      `INSERT INTO records (tenant_id, title, artist, hash) VALUES ($1, 'X', 'Y', repeat('a', 64))`,
      [tenantId],
    );

    const { listTenantsWithStats, getTenantDetail } = await import('@/lib/platform/tenants');
    const list = await listTenantsWithStats();
    const row = list.find((t) => t.slug === 'plattenkiste')!;
    expect(row).toMatchObject({ name: 'Die Plattenkiste', plan: 'small', recordCount: 1, userCount: 1 });

    const detail = (await getTenantDetail(tenantId))!;
    expect(detail.adminEmail).toBe('chef@plattenkiste.test');
    expect(detail.primaryColor).toBe('#C84B31');
    expect(detail.subscription).toBeNull();
    expect(detail.onboardingCompletedAt).toBeNull(); // frisch provisioniert → Wizard offen
  });

  it('setTenantPlanAction schreibt den Plan-Override', async () => {
    const { rows } = await owner.query(`SELECT id FROM tenants WHERE slug = 'plattenkiste'`);
    const state = await platformActions.setTenantPlanAction(
      { ok: false, error: null },
      fd({ tenantId: String(rows[0].id), plan: 'big' }),
    );
    expect(state).toEqual({ ok: true, error: null });
    const after = await owner.query(`SELECT plan FROM tenants WHERE id = $1`, [rows[0].id]);
    expect(after.rows[0].plan).toBe('big');
  });

  it('resendCredentialsAction: neues Passwort + mustChangePassword=true, Passwort NICHT im State', async () => {
    const before = await owner.query(
      `SELECT id, password FROM users WHERE email = 'chef@plattenkiste.test'`,
    );
    await owner.query(`UPDATE users SET must_change_password = false WHERE id = $1`, [before.rows[0].id]);
    const { rows } = await owner.query(`SELECT id FROM tenants WHERE slug = 'plattenkiste'`);

    const state = await platformActions.resendCredentialsAction(
      { ok: false, error: null },
      fd({ tenantId: String(rows[0].id) }),
    );
    expect(state).toEqual({ ok: true, error: null }); // kein temporaryPassword-Feld (nur Mail, Spec §13.9)

    const after = await owner.query(
      `SELECT password, must_change_password FROM users WHERE id = $1`,
      [before.rows[0].id],
    );
    expect(after.rows[0].password).not.toBe(before.rows[0].password);
    expect(after.rows[0].must_change_password).toBe(true);
  });
});
