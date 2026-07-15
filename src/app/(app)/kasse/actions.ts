'use server';

import { revalidatePath } from 'next/cache';
import { forbidden } from 'next/navigation';
import { z } from 'zod';
import { requireSession } from '@/auth/session';
import { isValidOrigin } from '@/lib/csrf';
import type { CartInput } from '@/lib/sales';
import { performSale, SaleConflictError, SalePriceMissingError } from '@/lib/performSale';
import {
  reserveCopy,
  cancelReservation as cancelReservationSvc,
  ReservationConflictError,
} from '@/lib/reservation';
import {
  createQuickItem as createQuickItemSvc,
  updateQuickItem as updateQuickItemSvc,
  deactivateQuickItem as deactivateQuickItemSvc,
} from '@/lib/quickItems';
import {
  findAvailableCopiesByRelease as findCopiesSvc,
  listInventory,
  type CopyHit,
} from '@/lib/inventory';

export type { CopyHit };

const decimalString = z.string().regex(/^\d+(\.\d{1,2})?$/);

const cartLineSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('inventory'), purchaseId: z.number().int().positive() }),
  z.object({
    kind: z.literal('quick'),
    quickItemId: z.number().int().positive(),
    quantity: z.number().int().min(1).max(999),
  }),
  z.object({
    kind: z.literal('adhoc'),
    label: z.string().min(1).max(200),
    unitPrice: decimalString,
    quantity: z.number().int().min(1).max(999),
  }),
]);

const discountSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('amount'), value: decimalString }),
  z.object({ kind: z.literal('percent'), value: z.number().min(0).max(100) }),
]);

const createSaleSchema = z
  .object({
    lines: z.array(cartLineSchema).min(1),
    payment: z.enum(['bar', 'karte', 'paypal', 'gutschein']),
    discount: discountSchema.nullable(),
    voucherCode: z.string().max(64).nullable().optional(),
  })
  .refine((d) => (d.payment === 'gutschein' ? !!d.voucherCode?.trim() : true), {
    message: 'voucherCode required when payment=gutschein',
    path: ['voucherCode'],
  })
  .refine(
    (d) => {
      const ids = d.lines.flatMap((l) => (l.kind === 'inventory' ? [l.purchaseId] : []));
      return new Set(ids).size === ids.length;
    },
    { message: 'duplicate inventory purchaseId in cart', path: ['lines'] },
  );

const purchaseIdSchema = z.object({ purchaseId: z.number().int().positive() });

const createQuickItemSchema = z.object({ name: z.string().trim().min(1).max(120), price: decimalString });
const updateQuickItemSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().trim().min(1).max(120).optional(),
  price: decimalString.optional(),
  active: z.boolean().optional(),
});
const deactivateQuickItemSchema = z.object({ id: z.number().int().positive() });

export async function createSale(
  input: CartInput,
): Promise<
  | { ok: true; transactionId: number; total: string }
  | { ok: false; reason: 'validation' | 'conflict' | 'error'; message?: string }
> {
  const user = await requireSession();
  if (user.role === 'kunde') forbidden();
  if (!(await isValidOrigin())) {
    return { ok: false, reason: 'error', message: 'Ungültige Herkunft (Origin).' };
  }

  const parsed = createSaleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: 'validation', message: parsed.error.message };
  }

  const ctx = { tenantId: user.tenantId, userId: user.id };
  try {
    const { transactionId, total } = await performSale(ctx, parsed.data);
    revalidatePath('/inventar');
    revalidatePath('/');
    revalidatePath('/kasse');
    return { ok: true, transactionId, total };
  } catch (err) {
    if (err instanceof SaleConflictError || err instanceof SalePriceMissingError) {
      return { ok: false, reason: 'conflict', message: err.message };
    }
    return { ok: false, reason: 'error' };
  }
}

export async function reserve(
  input: { purchaseId: number },
): Promise<{ ok: true } | { ok: false; reason: 'conflict' | 'validation' | 'error'; message?: string }> {
  const user = await requireSession();
  if (user.role === 'kunde') forbidden();
  if (!(await isValidOrigin())) {
    return { ok: false, reason: 'error', message: 'Ungültige Herkunft (Origin).' };
  }
  const parsed = purchaseIdSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: 'validation', message: parsed.error.message };
  }
  const ctx = { tenantId: user.tenantId, userId: user.id };
  try {
    await reserveCopy(ctx, parsed.data.purchaseId);
    revalidatePath('/inventar');
    return { ok: true };
  } catch (err) {
    if (err instanceof ReservationConflictError) {
      return { ok: false, reason: 'conflict', message: err.message };
    }
    return { ok: false, reason: 'error' };
  }
}

