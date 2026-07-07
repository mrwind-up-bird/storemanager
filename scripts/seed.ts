// Must be first: loads .env into process.env before any src/* imports.
import 'dotenv/config';

import { fileURLToPath } from 'url';
import { and, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../src/db/schema';
import type { RecordStatus } from '../src/db/schema';
import { provisionTenant, type ProvisionInput, generateTempPassword } from '../src/lib/provisioning';
import { DEFAULT_PRIMARY_COLOR } from '../src/lib/branding';
import { recordHash, sha256Hex } from '../src/db/hash';
import { hashPassword } from '../src/lib/password';
import { getEmbeddingsAdapter } from '../src/lib/embeddings';
import { buildEmbeddingDocument } from '../src/lib/embeddings/document';
import { getEmailAdapter, sendCredentialsEmail } from '../src/lib/email';
import { encryptSecret } from '../src/lib/crypto';
import { createCollection } from '../src/lib/collections';
import type { AnkaufInput } from '../src/lib/ankauf';
import { UNLIMITED_ENTITLEMENTS } from '../src/lib/gating';

// ---------------------------------------------------------------------------
// Tenant definitions
// ---------------------------------------------------------------------------

const DEMO_TENANT: ProvisionInput = {
  slug: 'demo',
  name: 'Q-Records Demo',
  adminEmail: 'admin@demo.test',
  primaryColor: DEFAULT_PRIMARY_COLOR,
  plan: 'big',
};

const VINYLCAVE_TENANT: ProvisionInput = {
  slug: 'vinylcave',
  name: 'Vinyl Cave',
  adminEmail: 'admin@vinylcave.test',
  primaryColor: '#5B4FCF',
  plan: 'small',
};

// Dritter Seed-Tenant NUR für die Gating-E2E (Spec §8/§14): plan=free mit
// tenants.limits-Override {maxRecords: 2} — deterministisch kleines Limit.
// resetFreeshopGatingState() dreht E2E-Rückstände vor jedem Lauf zurück.
export const FREESHOP_TENANT: ProvisionInput = {
  slug: 'freeshop',
  name: 'Freeshop',
  adminEmail: 'admin@freeshop.test',
  primaryColor: DEFAULT_PRIMARY_COLOR,
  plan: 'free',
};

export const PLATFORM_ADMIN_EMAIL = 'platform@qrecords.test';

// ---------------------------------------------------------------------------
// Fake Discogs connection — DEMO tenant ONLY (Slice 2, C12)
// ---------------------------------------------------------------------------
//
// Seeded so E2E can exercise BOTH connection states:
//   • demo       → has a (fake) connection → /ankauf renders the search form.
//   • vinylcave  → NO connection           → /ankauf renders connect-discogs-prompt.
//
// The token/secret below are fabricated and used only with DISCOGS_DRIVER=fake
// (the fake adapter ignores the auth entirely). They are stored ENCRYPTED at rest
// (encryptSecret, AAD-bound to the tenant) and must NEVER reach any client payload.
// e2e/discogs.spec.ts scans the rendered /ankauf HTML + every search/suggestion
// network body for the EXACT DEMO_DISCOGS_FAKE_TOKEN string below — so keep these
// in sync with the copies in e2e/helpers.ts.
export const DEMO_DISCOGS_USERNAME = 'qrecords-demo-seller';
export const DEMO_DISCOGS_FAKE_TOKEN = 'e2e-fake-oauth-token-demo-DO-NOT-LEAK-7f3a9c';
export const DEMO_DISCOGS_FAKE_SECRET = 'e2e-fake-oauth-secret-demo-DO-NOT-LEAK-2b8e1d';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RecordSeed = {
  title: string;
  artist: string;
  country: string;
  releaseYear: number;
  label: string[];
  format?: string;
  genre?: string[];
};

/** A single physical copy to create for a record. recordIndex = 0-based index into the records array. */
export type PurchaseSpec = {
  recordIndex: number;
  ek: string;
  vk: string;
  status: RecordStatus;
  conditionRecord: number | null;
  conditionCover: number | null;
  soldPrice?: string;
  soldDate?: Date;
};

export type PermalinkSpec = {
  slug: string;
  filter: { title?: string; genre?: string[]; format?: string[] };
};

// ---------------------------------------------------------------------------
// Datasets — demo tenant (jazz catalogue)
// ---------------------------------------------------------------------------

export const DEMO_RECORDS: RecordSeed[] = [
  // 0 — existing
  { title: 'Kind of Blue',              artist: 'Miles Davis',                         country: 'US', releaseYear: 1959, label: ['Columbia'],   format: 'Vinyl',    genre: ['Jazz'] },
  // 1 — existing
  { title: 'Blue Train',                artist: 'John Coltrane',                       country: 'US', releaseYear: 1958, label: ['Blue Note'],  format: 'Vinyl',    genre: ['Jazz'] },
  // 2 — existing
  { title: 'Giant Steps',               artist: 'John Coltrane',                       country: 'US', releaseYear: 1960, label: ['Atlantic'],   format: 'Vinyl',    genre: ['Jazz'] },
  // 3–14 new
  { title: 'Bitches Brew',              artist: 'Miles Davis',                         country: 'US', releaseYear: 1970, label: ['Columbia'],   format: 'Vinyl',    genre: ['Jazz', 'Fusion'] },
  { title: 'Mingus Ah Um',              artist: 'Charles Mingus',                      country: 'US', releaseYear: 1959, label: ['Columbia'],   format: 'Vinyl',    genre: ['Jazz'] },
  { title: 'Head Hunters',              artist: 'Herbie Hancock',                      country: 'US', releaseYear: 1973, label: ['Columbia'],   format: 'Vinyl',    genre: ['Jazz', 'Funk'] },
  { title: 'A Love Supreme',            artist: 'John Coltrane',                       country: 'US', releaseYear: 1965, label: ['Impulse!'],   format: 'Vinyl',    genre: ['Jazz'] },
  { title: 'Maiden Voyage',             artist: 'Herbie Hancock',                      country: 'US', releaseYear: 1965, label: ['Blue Note'],  format: 'Vinyl',    genre: ['Jazz'] },
  { title: 'The Shape of Jazz to Come', artist: 'Ornette Coleman',                     country: 'US', releaseYear: 1959, label: ['Atlantic'],   format: 'Vinyl',    genre: ['Jazz', 'Avant-Garde'] },
  { title: 'Time Out',                  artist: 'Dave Brubeck',                        country: 'US', releaseYear: 1959, label: ['Columbia'],   format: 'CD',       genre: ['Jazz'] },
  { title: 'Waltz for Debby',           artist: 'Bill Evans',                          country: 'US', releaseYear: 1962, label: ['Riverside'],  format: 'CD',       genre: ['Jazz'] },
  { title: 'Saxophone Colossus',        artist: 'Sonny Rollins',                       country: 'US', releaseYear: 1956, label: ['Prestige'],   format: 'Vinyl',    genre: ['Jazz'] },
  { title: "Moanin'",                   artist: 'Art Blakey & The Jazz Messengers',    country: 'US', releaseYear: 1958, label: ['Blue Note'],  format: 'Vinyl',    genre: ['Jazz'] },
  { title: 'Sketches of Spain',         artist: 'Miles Davis',                         country: 'US', releaseYear: 1960, label: ['Columbia'],   format: 'Vinyl',    genre: ['Jazz'] },
  { title: 'Speak No Evil',             artist: 'Wayne Shorter',                       country: 'US', releaseYear: 1966, label: ['Blue Note'],  format: 'Kassette', genre: ['Jazz'] },
];

// 16 copies total for 15 records.
// Record index 8 gets 2 copies (verfuegbar + verkauft) — demonstrates multi-copy model.
// verfuegbar: 0,1,2,3,4,5,6,7,8(copy1),13,14  = 11
// verkauft:   8(copy2),9,10                     =  3
// verliehen:  11,12                              =  2
export const DEMO_PURCHASES: PurchaseSpec[] = [
  { recordIndex:  0, ek:  '8.00', vk: '24.90', status: 'verfuegbar', conditionRecord: 6, conditionCover: 6 },
  { recordIndex:  1, ek: '10.00', vk: '29.90', status: 'verfuegbar', conditionRecord: 7, conditionCover: 6 },
  { recordIndex:  2, ek:  '9.00', vk: '27.90', status: 'verfuegbar', conditionRecord: 6, conditionCover: 5 },
  { recordIndex:  3, ek: '12.00', vk: '34.90', status: 'verfuegbar', conditionRecord: 5, conditionCover: 5 },
  { recordIndex:  4, ek:  '7.00', vk: '19.90', status: 'verfuegbar', conditionRecord: 6, conditionCover: 6 },
  { recordIndex:  5, ek: '11.00', vk: '32.90', status: 'verfuegbar', conditionRecord: 7, conditionCover: 7 },
  { recordIndex:  6, ek: '15.00', vk: '44.90', status: 'verfuegbar', conditionRecord: 6, conditionCover: 5 },
  { recordIndex:  7, ek: '13.00', vk: '38.90', status: 'verfuegbar', conditionRecord: 5, conditionCover: 4 },
  // Two copies of record 8 — the verfuegbar one stays in-stock, the verkauft one is already gone.
  { recordIndex:  8, ek:  '9.00', vk: '25.90', status: 'verfuegbar', conditionRecord: 6, conditionCover: 6 },
  { recordIndex:  8, ek:  '6.00', vk: '18.90', status: 'verkauft',   conditionRecord: 4, conditionCover: 3, soldPrice: '18.90', soldDate: new Date('2026-05-14') },
  { recordIndex:  9, ek:  '6.00', vk: '16.90', status: 'verkauft',   conditionRecord: 5, conditionCover: 5, soldPrice: '16.90', soldDate: new Date('2026-06-01') },
  { recordIndex: 10, ek:  '5.00', vk: '14.90', status: 'verkauft',   conditionRecord: 6, conditionCover: 5, soldPrice: '14.00', soldDate: new Date('2026-06-10') },
  { recordIndex: 11, ek:  '8.00', vk: '22.90', status: 'verliehen',  conditionRecord: 6, conditionCover: 6 },
  { recordIndex: 12, ek:  '7.00', vk: '18.90', status: 'verliehen',  conditionRecord: 5, conditionCover: 5 },
  { recordIndex: 13, ek: '10.00', vk: '28.90', status: 'verfuegbar', conditionRecord: 7, conditionCover: 6 },
  { recordIndex: 14, ek:  '4.00', vk:  '9.90', status: 'verfuegbar', conditionRecord: 4, conditionCover: 3 },
];

export const DEMO_PERMALINKS: PermalinkSpec[] = [
  { slug: 'jazz', filter: { genre: ['Jazz'] } },
  { slug: 'neu',  filter: {} },
];

// ── Slice 3: POS quick items + a matching open wishlist (demo tenant) ────────
// Non-inventory catalogue buttons for the Kasse screen.
// `category` (Slice 4) buckets quick items for the analytics breakdown: Kaffee/Wasser/
// Getränk-like items → 'Getränke', everything else → 'Sonstiges'.
export const DEMO_QUICK_ITEMS: { name: string; price: string; category: string }[] = [
  { name: 'Kaffee',        price: '2.50', category: 'Getränke'  },
  { name: 'Plattentasche', price: '1.00', category: 'Sonstiges' },
];

// ── Slice 4: batch-Ankauf demo collection (staff-only Sammlungen screen) ─────
// Seller "Nachlass Beispiel" — deliberately distinct artists/titles from DEMO_RECORDS
// so the two datasets never collide. One item carries a real discogsId (exercises the
// label-QR path), one is discogsId: null (exercises the no-QR fallback) — good demo
// data for the batch label print.
export const DEMO_COLLECTION: { sellerName: string; items: AnkaufInput[] } = {
  sellerName: 'Nachlass Beispiel',
  items: [
    {
      release: {
        discogsId: 249531,
        title: 'Chet Baker Sings',
        artist: 'Chet Baker',
        country: 'US',
        year: 1956,
        format: 'Vinyl',
        genre: ['Jazz'],
        label: ['Pacific Jazz'],
        coverImage: null,
      },
      purchasePrice: '9.00',
      targetPrice: '26.90',
      conditionRecord: 6,
      conditionCover: 5,
      listOnDiscogs: false,
    },
    {
      release: {
        discogsId: null,
        title: 'Go',
        artist: 'Dexter Gordon',
        country: 'US',
        year: 1962,
        format: 'Vinyl',
        genre: ['Jazz'],
        label: ['Blue Note'],
        coverImage: null,
      },
      purchasePrice: '8.00',
      targetPrice: '24.90',
      conditionRecord: 5,
      conditionCover: 5,
      listOnDiscogs: false,
    },
    {
      release: {
        discogsId: 305214,
        title: 'Getz/Gilberto',
        artist: 'Stan Getz',
        country: 'US',
        year: 1964,
        format: 'Vinyl',
        genre: ['Jazz', 'Bossa Nova'],
        label: ['Verve'],
        coverImage: null,
      },
      purchasePrice: '11.00',
      targetPrice: '32.90',
      conditionRecord: 6,
      conditionCover: 6,
      listOnDiscogs: false,
    },
  ],
};

// ≥1 OPEN wishlist whose `artist` matches a DEMO_RECORDS entry ('Miles Davis' → Kind of Blue /
// Bitches Brew / Sketches of Spain), so a matching Ankauf in the E2E flow (T14) produces a
// pending wishlist_matches row.
export const DEMO_WISHLISTS: {
  customerName: string;
  customerEmail: string;
  artist: string;
  label?: string | null;
  title?: string | null;
  country?: string | null;
}[] = [
  { customerName: 'Klaus Wunsch', customerEmail: 'klaus.wunsch@example.test', artist: 'Miles Davis' },
];

// ---------------------------------------------------------------------------
// Datasets — vinylcave tenant (rock/electronic catalogue)
// ---------------------------------------------------------------------------

export const VINYLCAVE_RECORDS: RecordSeed[] = [
  // 0 — existing
  { title: 'The Dark Side of the Moon', artist: 'Pink Floyd',    country: 'UK', releaseYear: 1973, label: ['Harvest'],      format: 'Vinyl',    genre: ['Rock', 'Progressive Rock'] },
  // 1 — existing
  { title: 'Abbey Road',                artist: 'The Beatles',   country: 'UK', releaseYear: 1969, label: ['Apple'],         format: 'Vinyl',    genre: ['Rock'] },
  // 2 — existing
  { title: 'Led Zeppelin IV',           artist: 'Led Zeppelin',  country: 'UK', releaseYear: 1971, label: ['Atlantic'],      format: 'Vinyl',    genre: ['Rock', 'Hard Rock'] },
  // 3–14 new
  { title: 'Unknown Pleasures',         artist: 'Joy Division',  country: 'UK', releaseYear: 1979, label: ['Factory'],       format: 'Vinyl',    genre: ['Post-Punk'] },
  { title: 'Remain in Light',           artist: 'Talking Heads', country: 'US', releaseYear: 1980, label: ['Sire'],          format: 'Vinyl',    genre: ['New Wave', 'Post-Punk'] },
  { title: 'Violator',                  artist: 'Depeche Mode',  country: 'UK', releaseYear: 1990, label: ['Mute'],          format: 'Vinyl',    genre: ['Electronic', 'Synth-Pop'] },
  { title: 'OK Computer',               artist: 'Radiohead',     country: 'UK', releaseYear: 1997, label: ['Parlophone'],    format: 'CD',       genre: ['Alternative', 'Rock'] },
  { title: 'The Queen Is Dead',         artist: 'The Smiths',    country: 'UK', releaseYear: 1986, label: ['Rough Trade'],   format: 'Vinyl',    genre: ['Alternative', 'Indie'] },
  { title: 'Power, Corruption & Lies',  artist: 'New Order',     country: 'UK', releaseYear: 1983, label: ['Factory'],       format: 'Vinyl',    genre: ['Electronic', 'Post-Punk'] },
  { title: 'Never Mind the Bollocks',   artist: 'Sex Pistols',   country: 'UK', releaseYear: 1977, label: ['Virgin'],        format: 'Vinyl',    genre: ['Punk'] },
  { title: 'The Joshua Tree',           artist: 'U2',            country: 'IE', releaseYear: 1987, label: ['Island'],        format: 'CD',       genre: ['Rock', 'Alternative'] },
  { title: 'Pornography',               artist: 'The Cure',      country: 'UK', releaseYear: 1982, label: ['Fiction'],       format: 'Vinyl',    genre: ['Post-Punk', 'Gothic Rock'] },
  { title: 'Closer',                    artist: 'Joy Division',  country: 'UK', releaseYear: 1980, label: ['Factory'],       format: 'Vinyl',    genre: ['Post-Punk'] },
  { title: 'Music for the Masses',      artist: 'Depeche Mode',  country: 'UK', releaseYear: 1987, label: ['Mute'],          format: 'Vinyl',    genre: ['Electronic', 'Synth-Pop'] },
  { title: 'Blue Monday',               artist: 'New Order',     country: 'UK', releaseYear: 1983, label: ['Factory'],       format: 'Kassette', genre: ['Electronic'] },
];

// 16 copies total for 15 records.
// Record index 5 (Violator) gets 2 copies — demonstrates multi-copy model for vinylcave.
// verfuegbar: 0,1,2,3,4,5(copy1),6,7,12,13,14 = 11
// verkauft:   5(copy2),8,9                      =  3
// verliehen:  10,11                              =  2
export const VINYLCAVE_PURCHASES: PurchaseSpec[] = [
  { recordIndex:  0, ek: '15.00', vk: '45.90', status: 'verfuegbar', conditionRecord: 6, conditionCover: 6 },
  { recordIndex:  1, ek: '12.00', vk: '39.90', status: 'verfuegbar', conditionRecord: 7, conditionCover: 6 },
  { recordIndex:  2, ek: '14.00', vk: '42.90', status: 'verfuegbar', conditionRecord: 5, conditionCover: 5 },
  { recordIndex:  3, ek:  '8.00', vk: '24.90', status: 'verfuegbar', conditionRecord: 6, conditionCover: 5 },
  { recordIndex:  4, ek: '10.00', vk: '29.90', status: 'verfuegbar', conditionRecord: 5, conditionCover: 5 },
  // Two copies of Violator — one in stock, one sold.
  { recordIndex:  5, ek: '11.00', vk: '34.90', status: 'verfuegbar', conditionRecord: 7, conditionCover: 6 },
  { recordIndex:  5, ek:  '8.00', vk: '24.90', status: 'verkauft',   conditionRecord: 5, conditionCover: 4, soldPrice: '24.90', soldDate: new Date('2026-05-20') },
  { recordIndex:  6, ek:  '7.00', vk: '19.90', status: 'verfuegbar', conditionRecord: 6, conditionCover: 6 },
  { recordIndex:  7, ek:  '9.00', vk: '27.90', status: 'verfuegbar', conditionRecord: 6, conditionCover: 5 },
  { recordIndex:  8, ek:  '8.00', vk: '22.90', status: 'verkauft',   conditionRecord: 5, conditionCover: 5, soldPrice: '22.90', soldDate: new Date('2026-06-03') },
  { recordIndex:  9, ek:  '7.00', vk: '19.90', status: 'verkauft',   conditionRecord: 4, conditionCover: 4, soldPrice: '18.00', soldDate: new Date('2026-06-15') },
  { recordIndex: 10, ek:  '6.00', vk: '16.90', status: 'verliehen',  conditionRecord: 6, conditionCover: 6 },
  { recordIndex: 11, ek:  '9.00', vk: '26.90', status: 'verliehen',  conditionRecord: 5, conditionCover: 4 },
  { recordIndex: 12, ek:  '8.00', vk: '23.90', status: 'verfuegbar', conditionRecord: 6, conditionCover: 6 },
  { recordIndex: 13, ek: '10.00', vk: '29.90', status: 'verfuegbar', conditionRecord: 5, conditionCover: 5 },
  { recordIndex: 14, ek:  '3.00', vk:  '8.90', status: 'verfuegbar', conditionRecord: 4, conditionCover: 3 },
];

export const VINYLCAVE_PERMALINKS: PermalinkSpec[] = [
  { slug: 'vinyl', filter: { format: ['Vinyl'] } },
  { slug: 'neu',   filter: {} },
];

// ---------------------------------------------------------------------------
// Datasets — freeshop tenant (Gating-Baseline: GENAU 1 Platte, Limit-Override 2)
// ---------------------------------------------------------------------------

export const FREESHOP_RECORDS: RecordSeed[] = [
  { title: 'Nevermind', artist: 'Nirvana', country: 'US', releaseYear: 1991, label: ['DGC'], format: 'Vinyl', genre: ['Grunge'] },
];

export const FREESHOP_PURCHASES: PurchaseSpec[] = [
  { recordIndex: 0, ek: '5.00', vk: '19.90', status: 'verfuegbar', conditionRecord: 5, conditionCover: 5 },
];

export const FREESHOP_PERMALINKS: PermalinkSpec[] = []; // provisionTenant legt 'lager' an — reicht.

// ---------------------------------------------------------------------------
// Internal helpers (not exported — use seedTenantInventory from tests)
// ---------------------------------------------------------------------------

async function ensureTenant(
  input: ProvisionInput,
  ownerPool: Pool,
): Promise<{ tenantId: number; usedPassword: string | null }> {
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
      const newHash = await hashPassword(seedPassword);
      await db
        .update(schema.users)
        .set({ password: newHash })
        .where(and(eq(schema.users.tenantId, tenantId), eq(schema.users.role, 'admin')));
      console.log(`[seed]   Updated admin password for "${input.slug}" to SEED_ADMIN_PASSWORD value.`);
      return { tenantId, usedPassword: seedPassword };
    }

    return { tenantId, usedPassword: null };
  }

  const result = await provisionTenant({ ...input, password: seedPassword ?? undefined });
  console.log(`[seed] Provisioned tenant "${input.slug}" (id=${result.tenantId}).`);
  return { tenantId: result.tenantId, usedPassword: result.temporaryPassword };
}

