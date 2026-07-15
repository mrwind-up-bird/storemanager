import 'server-only';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { sql, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { ownerPool } from '@/db/client';
import * as schema from '@/db/schema';
import { recordHash } from '@/db/hash';
import { isMediaFormat, mapStatus, clampCondition, toDiscogsId, safeSchema } from './import-qrecords-map';

/**
 * One-off ETL: v1 Q-records (TypeORM/Express Postgres) → v2 storemanager demo-Tenant.
 *
 * Quelle (read-only): `V1_SOURCE_DATABASE_URL` (+ optional `V1_SOURCE_SCHEMA`, default public).
 * Ziel: der v2-Tenant mit slug `DEMO_TENANT_SLUG` (default 'demo') — geschrieben via withTenant
 *       (appPool/qr_app, app.current_tenant gesetzt) → RLS scoped JEDES Insert UND den Wipe hart
 *       auf diesen Tenant. Andere Tenants sind strukturell unantastbar.
 *
 * Nur Medien (Musik/Video) — Getränke/Quick-POS liegen in v1 in transactions/-_items, nicht in
 * `records`; ein zusätzlicher Format-Whitelist-Filter schließt Nicht-Medien-Records sicher aus.
 * Wipe & reload: der demo-Bestand wird vor dem Import geleert (deterministischer Demo-Zustand).
 * Idempotent über `records.unique(hash, tenant_id)` — Re-Runs sind sicher.
 *
 * Ausführen im Deployment (server-only ist NUR im esbuild-cjs-Bundle gestubbt, nicht unter tsx):
 *   docker compose exec -e V1_SOURCE_DATABASE_URL="postgres://…v1…" worker node /app/import-qrecords.cjs
 * Erst gefahrlos testen mit IMPORT_DRY_RUN=1 (liest v1, zählt, schreibt NICHTS):
 *   docker compose exec -e IMPORT_DRY_RUN=1 -e V1_SOURCE_DATABASE_URL="…" worker node /app/import-qrecords.cjs
 */

// ── v1-Zeilentypen (nur die gelesenen Spalten) ─────────────────────────────────
type V1Record = {
  id: number;
  title: string;
  artist: string;
  label: string[] | null;
  release_year: number | null;
  genre: string[] | null;
  styles: string[] | null;
  tags: string[] | null;
  format: string | null;
  country: string | null;
  discogs_id: string | number | null;
  cover_image: string | null;
  notes: string | null;
  price: string | number | null;
  sold: boolean | null;
};
type V1Purchase = {
  id: number;
  record_id: number | null;
  purchase_price: string | null;
  target_price: string | null;
  sold_price: string | null;
  sold_date: Date | null;
  payment_method: string | null;
  purchase_date: Date | null;
};
type V1Cond = { record_id: number; purchase_id: number | null; condition_cover: number; condition_record: number };

export interface ImportSummary {
  tenantId: number;
  recordsTotal: number;
  recordsImported: number;
  recordsSkippedNonMedia: number;
  copiesImported: number;
  copiesSold: number;
  formatsSeen: Record<string, number>;
  dryRun: boolean;
}

export async function importQrecords(): Promise<ImportSummary> {
  const v1Url = process.env.V1_SOURCE_DATABASE_URL;
  if (!v1Url) throw new Error('V1_SOURCE_DATABASE_URL fehlt — Quell-Connection-String erforderlich.');
  const schemaName = safeSchema(process.env.V1_SOURCE_SCHEMA ?? 'public');
  const demoSlug = process.env.DEMO_TENANT_SLUG ?? 'demo';
  const dryRun = process.env.IMPORT_DRY_RUN === '1';

  const src = new Pool({ connectionString: v1Url, max: 4, statement_timeout: 60_000 });
  src.on('error', (e) => console.error('[import] v1 source pool error (idle):', e));

  const db = drizzle(ownerPool, { schema });

  try {
    // 1) Ziel-Tenant auflösen (Registry-Lesen via owner).
    const tr = await db.execute(sql`SELECT id FROM tenants WHERE slug = ${demoSlug} LIMIT 1`);
    const tenantId = (tr.rows[0] as { id: number } | undefined)?.id;
    if (tenantId == null || !Number.isInteger(tenantId) || tenantId <= 0) {
      throw new Error(`Ziel-Tenant slug='${demoSlug}' nicht gefunden.`);
    }
    console.log(`[import] Ziel-Tenant '${demoSlug}' = #${tenantId}${dryRun ? '  (DRY-RUN)' : ''}`);

    // 2) v1 lesen (read-only): records + purchases + conditions.
    const { rows: v1recs } = await src.query<V1Record>(
      `SELECT id,title,artist,label,release_year,genre,styles,tags,format,country,discogs_id,cover_image,notes,price,sold
         FROM ${schemaName}.records`,
    );
    const { rows: v1purch } = await src.query<V1Purchase>(
      `SELECT id,record_id,purchase_price,target_price,sold_price,sold_date,payment_method,purchase_date
         FROM ${schemaName}.purchases`,
    );
    const { rows: v1cond } = await src.query<V1Cond>(
      `SELECT record_id,purchase_id,condition_cover,condition_record FROM ${schemaName}.conditions`,
    );

    const purchByRecord = new Map<number, V1Purchase[]>();
    for (const p of v1purch) {
      if (p.record_id == null) continue;
      (purchByRecord.get(p.record_id) ?? purchByRecord.set(p.record_id, []).get(p.record_id)!).push(p);
    }
    const condByPurchase = new Map<number, V1Cond>();
    const condByRecord = new Map<number, V1Cond>();
    for (const c of v1cond) {
      if (c.purchase_id != null) condByPurchase.set(c.purchase_id, c);
      if (!condByRecord.has(c.record_id)) condByRecord.set(c.record_id, c);
    }

    // Medien-Filter + Format-Report.
    const formatsSeen: Record<string, number> = {};
    const media: V1Record[] = [];
    let skippedNonMedia = 0;
    for (const r of v1recs) {
      const key = (r.format ?? '∅').trim() || '∅';
      formatsSeen[key] = (formatsSeen[key] ?? 0) + 1;
      if (isMediaFormat(r.format)) media.push(r);
      else skippedNonMedia++;
    }

    const summary: ImportSummary = {
      tenantId,
      recordsTotal: v1recs.length,
      recordsImported: 0,
      recordsSkippedNonMedia: skippedNonMedia,
      copiesImported: 0,
      copiesSold: 0,
      formatsSeen,
      dryRun,
    };

    if (dryRun) {
      const copiesPlanned = media.reduce((n, r) => n + Math.max(1, (purchByRecord.get(r.id) ?? []).length), 0);
      console.log(
        `[import] DRY-RUN: ${media.length}/${v1recs.length} Medien-Records (${skippedNonMedia} Nicht-Medien ausgeschlossen), ~${copiesPlanned} Exemplare. Formate:`,
        formatsSeen,
      );
      summary.recordsImported = media.length;
      summary.copiesImported = copiesPlanned;
      return summary;
    }

    // 3) Wipe & reload — hart auf tenant_id=demoId gefiltert, atomar in EINER Transaktion (owner).
    //    Drizzle-Query-Builder (nicht rohes sql``) — serialisiert text[]-Spalten + Typen korrekt.
    await db.transaction(async (tx) => {
      await tx.delete(schema.recordEmbeddings).where(eq(schema.recordEmbeddings.tenantId, tenantId));
      await tx.delete(schema.purchases).where(eq(schema.purchases.tenantId, tenantId));
      await tx.delete(schema.records).where(eq(schema.records.tenantId, tenantId));

      for (const r of media) {
        const label = r.label ?? [];
        const hash = recordHash({ title: r.title, artist: r.artist, country: r.country, year: r.release_year, label });
        const [ins] = await tx
          .insert(schema.records)
          .values({
            tenantId,
            title: r.title,
            artist: r.artist,
            label,
            country: r.country,
            releaseYear: r.release_year,
            format: r.format,
            genre: r.genre ?? [],
            styles: r.styles ?? [],
            tags: r.tags ?? [],
            coverImage: r.cover_image,
            discogsId: toDiscogsId(r.discogs_id),
            notes: r.notes,
            hash,
          })
          .onConflictDoUpdate({
            target: [schema.records.hash, schema.records.tenantId],
            set: { updatedAt: sql`now()` },
          })
          .returning({ id: schema.records.id });
        const recordId = ins!.id;
        summary.recordsImported++;

        const recPrice = r.price != null ? String(r.price) : null;
        const purchases = purchByRecord.get(r.id) ?? [];
        const copies: V1Purchase[] =
          purchases.length > 0
            ? purchases
            : [{ id: -1, record_id: r.id, purchase_price: null, target_price: recPrice, sold_price: null, sold_date: null, payment_method: null, purchase_date: null }];

        for (const p of copies) {
          const cond = (p.id >= 0 ? condByPurchase.get(p.id) : undefined) ?? condByRecord.get(r.id);
          const status = mapStatus(p.sold_date, r.sold ?? false);
          await tx.insert(schema.purchases).values({
            tenantId,
            recordId,
            purchasePrice: p.purchase_price,
            targetPrice: p.target_price ?? recPrice,
            soldPrice: p.sold_price,
            soldDate: p.sold_date,
            paymentMethod: p.payment_method,
            status,
            conditionRecord: clampCondition(cond?.condition_record),
            conditionCover: clampCondition(cond?.condition_cover),
            ...(p.purchase_date ? { createdAt: p.purchase_date } : {}),
          });
          summary.copiesImported++;
          if (status === 'verkauft') summary.copiesSold++;
        }
      }
    });

    console.log(
      `[import] ✓ ${summary.recordsImported} Records + ${summary.copiesImported} Exemplare (${summary.copiesSold} verkauft) → Tenant #${tenantId}. ${skippedNonMedia} Nicht-Medien ausgeschlossen.`,
    );
    return summary;
  } finally {
    await src.end().catch(() => undefined);
  }
}

// ── CLI-Entry-Guard — nur bei Direktaufruf laufen (spiegelt scripts/seed.ts) ────
const importMetaUrl: string | undefined = import.meta.url;
function isImportDirectInvocation(): boolean {
  if (!importMetaUrl) return true; // esbuild-cjs-Bundle: import.meta.url leer → Entrypoint.
  const self = fileURLToPath(importMetaUrl);
  return process.argv[1] === self || process.argv[1] === self.replace(/\.ts$/, '.js');
}
if (isImportDirectInvocation()) {
  importQrecords()
    .then(() => process.exit(0))
    .catch((e: unknown) => {
      console.error('[import] failed:', e);
      process.exit(1);
    });
}
