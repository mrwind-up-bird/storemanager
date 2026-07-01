import { pathToFileURL } from 'node:url';
import PgBoss from 'pg-boss';
// Type-only import — erased at compile time, so it does NOT trigger the lazy
// runtime import of ./jobs/analyticsSummary (and its @/db → @/env chain). It just
// keeps the queue registration and the real handler sharing ONE payload type.
import type { AnalyticsSummaryPayload } from './jobs/analyticsSummary';
// Type-only import (erased at compile time) — keeps the queue registration and
// the real handler sharing ONE payload type WITHOUT pulling the job module's
// runtime @/db → @/env chain at module load, so `import { QUEUE }` stays env-less.
import type { DiscogsListingPayload } from './jobs/discogsListing';
// Type-only import (erased at compile time) — keeps the queue registration and the real
// handler sharing ONE payload type without pulling the job module's @/db → @/env chain.
import type { WishlistMatchPayload } from './jobs/wishlistMatch';

/**
 * Canonical queue name registry.
 * Every queue used by this worker is registered here so callers can reference
 * the name via the constant rather than a raw string literal.
 *
 * Importing this module only to read QUEUE does NOT trigger @/env validation or
 * any database pool creation — those happen lazily inside startWorker().
 */
export const QUEUE = {
  analyticsSummaryRefresh: 'system.analytics_summary.refresh',
  discogsListingCreate: 'tenant.discogs.listing.create',
  wishlistMatch: 'tenant.wishlist.match',
} as const;

/**
 * Boot the pg-boss worker process.
 *
 * - Connects to `PGBOSS_DATABASE_URL` (qr_owner connection, BYPASSRLS).
 * - pg-boss owns the `pgboss` schema — entirely OUTSIDE tenant RLS.
 * - pg-boss v10 requires `createQueue(name)` before `work`/`send` on that queue.
 * - Registers handlers for all queues, then keeps the process alive via an
 *   unresolvable promise (pg-boss internal timers keep the event loop running).
 * - SIGTERM / SIGINT trigger a graceful `boss.stop()` before exiting.
 *
 * This function MUST NOT be called from within `next start` — the worker is its
 * OWN process, started via `pnpm worker` (i.e. `tsx src/worker/index.ts`).
 *
 * All env-dependent and DB-dependent modules are imported lazily here so that a
 * test file can `import { QUEUE } from '@/worker/index'` at the top level without
 * triggering Zod env validation (which fails before setupTestDatabase() sets env vars).
 */
export async function startWorker(): Promise<void> {
  // Lazy imports: @/env triggers Zod parse; @/db/tenant → @/db/client → @/env.
  // Both must be imported AFTER env vars are set (i.e. not at module-load time).
  const { env } = await import('@/env');
  const { handleAnalyticsSummaryRefresh } = await import('./jobs/analyticsSummary');
  const { handleDiscogsListingCreate } = await import('./jobs/discogsListing');
  const { handleWishlistMatch } = await import('./jobs/wishlistMatch');

  const boss = new PgBoss(env.PGBOSS_DATABASE_URL);

  boss.on('error', (error: unknown) => {
    console.error('[worker] pg-boss error:', error);
  });

  await boss.start();
  console.log('[worker] pg-boss started (pgboss schema is separate from public)');

  // pg-boss v10: createQueue must be called before work() or send() on a new queue.
  // Calling createQueue on an existing queue is a no-op (ON CONFLICT DO NOTHING).
  await boss.createQueue(QUEUE.analyticsSummaryRefresh);
  console.log(`[worker] Queue created/verified: ${QUEUE.analyticsSummaryRefresh}`);

  // pg-boss v10 work() handler receives Job<T>[] (an array, even with default batchSize=1).
  // We wrap the single-job handler so each job in the batch is processed sequentially.
  await boss.work<AnalyticsSummaryPayload>(
    QUEUE.analyticsSummaryRefresh,
    async (jobs: PgBoss.Job<AnalyticsSummaryPayload>[]) => {
      for (const job of jobs) {
        await handleAnalyticsSummaryRefresh(job);
      }
    },
  );
  console.log(`[worker] Handler registered for queue: ${QUEUE.analyticsSummaryRefresh}`);

  // Per-tenant Discogs marketplace listing job (Slice 2).
  await boss.createQueue(QUEUE.discogsListingCreate);
  console.log(`[worker] Queue created/verified: ${QUEUE.discogsListingCreate}`);

  await boss.work<DiscogsListingPayload>(
    QUEUE.discogsListingCreate,
    async (jobs: PgBoss.Job<DiscogsListingPayload>[]) => {
      for (const job of jobs) {
        await handleDiscogsListingCreate(job);
      }
    },
  );
  console.log(`[worker] Handler registered for queue: ${QUEUE.discogsListingCreate}`);

  // Per-tenant wishlist match job (Slice 3): match arrived copies against open wishlists.
  await boss.createQueue(QUEUE.wishlistMatch);
  console.log(`[worker] Queue created/verified: ${QUEUE.wishlistMatch}`);

  await boss.work<WishlistMatchPayload>(
    QUEUE.wishlistMatch,
    async (jobs: PgBoss.Job<WishlistMatchPayload>[]) => {
      for (const job of jobs) {
        await handleWishlistMatch(job);
      }
    },
  );
  console.log(`[worker] Handler registered for queue: ${QUEUE.wishlistMatch}`);

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[worker] Received ${signal}. Stopping pg-boss...`);
    await boss.stop();
    console.log('[worker] pg-boss stopped. Exiting.');
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  // pg-boss internal timers keep the event loop alive.
  // This promise never resolves in normal operation; signal handlers exit the process.
  await new Promise<never>(() => undefined);
}

// ESM-safe entry guard: `require.main` is undefined under tsx ESM mode, so we
// compare import.meta.url to the file being executed instead.
const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  void startWorker().catch((err: unknown) => {
    console.error('[worker] Fatal startup error:', err);
    process.exit(1);
  });
}
