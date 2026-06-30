import type { PaymentMethod } from '@/db/schema';
import { toCents, fromCents, percentToCents, clamp, sumLineCents } from '@/lib/money';

export type { PaymentMethod }; // re-export for UI/action ergonomics

/** Client-submitted cart line (what `createSale` receives). Prices for inventory/quick are NOT trusted. */
export type CartLineInput =
  | { kind: 'inventory'; purchaseId: number }
  | { kind: 'quick'; quickItemId: number; quantity: number }
  | { kind: 'adhoc'; label: string; unitPrice: string; quantity: number };

/** Server-resolved line: unitPrice is authoritative (DB targetPrice / quick catalog / ad-hoc client value). */
export type ResolvedCartLine = {
  label: string;
  unitPrice: string; // numeric(10,2) decimal string
  quantity: number; // >= 1
};

/** Transaction-level discount. Percent is 0..100; amount is a decimal euro string. */
export type DiscountInput =
  | { kind: 'amount'; value: string }
  | { kind: 'percent'; value: number };

/** Full client cart payload (POS screen + single-sell modal both produce this shape).
 *  This is THE one name for the cart concept: `performSale` reuses it as `PerformSaleInput` (C5). */
export type CartInput = {
  lines: CartLineInput[];
  payment: PaymentMethod;
  discount: DiscountInput | null;
  voucherCode?: string | null;
};

/** Computed money outputs, all as 2-decimal strings. total = subtotal - discount. */
export type CartTotals = {
  subtotal: string;
  discount: string; // clamped to [0, subtotal]
  total: string;
};

/**
 * Pure totals computation. discount is clamped: 0 <= discount <= subtotal.
 * Locked semantics:
 *   subtotalCents = Σ toCents(line.unitPrice) * line.quantity
 *   discountCents = amount→toCents(value) | percent→percentToCents(subtotalCents, value) | null→0
 *   discountCents = clamp(discountCents, 0, subtotalCents)
 *   totalCents    = subtotalCents - discountCents
 * Empty input (lines=[]) → { subtotal:'0.00', discount:'0.00', total:'0.00' } (subtotalCents=0 ⇒ discount
 *   clamps to 0). The ACTION layer rejects empty carts via `createSaleSchema.lines.min(1)`, so `performSale`
 *   never receives an empty cart; this line documents the pure function's behaviour for T2 unit tests.
 */
export function computeCartTotals(
  lines: ResolvedCartLine[],
  discount: DiscountInput | null,
): CartTotals {
  const subtotalCents = sumLineCents(
    lines.map((l) => ({ unitCents: toCents(l.unitPrice), quantity: l.quantity })),
  );
  let discountCents = 0;
  if (discount) {
    discountCents = discount.kind === 'amount'
      ? toCents(discount.value)
      : percentToCents(subtotalCents, discount.value);
  }
  discountCents = clamp(discountCents, 0, subtotalCents);
  const totalCents = subtotalCents - discountCents;
  return {
    subtotal: fromCents(subtotalCents),
    discount: fromCents(discountCents),
    total: fromCents(totalCents),
  };
}
