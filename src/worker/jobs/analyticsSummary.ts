import type PgBoss from 'pg-boss';
import { withSuperadmin } from '@/db/tenant';

export type AnalyticsSummaryPayload = {
  tenantId: number;
};

/**
 * Skeleton handler for the analytics_summary_refresh system job.
 *
 * Tenant-in-payload convention: every job payload carries `tenantId`.
 * System jobs (like this one) use `withSuperadmin`; per-tenant jobs open their
 * OWN `withTenant(payload.tenantId)` on a fresh connection.
 *
 * NOTE for Slice 4: a real `REFRESH MATERIALIZED VIEW CONCURRENTLY` must run
 * OUTSIDE a transaction (autocommit on ownerPool), NOT inside `withSuperadmin`'s
 * transaction — the skeleton is a no-op log so a tx is fine for now.
 */
export async function handleAnalyticsSummaryRefresh(
  job: PgBoss.Job<AnalyticsSummaryPayload>,
): Promise<void> {
  const { tenantId } = job.data;

  await withSuperadmin(async () => {
    // Skeleton: no-op until Slice 4 (materialized view refresh).
    console.log(
      `[worker] analyticsSummaryRefresh: tenantId=${tenantId} jobId=${job.id}`,
    );
  });
}
