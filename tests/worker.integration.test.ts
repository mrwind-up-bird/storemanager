import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import PgBoss from 'pg-boss';
import pg from 'pg';
import { setupTestDatabase } from './helpers/db';
import { QUEUE } from '@/worker/index';

// This suite starts a real Postgres 17 container via testcontainers,
// boots pg-boss against the ownerUrl (qr_owner can create the pgboss schema),
// and verifies job dispatch + completion semantics.

describe('pg-boss worker integration', () => {
  let ownerUrl: string;
  let teardown: () => Promise<void>;

  beforeAll(async () => {
    const db = await setupTestDatabase();
    ownerUrl = db.ownerUrl;
    teardown = db.teardown;
  }, 120_000);

  afterAll(async () => {
    await teardown();
  });

  it('pgboss schema is created by boss.start() and is separate from public', async () => {
    const boss = new PgBoss(ownerUrl);
    await boss.start();

    const client = new pg.Client({ connectionString: ownerUrl });
    await client.connect();
    const result = await client.query<{ schema_name: string }>(
      `SELECT schema_name
       FROM information_schema.schemata
       WHERE schema_name = 'pgboss'`,
    );
    await client.end();

    await boss.stop();

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.schema_name).toBe('pgboss');
  }, 60_000);

  it('pgboss tables do not appear in the public schema', async () => {
    const client = new pg.Client({ connectionString: ownerUrl });
    await client.connect();
    const result = await client.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name LIKE 'pgboss%'`,
    );
    await client.end();

    expect(result.rows).toHaveLength(0);
  }, 30_000);

  it('publishes a job with {tenantId} payload and a registered handler receives it', async () => {
    const boss = new PgBoss(ownerUrl);
    await boss.start();

    // pg-boss v10: createQueue must be called before send() on a new queue.
    await boss.createQueue(QUEUE.analyticsSummaryRefresh);

    const received: Array<{ tenantId: number }> = [];

    // pg-boss v10 work() handler receives Job<T>[] (an array, even with default batchSize=1).
    await boss.work<{ tenantId: number }>(
      QUEUE.analyticsSummaryRefresh,
      async (jobs: PgBoss.Job<{ tenantId: number }>[]) => {
        for (const job of jobs) {
          received.push(job.data);
        }
      },
    );

    await boss.send(QUEUE.analyticsSummaryRefresh, { tenantId: 99 });

    // pg-boss polls on a configurable interval (default ~2 s).
    // Wait up to 20 s for the job to be picked up.
    const deadline = Date.now() + 20_000;
    while (received.length === 0 && Date.now() < deadline) {
      await new Promise<void>((r) => setTimeout(r, 500));
    }

    await boss.stop();

    expect(received).toHaveLength(1);
    expect(received[0]!.tenantId).toBe(99);
  }, 60_000);

  it('completed job is no longer in the active jobs table', async () => {
    const boss = new PgBoss(ownerUrl);
    await boss.start();

    // pg-boss v10: createQueue is idempotent (ON CONFLICT DO NOTHING) — safe to call again.
    await boss.createQueue(QUEUE.analyticsSummaryRefresh);

    let resolveHandler!: () => void;
    const handlerDone = new Promise<void>((r) => {
      resolveHandler = r;
    });

    // pg-boss v10 work() handler receives Job<T>[] (array).
    await boss.work<{ tenantId: number }>(
      QUEUE.analyticsSummaryRefresh,
      async (_jobs: PgBoss.Job<{ tenantId: number }>[]) => {
        resolveHandler();
      },
    );

    const jobId = await boss.send(QUEUE.analyticsSummaryRefresh, { tenantId: 1 });

    // Wait for handler to fire
    await Promise.race([
      handlerDone,
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('handler timeout')), 20_000),
      ),
    ]);

    // Give pg-boss a moment to mark the job completed
    await new Promise<void>((r) => setTimeout(r, 1_500));

    const client = new pg.Client({ connectionString: ownerUrl });
    await client.connect();
    const result = await client.query<{ state: string }>(
      `SELECT state FROM pgboss.job WHERE id = $1`,
      [jobId],
    );
    await client.end();

    await boss.stop();

    // State should be 'completed', not 'active' or 'created'
    expect(result.rows[0]?.state).toBe('completed');
  }, 60_000);
});
