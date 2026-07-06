import 'server-only';
import crypto from 'node:crypto';
import { withOwner } from '@/db/tenant';
import { tenants, users, permalinks } from '@/db/schema';
import { RESERVED_SUBDOMAINS } from '@/lib/subdomain';
import { assertAccessibleAccent } from '@/lib/tenant';
import { DEFAULT_PRIMARY_COLOR } from '@/lib/branding';
import { hashPassword } from '@/lib/password';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Slug format: 3–32 chars, lowercase alphanumeric with interior hyphens.
 * Must start and end with [a-z0-9].  No leading/trailing hyphen.
 *
 * Length proof: `[a-z0-9]` (1) + `[a-z0-9-]{1,30}` (1–30) + `[a-z0-9]` (1) = 3–32.
 */
const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

/**
 * A colour must be a well-formed 3- or 6-digit hex string starting with '#'.
 * Validated before `assertAccessibleAccent` so that NaN-based luminance values
 * do not silently bypass the contrast check.
 */
export const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Base32 alphabet (RFC 4648 §6): A–Z + 2–7.
 * Each byte contributes 5 bits via `b & 0x1f`; because 2^8 = 256 = 8 × 32,
 * the distribution over 0–31 is exactly uniform — no rejection sampling needed.
 */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProvisionInput = {
  slug: string;
  name: string;
  adminEmail: string;
  primaryColor?: string;
  plan?: 'free' | 'small' | 'big';
  /** Optional explicit password. When omitted a 16-char base32 temp password is generated. */
  password?: string;
};

export type ProvisionResult = {
  tenantId: number;
  adminUserId: number;
  /** Plaintext password (either provided or generated). Hand to caller; never log. */
  temporaryPassword: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a cryptographically strong 16-character base32 temporary password
 * (80 bits of entropy from 16 random bytes, 5 bits each).
 */
export function generateTempPassword(): string {
  const bytes = crypto.randomBytes(16);
  return Array.from(bytes, (b) => BASE32_ALPHABET[b & 0x1f]!).join('');
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Atomically provision a new tenant with its initial admin user and the default
 * "lager" permalink.  All three inserts run in a single `withOwner` transaction;
 * any failure (including a duplicate-slug unique-constraint violation) rolls back
 * the entire transaction, leaving no partial rows (§9.9).
 *
 * Validations that run BEFORE the transaction is opened (i.e. no DB involvement):
 *  - `slug` not in `RESERVED_SUBDOMAINS`
 *  - `slug` matches the format regex
 *  - `primaryColor`, if provided, is a valid 3- or 6-digit hex AND passes WCAG AA
 *
 * Email delivery is the CALLER's responsibility — this function only returns
 * the plaintext `temporaryPassword` (never logs it).
 */
export async function provisionTenant(input: ProvisionInput): Promise<ProvisionResult> {
  const { slug, name, adminEmail, primaryColor, plan = 'free', password } = input;

  // ── Pre-transaction validation ────────────────────────────────────────────

  if (RESERVED_SUBDOMAINS.has(slug)) {
    throw new Error(
      `Slug "${slug}" is reserved and cannot be used as a tenant identifier.`,
    );
  }

  if (!SLUG_REGEX.test(slug)) {
    throw new Error(
      `Invalid slug "${slug}": must be 3–32 characters, start and end with a lowercase ` +
        `letter or digit, and contain only lowercase letters, digits, or hyphens.`,
    );
  }

  if (primaryColor !== undefined) {
    if (!HEX_COLOR_REGEX.test(primaryColor)) {
      throw new Error(
        `Invalid primaryColor "${primaryColor}": must be a valid 3- or 6-digit hex color ` +
          `(e.g. #F00 or #FF0000).`,
      );
    }
    // Throws if neither white nor #111111 achieves 4.5:1 contrast — low-contrast colours
    // that can't be paired with any accessible foreground are rejected here, pre-transaction.
    assertAccessibleAccent(primaryColor);
  }

  // ── Credential generation (CPU work — outside the DB transaction) ─────────

  const temporaryPassword = password ?? generateTempPassword();
  // hashPassword uses BCRYPT_COST = 12 (see src/lib/password.ts)
  const passwordHash = await hashPassword(temporaryPassword);

  // ── Single atomic transaction ─────────────────────────────────────────────
  //
  // `withOwner` uses the qr_owner pool (BYPASSRLS), sets transaction-local GUCs
  // to empty-string tenant/user (no RLS context needed for provisioning), and wraps
  // everything in a single database transaction.  Any throw inside triggers rollback.
  //
  // We ALWAYS pass tenantId explicitly on the user and permalink inserts (defence-in-depth;
  // the GUC-based column default is never invoked — qr_owner's GUC context is empty).

  const { tenantId, adminUserId } = await withOwner(async (tx) => {
    // 1. Insert into the platform tenant registry.
    const [newTenant] = await tx
      .insert(tenants)
      .values({
        slug,
        name,
        plan,
        config: {
          branding: { primaryColor: primaryColor ?? DEFAULT_PRIMARY_COLOR, logo: null },
        },
        limits: {},
      })
      .returning({ id: tenants.id });

    if (!newTenant) {
      // Should never happen; the INSERT RETURNING would only be empty if the DB
      // silently discarded the row, which is not possible with Postgres.
      throw new Error('[provisionTenant] Tenant insert returned no row.');
    }

    // 2. Insert the initial admin user with the bcrypt hash.
    const [newUser] = await tx
      .insert(users)
      .values({
        tenantId: newTenant.id,
        email: adminEmail,
        password: passwordHash,
        role: 'admin',
        isSuperadmin: false,
        // Generiertes temporäres Passwort ⇒ Zwangswechsel beim Erst-Login (Spec §11).
        // Explizit übergebenes Passwort (Seed) ⇒ kein Zwang.
        mustChangePassword: password === undefined,
      })
      .returning({ id: users.id });

    if (!newUser) {
      throw new Error('[provisionTenant] Admin user insert returned no row.');
    }

    // 3. Insert the default "lager" (stock/available) permalink stub.
    await tx.insert(permalinks).values({
      tenantId: newTenant.id,
      slug: 'lager',
      filter: {},
    });

    return { tenantId: newTenant.id, adminUserId: newUser.id };
  });

  return { tenantId, adminUserId, temporaryPassword };
}