export async function cancelReservation(
  input: { purchaseId: number },
): Promise<{ ok: true } | { ok: false; reason: 'conflict' | 'validation' | 'error'; message?: string }> {
  const user = await requireSession();
  if (user.role === 'kunde') forbidden();
  if (!(await isValidOrigin())) {
    return { ok: false, reason: 'error', message: 'Ungültige Herkunft (Origin).' };
  }
  const parsed = purchaseIdSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: 'validation', message: parsed.error.message };
  }
  const ctx = { tenantId: user.tenantId, userId: user.id };
  try {
    await cancelReservationSvc(ctx, parsed.data.purchaseId);
    revalidatePath('/inventar');
    return { ok: true };
  } catch (err) {
    if (err instanceof ReservationConflictError) {
      return { ok: false, reason: 'conflict', message: err.message };
    }
    return { ok: false, reason: 'error' };
  }
}

export async function createQuickItem(
  input: { name: string; price: string },
): Promise<{ ok: true; id: number } | { ok: false; reason: 'validation' | 'error'; message?: string }> {
  const user = await requireSession();
  if (user.role === 'kunde') forbidden();
  if (!(await isValidOrigin())) {
    return { ok: false, reason: 'error', message: 'Ungültige Herkunft (Origin).' };
  }
  const parsed = createQuickItemSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: 'validation', message: parsed.error.message };
  }
  const ctx = { tenantId: user.tenantId, userId: user.id };
  try {
    const { id } = await createQuickItemSvc(ctx, parsed.data);
    revalidatePath('/kasse');
    return { ok: true, id };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

export async function updateQuickItem(
  input: { id: number; name?: string; price?: string; active?: boolean },
): Promise<{ ok: true } | { ok: false; reason: 'validation' | 'error'; message?: string }> {
  const user = await requireSession();
  if (user.role === 'kunde') forbidden();
  if (!(await isValidOrigin())) {
    return { ok: false, reason: 'error', message: 'Ungültige Herkunft (Origin).' };
  }
  const parsed = updateQuickItemSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: 'validation', message: parsed.error.message };
  }
  const { id, ...patch } = parsed.data;
  const ctx = { tenantId: user.tenantId, userId: user.id };
  try {
    await updateQuickItemSvc(ctx, id, patch);
    revalidatePath('/kasse');
    return { ok: true };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

export async function deactivateQuickItem(
  input: { id: number },
): Promise<{ ok: true } | { ok: false; reason: 'validation' | 'error'; message?: string }> {
  const user = await requireSession();
  if (user.role === 'kunde') forbidden();
  if (!(await isValidOrigin())) {
    return { ok: false, reason: 'error', message: 'Ungültige Herkunft (Origin).' };
  }
  const parsed = deactivateQuickItemSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: 'validation', message: parsed.error.message };
  }
  const ctx = { tenantId: user.tenantId, userId: user.id };
  try {
    await deactivateQuickItemSvc(ctx, parsed.data.id);
    revalidatePath('/kasse');
    return { ok: true };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

const releaseIdSchema = z.number().int().positive();

/** Etiketten-QR → verfügbare Exemplare dieses Releases (C6). Lesend, staff-only. */
export async function findAvailableCopiesByRelease(
  releaseId: number,
): Promise<{ ok: true; copies: CopyHit[] } | { ok: false; reason: 'validation' | 'error' }> {
  const user = await requireSession();
  if (user.role === 'kunde') forbidden();
  const parsed = releaseIdSchema.safeParse(releaseId);
  if (!parsed.success) return { ok: false, reason: 'validation' };
  try {
    const copies = await findCopiesSvc({ tenantId: user.tenantId, userId: user.id }, parsed.data);
    return { ok: true, copies };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

const copyQuerySchema = z.string().trim().min(1).max(80);

/** Textsuche über verfügbare Exemplare für den Schnellverkauf (C6/C9). Max. 8 Treffer. */
export async function searchAvailableCopies(
  query: string,
): Promise<{ ok: true; copies: CopyHit[] } | { ok: false; reason: 'validation' | 'error' }> {
  const user = await requireSession();
  if (user.role === 'kunde') forbidden();
  const parsed = copyQuerySchema.safeParse(query);
  if (!parsed.success) return { ok: false, reason: 'validation' };
  try {
    const { rows } = await listInventory(
      { tenantId: user.tenantId, userId: user.id },
      { q: parsed.data, status: 'verfuegbar' },
    );
    const copies: CopyHit[] = rows.slice(0, 8).map((r) => ({
      purchaseId: r.copyId,
      title: r.title,
      artist: r.artist,
      targetPrice: r.vk,
      conditionRecord: r.conditionRecord,
      conditionCover: r.conditionCover,
    }));
    return { ok: true, copies };
  } catch {
    return { ok: false, reason: 'error' };
  }
}
