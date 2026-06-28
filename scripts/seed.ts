// Must be first: loads .env into process.env before any src/* imports.
import 'dotenv/config';

import { eq, and } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../src/db/schema';
import { provisionTenant, type ProvisionInput } from '../src/lib/provisioning';
import { recordHash } from '../src/db/hash';
import { hashPassword } from '../src/lib/password';

// ---------------------------------------------------------------------------
// Tenant definitions
// ---------------------------------------------------------------------------

const DEMO_TENANT: ProvisionInput = {
  slug: 'demo',
  name: 'Q-Records Demo',
  adminEmail: 'admin@demo.test',
  primaryColor: '#E8552E', // deep coral — achieves ≥ 4.5:1 contrast with #111111
  plan: 'free',
};

const VINYLCAVE_TENANT: ProvisionInput = {
  slug: 'vinylcave',
  name: 'Vinyl Cave',
  adminEmail: 'admin@vinylcave.test',
  primaryColor: '#5B4FCF', // deep indigo — achieves ≥ 4.5:1 contrast with white
  plan: 'small',
};

// ---------------------------------------------------------------------------
// Sample records (3 per tenant — varied artist/title for realistic seed data)
// ---------------------------------------------------------------------------

type RecordSeed = {
  title: string;
  artist: string;
  country: string;
  releaseYear: number;
  label: string[];
};

const DEMO_RECORDS: RecordSeed[] = [
  { title: 'Kind of Blue',  artist: 'Miles Davis',   country: 'US', releaseYear: 1959, label: ['Columbia'] },
  { title: 'Blue Train',    artist: 'John Coltrane', country: 'US', releaseYear: 1958, label: ['Blue Note'] },
  { title: 'Giant Steps',   artist: 'John Coltrane', country: 'US', releaseYear: 1960, label: ['Atlantic'] },
];

