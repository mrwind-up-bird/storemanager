'use server';

import { revalidatePath } from 'next/cache';
import { forbidden } from 'next/navigation';
import { z } from 'zod';
import { requireSession } from '@/auth/session';
import { isValidOrigin } from '@/lib/csrf';
import { MONEY_STRING_RE } from '@/lib/money';
import { getEntitlements } from '@/lib/gating';
import { updateRecord, RecordHashConflictError } from '@/lib/records';
import { updatePurchase, addCopy, duplicateCopy, deleteCopy, CopyEditError } from '@/lib/copies';
import { enqueueEmbeddingRefresh, enqueueWishlistMatch, enqueueDiscogsListing } from '@/lib/jobs';

// ── shared field rules ───────────────────────────────────────────────────────
const decimalString = z.string().trim().regex(MONEY_STRING_RE);
const nullableDecimal = decimalString.nullable();
const shortText = z.string().trim().max(200);
const notesText = z.string().trim().max(4000);
const tagList = z.array(z.string().trim().min(1).max(80)).max(50);

type ActionErr = { ok: false; reason: 'validation' | 'conflict' | 'error'; message?: string };

function revalidateRecord(recordId: number): void {
  revalidatePath('/inventar');
  revalidatePath(`/inventar/${recordId}`);
  revalidatePath('/');
}

// ── Metadaten / Klassifizierung / Notizen (Edit-Modal · Tab 1+2) ─────────────
const updateRecordSchema = z.object({
  recordId: z.number().int().positive(),
  title: z.string().trim().min(1).max(300),
  artist: z.string().trim().min(1).max(300),
  label: z.array(shortText.min(1)).max(20),
  country: shortText.nullable(),
  releaseYear: z.number().int().min(0).max(3000).nullable(),
  format: shortText.nullable(),
  genre: tagList,
  styles: tagList,
  tags: tagList,
  notes: notesText.nullable(),
});

export async function updateRecordAction(
  input: unknown,
): Promise<{ ok: true } | ActionErr> {
  const user = await requireSession();
  if (user.role === 'kunde') forbidden();
  if (!(await isValidOrigin())) return { ok: false, reason: 'error', message: 'Ungültige Herkunft (Origin).' };

  const parsed = updateRecordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: 'validation', message: 'Ungültige Eingaben.' };

  const ctx = { tenantId: user.tenantId, userId: user.id };
  const { recordId, ...patch } = parsed.data;
  try {
    await updateRecord(ctx, recordId, patch);
  } catch (err) {
    if (err instanceof RecordHashConflictError) return { ok: false, reason: 'conflict', message: err.message };
    console.error('[inventar] updateRecord failed', err);
    return { ok: false, reason: 'error' };
  }

  revalidateRecord(recordId);
  // Metadata drives the semantic-search document → re-index. Post-commit, soft-fail.
  try {
    await enqueueEmbeddingRefresh({ tenantId: user.tenantId, recordId });
  } catch (err) {
    console.error('[inventar] embedding-refresh enqueue failed after record update', err);
  }
  return { ok: true };
}

// ── Exemplar patch (Edit-Modal · Tab 3 „Bestand & Finanzen") ──────────────────
const updatePurchaseSchema = z.object({
  purchaseId: z.number().int().positive(),
  purchasePrice: nullableDecimal,
  targetPrice: nullableDecimal,
  conditionRecord: z.number().int().min(0).max(7).nullable(),
  conditionCover: z.number().int().min(0).max(7).nullable(),
  status: z.enum(['verfuegbar', 'reserviert', 'verliehen']),
  notes: notesText.nullable(),
});

function mapCopyError(err: unknown): ActionErr | null {
  if (err instanceof CopyEditError) {
    const msg: Record<string, string> = {
      not_found: 'Exemplar nicht gefunden.',
      sold_immutable: 'Verkaufte Exemplare können nicht bearbeitet oder gelöscht werden.',
      referenced: 'Exemplar ist mit einem Verkauf verknüpft und kann nicht gelöscht werden.',
      invalid_status: 'Verkauf läuft über die Kasse — Status „verkauft" ist hier nicht setzbar.',
    };
    return { ok: false, reason: 'validation', message: msg[err.reason] ?? 'Aktion nicht möglich.' };
  }
  return null;
}