/**
 * Idempotent record insert. Returns the record's id (existing or newly inserted).
 */
async function ensureRecord(
  tenantId: number,
  rec: RecordSeed,
  ownerPool: Pool,
): Promise<number> {
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
    .where(and(eq(schema.records.hash, hash), eq(schema.records.tenantId, tenantId)))
    .limit(1);

  if (existing.length > 0 && existing[0]) {
    console.log(`[seed]   Record "${rec.title}" already exists, skipping.`);
    return existing[0].id;
  }

  const [inserted] = await db
    .insert(schema.records)
    .values({
      tenantId,
      title: rec.title,
      artist: rec.artist,
      label: rec.label,
      country: rec.country,
      releaseYear: rec.releaseYear,
      format: rec.format ?? 'Vinyl',
      genre: rec.genre ?? [],
      hash,
    })
    .returning({ id: schema.records.id });

  console.log(`[seed]   Inserted "${rec.title}" — ${rec.artist} (${rec.releaseYear}).`);

  const recordId = inserted!.id;
  // KI-Suche (Slice 7): Embedding inline berechnen (Dev/CI = fake, deterministisch), damit die
  // KI-Suche in E2E ohne laufenden Worker sofort Daten hat. Idempotent über content_hash.
  const doc = buildEmbeddingDocument({
    artist: rec.artist, title: rec.title, label: rec.label, genre: rec.genre ?? [],
    format: rec.format ?? 'Vinyl', releaseYear: rec.releaseYear, country: rec.country,
  });
  const [vec] = await getEmbeddingsAdapter().embed([doc]);
  const literal = `[${vec!.join(',')}]`;
  await db.execute(sql`
    INSERT INTO record_embeddings (tenant_id, record_id, embedding, content_hash, model)
    VALUES (${tenantId}, ${recordId}, ${literal}::vector(1536), ${sha256Hex(doc)}, ${getEmbeddingsAdapter().model})
    ON CONFLICT (tenant_id, record_id) DO UPDATE
      SET embedding = EXCLUDED.embedding, content_hash = EXCLUDED.content_hash, model = EXCLUDED.model, updated_at = now()
  `);
  return recordId;
}

