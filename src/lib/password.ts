import bcryptjs from 'bcryptjs';

/**
 * Shared bcrypt cost constant.
 *
 * Cost 12 is used throughout: provisioning hashes the initial admin password at cost 12,
 * and the auth layer (Task 10) runs a timing-safe dummy hash at cost 12 on login.
 * Mismatching costs would re-open a timing oracle on unknown users.
 */
export const BCRYPT_COST = 12;

/**
 * Hash a plaintext password with bcrypt at BCRYPT_COST.
 * Always use this helper — never call bcryptjs.hash directly — so the cost stays consistent.
 */
export async function hashPassword(plaintext: string): Promise<string> {
  return bcryptjs.hash(plaintext, BCRYPT_COST);
}

/**
 * Gültig geformter bcrypt-Hash (Cost 12) für den Timing-Schutz: wird verglichen, wenn KEINE
 * User-Zeile existiert, damit "unbekannte E-Mail" und "falsches Passwort" identisch lange
 * dauern (kein User-Enumeration-Orakel). Geteilt von Tenant-Auth und Platform-Auth.
 */
export const DUMMY_BCRYPT_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEeO.iI5wQp.J7m9F9pYVxq3sCJ8B9YQ3qK';
