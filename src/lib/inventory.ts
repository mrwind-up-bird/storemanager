import 'server-only';
import { and, asc, eq, gte, sql, type SQL } from 'drizzle-orm';
import { withTenant } from '@/db/tenant';
import { records, purchases, type RecordStatus } from '@/db/schema';

export type InventoryStatus = RecordStatus; // 'verfuegbar'|'reserviert'|'verkauft'|'verliehen'
export type ConditionBand = 'mint_nm' | 'vgplus' | 'vg'; // ≥6, ≥5, ≥4 on conditionRecord

export type InventoryFilters = {
  q?: string;
  format?: string;
  genre?: string;
  condition?: ConditionBand;
  status?: InventoryStatus;
};

export type InventoryRow = {
  copyId: number;
  recordId: number;
  title: string;
  artist: string;
  label: string[];
  releaseYear: number | null;
  country: string | null;
  format: string | null;
  genre: string[];
  ek: string | null; // numeric(10,2) → string from pg
  vk: string | null;
  status: InventoryStatus;
  conditionRecord: number | null;
  conditionCover: number | null;
  discogsId: number | null;
};

export type InventoryAggregates = {
  total: number;
  byStatus: Record<InventoryStatus, number>;
  valueAvailable: number; // Σ vk of 'verfuegbar' copies in the q+filter set (euros)
  formatSplit: { vinyl: number; cd: number; other: number };
  genreOptions: string[];
};

const CONDITION_BANDS: Record<ConditionBand, number> = { mint_nm: 6, vgplus: 5, vg: 4 };
const KNOWN_FORMATS = ['Vinyl', 'CD', 'Kassette'] as const;
const STATUS_VALUES: readonly InventoryStatus[] = ['verfuegbar', 'reserviert', 'verkauft', 'verliehen'];

/** base predicates (tenant + q + format + genre + condition) — the status tab is NEVER part of this set. */
function basePreds(tenantId: number, f: InventoryFilters): SQL[] {
  const preds: SQL[] = [
    eq(records.tenantId, tenantId),
    eq(purchases.tenantId, tenantId), // defence-in-depth alongside RLS (Global Constraint)
  ];
  if (f.q) {
    const esc = f.q.replace(/[\\%_]/g, (c) => '\\' + c);
    const like = `%${esc}%`;
    preds.push(
      sql`(${records.title} ILIKE ${like} OR ${records.artist} ILIKE ${like} OR array_to_string(${records.label}, ' ') ILIKE ${like})`,
    );
  }
  if (f.format) preds.push(eq(records.format, f.format));
  if (f.genre) preds.push(sql`${f.genre} = ANY(${records.genre})`);
  if (f.condition) preds.push(gte(purchases.conditionRecord, CONDITION_BANDS[f.condition]));
  return preds;
}

export async function listInventory(
  ctx: { tenantId: number; userId: number | null },
  f: InventoryFilters,
): Promise<InventoryRow[]> {
  return withTenant({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const preds = basePreds(ctx.tenantId, f);
    if (f.status) preds.push(eq(purchases.status, f.status));
    return tx
      .select({
        copyId: purchases.id,
        recordId: records.id,
        title: records.title,
        artist: records.artist,
        label: records.label,
        releaseYear: records.releaseYear,
        country: records.country,
        format: records.format,
        genre: records.genre,
        ek: purchases.purchasePrice,
        vk: purchases.targetPrice,
        status: purchases.status,
        conditionRecord: purchases.conditionRecord,
        conditionCover: purchases.conditionCover,
        discogsId: records.discogsId,
      })
      .from(purchases)
      .innerJoin(records, eq(records.id, purchases.recordId))
      .where(and(...preds))
      .orderBy(asc(records.artist), asc(records.title));
  });
}