// ---------------------------------------------------------------------------
// Exported helpers
// ---------------------------------------------------------------------------

/**
 * Idempotent purchase (copy) insert. Skip if a row already exists with the
 * same (tenantId, recordId, purchasePrice, status) — sufficient uniqueness for
 * the deterministic seed dataset.
 */
export async function ensurePurchase(
  ownerPool: Pool,
  input: {
    tenantId: number;
    recordId: number;
    ek: string;
    vk: string;
    status: RecordStatus;
    conditionRecord: number | null;
    conditionCover: number | null;
    soldPrice?: string;
    soldDate?: Date;
  },
): Promise<void> {
  const db = drizzle(ownerPool, { schema });

  const existing = await db
    .select({ id: schema.purchases.id })
    .from(schema.purchases)
    .where(
      and(
        eq(schema.purchases.tenantId, input.tenantId),
        eq(schema.purchases.recordId, input.recordId),
        eq(schema.purchases.purchasePrice, input.ek),
        eq(schema.purchases.status, input.status),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    return; // already seeded
  }

  await db.insert(schema.purchases).values({
    tenantId: input.tenantId,
    recordId: input.recordId,
    purchasePrice: input.ek,
    targetPrice: input.vk,
    status: input.status,
    conditionRecord: input.conditionRecord,
    conditionCover: input.conditionCover,
    soldPrice: input.soldPrice ?? null,
    soldDate: input.soldDate ?? null,
  });

  console.log(`[seed]   Purchase for record ${input.recordId} (${input.status}) created.`);
}

/**
 * Idempotent permalink insert. Skip if (tenantId, slug) already exists.
 */
export async function ensurePermalink(
  ownerPool: Pool,
  input: {
    tenantId: number;
    slug: string;
    filter: PermalinkSpec['filter'];
  },
): Promise<void> {
  const db = drizzle(ownerPool, { schema });

  const existing = await db
    .select({ id: schema.permalinks.id })
    .from(schema.permalinks)
    .where(and(eq(schema.permalinks.tenantId, input.tenantId), eq(schema.permalinks.slug, input.slug)))
    .limit(1);

  if (existing.length > 0) {
    return; // already seeded
  }

  await db.insert(schema.permalinks).values({
    tenantId: input.tenantId,
    slug: input.slug,
    filter: input.filter,
  });

  console.log(`[seed]   Permalink "/${input.slug}" created.`);
}

/**
 * Idempotent Discogs connection insert (Slice 2, C12).
 *
 * Skips if a row already exists for the tenant (discogs_connections has a
 * UNIQUE(tenant_id) constraint). The OAuth token + token-secret are encrypted at
 * rest via encryptSecret(x, { tenantId }) — AAD-bound to the tenant, so the
 * ciphertext cannot be moved to another tenant.
 *
 * Exported so integration tests can seed a connection with a testcontainer ownerPool.
 */
export async function ensureDiscogsConnection(
  ownerPool: Pool,
  input: { tenantId: number; discogsUsername: string; token: string; tokenSecret: string },
): Promise<void> {
  const db = drizzle(ownerPool, { schema });

  const existing = await db
    .select({ id: schema.discogsConnections.id })
    .from(schema.discogsConnections)
    .where(eq(schema.discogsConnections.tenantId, input.tenantId))
    .limit(1);

  if (existing.length > 0) {
    console.log(
      `[seed]   Discogs connection for tenant ${input.tenantId} already exists, skipping.`,
    );
    return;
  }

  await db.insert(schema.discogsConnections).values({
    tenantId: input.tenantId,
    discogsUsername: input.discogsUsername,
    oauthToken: encryptSecret(input.token, { tenantId: input.tenantId }),
    oauthTokenSecret: encryptSecret(input.tokenSecret, { tenantId: input.tenantId }),
    connectedByUserId: null,
  });

  console.log(
    `[seed]   Discogs connection for "${input.discogsUsername}" (tenant ${input.tenantId}) created.`,
  );
}

/**
 * Idempotenter Platform-User (Spec §5). Passwort: SEED_ADMIN_PASSWORD, sonst generiert
 * (einmalig geloggt — Muster wie printCredentials). Re-Seed setzt das Passwort neu,
 * wenn SEED_ADMIN_PASSWORD gesetzt ist (wie ensureTenant für Tenant-Admins).
 */
export async function ensurePlatformUser(
  ownerPool: Pool,
  email: string,
  password: string | undefined,
): Promise<void> {
  const db = drizzle(ownerPool, { schema });

  const existing = await db
    .select({ id: schema.platformUsers.id })
    .from(schema.platformUsers)
    .where(eq(schema.platformUsers.email, email))
    .limit(1);

  if (existing.length > 0 && existing[0]) {
    if (password) {
      await db
        .update(schema.platformUsers)
        .set({ password: await hashPassword(password), updatedAt: new Date() })
        .where(eq(schema.platformUsers.id, existing[0].id));
      console.log(`[seed]   Platform-User "${email}" Passwort aktualisiert.`);
    }
    return;
  }

  const effective = password ?? generateTempPassword();
  await db.insert(schema.platformUsers).values({ email, password: await hashPassword(effective) });
  console.log(`[seed]   Platform-User "${email}" angelegt${password ? '' : ` — temporäres Passwort: ${effective}`}.`);
}

/**
 * Seed-Tenants sind fertig konfiguriert: Wizard nie zeigen, Passwortzwang aus (Spec §8) —
 * sonst laufen die bestehenden E2E-Logins in Passwort-/Wizard-Redirects.
 */
export async function markTenantOnboarded(ownerPool: Pool, tenantId: number): Promise<void> {
  const db = drizzle(ownerPool, { schema });
  await db
    .update(schema.tenants)
    .set({ onboardingCompletedAt: new Date() })
    .where(and(eq(schema.tenants.id, tenantId), isNull(schema.tenants.onboardingCompletedAt)));
  await db
    .update(schema.users)
    .set({ mustChangePassword: false })
    .where(eq(schema.users.tenantId, tenantId));
}

/**
 * Freeshop-Reset (Reset-Muster wie ensureWishlist, Slice 3): Die Upgrade-E2E (Szenario 4)
 * hinterlässt plan='small' + eine subscriptions-Zeile, die Gating-E2E (Szenario 3) zusätzliche
 * records/purchases/collections. Alles zurückdrehen, damit jeder Lauf deterministisch startet.
 * freeshop verkauft in keinem E2E (sonst FK transaction_items → purchases beachten).
 */
export async function resetFreeshopGatingState(ownerPool: Pool, tenantId: number): Promise<void> {
  const db = drizzle(ownerPool, { schema });

  await db
    .update(schema.tenants)
    .set({ plan: 'free', limits: { maxRecords: 2 }, updatedAt: new Date() })
    .where(eq(schema.tenants.id, tenantId));
  await db.delete(schema.subscriptions).where(eq(schema.subscriptions.tenantId, tenantId));

  // Nicht-Seed-Bestände löschen: purchases → collections → records (FK-Reihenfolge).
  const keepHashes = FREESHOP_RECORDS.map((r) =>
    recordHash({ title: r.title, artist: r.artist, country: r.country, year: r.releaseYear, label: r.label }),
  );
  const stale = await db
    .select({ id: schema.records.id })
    .from(schema.records)
    .where(and(eq(schema.records.tenantId, tenantId), notInArray(schema.records.hash, keepHashes)));
  const staleIds = stale.map((r) => r.id);
  if (staleIds.length > 0) {
    await db
      .delete(schema.purchases)
      .where(and(eq(schema.purchases.tenantId, tenantId), inArray(schema.purchases.recordId, staleIds)));
  }
  await db.delete(schema.collections).where(eq(schema.collections.tenantId, tenantId));
  if (staleIds.length > 0) {
    await db
      .delete(schema.records)
      .where(and(eq(schema.records.tenantId, tenantId), inArray(schema.records.id, staleIds)));
  }
}

/**
 * Seeds records, purchases, and permalinks for a tenant.
 * Exported so integration tests can call it directly with a testcontainer ownerPool.
 */
export async function seedTenantInventory(
  ownerPool: Pool,
  tenantId: number,
  records: RecordSeed[],
  purchases: PurchaseSpec[],
  permalinks: PermalinkSpec[],
): Promise<void> {
  const recordIds: number[] = [];
  for (const rec of records) {
    const id = await ensureRecord(tenantId, rec, ownerPool);
    recordIds.push(id);
  }

  for (const spec of purchases) {
    const recordId = recordIds[spec.recordIndex];
    if (recordId === undefined) {
      throw new Error(`[seed] Invalid recordIndex ${spec.recordIndex} (records.length=${records.length})`);
    }
    await ensurePurchase(ownerPool, {
      tenantId,
      recordId,
      ek: spec.ek,
      vk: spec.vk,
      status: spec.status,
      conditionRecord: spec.conditionRecord,
      conditionCover: spec.conditionCover,
      soldPrice: spec.soldPrice,
      soldDate: spec.soldDate,
    });
  }

  for (const pl of permalinks) {
    await ensurePermalink(ownerPool, { tenantId, slug: pl.slug, filter: pl.filter });
  }
}

/**
 * Idempotent-STATE quick-item insert. Skip-insert if (tenantId, name) already exists, but
 * ALWAYS (re-)apply the category (Slice 4). A row seeded before Slice 4 has category = NULL;
 * a plain skip-if-exists guard would leave it NULL forever, so re-seeding UPDATEs it instead.
 * Seeded items are active (default) so they render as Kasse buttons.
 */
export async function ensureQuickItem(
  ownerPool: Pool,
  input: { tenantId: number; name: string; price: string; category: string },
): Promise<void> {
  const db = drizzle(ownerPool, { schema });

  const existing = await db
    .select({ id: schema.quickItems.id })
    .from(schema.quickItems)
    .where(and(eq(schema.quickItems.tenantId, input.tenantId), eq(schema.quickItems.name, input.name)))
    .limit(1);

  if (existing.length > 0 && existing[0]) {
    await db
      .update(schema.quickItems)
      .set({ category: input.category })
      .where(eq(schema.quickItems.id, existing[0].id));
    return;
  }

  await db.insert(schema.quickItems).values({
    tenantId: input.tenantId,
    name: input.name,
    price: input.price,
    category: input.category,
  });

  console.log(`[seed]   Quick item "${input.name}" (€${input.price}, ${input.category}) created.`);
}

/**
 * Idempotent wishlist insert. Skip if (tenantId, customerEmail, artist) already exists.
 * Inserts with the default status 'open'. createdByUserId must be a real users.id of the tenant.
 */
export async function ensureWishlist(
  ownerPool: Pool,
  input: {
    tenantId: number;
    createdByUserId: number;
    customerName: string;
    customerEmail: string;
    artist: string;
    label?: string | null;
    title?: string | null;
    country?: string | null;
  },
): Promise<void> {
  const db = drizzle(ownerPool, { schema });

  const existing = await db
    .select({ id: schema.wishlists.id })
    .from(schema.wishlists)
    .where(
      and(
        eq(schema.wishlists.tenantId, input.tenantId),
        eq(schema.wishlists.customerEmail, input.customerEmail),
        eq(schema.wishlists.artist, input.artist),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    // Reset to 'open' so repeated E2E runs can re-exercise the full match→notify
    // flow. Also purge any stale 'pending' matches from aborted prior runs so the
    // next Ankauf gets a clean match slot.
    await db
      .update(schema.wishlists)
      .set({ status: 'open' })
      .where(eq(schema.wishlists.id, existing[0]!.id));
    await db
      .delete(schema.wishlistMatches)
      .where(
        and(
          eq(schema.wishlistMatches.wishlistId, existing[0]!.id),
          eq(schema.wishlistMatches.status, 'pending'),
        ),
      );
    return;
  }

  await db.insert(schema.wishlists).values({
    tenantId: input.tenantId,
    createdByUserId: input.createdByUserId,
    customerName: input.customerName,
    customerEmail: input.customerEmail,
    artist: input.artist,
    label: input.label ?? null,
    title: input.title ?? null,
    country: input.country ?? null,
  });

  console.log(`[seed]   Wishlist for "${input.customerName}" (artist=${input.artist}) created.`);
}

/**
 * Resolves the tenant's admin user id (wishlists.createdByUserId is NOT NULL → needs a real user).
 */
async function tenantAdminUserId(tenantId: number, ownerPool: Pool): Promise<number> {
  const db = drizzle(ownerPool, { schema });
  const rows = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(eq(schema.users.tenantId, tenantId), eq(schema.users.role, 'admin')))
    .limit(1);
  if (!rows[0]) {
    throw new Error(`[seed] no admin user found for tenant ${tenantId} (cannot set wishlists.createdByUserId)`);
  }
  return rows[0].id;
}

/**
 * Seeds quick items + wishlists for a tenant. Wishlists are attributed to the tenant's admin user.
 * Exported so integration tests can call it directly with a testcontainer ownerPool.
 */
export async function seedTenantSales(
  ownerPool: Pool,
  tenantId: number,
  quickItems: { name: string; price: string; category: string }[],
  wishlists: {
    customerName: string;
    customerEmail: string;
    artist: string;
    label?: string | null;
    title?: string | null;
    country?: string | null;
  }[],
): Promise<void> {
  for (const qi of quickItems) {
    await ensureQuickItem(ownerPool, { tenantId, name: qi.name, price: qi.price, category: qi.category });
  }
  if (wishlists.length > 0) {
    const createdByUserId = await tenantAdminUserId(tenantId, ownerPool);
    for (const wl of wishlists) {
      await ensureWishlist(ownerPool, { tenantId, createdByUserId, ...wl });
    }
  }
}

/**
 * Idempotent (skip-if-exists) demo-collection insert (Slice 4). Unlike ensureQuickItem,
 * collections have no state machine to backfill — skip-if-exists is the correct guard here.
 * Goes through createCollection (the real service: ONE tx, insert collection + acquireOne per
 * item) so the Sammlungen screen + Ankäufe/Sammlungen KPI + batch label print all get
 * representative data. createCollection does NOT enqueue jobs by design, so seeding has no job
 * side effects.
 */
export async function ensureDemoCollection(
  ownerPool: Pool,
  tenantId: number,
  adminUserId: number,
  input: { sellerName: string; items: AnkaufInput[] },
): Promise<void> {
  const db = drizzle(ownerPool, { schema });

  const existing = await db
    .select({ id: schema.collections.id })
    .from(schema.collections)
    .where(and(eq(schema.collections.tenantId, tenantId), eq(schema.collections.sellerName, input.sellerName)))
    .limit(1);

  if (existing.length > 0) {
    console.log(`[seed]   Collection "${input.sellerName}" already exists, skipping.`);
    return;
  }

  const { collectionId, purchaseIds } = await createCollection(
    { tenantId, userId: adminUserId },
    { sellerName: input.sellerName, items: input.items },
    // Vertrauenswürdiger Fixture-Pfad — Request-Pfade laden IMMER getEntitlements (Spec §10).
    UNLIMITED_ENTITLEMENTS,
  );

  console.log(
    `[seed]   Collection "${input.sellerName}" (id=${collectionId}) created with ${purchaseIds.length} items.`,
  );
}

/**
 * Seeds ONE demo collection for a tenant, attributed to the tenant's admin user (mirrors
 * seedTenantSales' wishlist attribution). Exported so integration tests can call it directly
 * with a testcontainer ownerPool.
 */
export async function seedTenantCollections(
  ownerPool: Pool,
  tenantId: number,
  collection: { sellerName: string; items: AnkaufInput[] },
): Promise<void> {
  const adminUserId = await tenantAdminUserId(tenantId, ownerPool);
  await ensureDemoCollection(ownerPool, tenantId, adminUserId, collection);
}

// ---------------------------------------------------------------------------
// CLI helpers (unchanged from Slice 0 except loginUrlFor / printCredentials)
// ---------------------------------------------------------------------------

function loginUrlFor(slug: string, protocol: string, rootDomain: string): string {
  const port = process.env['APP_PORT'] ?? '3000';
  const isDefault = (protocol === 'https' && port === '443') || (protocol === 'http' && port === '80');
  const portPart = isDefault ? '' : `:${port}`;
  return `${protocol}://${slug}.${rootDomain}${portPart}/login`;
}

async function sendCredentialMail(
  tenant: ProvisionInput,
  password: string | null,
  protocol: string,
  rootDomain: string,
): Promise<void> {
  if (password === null) return;
  try {
    await sendCredentialsEmail(getEmailAdapter(), {
      to: tenant.adminEmail,
      tenantName: tenant.name,
      loginUrl: loginUrlFor(tenant.slug, protocol, rootDomain),
      temporaryPassword: password,
    });
    console.log(`[seed]   Credential mail dispatched to ${tenant.adminEmail} (${process.env['MAIL_DRIVER'] ?? 'console'}).`);
  } catch (err) {
    console.warn(`[seed]   WARN: credential mail to ${tenant.adminEmail} failed (non-fatal):`, err instanceof Error ? err.message : err);
  }
}

function printCredentials(tenant: ProvisionInput, password: string | null, protocol: string, rootDomain: string): void {
  console.log('[seed] ┌──────────────────────────────────────────────────────');
  console.log(`[seed] │  Tenant:   ${tenant.name} (${tenant.slug})`);
  console.log(`[seed] │  Email:    ${tenant.adminEmail}`);
  if (password !== null) {
    console.log(`[seed] │  Password: ${password}`);
  } else {
    console.log(`[seed] │  [skipped — password unchanged, SEED_ADMIN_PASSWORD not set]`);
  }
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

  const protocol   = process.env['APP_PROTOCOL'] ?? 'http';
  const rootDomain = process.env['ROOT_DOMAIN']  ?? 'localhost';

  const ownerPool = new Pool({ connectionString: ownerUrl });

  try {
    console.log('[seed] Starting seed run...');

    // ── demo tenant ────────────────────────────────────────────────────────
    const { tenantId: demoId, usedPassword: demoPw } = await ensureTenant(DEMO_TENANT, ownerPool);
    printCredentials(DEMO_TENANT, demoPw, protocol, rootDomain);
    await sendCredentialMail(DEMO_TENANT, demoPw, protocol, rootDomain);

    console.log(`[seed] Seeding inventory for "${DEMO_TENANT.slug}"...`);
    await seedTenantInventory(ownerPool, demoId, DEMO_RECORDS, DEMO_PURCHASES, DEMO_PERMALINKS);

    // Fake Discogs connection — DEMO tenant ONLY (vinylcave stays unconnected, C12).
    console.log(`[seed] Seeding fake Discogs connection for "${DEMO_TENANT.slug}"...`);
    await ensureDiscogsConnection(ownerPool, {
      tenantId: demoId,
      discogsUsername: DEMO_DISCOGS_USERNAME,
      token: DEMO_DISCOGS_FAKE_TOKEN,
      tokenSecret: DEMO_DISCOGS_FAKE_SECRET,
    });

    // POS quick items + a matching open wishlist — DEMO tenant ONLY (drives the Slice-3 E2E flow).
    console.log(`[seed] Seeding quick items + wishlists for "${DEMO_TENANT.slug}"...`);
    await seedTenantSales(ownerPool, demoId, DEMO_QUICK_ITEMS, DEMO_WISHLISTS);

    // ONE demo collection (batch Ankauf) — DEMO tenant ONLY (drives the Slice-4 Sammlungen
    // screen + Ankäufe/Sammlungen KPI + batch label print).
    console.log(`[seed] Seeding demo collection for "${DEMO_TENANT.slug}"...`);
    await seedTenantCollections(ownerPool, demoId, DEMO_COLLECTION);

    // Plan-Konvergenz auch für BESTEHENDE Tenants: ensureTenant() überspringt existierende
    // Tenants komplett — der Spec-§8-Plan-Flip (demo → 'big') würde in Umgebungen mit
    // persistentem Compose-Volume (Seed lief vor Slice 6 mit plan='free') sonst nie ankommen
    // und die 59 Bestands-E2E (Analytik/Discogs-Gates) scheitern. Unconditional wie
    // resetFreeshopGatingState/markTenantOnboarded.
    await ownerPool.query(`UPDATE tenants SET plan = $1 WHERE id = $2`, [DEMO_TENANT.plan, demoId]);
    await markTenantOnboarded(ownerPool, demoId);

    // ── vinylcave tenant ───────────────────────────────────────────────────
    const { tenantId: vinylId, usedPassword: vinylPw } = await ensureTenant(VINYLCAVE_TENANT, ownerPool);
    printCredentials(VINYLCAVE_TENANT, vinylPw, protocol, rootDomain);
    await sendCredentialMail(VINYLCAVE_TENANT, vinylPw, protocol, rootDomain);

    console.log(`[seed] Seeding inventory for "${VINYLCAVE_TENANT.slug}"...`);
    await seedTenantInventory(ownerPool, vinylId, VINYLCAVE_RECORDS, VINYLCAVE_PURCHASES, VINYLCAVE_PERMALINKS);

    await ownerPool.query(`UPDATE tenants SET plan = $1 WHERE id = $2`, [VINYLCAVE_TENANT.plan, vinylId]);
    await markTenantOnboarded(ownerPool, vinylId);

    // ── freeshop tenant (Gating-E2E, Spec §8) ──────────────────────────────
    const { tenantId: freeId, usedPassword: freePw } = await ensureTenant(FREESHOP_TENANT, ownerPool);
    printCredentials(FREESHOP_TENANT, freePw, protocol, rootDomain);
    await sendCredentialMail(FREESHOP_TENANT, freePw, protocol, rootDomain);

    console.log(`[seed] Resetting gating state for "${FREESHOP_TENANT.slug}"...`);
    await resetFreeshopGatingState(ownerPool, freeId);

    console.log(`[seed] Seeding inventory for "${FREESHOP_TENANT.slug}"...`);
    await seedTenantInventory(ownerPool, freeId, FREESHOP_RECORDS, FREESHOP_PURCHASES, FREESHOP_PERMALINKS);
    await markTenantOnboarded(ownerPool, freeId);

    // ── Platform-User (Spec §5) ────────────────────────────────────────────
    await ensurePlatformUser(ownerPool, PLATFORM_ADMIN_EMAIL, process.env['SEED_ADMIN_PASSWORD']);

    console.log('[seed] Done. Safe to re-run (idempotent).');
  } finally {
    await ownerPool.end();
  }
}

// ---------------------------------------------------------------------------
// CLI entry guard — run main() only when executed directly, not on import.
//
// Two runtimes invoke this file, and the guard must fire in BOTH while staying
// inert on a plain `import` (so vitest can import the exported seed helpers):
//
//   • `pnpm db:seed` → `tsx scripts/seed.ts` (ESM): `import.meta.url` is this
//     file's URL. Run only when process.argv[1] resolves to this file, so test
//     imports (where argv[1] is the vitest binary) never trigger main().
//
//   • compose `seed` service → `node /app/seed.cjs`: the esbuild
//     `--format=cjs` bundle replaces `import.meta` with `{}`, so
//     `import.meta.url` is `undefined` (esbuild's [empty-import-meta] warning).
//     The bundle is ALWAYS the process entrypoint, so run main(). We must NOT
//     call fileURLToPath(undefined) — that throws ERR_INVALID_ARG_TYPE at load
//     and would crash the seed service before main() ever runs.
// ---------------------------------------------------------------------------
const seedMetaUrl: string | undefined = import.meta.url;

function isSeedDirectInvocation(): boolean {
  // esbuild cjs bundle (node seed.cjs): import.meta.url is empty → entrypoint.
  if (!seedMetaUrl) return true;
  const self = fileURLToPath(seedMetaUrl);
  return process.argv[1] === self || process.argv[1] === self.replace(/\.ts$/, '.js');
}

if (isSeedDirectInvocation()) {
  main()
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      console.error('[seed] Fatal error:', err);
      process.exit(1);
    });
}
