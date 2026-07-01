'use server';

import { revalidatePath } from 'next/cache';
import { forbidden } from 'next/navigation';
import { z } from 'zod';
import { requireSession } from '@/auth/session';
import { isValidOrigin } from '@/lib/csrf';
import { createCollection } from '@/lib/collections';
import { enqueueDiscogsListing, enqueueWishlistMatch } from '@/lib/jobs';

export type CreateCollectionResult =
  | { ok: true; collectionId: number; count: number }
  | { ok: false; reason: 'validation' | 'error'; message?: string };

// Item schema is verbatim the ankaufSchema object from '../actions' (kept local — a shared
// export would couple the two action files' zod graphs for no benefit).
const decimalString = z.string().regex(/^\d+(\.\d{1,2})?$/);
const itemSchema = z.object({
  release: z.object({
    discogsId: z.number().int(),
    title: z.string(),
    artist: z.string(),
    country: z.string().nullable(),
    year: z.number().int().nullable(),
    format: z.string().nullable(),
    genre: z.array(z.string()),
    label: z.array(z.string()),
    coverImage: z.string().nullable(),
  }),
  purchasePrice: decimalString,
  targetPrice: decimalString,
  conditionRecord: z.number().int().min(0).max(7),
  conditionCover: z.number().int().min(0).max(7),
  listOnDiscogs: z.boolean(),
});

const createCollectionSchema = z.object({
  sellerName: z.string().min(1),
  sellerContact: z.string().optional(),
  note: z.string().optional(),
  acquiredAt: z
    .string()
    .datetime()
    .optional()
    .transform((s) => (s ? new Date(s) : undefined)),
  items: z.array(itemSchema).min(1),
});

export async function createCollectionAction(input: unknown): Promise<CreateCollectionResult> {
  const user = await requireSession();
  if (user.role === 'kunde') forbidden();

  if (!(await isValidOrigin())) {
    return { ok: false, reason: 'error', message: 'Ungültige Herkunft (Origin).' };
  }

  const parsed = createCollectionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: 'validation', message: parsed.error.message };
  }

  const ctx = { tenantId: user.tenantId, userId: user.id };
  let collectionId: number;
  let purchaseIds: number[];
  let recordIds: number[];
  try {
    ({ collectionId, purchaseIds, recordIds } = await createCollection(ctx, parsed.data));
  } catch {
    return { ok: false, reason: 'error' };
  }

  revalidatePath('/inventar');
  revalidatePath('/');
  revalidatePath('/analytik');
  revalidatePath('/ankauf/sammlungen');

  // Post-commit, outside the tx, isolated per item — the collection is already committed, so a
  // failed enqueue must NOT roll it back (log + soft-continue). Mirrors ankaufRecord (C11).
  for (let i = 0; i < purchaseIds.length; i++) {
    const purchaseId = purchaseIds[i]!;
    const recordId = recordIds[i]!;
    try {
      await enqueueWishlistMatch({ tenantId: user.tenantId, purchaseId, recordId });
    } catch (err) {
      console.error('[sammlung] wishlist-match enqueue failed after collection committed', err);
    }

    if (parsed.data.items[i]!.listOnDiscogs) {
      try {
        await enqueueDiscogsListing({ tenantId: user.tenantId, purchaseId });
      } catch (err) {
        console.error('[sammlung] listing enqueue failed after collection committed', err);
      }
    }
  }

  return { ok: true, collectionId, count: purchaseIds.length };
}