export async function inventoryAggregates(
  ctx: { tenantId: number; userId: number | null },
  f: InventoryFilters,
): Promise<InventoryAggregates> {
  return withTenant({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const preds = basePreds(ctx.tenantId, f); // NB: status intentionally excluded

    // byStatus + total — counts within the q+filter set, grouped by status.
    const statusRows = await tx
      .select({ status: purchases.status, count: sql<number>`count(*)::int` })
      .from(purchases)
      .innerJoin(records, eq(records.id, purchases.recordId))
      .where(and(...preds))
      .groupBy(purchases.status);

    const byStatus: Record<InventoryStatus, number> = {
      verfuegbar: 0,
      reserviert: 0,
      verkauft: 0,
      verliehen: 0,
    };
    let total = 0;
    for (const r of statusRows) {
      byStatus[r.status] = r.count;
      total += r.count;
    }

    // valueAvailable + formatSplit — verfuegbar copies only, within the same q+filter set.
    const availRows = await tx
      .select({ format: records.format, vk: purchases.targetPrice })
      .from(purchases)
      .innerJoin(records, eq(records.id, purchases.recordId))
      .where(and(...preds, eq(purchases.status, 'verfuegbar')));

    let valueAvailable = 0;
    const formatSplit = { vinyl: 0, cd: 0, other: 0 };
    for (const r of availRows) {
      if (r.vk) valueAvailable += Number(r.vk);
      if (r.format === 'Vinyl') formatSplit.vinyl += 1;
      else if (r.format === 'CD') formatSplit.cd += 1;
      else formatSplit.other += 1;
    }

    // genreOptions — distinct genres present for the tenant, independent of the active filters.
    const genreRes = await tx.execute(
      sql`SELECT DISTINCT unnest(genre) AS g FROM records WHERE tenant_id = ${ctx.tenantId} ORDER BY g`,
    );
    const genreOptions = (genreRes.rows as { g: string }[]).map((row) => row.g);

    return { total, byStatus, valueAvailable, formatSplit, genreOptions };
  });
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export function parseInventoryFilters(
  sp: Record<string, string | string[] | undefined>,
): InventoryFilters {
  const out: InventoryFilters = {};

  const q = first(sp.q);
  if (q) {
    const trimmed = q.trim().slice(0, 80);
    if (trimmed) out.q = trimmed;
  }

  const format = first(sp.format);
  if (format && (KNOWN_FORMATS as readonly string[]).includes(format)) out.format = format;

  const genre = first(sp.genre);
  if (genre && genre.trim().length > 0) out.genre = genre.trim();

  const condition = first(sp.condition);
  if (condition && condition in CONDITION_BANDS) out.condition = condition as ConditionBand;

  const status = first(sp.status);
  if (status && (STATUS_VALUES as readonly string[]).includes(status)) {
    out.status = status as InventoryStatus;
  }

  return out;
}

/** Minimal row for the mobile sell flows — deliberately WITHOUT purchase price (EK stays server-side). */
export type CopyHit = {
  purchaseId: number;
  title: string;
  artist: string;
  targetPrice: string | null;
  conditionRecord: number | null;
  conditionCover: number | null;
};

/** All verfuegbar copies of a Discogs release (label-QR sell flow, C7).
 *  KRITISCH: matcht über records.discogsId — NIEMALS purchases.recordId (interne ID ≠ Release-ID). */
export async function findAvailableCopiesByRelease(
  ctx: { tenantId: number; userId: number | null },
  discogsReleaseId: number,
): Promise<CopyHit[]> {
  return withTenant({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) =>
    tx
      .select({
        purchaseId: purchases.id,
        title: records.title,
        artist: records.artist,
        targetPrice: purchases.targetPrice,
        conditionRecord: purchases.conditionRecord,
        conditionCover: purchases.conditionCover,
      })
      .from(purchases)
      .innerJoin(records, eq(records.id, purchases.recordId))
      .where(
        and(
          eq(purchases.tenantId, ctx.tenantId),
          eq(records.tenantId, ctx.tenantId),
          eq(records.discogsId, discogsReleaseId),
          eq(purchases.status, 'verfuegbar'),
        ),
      )
      .orderBy(asc(purchases.id)),
  );
}