const VINYLCAVE_RECORDS: RecordSeed[] = [
  { title: 'The Dark Side of the Moon', artist: 'Pink Floyd',   country: 'UK', releaseYear: 1973, label: ['Harvest'] },
  { title: 'Abbey Road',                artist: 'The Beatles',  country: 'UK', releaseYear: 1969, label: ['Apple'] },
  { title: 'Led Zeppelin IV',           artist: 'Led Zeppelin', country: 'UK', releaseYear: 1971, label: ['Atlantic'] },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Provision a tenant only if its slug does not already exist.
 *
 * When `SEED_ADMIN_PASSWORD` is set AND the tenant already exists, the admin
 * user's password is updated to match the env var so re-runs always converge
 * to a known, deterministic login credential (required for Task 15 E2E).
 *
 * Returns the tenantId and the password that was used/set.
 */
async function ensureTenant(
  input: ProvisionInput,
  ownerPool: Pool,
): Promise<{ tenantId: number; usedPassword: string }> {
  const db = drizzle(ownerPool, { schema });

  const existing = await db
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(eq(schema.tenants.slug, input.slug))
    .limit(1);

  const seedPassword = process.env['SEED_ADMIN_PASSWORD'];

  if (existing.length > 0 && existing[0]) {
    const tenantId = existing[0].id;
    console.log(`[seed] Tenant "${input.slug}" already exists (id=${tenantId}), skipping creation.`);

    if (seedPassword) {
      // Converge: update the admin password to the deterministic env var value.
      const newHash = await hashPassword(seedPassword);
      await db
        .update(schema.users)
        .set({ password: newHash })
        .where(
          and(
            eq(schema.users.tenantId, tenantId),
            eq(schema.users.role, 'admin'),
          ),
        );
      console.log(`[seed]   Updated admin password for "${input.slug}" to SEED_ADMIN_PASSWORD value.`);
      return { tenantId, usedPassword: seedPassword };
    }

    return { tenantId, usedPassword: '(not changed — SEED_ADMIN_PASSWORD not set)' };
  }

  // New tenant: provision with explicit password if provided.
  const result = await provisionTenant({
    ...input,
    password: seedPassword ?? undefined,
  });
  console.log(`[seed] Provisioned tenant "${input.slug}" (id=${result.tenantId}).`);
  return { tenantId: result.tenantId, usedPassword: result.temporaryPassword };
}

/**
 * Insert a sample record for a tenant if its dedup hash does not already exist
 * for that tenant.  Uses qr_owner (BYPASSRLS) with an explicit tenantId.
 */
async function ensureRecord(
  tenantId: number,
  rec: RecordSeed,
  ownerPool: Pool,
): Promise<void> {
  const db = drizzle(ownerPool, { schema });

  const hash = recordHash({
    title: rec.title,
    artist: rec.artist,
    country: rec.country,
    year: rec.releaseYear,
    label: rec.label,
  });

  const existing = await db
    .select({ id: schema.records.id })
    .from(schema.records)
    .where(
      and(
        eq(schema.records.hash, hash),
        eq(schema.records.tenantId, tenantId),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    console.log(`[seed]   Record "${rec.title}" already exists, skipping.`);
    return;
  }

  await db.insert(schema.records).values({
    tenantId,
    title: rec.title,
    artist: rec.artist,
    label: rec.label,
    country: rec.country,
    releaseYear: rec.releaseYear,
    format: 'LP',
    genre: [],
    hash,
    recordStatus: 'verfuegbar',
  });

  console.log(`[seed]   Inserted "${rec.title}" — ${rec.artist} (${rec.releaseYear}).`);
}

function printCredentials(tenant: ProvisionInput, password: string, protocol: string, rootDomain: string): void {
  console.log('[seed] ┌──────────────────────────────────────────────────────');
  console.log(`[seed] │  Tenant:   ${tenant.name} (${tenant.slug})`);
  console.log(`[seed] │  Email:    ${tenant.adminEmail}`);
  console.log(`[seed] │  Password: ${password}`);
  console.log(`[seed] │  URL:      ${protocol}://${tenant.slug}.${rootDomain}`);
  console.log('[seed] └──────────────────────────────────────────────────────');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const ownerUrl = process.env['DATABASE_OWNER_URL'];
  if (!ownerUrl) {
    throw new Error('[seed] DATABASE_OWNER_URL is not set. Check your .env file.');
  }

  const protocol = process.env['APP_PROTOCOL'] ?? 'http';
  const rootDomain = process.env['ROOT_DOMAIN'] ?? 'localhost';

  // Use a direct pool for seed queries (avoid importing @/db/client which pulls in env.ts).
  const ownerPool = new Pool({ connectionString: ownerUrl });

  try {
    console.log('[seed] Starting seed run...');

    // ── demo tenant ────────────────────────────────────────────────────────
    const { tenantId: demoId, usedPassword: demoPw } = await ensureTenant(DEMO_TENANT, ownerPool);
    printCredentials(DEMO_TENANT, demoPw, protocol, rootDomain);

    console.log(`[seed] Seeding records for "${DEMO_TENANT.slug}"...`);
    for (const rec of DEMO_RECORDS) {
      await ensureRecord(demoId, rec, ownerPool);
    }

    // ── vinylcave tenant ───────────────────────────────────────────────────
    const { tenantId: vinylId, usedPassword: vinylPw } = await ensureTenant(VINYLCAVE_TENANT, ownerPool);
    printCredentials(VINYLCAVE_TENANT, vinylPw, protocol, rootDomain);

    console.log(`[seed] Seeding records for "${VINYLCAVE_TENANT.slug}"...`);
    for (const rec of VINYLCAVE_RECORDS) {
      await ensureRecord(vinylId, rec, ownerPool);
    }

    console.log('[seed] Done. Safe to re-run (idempotent).');
  } finally {
    await ownerPool.end();
  }

  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('[seed] Fatal error:', err);
  process.exit(1);
});
