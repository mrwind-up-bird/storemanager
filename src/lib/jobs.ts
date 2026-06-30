import 'server-only';
import PgBoss from 'pg-boss';
import { env } from '@/env';
import { QUEUE } from '@/worker/index';

/**
 * Lazy module-scoped PgBoss singleton on `env.PGBOSS_DATABASE_URL`.
 *
 * The boss is started once and the queue created once; subsequent enqueue calls
 * reuse the same connection. `createQueue` on an existing queue is a no-op.
 */
let bossPromise: Promise<PgBoss> | null = null;

async function getBoss(): Promise<PgBoss> {
  if (!bossPromise) {
    bossPromise = (async () => {
      const boss = new PgBoss(env.PGBOSS_DATABASE_URL);
      boss.on('error', (error: unknown) => {
        console.error('[jobs] pg-boss error:', error);
      });
      await boss.start();
      await boss.createQueue(QUEUE.discogsListingCreate);
      return boss;
    })();
  }
  return bossPromise;
}

export async function enqueueDiscogsListing(payload: {
  tenantId: number;
  purchaseId: number;
}): Promise<void> {
  const boss = await getBoss();
  await boss.send(QUEUE.discogsListingCreate, payload, {
    retryLimit: 5,
    retryBackoff: true,
  });
}
