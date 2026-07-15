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
 * ⚠️ SICHERHEIT (Nemesis-Review): geschrieben via `drizzle(ownerPool)` = Rolle qr_owner, die
 * **BYPASSRLS** hat (docker/postgres/init/01-roles.sql). RLS wird hier NICHT ausgewertet — die
 * EINZIGE Tenant-Scope ist das explizite `WHERE tenant_id = <demoId>` in jedem DELETE. Diese
 * WHERE-Klauseln NIEMALS entfernen (kein RLS-Backstop!). Der destruktive Lauf verlangt zusätzlich
 * `IMPORT_CONFIRM_WIPE=1` (verhindert einen versehentlichen Wipe eines zahlenden Tenants per
 * DEMO_TENANT_SLUG-Tippfehler).
 *
 * Quelle (read-only): `V1_SOURCE_DATABASE_URL` (+ optional `V1_SOURCE_SCHEMA`, default public).
 * Ziel: Tenant slug=`DEMO_TENANT_SLUG` (default 'demo'). Wipe & reload, atomar, idempotent
 * (records.unique(hash, tenant_id)). Nur Medien (Format-Whitelist) — Getränke/Quick-POS liegen in
 * v1 in transactions/-_items, nicht in `records`. Verkaufte Exemplare mit → v2 leitet Umschlag/
 * Verkaufsfrequenz daraus ab.
 *
 * Ausführen (server-only ist NUR im esbuild-cjs-Bundle gestubbt, nicht unter tsx):
 *   # 1) DRY-RUN — liest, zählt, Verteilungs-Report (record_status, Condition-Skala), schreibt NICHTS:
 *   docker compose exec -e IMPORT_DRY_RUN=1 -e V1_SOURCE_DATABASE_URL="…" worker node /app/import-qrecords.cjs
 *   # 2) Echter Lauf — verlangt explizite Bestätigung:
 *   docker compose exec -e IMPORT_CONFIRM_WIPE=1 -e V1_SOURCE_DATABASE_URL="…" worker node /app/import-qrecords.cjs
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
  record_status: string | null;
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
  tenantSlug: string;
  recordsTotal: number;
  recordsImported: number; // distinkte v2-Records
  recordsCollapsed: number; // Medien-Zeilen, die per Hash auf einen bestehenden Record fielen (z.B. LP+CD)
  recordsSkippedNonMedia: number;
  copiesImported: number;
  copiesSold: number;
  formatsSeen: Record<string, number>;
  recordStatusSeen: Record<string, number>; // v1 record_status-Verteilung (Aletheia #1 — Verifikation)
  conditionRange: { min: number | null; max: number | null; distinct: number[] }; // (Aletheia #2 — 0..7 vs 1..8)
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
    // 1) Ziel-Tenant auflösen (id + name für die Bestätigungs-Anzeige).
    const tr = await db.execute(sql`SELECT id, name FROM tenants WHERE slug = ${demoSlug} LIMIT 1`);
    const trow = tr.rows[0] as { id: number; name: string } | undefined;
    const tenantId = trow?.id;
    if (tenantId == null || !Number.isInteger(tenantId) || tenantId <= 0) {
      throw new Error(`Ziel-Tenant slug='${demoSlug}' nicht gefunden.`);
    }
    console.log(
      `[import] Ziel-Tenant: slug='${demoSlug}' name='${trow!.name}' id=#${tenantId}${dryRun ? '  (DRY-RUN)' : ''}`,
    );

    // Destruktiver Lauf verlangt explizite Bestätigung (Nemesis #2 — kein versehentlicher Wipe
    // eines zahlenden Tenants per DEMO_TENANT_SLUG-Tippfehler).
    if (!dryRun && process.env.IMPORT_CONFIRM_WIPE !== '1') {
      throw new Error(
        `Abbruch: der echte Import WIPED den kompletten Bestand von Tenant '${demoSlug}' (#${tenantId}). ` +
          `Zum Bestätigen IMPORT_CONFIRM_WIPE=1 setzen — oder zuerst IMPORT_DRY_RUN=1 fahren.`,
      );
    }

    // 2) v1 lesen (read-only): records + purchases + conditions.
    const { rows: v1recs } = await src.query<V1Record>(
      `SELECT id,title,artist,label,release_year,genre,styles,tags,format,country,discogs_id,cover_image,notes,price,sold,record_status
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

    // Medien-Filter + Verteilungs-Reports (Format, record_status, Condition-Skala).
    const formatsSeen: Record<string, number> = {};
    const recordStatusSeen: Record<string, number> = {};
    const media: V1Record[] = [];
    let skippedNonMedia = 0;
    for (const r of v1recs) {
      const fk = (r.format ?? '∅').trim() || '∅';
      formatsSeen[fk] = (formatsSeen[fk] ?? 0) + 1;
      const sk = r.record_status ?? '∅';
      recordStatusSeen[sk] = (recordStatusSeen[sk] ?? 0) + 1;
      if (isMediaFormat(r.format)) media.push(r);
      else skippedNonMedia++;
    }
    const condVals = v1cond
      .flatMap((c) => [c.condition_cover, c.condition_record])
      .filter((n): n is number => n != null);
    const conditionRange = {
      min: condVals.length ? Math.min(...condVals) : null,
      max: condVals.length ? Math.max(...condVals) : null,
      distinct: [...new Set(condVals)].sort((a, b) => a - b),
    };

    const summary: ImportSummary = {
      tenantId,
      tenantSlug: demoSlug,
      recordsTotal: v1recs.length,
      recordsImported: 0,
      recordsCollapsed: 0,
      recordsSkippedNonMedia: skippedNonMedia,
      copiesImported: 0,
      copiesSold: 0,
      formatsSeen,
      recordStatusSeen,
      conditionRange,
      dryRun,
    };

    const hashOf = (r: V1Record) =>
      recordHash({ title: r.title, artist: r.artist, country: r.country, year: r.release_year, label: r.label ?? [] });

    if (dryRun) {
      const distinctHashes = new Set(media.map(hashOf));
      const copiesPlanned = media.reduce((n, r) => n + Math.max(1, (purchByRecord.get(r.id) ?? []).length), 0);
      summary.recordsImported = distinctHashes.size;
      summary.recordsCollapsed = media.length - distinctHashes.size;
      summary.copiesImported = copiesPlanned;
      console.log(
        `[import] DRY-RUN: ${media.length}/${v1recs.length} Medien (${skippedNonMedia} Nicht-Medien aus) → ${distinctHashes.size} distinkte Records (${summary.recordsCollapsed} per Hash zusammengefallen), ~${copiesPlanned} Exemplare.`,
      );
      console.log('[import]   Formate:', formatsSeen);
      console.log(
        '[import]   ⚠ v1 record_status:',
        recordStatusSeen,
        '→ VERIFIZIEREN: aktuell werden nicht-verkaufte Zeilen alle als "verfuegbar" importiert (reserviert/verliehen gehen verloren).',
      );
      console.log(
        '[import]   ⚠ Condition-Werte:',
        conditionRange,
        '→ v2 erwartet 0..7 (0 Poor … 7 Mint). Bei beobachtetem Wert 8 ist die v1-Skala 1..8 und das Mapping off-by-one.',
      );
      return summary;
    }

    // 3) Wipe & reload — hart auf tenant_id=demoId gefiltert, atomar in EINER Transaktion (owner).
    //    Drizzle-Query-Builder (nicht rohes sql``) — serialisiert text[]-Spalten + Typen korrekt.
    const insertedIds = new Set<number>();
    await db.transaction(async (tx) => {
      // FK-Reihenfolge (Nemesis #3): zuerst die Tabellen, die records/purchases mit `ON DELETE no
      // action` referenzieren, sonst wirft der Wipe 23503, sobald demo POS-Verkäufe/Wishlist-Matches hat.
      await tx.delete(schema.wishlistMatches).where(eq(schema.wishlistMatches.tenantId, tenantId));
      await tx.delete(schema.transactionItems).where(eq(schema.transactionItems.tenantId, tenantId));
      await tx.delete(schema.transactions).where(eq(schema.transactions.tenantId, tenantId));
      await tx.delete(schema.recordEmbeddings).where(eq(schema.recordEmbeddings.tenantId, tenantId));
      await tx.delete(schema.purchases).where(eq(schema.purchases.tenantId, tenantId));
      await tx.delete(schema.records).where(eq(schema.records.tenantId, tenantId));

      for (const r of media) {
        const [ins] = await tx
          .insert(schema.records)
          .values({
            tenantId,
            title: r.title,
            artist: r.artist,
            label: r.label ?? [],
            country: r.country,
            releaseYear: r.release_year,
            format: r.format,
            genre: r.genre ?? [],
            styles: r.styles ?? [],
            tags: r.tags ?? [],
            coverImage: r.cover_image,
            discogsId: toDiscogsId(r.discogs_id),
            notes: r.notes,
            hash: hashOf(r),
          })
          .onConflictDoUpdate({
            target: [schema.records.hash, schema.records.tenantId],
            set: { updatedAt: sql`now()` },
          })
          .returning({ id: schema.records.id });
        const recordId = ins!.id;
        // Hash-Kollision (z.B. LP+CD desselben Release — format ist NICHT im Hash): derselbe Record,
        // zusätzliche Exemplare. Distinkt zählen statt pro Zeile hochzählen (Aletheia #3).
        if (insertedIds.has(recordId)) summary.recordsCollapsed++;
        else insertedIds.add(recordId);

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
            // Nur verkaufte Exemplare tragen einen Verkaufspreis — sonst widersprüchlicher Zustand
            // "verfuegbar + sold_price" (Aletheia #4).
            soldPrice: status === 'verkauft' ? p.sold_price : null,
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
    summary.recordsImported = insertedIds.size;

    console.log(
      `[import] ✓ ${summary.recordsImported} Records (${summary.recordsCollapsed} per Hash zusammengefallen) + ${summary.copiesImported} Exemplare (${summary.copiesSold} verkauft) → Tenant #${tenantId}. ${skippedNonMedia} Nicht-Medien ausgeschlossen.`,
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
