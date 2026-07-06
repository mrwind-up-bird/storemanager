'use server';

import { revalidatePath } from 'next/cache';
import { forbidden } from 'next/navigation';
import { z } from 'zod';
import { requireSession } from '@/auth/session';
import { isValidOrigin } from '@/lib/csrf';
import { createCollection } from '@/lib/collections';
import { enqueueDiscogsListing, enqueueWishlistMatch } from '@/lib/jobs';
import { MONEY_STRING_RE } from '@/lib/money';
import { getEntitlements, LimitExceededError } from '@/lib/gating';

export type CreateCollectionResult =
  | { ok: true; collectionId: number; count: number }
  | { ok: false; reason: 'validation' | 'error'; message?: string };

// Item schema mirrors the ankaufSchema object from '../actions' (kept local — a shared
// export would couple the two action files' zod graphs for no benefit), except `discogsId`
// is nullable here: batch-Ankauf items may be sourced manually (off-Discogs), whereas the
// single-item AnkaufModal always carries a real Discogs id.
// `.trim()` before `.regex()` so a stray leading/trailing space (a client input can produce one
// even after the wizard's own trim-on-submit) doesn't reject what `toCents`/the client would
// otherwise accept — the client and server must agree on exactly the same decimal-string rule.
const decimalString = z.string().trim().regex(MONEY_STRING_RE);
const itemSchema = z.object({
  release: z.object({
    discogsId: z.number().int().nullable(),
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
    // Never surface the raw (English) zod issue list to German-speaking staff — the client
    // already gates the submit button on per-item validity, so reaching here means either a
    // client bug or a hand-crafted request; either way this message is generic on purpose.
    return {
      ok: false,
      reason: 'validation',
      message: 'Ungültige Eingaben — bitte Preise und Pflichtfelder aller Artikel prüfen.',
    };
  }

  const ctx = { tenantId: user.tenantId, userId: user.id };
  const ent = await getEntitlements(user.tenantId);

  if (parsed.data.items.some((i) => i.listOnDiscogs) && !ent.features.discogsListing) {
    return {
      ok: false,
      reason: 'validation',
      message: `Discogs-Listing ist im ${ent.planName}-Plan nicht verfügbar. Upgrade unter Einstellungen → Abo.`,
    };
  }

  let collectionId: number;
  let purchaseIds: number[];
  let recordIds: number[];
  try {
    ({ collectionId, purchaseIds, recordIds } = await createCollection(ctx, parsed.data, ent));
  } catch (err) {
    if (err instanceof LimitExceededError) {
      return { ok: false, reason: 'validation', message: err.message };
    }
    console.error('[sammlung] createCollection failed', err);
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
