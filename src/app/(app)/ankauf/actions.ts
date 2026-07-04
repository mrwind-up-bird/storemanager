'use server';

import { revalidatePath } from 'next/cache';
import { forbidden } from 'next/navigation';
import { z } from 'zod';
import { requireSession } from '@/auth/session';
import { isValidOrigin } from '@/lib/csrf';
import { deleteConnection, getConnection } from '@/lib/discogs-connection';
import { getDiscogsAdapter } from '@/lib/discogs';
import { DiscogsAuthError } from '@/lib/discogs/types';
import type { DiscogsSearchResult, DiscogsPriceSuggestion } from '@/lib/discogs/types';
import { performAnkauf, type AnkaufInput } from '@/lib/ankauf';
import { enqueueDiscogsListing, enqueueWishlistMatch } from '@/lib/jobs';

export type SearchResultDTO = DiscogsSearchResult;

export async function searchDiscogs(
  query: string,
): Promise<
  { ok: true; results: SearchResultDTO[] } | { ok: false; reason: 'not_connected' | 'auth' | 'error' }
> {
  const user = await requireSession();
  const conn = await getConnection({ tenantId: user.tenantId, userId: user.id });
  if (!conn) return { ok: false, reason: 'not_connected' };

  const q = query.trim();
  if (!q) return { ok: true, results: [] };

  try {
    const results = await getDiscogsAdapter().search(conn.auth, q);
    return { ok: true, results };
  } catch (e) {
    if (e instanceof DiscogsAuthError) return { ok: false, reason: 'auth' };
    return { ok: false, reason: 'error' };
  }
}

export async function getPriceSuggestion(
  releaseId: number,
): Promise<
  | { ok: true; suggestion: DiscogsPriceSuggestion | null; median: number | null }
  | { ok: false; reason: 'not_connected' | 'auth' | 'error' }
> {
  const user = await requireSession();
  const conn = await getConnection({ tenantId: user.tenantId, userId: user.id });
  if (!conn) return { ok: false, reason: 'not_connected' };

  try {
    const suggestion = await getDiscogsAdapter().priceSuggestions(conn.auth, releaseId);
    // median is not re-fetched here; the modal passes the search-result median into
    // suggestSalePrice. Kept in the return type for forward-compat.
    return { ok: true, suggestion, median: null };
  } catch (e) {
    if (e instanceof DiscogsAuthError) return { ok: false, reason: 'auth' };
    return { ok: false, reason: 'error' };
  }
}

const decimalString = z.string().regex(/^\d+(\.\d{1,2})?$/);
const ankaufSchema = z.object({
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

export async function ankaufRecord(
  input: AnkaufInput,
): Promise<
  | { ok: true; recordId: number; purchaseId: number; listingSkipped?: boolean }
  | { ok: false; reason: 'not_connected' | 'validation' | 'error'; message?: string }
> {
  const user = await requireSession();

  if (!(await isValidOrigin())) {
    return { ok: false, reason: 'error', message: 'Ungültige Herkunft (Origin).' };
  }

  const conn = await getConnection({ tenantId: user.tenantId, userId: user.id });
  if (!conn) return { ok: false, reason: 'not_connected' };

  const parsed = ankaufSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: 'validation', message: parsed.error.message };
  }

  const ctx = { tenantId: user.tenantId, userId: user.id };
  let recordId: number;
  let purchaseId: number;
  try {
    ({ recordId, purchaseId } = await performAnkauf(ctx, parsed.data));
  } catch {
    return { ok: false, reason: 'error' };
  }

  revalidatePath('/inventar');
  revalidatePath('/');

  // Slice 3: match this arrived copy against open wishlists. Post-commit, soft-fail —
  // the purchase is already committed, so an enqueue error must NOT roll it back.
  try {
    await enqueueWishlistMatch({ tenantId: user.tenantId, purchaseId, recordId });
  } catch (err) {
    console.error('[ankauf] wishlist-match enqueue failed after purchase committed', err);
  }

  if (parsed.data.listOnDiscogs) {
    try {
      await enqueueDiscogsListing({ tenantId: user.tenantId, purchaseId });
    } catch (err) {
      console.error('[ankauf] listing enqueue failed after purchase committed', err);
      return { ok: true, recordId, purchaseId, listingSkipped: true };
    }
  }

  return { ok: true, recordId, purchaseId };
}

const barcodeSchema = z.string().trim().regex(/^\d{8,14}$/);

/** EAN/UPC → Discogs-Treffer (C6). Lesend — Konvention wie searchDiscogs (kein CSRF-Check). */
export async function searchDiscogsByBarcode(
  barcode: string,
): Promise<
  | { ok: true; results: SearchResultDTO[] }
  | { ok: false; reason: 'not_connected' | 'auth' | 'validation' | 'error' }
> {
  const user = await requireSession();
  if (user.role === 'kunde') forbidden(); // Spec §8.2: staff-only (strenger als searchDiscogs)
  const conn = await getConnection({ tenantId: user.tenantId, userId: user.id });
  if (!conn) return { ok: false, reason: 'not_connected' };

  const parsed = barcodeSchema.safeParse(barcode);
  if (!parsed.success) return { ok: false, reason: 'validation' };

  try {
    const results = await getDiscogsAdapter().searchByBarcode(conn.auth, parsed.data);
    return { ok: true, results };
  } catch (e) {
    if (e instanceof DiscogsAuthError) return { ok: false, reason: 'auth' };
    return { ok: false, reason: 'error' };
  }
}

export async function disconnectDiscogs(): Promise<void> {
  const user = await requireSession();
  if (!(user.role === 'admin' || user.isSuperadmin)) forbidden();
  if (!(await isValidOrigin())) return;
  await deleteConnection({ tenantId: user.tenantId, userId: user.id });
  revalidatePath('/ankauf');
}
