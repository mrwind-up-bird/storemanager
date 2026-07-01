import { describe, it, expect } from 'vitest';
import {
  computeCartTotals,
  type ResolvedCartLine,
  type DiscountInput,
  type CartInput,
} from '@/lib/sales';

const lines = (...ls: ResolvedCartLine[]) => ls;

describe('computeCartTotals — subtotal', () => {
  it('sums unitPrice * quantity across lines, returning 2-decimal strings', () => {
    const r = computeCartTotals(
      lines(
        { label: 'A', unitPrice: '10.00', quantity: 2 },
        { label: 'B', unitPrice: '2.50', quantity: 3 },
      ),
      null,
    );
    expect(r).toEqual({ subtotal: '27.50', discount: '0.00', total: '27.50' });
  });

  it('returns all-zero strings for an empty cart (subtotalCents=0 ⇒ discount clamps to 0)', () => {
    expect(computeCartTotals([], null)).toEqual({
      subtotal: '0.00',
      discount: '0.00',
      total: '0.00',
    });
  });
});

describe('computeCartTotals — discount', () => {
  const base = lines({ label: 'A', unitPrice: '100.00', quantity: 1 });

  it('applies a fixed amount discount', () => {
    const d: DiscountInput = { kind: 'amount', value: '15.00' };
    expect(computeCartTotals(base, d)).toEqual({
      subtotal: '100.00',
      discount: '15.00',
      total: '85.00',
    });
  });

  it('applies a percent discount resolved to cents (half-up)', () => {
    const d: DiscountInput = { kind: 'percent', value: 10 };
    expect(computeCartTotals(base, d)).toEqual({
      subtotal: '100.00',
      discount: '10.00',
      total: '90.00',
    });
  });

  it('rounds a percent discount half-up at the cent boundary', () => {
    // 3% of 12.34 (1234c) = 37.02c -> 37c -> 0.37
    const d: DiscountInput = { kind: 'percent', value: 3 };
    expect(computeCartTotals(lines({ label: 'A', unitPrice: '12.34', quantity: 1 }), d)).toEqual({
      subtotal: '12.34',
      discount: '0.37',
      total: '11.97',
    });
  });

  it('clamps a discount greater than subtotal down to subtotal (total never negative)', () => {
    const d: DiscountInput = { kind: 'amount', value: '500.00' };
    expect(computeCartTotals(base, d)).toEqual({
      subtotal: '100.00',
      discount: '100.00',
      total: '0.00',
    });
  });

  it('clamps a percent discount of 150% to subtotal', () => {
    const d: DiscountInput = { kind: 'percent', value: 100 };
    expect(computeCartTotals(base, d)).toEqual({
      subtotal: '100.00',
      discount: '100.00',
      total: '0.00',
    });
  });

  it('clamps a negative amount discount up to 0', () => {
    const d: DiscountInput = { kind: 'amount', value: '-5.00' };
    expect(computeCartTotals(base, d)).toEqual({
      subtotal: '100.00',
      discount: '0.00',
      total: '100.00',
    });
  });
});

describe('CartInput shape', () => {
  it('accepts inventory / quick / adhoc lines and amount/percent discount', () => {
    const cart: CartInput = {
      lines: [
        { kind: 'inventory', purchaseId: 7 },
        { kind: 'quick', quickItemId: 3, quantity: 2 },
        { kind: 'adhoc', label: 'Kaffee', unitPrice: '2.50', quantity: 1 },
      ],
      payment: 'bar',
      discount: { kind: 'percent', value: 5 },
      voucherCode: null,
    };
    expect(cart.lines).toHaveLength(3);
    expect(cart.payment).toBe('bar');
  });
});
