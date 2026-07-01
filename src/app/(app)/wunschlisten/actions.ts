'use server';

import { revalidatePath } from 'next/cache';
import { forbidden } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireSession } from '@/auth/session';
import { isValidOrigin } from '@/lib/csrf';
import { withTenant } from '@/db/tenant';
import { wishlistMatches } from '@/db/schema';
import { createWishlist as createWishlistSvc, type CreateWishlistInput } from '@/lib/wishlist';
import { enqueueWishlistNotification } from '@/lib/jobs';

const createWishlistSchema = z.object({
  customerName: z.string().trim().min(1).max(200),
  customerEmail: z.string().trim().email().max(320),
  artist: z.string().trim().min(1).max(200),
  label: z.string().trim().max(200).nullish(),
  title: z.string().trim().max(200).nullish(),
  country: z.string().trim().max(120).nullish(),
});

const matchIdSchema = z.object({ matchId: z.number().int().positive() });

export async function createWishlist(
  input: CreateWishlistInput,
): Promise<{ ok: true; id: number } | { ok: false; reason: 'validation' | 'error'; message?: string }> {
  const user = await requireSession();
  if (user.role === 'kunde') forbidden();
  if (!(await isValidOrigin())) {
    return { ok: false, reason: 'error', message: 'Ungültige Herkunft (Origin).' };
  }
  const parsed = createWishlistSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: 'validation', message: parsed.error.message };
  }
  const ctx = { tenantId: user.tenantId, userId: user.id };
  try {
    const { id } = await createWishlistSvc(ctx, parsed.data);
    revalidatePath('/wunschlisten');
    return { ok: true, id };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

export async function notifyWishlistMatch(
  input: { matchId: number },
): Promise<
  { ok: true } | { ok: false; reason: 'validation' | 'not_found' | 'error'; message?: string }
> {
  const user = await requireSession();
  if (user.role === 'kunde') forbidden();
  if (!(await isValidOrigin())) {
    return { ok: false, reason: 'error', message: 'Ungültige Herkunft (Origin).' };
  }
  const parsed = matchIdSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: 'validation', message: parsed.error.message };
  }
  const ctx = { tenantId: user.tenantId, userId: user.id };

  // Read-then-enqueue (C11): load the match (RLS scopes to tenant) BEFORE enqueuing.
  let status: string | null;
  try {
    status = await withTenant(ctx, async (tx) => {
      const [row] = await tx
        .select({ status: wishlistMatches.status })
        .from(wishlistMatches)
        .where(eq(wishlistMatches.id, parsed.data.matchId));
      return row ? row.status : null;
    });
  } catch {
    return { ok: false, reason: 'error' };
  }

  if (status === null) return { ok: false, reason: 'not_found' };
  // Idempotent: only a 'pending' match enqueues. A double-click on an already notified/dismissed match is a
  // successful no-op (no redundant job stacked); the worker is also race-guarded (C9.4 SELECT … FOR UPDATE).
  if (status !== 'pending') {
    revalidatePath('/wunschlisten');
    return { ok: true };
  }

  try {
    await enqueueWishlistNotification({ tenantId: user.tenantId, matchId: parsed.data.matchId });
  } catch (err) {
    // soft-fail post-enqueue log (no DB state was mutated): surface as a structured error so the UI can retry.
    console.error('[wunschlisten] notify enqueue failed', err);
    return { ok: false, reason: 'error', message: 'Benachrichtigung konnte nicht eingereiht werden.' };
  }
  revalidatePath('/wunschlisten');
  return { ok: true };
}

export async function dismissMatch(
  input: { matchId: number },
): Promise<
  { ok: true } | { ok: false; reason: 'validation' | 'not_found' | 'error'; message?: string }
> {
  const user = await requireSession();
  if (user.role === 'kunde') forbidden();
  if (!(await isValidOrigin())) {
    return { ok: false, reason: 'error', message: 'Ungültige Herkunft (Origin).' };
  }
  const parsed = matchIdSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: 'validation', message: parsed.error.message };
  }
  const ctx = { tenantId: user.tenantId, userId: user.id };
  let updated = 0;
  try {
    updated = await withTenant(ctx, async (tx) => {
      const rows = await tx
        .update(wishlistMatches)
        .set({ status: 'dismissed' })
        .where(eq(wishlistMatches.id, parsed.data.matchId))
        .returning({ id: wishlistMatches.id });
      return rows.length;
    });
  } catch {
    return { ok: false, reason: 'error' };
  }
  // RLS scopes the UPDATE to the tenant — 0 rows means missing OR cross-tenant; both → not_found.
  if (updated === 0) return { ok: false, reason: 'not_found' };
  revalidatePath('/wunschlisten');
  return { ok: true };
}
