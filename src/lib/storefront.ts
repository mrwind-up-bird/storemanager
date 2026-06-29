import 'server-only';
import { sql } from 'drizzle-orm';
import { withTenant } from '@/db/tenant';

export type PermalinkFilter = { title?: string; genre?: string[]; format?: string[] };
export type Availability = 'in' | 'low';
export type StorefrontRecord = {
  recordId: number;
  title: string;
  artist: string;
  format: string | null;
  meta: string;
  availability: Availability;
};
export type ResolvedPermalink = { slug: string; title: string; filter: PermalinkFilter };

/** Raw row shape from the grouped public query — internal only, never returned. */
type StorefrontQueryRow = {
  record_id: number;
  title: string;
  artist: string;
  release_year: number | null;
  label: string[] | null;
  country: string | null;
  format: string | null;
  avail_count: string | number;
};

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map((x) => x.trim());
}

/** Validate/sanitise the jsonb permalink filter: title string, genre/format string[]; ignore unknown keys. */
export function parsePermalinkFilter(raw: unknown): PermalinkFilter {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;
  const out: PermalinkFilter = {};
  if (typeof obj.title === 'string' && obj.title.trim().length > 0) out.title = obj.title.trim();
  const genre = toStringArray(obj.genre);
  if (genre.length > 0) out.genre = genre;
  const format = toStringArray(obj.format);
  if (format.length > 0) out.format = format;
  return out;
}

/** "new-arrivals" → "New Arrivals" (fallback H2 when the filter carries no explicit title). */
function humaniseSlug(slug: string): string {
  return slug
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Escape ILIKE metacharacters; pair with an explicit `ESCAPE '\'` in the SQL. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => '\\' + c);
}

/** Resolve a public slug WITHIN the tenant. null → caller notFound(). Runs with userId:null (public). */
export async function resolvePermalink(
  ctx: { tenantId: number },
  slug: string,
): Promise<ResolvedPermalink | null> {
  const row = await withTenant({ tenantId: ctx.tenantId, userId: null }, async (tx) => {
    const result = await tx.execute(sql`
      SELECT slug, filter
      FROM permalinks
      WHERE slug = ${slug} AND tenant_id = ${ctx.tenantId}
      LIMIT 1
    `);
    return (result.rows[0] as { slug: string; filter: unknown } | undefined) ?? null;
  });
  if (!row) return null;
  const filter = parsePermalinkFilter(row.filter);
  return { slug: row.slug, title: filter.title ?? humaniseSlug(row.slug), filter };
}

/**
 * Public live-stock listing. Returns records that match the filter (+ optional q on title/artist)
 * and have >=1 'verfuegbar' copy, grouped per record. SELECTS ONLY public columns — never price,
 * condition, EK/VK or internal status reach StorefrontRecord. availability = availCount>=2 ? in : low.
 */
export async function listStorefront(
  ctx: { tenantId: number },
  filter: PermalinkFilter,
  q?: string,
): Promise<StorefrontRecord[]> {
  // Defence-in-depth: explicit tenant predicate on records AND purchases, alongside RLS.
  const conds = [sql`r.tenant_id = ${ctx.tenantId}`];

  if (filter.title) {
    conds.push(sql`r.title ILIKE ${`%${escapeLike(filter.title)}%`} ESCAPE '\\'`);
  }
  if (filter.genre && filter.genre.length > 0) {
    // Build an explicit ARRAY[...] literal: drizzle flattens a raw JS array into
    // separate params, so `${arr}::text[]` would bind a scalar (malformed literal).
    const genreArr = sql.join(filter.genre.map((g) => sql`${g}`), sql`, `);
    conds.push(sql`r.genre && ARRAY[${genreArr}]::text[]`);
  }
  if (filter.format && filter.format.length > 0) {
    const formatArr = sql.join(filter.format.map((f) => sql`${f}`), sql`, `);
    conds.push(sql`r.format = ANY(ARRAY[${formatArr}]::text[])`);
  }
  const trimmedQ = q?.trim();
  if (trimmedQ) {
    const like = `%${escapeLike(trimmedQ)}%`;
    conds.push(sql`(r.title ILIKE ${like} ESCAPE '\\' OR r.artist ILIKE ${like} ESCAPE '\\')`);
  }

  const rows = await withTenant({ tenantId: ctx.tenantId, userId: null }, async (tx) => {
    const result = await tx.execute(sql`
      SELECT
        r.id           AS record_id,
        r.title        AS title,
        r.artist       AS artist,
        r.release_year AS release_year,
        r.label        AS label,
        r.country      AS country,
        r.format       AS format,
        COUNT(*) FILTER (WHERE p.status = 'verfuegbar') AS avail_count
      FROM records r
      JOIN purchases p ON p.record_id = r.id AND p.tenant_id = r.tenant_id
      WHERE ${sql.join(conds, sql` AND `)}
      GROUP BY r.id
      HAVING COUNT(*) FILTER (WHERE p.status = 'verfuegbar') >= 1
      ORDER BY r.artist, r.title
    `);
    return result.rows as StorefrontQueryRow[];
  });

  return rows.map((row): StorefrontRecord => {
    const meta = [
      row.release_year,
      Array.isArray(row.label) && row.label.length > 0 ? row.label.join('/') : null,
      row.country,
      row.format,
    ]
      .filter(Boolean)
      .join(' · ');
    return {
      recordId: Number(row.record_id),
      title: row.title,
      artist: row.artist,
      format: row.format ?? null,
      meta,
      availability: Number(row.avail_count) >= 2 ? 'in' : 'low',
    };
  });
}
