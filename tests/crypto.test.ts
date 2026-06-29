import { describe, it, expect, vi } from 'vitest';

// vi.mock is hoisted above all imports by Vitest — runs before module resolution
vi.mock('@/env', () => ({
  env: {
    ENCRYPTION_KEY: Buffer.alloc(32, 0xab).toString('base64'), // valid 32-byte key
    ENCRYPTION_KEY_ID: 'v1',
  },
}));

import { encryptSecret, decryptSecret, assertEncryptionKey } from '@/lib/crypto';

const TEST_AAD = { tenantId: 42, userId: 7 } as const;
const PLAINTEXT = 'super-secret-discogs-token';

describe('crypto helper — AES-256-GCM', () => {
  describe('encryptSecret / decryptSecret', () => {
    it('roundtrip: decrypt(encrypt(plain)) === plain', () => {
      const payload = encryptSecret(PLAINTEXT, TEST_AAD);
      expect(decryptSecret(payload, TEST_AAD)).toBe(PLAINTEXT);
    });

    it('payload has 4 dot-separated parts, first part is the key id', () => {
      const payload = encryptSecret(PLAINTEXT, TEST_AAD);
      const parts = payload.split('.');
      expect(parts).toHaveLength(4);
      expect(parts[0]).toBe('v1');
    });

    it('produces a distinct IV per call — two encryptions of identical plaintext differ', () => {
      const p1 = encryptSecret(PLAINTEXT, TEST_AAD);
      const p2 = encryptSecret(PLAINTEXT, TEST_AAD);
      expect(p1).not.toBe(p2);
      // IV is the second dot-segment
      expect(p1.split('.')[1]).not.toBe(p2.split('.')[1]);
    });

    it('throws when a ciphertext byte is flipped (tamper via ct)', () => {
      const payload = encryptSecret(PLAINTEXT, TEST_AAD);
      const [keyId, ivB64, tagB64, ctB64] = payload.split('.');
      const ct = Buffer.from(ctB64, 'base64');
      ct[0] ^= 0xff; // flip first byte
      const tampered = `${keyId}.${ivB64}.${tagB64}.${ct.toString('base64')}`;
      expect(() => decryptSecret(tampered, TEST_AAD)).toThrow();
    });

    it('throws when the auth tag is flipped (tamper via tag)', () => {
      const payload = encryptSecret(PLAINTEXT, TEST_AAD);
      const [keyId, ivB64, tagB64, ctB64] = payload.split('.');
      const tag = Buffer.from(tagB64, 'base64');
      tag[0] ^= 0xff;
      const tampered = `${keyId}.${ivB64}.${tag.toString('base64')}.${ctB64}`;
      expect(() => decryptSecret(tampered, TEST_AAD)).toThrow();
    });

    it('throws when decrypting with a different tenantId in AAD (wrong tenant)', () => {
      const payload = encryptSecret(PLAINTEXT, { tenantId: 1, userId: null });
      expect(() => decryptSecret(payload, { tenantId: 2, userId: null })).toThrow();
    });

    it('throws when decrypting with a different userId in AAD', () => {
      const payload = encryptSecret(PLAINTEXT, { tenantId: 1, userId: 10 });
      expect(() => decryptSecret(payload, { tenantId: 1, userId: 99 })).toThrow();
    });

    it('handles null userId in AAD consistently (encrypt then decrypt)', () => {
      const aad = { tenantId: 5, userId: null };
      expect(decryptSecret(encryptSecret(PLAINTEXT, aad), aad)).toBe(PLAINTEXT);
    });

    it('handles undefined userId in AAD the same as null (treated as empty string)', () => {
      const aad = { tenantId: 5 }; // userId absent = undefined
      expect(decryptSecret(encryptSecret(PLAINTEXT, aad), aad)).toBe(PLAINTEXT);
    });

    it('throws on malformed payload with wrong number of dot-segments', () => {
      expect(() => decryptSecret('v1.onlytwoparts', TEST_AAD)).toThrow();
      expect(() => decryptSecret('v1.a.b.c.d', TEST_AAD)).toThrow();
    });
  });

  describe('assertEncryptionKey', () => {
    it('does not throw when the mocked key decodes to exactly 32 bytes', () => {
      expect(() => assertEncryptionKey()).not.toThrow();
    });
  });
});

// Separate describe block so vi.resetModules() does not pollute the tests above
describe('assertEncryptionKey — rejects a key that is not 32 bytes', () => {
  it('throws mentioning "32 bytes" when ENCRYPTION_KEY decodes to 16 bytes', async () => {
    vi.resetModules();
    vi.doMock('@/env', () => ({
      env: {
        ENCRYPTION_KEY: Buffer.alloc(16, 0x01).toString('base64'), // 16 bytes — wrong
        ENCRYPTION_KEY_ID: 'v1',
      },
    }));
    const { assertEncryptionKey: fn } = await import('@/lib/crypto');
    expect(() => fn()).toThrow('32 bytes');
    vi.resetModules(); // restore clean state for subsequent test files
  });
});
