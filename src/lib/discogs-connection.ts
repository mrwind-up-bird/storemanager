import 'server-only';
import { eq } from 'drizzle-orm';
import { withTenant, type TenantCtx } from '@/db/tenant';
import { encryptSecret, decryptSecret } from '@/lib/crypto';
import { discogsConnections } from '@/db/schema';
import type { DiscogsAuth } from '@/lib/discogs/types';

export type DiscogsConnection = {
  discogsUsername: string;
  auth: DiscogsAuth; // decrypted
  connectedByUserId: number | null;
};

/** Decrypts tokens; null if no connection for this tenant. AAD = { tenantId } only. */
export async function getConnection(ctx: TenantCtx): Promise<DiscogsConnection | null> {
  return withTenant(ctx, async (tx) => {
    const rows = await tx.select().from(discogsConnections).limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      discogsUsername: row.discogsUsername,
      connectedByUserId: row.connectedByUserId ?? null,
      auth: {
        token: decryptSecret(row.oauthToken, { tenantId: ctx.tenantId }),
        tokenSecret: decryptSecret(row.oauthTokenSecret, { tenantId: ctx.tenantId }),
      },
    };
  });
}

/** Encrypts tokens (AAD = { tenantId }); upserts on unique(tenant_id). */
export async function upsertConnection(
  ctx: TenantCtx,
  input: { discogsUsername: string; auth: DiscogsAuth; connectedByUserId: number | null },
): Promise<void> {
  await withTenant(ctx, async (tx) => {
    await tx
      .insert(discogsConnections)
      .values({
        tenantId: ctx.tenantId,
        discogsUsername: input.discogsUsername,
        oauthToken: encryptSecret(input.auth.token, { tenantId: ctx.tenantId }),
        oauthTokenSecret: encryptSecret(input.auth.tokenSecret, { tenantId: ctx.tenantId }),
        connectedByUserId: input.connectedByUserId,
      })
      .onConflictDoUpdate({
        target: discogsConnections.tenantId,
        set: {
          discogsUsername: input.discogsUsername,
          oauthToken: encryptSecret(input.auth.token, { tenantId: ctx.tenantId }),
          oauthTokenSecret: encryptSecret(input.auth.tokenSecret, { tenantId: ctx.tenantId }),
          connectedByUserId: input.connectedByUserId,
          updatedAt: new Date(),
        },
      });
  });
}

export async function deleteConnection(ctx: TenantCtx): Promise<void> {
  await withTenant(ctx, async (tx) => {
    await tx.delete(discogsConnections).where(eq(discogsConnections.tenantId, ctx.tenantId));
  });
}
