import 'server-only';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import { appPool, ownerPool } from '@/db/client';
import * as schema from '@/db/schema';

export type TenantCtx = { tenantId: number; userId: number | null };
export type Tx = Parameters<Parameters<NodePgDatabase<typeof schema>['transaction']>[0]>[0];

/** Pre-stringified GUC values for a single set_config statement. */
type GucCtx = { tenantId: string; userId: string; isSuperadmin: boolean };

async function runInTx<T>(pool: Pool, ctx: GucCtx, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const db = drizzle(pool, { schema });
  return db.transaction(async (tx) => {
    // Transaction-local (is_local = true). NEVER connection-scoped `SET` — that leaks across the pool.
    // The `${…}` interpolations are drizzle bound params, so the GUC values are injection-safe.
    await tx.execute(sql`select
      set_config('app.current_tenant', ${ctx.tenantId}, true),
      set_config('app.current_user_id', ${ctx.userId}, true),
      set_config('app.is_superadmin', ${ctx.isSuperadmin ? 'true' : 'false'}, true)`);
    return fn(tx);
  });
}

/** Tenant-scoped runtime access. `is_superadmin` is ALWAYS reset to false here — never inherited. */
export async function withTenant<T>(ctx: TenantCtx, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!Number.isInteger(ctx.tenantId)) {
    throw new Error(`withTenant: tenantId must be an integer, got ${String(ctx.tenantId)}`);
  }
  if (ctx.userId !== null && !Number.isInteger(ctx.userId)) {
    throw new Error(`withTenant: userId must be an integer or null, got ${String(ctx.userId)}`);
  }
  return runInTx(
    appPool,
    {
      tenantId: String(ctx.tenantId),
      userId: ctx.userId === null ? '' : String(ctx.userId),
      isSuperadmin: false,
    },
    fn,
  );
}

/** Platform-wide access (no tenant). Uses appPool; trips the superadmin_bypass policy. */
export async function withSuperadmin<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return runInTx(appPool, { tenantId: '', userId: '', isSuperadmin: true }, fn);
}

/** Owner pool (qr_owner) for registry/migration work. No tenant context, not superadmin. */
export async function withOwner<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return runInTx(ownerPool, { tenantId: '', userId: '', isSuperadmin: false }, fn);
}
