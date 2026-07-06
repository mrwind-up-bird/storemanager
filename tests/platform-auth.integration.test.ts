// Slice 6 T3 — Platform-Session (Spec §5/§14): verify mit Dummy-Hash-Fallback, Create/Lookup,
// Expiry-Cleanup, Cookie-Name je Protokoll (pure), Token-Delete.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { setupTestDatabase, type TestDatabase } from './helpers/db';

describe('platform auth', () => {
  let db: TestDatabase;
  let owner: Pool;

  beforeAll(async () => {
    db = await setupTestDatabase();
    owner = new Pool({ connectionString: db.ownerUrl, max: 2 });
    const { hashPassword } = await import('@/lib/password');
    await owner.query(`INSERT INTO platform_users (email, password) VALUES ($1, $2)`, [
      'platform@qrecords.test',
      await hashPassword('PlatformPw123!'),
    ]);
  }, 180_000);

  afterAll(async () => {
    await owner.end();
    await db.teardown();
  });

  it('platformCookieName ist protokollabhängig', async () => {
    const { platformCookieName } = await import('@/auth/platform');
    expect(platformCookieName('https')).toBe('__Host-qr.platform');
    expect(platformCookieName('http')).toBe('qr.platform');
  });

  it('verifyPlatformCredentials: korrekt / falsches Passwort / unbekannte E-Mail', async () => {
    const { verifyPlatformCredentials } = await import('@/auth/platform');
    const ok = await verifyPlatformCredentials('platform@qrecords.test', 'PlatformPw123!');
    expect(ok).toMatchObject({ email: 'platform@qrecords.test' });
    expect(await verifyPlatformCredentials('platform@qrecords.test', 'falsch')).toBeNull();

    // Timing-Regression-Guard: bcrypt.compare MUSS auch bei unbekannter E-Mail laufen
    // (Dummy-Hash-Pfad) — ein künftiges `if (!u) return null;` VOR dem compare würde ein
    // User-Enumeration-Zeitfenster reißen, ohne dass ein reiner Ergebnis-Check das bemerkt.
    const compareSpy = vi.spyOn(bcrypt, 'compare');
    expect(await verifyPlatformCredentials('nix@qrecords.test', 'PlatformPw123!')).toBeNull();
    expect(compareSpy).toHaveBeenCalled();
    compareSpy.mockRestore();
  });

  it('Session: create → lookup → destroy-by-delete', async () => {
    const { verifyPlatformCredentials, createPlatformSession, getPlatformSessionByToken } =
      await import('@/auth/platform');
    const user = (await verifyPlatformCredentials('platform@qrecords.test', 'PlatformPw123!'))!;
    const { token, expires } = await createPlatformSession(user.id);
    expect(expires.getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);

    const resolved = await getPlatformSessionByToken(token);
    expect(resolved).toEqual({ id: user.id, email: 'platform@qrecords.test' });

    await owner.query(`DELETE FROM platform_sessions WHERE token = $1`, [token]);
    expect(await getPlatformSessionByToken(token)).toBeNull();
  });

  it('abgelaufene Session wird beim Lookup gelöscht (opportunistischer Cleanup)', async () => {
    const { getPlatformSessionByToken } = await import('@/auth/platform');
    const uid = (await owner.query(`SELECT id FROM platform_users LIMIT 1`)).rows[0].id as number;
    await owner.query(
      `INSERT INTO platform_sessions (token, platform_user_id, expires) VALUES ('expired-token', $1, now() - interval '1 hour')`,
      [uid],
    );
    expect(await getPlatformSessionByToken('expired-token')).toBeNull();
    const left = await owner.query(`SELECT count(*)::int AS n FROM platform_sessions WHERE token = 'expired-token'`);
    expect(left.rows[0].n).toBe(0);
  });
});
