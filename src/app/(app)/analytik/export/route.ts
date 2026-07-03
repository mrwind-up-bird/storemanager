import 'server-only';
import { sql } from 'drizzle-orm';
import { forbidden } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { withTenant } from '@/db/tenant';
import { periodRange, berlinLocalYMD, type AnalyticsPeriod } from '@/lib/analytics-period';
import { toCents } from '@/lib/money';
import { serializeAnalyticsCsv, type CsvTxRow } from '@/lib/analytics-csv';

// One more than the cap so a single query tells us whether more rows exist (C13: cap 10 000).
const CAP = 10_000;

type TxRow = {
  id: number;
  created_at: Date;
  payment_method: string;
  subtotal: string;
  discount: string;
  total: string;
};

/** GET /analytik/export?period=week|month|quarter — streams tenant-scoped transactions as CSV.
 *  Staff-only (same gate as the Analytik screen — sales internals never reach a kunde). */
export async function GET(request: Request): Promise<Response> {
  const user = await requireSession();
  if (user.role === 'kunde') forbidden();

  const url = new URL(request.url);
  const raw = url.searchParams.get('period');
  // AnalyticsPeriod union (never blind-cast), same validation as the Analytik screen — falls back
  // to 'week' for anything else (missing, malformed, or unknown query value).
  const period: AnalyticsPeriod = raw === 'month' || raw === 'quarter' ? raw : 'week';

  const { start, end } = periodRange(period, new Date());
  const ctx = { tenantId: user.tenantId, userId: user.id };

  const { rows, capped } = await withTenant(ctx, async (tx) => {
    const result = await tx.execute(sql`
      SELECT id, created_at, payment_method, subtotal, discount, total
      FROM transactions
      WHERE created_at >= ${start} AND created_at < ${end}
      ORDER BY created_at, id
      LIMIT ${CAP + 1}
    `);
    const fetched = result.rows as TxRow[];
    const capped = fetched.length > CAP;
    const sliced = capped ? fetched.slice(0, CAP) : fetched;
    // Money columns are numeric(10,2) strings at the read boundary → toCents here (C1); fromCents
    // happens only inside the pure serializer, at the CSV cell.
    const rows: CsvTxRow[] = sliced.map((r) => ({
      createdAt: new Date(r.created_at),
      id: r.id,
      paymentMethod: r.payment_method,
      subtotalCents: toCents(r.subtotal),
      discountCents: toCents(r.discount),
      totalCents: toCents(r.total),
    }));
    return { rows, capped };
  });

  const csv = serializeAnalyticsCsv(rows, capped);
  // Filename date is `start`'s Berlin-LOCAL calendar date, not its UTC ISO date — `start` is a
  // Berlin-local-midnight instant, so `.toISOString()` (UTC) would always land on the previous day.
  const { year, month, day } = berlinLocalYMD(start);
  const startDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const headers = new Headers({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="analytik-${period}-${startDate}.csv"`,
  });
  return new Response(csv, { headers });
}