export async function updatePurchaseAction(input: unknown): Promise<{ ok: true } | ActionErr> {
  const user = await requireSession();
  if (user.role === 'kunde') forbidden();
  if (!(await isValidOrigin())) return { ok: false, reason: 'error', message: 'Ungültige Herkunft (Origin).' };

  const parsed = updatePurchaseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: 'validation', message: 'Ungültige Eingaben.' };

  const ctx = { tenantId: user.tenantId, userId: user.id };
  const { purchaseId, ...patch } = parsed.data;
  let recordId: number;
  try {
    ({ recordId } = await updatePurchase(ctx, purchaseId, patch));
  } catch (err) {
    const mapped = mapCopyError(err);
    if (mapped) return mapped;
    console.error('[inventar] updatePurchase failed', err);
    return { ok: false, reason: 'error' };
  }
  revalidateRecord(recordId);
  return { ok: true };
}

// ── Neues Exemplar (Edit-Modal · „Neuer Ankauf") ──────────────────────────────
const addCopySchema = z.object({
  recordId: z.number().int().positive(),
  purchasePrice: nullableDecimal,
  targetPrice: nullableDecimal,
  conditionRecord: z.number().int().min(0).max(7),
  conditionCover: z.number().int().min(0).max(7),
  notes: notesText.nullable().optional(),
  listOnDiscogs: z.boolean().default(false),
});

export async function addCopyAction(
  input: unknown,
): Promise<{ ok: true; purchaseId: number } | ActionErr> {
  const user = await requireSession();
  if (user.role === 'kunde') forbidden();
  if (!(await isValidOrigin())) return { ok: false, reason: 'error', message: 'Ungültige Herkunft (Origin).' };

  const parsed = addCopySchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: 'validation', message: 'Ungültige Eingaben.' };

  const ctx = { tenantId: user.tenantId, userId: user.id };
  if (parsed.data.listOnDiscogs) {
    const ent = await getEntitlements(user.tenantId);
    if (!ent.features.discogsListing) {
      return {
        ok: false,
        reason: 'validation',
        message: `Discogs-Listing ist im ${ent.planName}-Plan nicht verfügbar. Upgrade unter Einstellungen → Abo.`,
      };
    }
  }

  const { recordId, ...rest } = parsed.data;
  let purchaseId: number;
  try {
    ({ purchaseId } = await addCopy(ctx, recordId, rest));
  } catch (err) {
    const mapped = mapCopyError(err);
    if (mapped) return mapped;
    console.error('[inventar] addCopy failed', err);
    return { ok: false, reason: 'error' };
  }

  revalidateRecord(recordId);
  // A newly-arrived available copy may satisfy open wishlists. Post-commit, soft-fail.
  try {
    await enqueueWishlistMatch({ tenantId: user.tenantId, purchaseId, recordId });
  } catch (err) {
    console.error('[inventar] wishlist-match enqueue failed after addCopy', err);
  }
  if (parsed.data.listOnDiscogs) {
    try {
      await enqueueDiscogsListing({ tenantId: user.tenantId, purchaseId });
    } catch (err) {
      console.error('[inventar] listing enqueue failed after addCopy', err);
    }
  }
  return { ok: true, purchaseId };
}

const purchaseIdSchema = z.object({ purchaseId: z.number().int().positive() });

export async function duplicateCopyAction(input: unknown): Promise<{ ok: true } | ActionErr> {
  const user = await requireSession();
  if (user.role === 'kunde') forbidden();
  if (!(await isValidOrigin())) return { ok: false, reason: 'error', message: 'Ungültige Herkunft (Origin).' };

  const parsed = purchaseIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: 'validation', message: 'Ungültige Eingaben.' };

  const ctx = { tenantId: user.tenantId, userId: user.id };
  try {
    const { recordId } = await duplicateCopy(ctx, parsed.data.purchaseId);
    revalidateRecord(recordId);
  } catch (err) {
    const mapped = mapCopyError(err);
    if (mapped) return mapped;
    console.error('[inventar] duplicateCopy failed', err);
    return { ok: false, reason: 'error' };
  }
  return { ok: true };
}

export async function deleteCopyAction(input: unknown): Promise<{ ok: true } | ActionErr> {
  const user = await requireSession();
  if (user.role === 'kunde') forbidden();
  if (!(await isValidOrigin())) return { ok: false, reason: 'error', message: 'Ungültige Herkunft (Origin).' };

  const parsed = purchaseIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: 'validation', message: 'Ungültige Eingaben.' };

  const ctx = { tenantId: user.tenantId, userId: user.id };
  try {
    const { recordId } = await deleteCopy(ctx, parsed.data.purchaseId);
    revalidateRecord(recordId);
  } catch (err) {
    const mapped = mapCopyError(err);
    if (mapped) return mapped;
    console.error('[inventar] deleteCopy failed', err);
    return { ok: false, reason: 'error' };
  }
  return { ok: true };
}
