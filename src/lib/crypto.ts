import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '@/env';

/**
 * Throws if ENCRYPTION_KEY does not base64-decode to exactly 32 bytes.
 * Call once at server boot before handling any traffic.
 */
export function assertEncryptionKey(): void {
  const keyBytes = Buffer.from(env.ENCRYPTION_KEY, 'base64');
  if (keyBytes.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must base64-decode to exactly 32 bytes; got ${keyBytes.length}. ` +
        `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }
}

/**
 * Builds the AAD (Additional Authenticated Data) buffer.
 * Format: utf-8 encoding of "<tenantId>:<userId|empty>"
 * Binds the ciphertext to a specific tenant (and optionally user).
 */
function buildAad(aad: { tenantId: number; userId?: number | null }): Buffer {
  return Buffer.from(`${aad.tenantId}:${aad.userId ?? ''}`, 'utf8');
}

/**
 * Encrypts `plaintext` under AES-256-GCM.
 * - Random 12-byte IV per call (never reused).
 * - AAD = utf-8(`${tenantId}:${userId ?? ""}`) — decryption fails if either differs.
 * - Returns: `"<keyId>.<ivBase64>.<tagBase64>.<ciphertextBase64>"`
 */
export function encryptSecret(
  plaintext: string,
  aad: { tenantId: number; userId?: number | null },
): string {
  const key = Buffer.from(env.ENCRYPTION_KEY, 'base64');
  const iv = randomBytes(12); // 96-bit IV, GCM standard
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(buildAad(aad));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag(); // 128-bit auth tag
  return (
    `${env.ENCRYPTION_KEY_ID}` +
    `.${iv.toString('base64')}` +
    `.${tag.toString('base64')}` +
    `.${ct.toString('base64')}`
  );
}

/**
 * Decrypts a payload produced by `encryptSecret`.
 * Throws if:
 *  - The payload is malformed (wrong number of segments).
 *  - The key id does not match `env.ENCRYPTION_KEY_ID`.
 *  - The auth tag fails verification (ciphertext tampered or wrong AAD).
 */
export function decryptSecret(
  payload: string,
  aad: { tenantId: number; userId?: number | null },
): string {
  const parts = payload.split('.');
  if (parts.length !== 4) {
    throw new Error(
      `Invalid crypto payload: expected 4 dot-separated segments, got ${parts.length}`,
    );
  }
  const [keyId, ivB64, tagB64, ctB64] = parts as [string, string, string, string];

  if (keyId !== env.ENCRYPTION_KEY_ID) {
    throw new Error(
      `Unknown encryption key id "${keyId}"; current key id is "${env.ENCRYPTION_KEY_ID}"`,
    );
  }

  const key = Buffer.from(env.ENCRYPTION_KEY, 'base64');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  decipher.setAAD(buildAad(aad));

  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    throw new Error(
      'Decryption failed: authentication tag mismatch — payload was tampered or AAD (tenantId/userId) is wrong',
    );
  }
}
