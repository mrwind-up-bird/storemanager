// tests/app/kasse.component.test.tsx
// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom/vitest" />

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

// vi.hoisted ensures these fn refs are available inside the vi.mock() factory
// (which is statically hoisted above all imports by Vitest).
const createSale = vi.hoisted(() =>
  vi.fn(async () => ({ ok: true as const, transactionId: 1, total: '0.00' })),
);
vi.mock('@/app/(app)/kasse/actions', () => ({ createSale }));

import { PaymentCluster } from '@/app/(app)/kasse/_components/PaymentCluster';
import { DiscountInput } from '@/app/(app)/kasse/_components/DiscountInput';
import { Cart, type UiCartLine } from '@/app/(app)/kasse/_components/Cart';
import { InventorySearch } from '@/app/(app)/kasse/_components/InventorySearch';
import { QuickItemButtons } from '@/app/(app)/kasse/_components/QuickItemButtons';
import { AdhocAdd } from '@/app/(app)/kasse/_components/AdhocAdd';
import { KasseScreen } from '@/app/(app)/kasse/_components/KasseScreen';
import type { InventoryRow } from '@/lib/inventory';
import type { QuickItemRow } from '@/lib/quickItems';

const fxInventory: InventoryRow[] = [
  {
    copyId: 101, recordId: 11, title: 'Kind of Blue', artist: 'Miles Davis', label: ['Columbia'],
    releaseYear: 1959, country: 'US', format: 'Vinyl', genre: ['Jazz'], ek: '8.00', vk: '20.00',
    status: 'verfuegbar', conditionRecord: 5, conditionCover: 4, discogsId: null,
  },
];
const fxQuickItems: QuickItemRow[] = [{ id: 7, name: 'Kaffee', price: '2.50', active: true }];

function beforeEachReset() {
  beforeEach(() => {
    createSale.mockClear();
    createSale.mockResolvedValue({ ok: true, transactionId: 1, total: '0.00' });
  });
}

// ── PaymentCluster ─────────────────────────────────────────────────────────────

describe('PaymentCluster', () => {
  afterEach(cleanup);

  it('renders four payment methods and toggles the voucher field for gutschein', () => {
    const onPaymentChange = vi.fn();
    const onVoucherChange = vi.fn();
    const { rerender } = render(
      <PaymentCluster
        payment="bar"
        voucherCode=""
        onPaymentChange={onPaymentChange}
        onVoucherChange={onVoucherChange}
      />,
    );
    for (const m of ['bar', 'karte', 'paypal', 'gutschein']) {
      expect(screen.getByTestId(`kasse-pay-${m}`)).toBeInTheDocument();
    }
    // voucher field hidden unless payment === 'gutschein'
    expect(screen.queryByTestId('voucher-code-input')).toBeNull();

    fireEvent.click(screen.getByTestId('kasse-pay-gutschein'));
    expect(onPaymentChange).toHaveBeenCalledWith('gutschein');

    rerender(
      <PaymentCluster
        payment="gutschein"
        voucherCode=""
        onPaymentChange={onPaymentChange}
        onVoucherChange={onVoucherChange}
      />,
    );
    expect(screen.getByTestId('voucher-code-input')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('voucher-code-input'), { target: { value: 'XMAS' } });
    expect(onVoucherChange).toHaveBeenCalledWith('XMAS');
  });
});

// ── DiscountInput ──────────────────────────────────────────────────────────────

describe('DiscountInput', () => {
  afterEach(cleanup);

  it('switches the discount kind via kasse-discount-mode and reports value changes', () => {
    const onModeChange = vi.fn();
    const onValueChange = vi.fn();
    render(
      <DiscountInput mode="amount" value="" onModeChange={onModeChange} onValueChange={onValueChange} />,
    );
    fireEvent.change(screen.getByTestId('kasse-discount-mode'), { target: { value: 'percent' } });
    expect(onModeChange).toHaveBeenCalledWith('percent');
    fireEvent.change(screen.getByTestId('kasse-discount-input'), { target: { value: '10' } });
    expect(onValueChange).toHaveBeenCalledWith('10');
  });
});

// ── Cart ───────────────────────────────────────────────────────────────────────

describe('Cart', () => {
  afterEach(cleanup);

  const lines: UiCartLine[] = [
    { key: 'quick-7', kind: 'quick', quickItemId: 7, label: 'Kaffee', unitPrice: '2.50', quantity: 2 },
  ];

  it('disables submit when empty, then renders items + total and fires onSubmit', () => {
    const onRemove = vi.fn();
    const onSubmit = vi.fn();
    const { rerender } = render(
      <Cart
        lines={[]}
        totals={{ subtotal: '0.00', discount: '0.00', total: '0.00' }}
        onRemove={onRemove}
        onSubmit={onSubmit}
        submitting={false}
      />,
    );
    expect(screen.getByTestId('kasse-cart')).toBeInTheDocument();
    expect(screen.getByTestId('kasse-total')).toHaveTextContent('0.00');
    expect(screen.getByTestId('kasse-submit')).toBeDisabled();

    rerender(
      <Cart
        lines={lines}
        totals={{ subtotal: '5.00', discount: '0.00', total: '5.00' }}
        onRemove={onRemove}
        onSubmit={onSubmit}
        submitting={false}
      />,
    );
    expect(screen.getByTestId('kasse-cart-item-quick-7')).toBeInTheDocument();
    expect(screen.getByTestId('kasse-total')).toHaveTextContent('5.00');
    expect(screen.getByTestId('kasse-submit')).toBeEnabled();

    fireEvent.click(screen.getByTestId('kasse-submit'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

// ── Selection controls ─────────────────────────────────────────────────────────

describe('selection controls', () => {
  afterEach(cleanup);

  it('InventorySearch filters by query and emits the picked row', async () => {
    const onAdd = vi.fn();
    render(<InventorySearch rows={fxInventory} onAdd={onAdd} />);
    // nothing rendered until the operator types
    expect(screen.queryByRole('button', { name: /Kind of Blue/ })).toBeNull();
    fireEvent.change(screen.getByTestId('kasse-inventory-search'), { target: { value: 'miles' } });
    fireEvent.click(await screen.findByRole('button', { name: /Kind of Blue/ }));
    expect(onAdd).toHaveBeenCalledWith(fxInventory[0]);
  });

  it('QuickItemButtons renders a button per active item and emits it', () => {
    const onAdd = vi.fn();
    render(<QuickItemButtons items={fxQuickItems} onAdd={onAdd} />);
    fireEvent.click(screen.getByTestId('kasse-quick-item-7'));
    expect(onAdd).toHaveBeenCalledWith(fxQuickItems[0]);
  });

  it('AdhocAdd validates name + price before enabling kasse-adhoc-add', () => {
    const onAdd = vi.fn();
    render(<AdhocAdd onAdd={onAdd} />);
    expect(screen.getByTestId('kasse-adhoc-add')).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Bezeichnung'), { target: { value: 'Poster' } });
    fireEvent.change(screen.getByPlaceholderText('Preis'), { target: { value: '5.00' } });
    expect(screen.getByTestId('kasse-adhoc-add')).toBeEnabled();
    fireEvent.click(screen.getByTestId('kasse-adhoc-add'));
    expect(onAdd).toHaveBeenCalledWith('Poster', '5.00');
  });
});

// ── KasseScreen (integration) ──────────────────────────────────────────────────

describe('KasseScreen', () => {
  afterEach(cleanup);
  beforeEachReset();

  function renderScreen() {
    return render(<KasseScreen inventory={fxInventory} quickItems={fxQuickItems} />);
  }

  it('renders the POS shell with an empty cart and disabled submit', () => {
    renderScreen();
    expect(screen.getByTestId('kasse-screen')).toBeInTheDocument();
    expect(screen.getByTestId('kasse-inventory-search')).toBeInTheDocument();
    expect(screen.getByTestId('kasse-quick-item-7')).toBeInTheDocument();
    expect(screen.getByTestId('kasse-adhoc-add')).toBeInTheDocument();
    expect(screen.getByTestId('kasse-cart')).toBeInTheDocument();
    expect(screen.getByTestId('kasse-total')).toHaveTextContent('0.00');
    expect(screen.getByTestId('kasse-submit')).toBeDisabled();
  });

  it('adds an inventory copy from search and reflects its VK in the total', async () => {
    renderScreen();
    fireEvent.change(screen.getByTestId('kasse-inventory-search'), { target: { value: 'miles' } });
    fireEvent.click(await screen.findByRole('button', { name: /Kind of Blue/ }));
    expect(screen.getByTestId('kasse-cart-item-inv-101')).toBeInTheDocument();
    expect(screen.getByTestId('kasse-total')).toHaveTextContent('20.00');
    expect(screen.getByTestId('kasse-submit')).toBeEnabled();
  });

  it('never adds the same inventory copy twice (inv-<purchaseId> single-instance)', async () => {
    renderScreen();
    fireEvent.change(screen.getByTestId('kasse-inventory-search'), { target: { value: 'miles' } });
    fireEvent.click(await screen.findByRole('button', { name: /Kind of Blue/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Kind of Blue/ }));
    expect(screen.getAllByTestId('kasse-cart-item-inv-101')).toHaveLength(1);
    expect(screen.getByTestId('kasse-total')).toHaveTextContent('20.00');
  });

  it('adds a quick item and an ad-hoc line, summing via computeCartTotals', () => {
    renderScreen();
    fireEvent.click(screen.getByTestId('kasse-quick-item-7')); // 2.50
    expect(screen.getByTestId('kasse-cart-item-quick-7')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Bezeichnung'), { target: { value: 'Poster' } });
    fireEvent.change(screen.getByPlaceholderText('Preis'), { target: { value: '5.00' } });
    fireEvent.click(screen.getByTestId('kasse-adhoc-add'));
    expect(screen.getByTestId('kasse-cart-item-adhoc-0')).toBeInTheDocument();
    expect(screen.getByTestId('kasse-total')).toHaveTextContent('7.50'); // 2.50 + 5.00
  });

  it('applies a percent discount via kasse-discount-mode (integer-cent math)', () => {
    renderScreen();
    fireEvent.click(screen.getByTestId('kasse-quick-item-7')); // 2.50
    fireEvent.change(screen.getByTestId('kasse-discount-mode'), { target: { value: 'percent' } });
    fireEvent.change(screen.getByTestId('kasse-discount-input'), { target: { value: '10' } });
    expect(screen.getByTestId('kasse-total')).toHaveTextContent('2.25'); // 2.50 - 10%
  });

  it('reveals the voucher field only for gutschein payment', () => {
    renderScreen();
    expect(screen.queryByTestId('voucher-code-input')).toBeNull();
    fireEvent.click(screen.getByTestId('kasse-pay-gutschein'));
    expect(screen.getByTestId('voucher-code-input')).toBeInTheDocument();
  });

  it('submits the RESOLVED CartInput to createSale exactly once and clears the cart', async () => {
    renderScreen();
    fireEvent.click(screen.getByTestId('kasse-quick-item-7')); // quick 7 x1
    fireEvent.click(screen.getByTestId('kasse-pay-karte'));
    fireEvent.click(screen.getByTestId('kasse-submit'));
    await waitFor(() => expect(createSale).toHaveBeenCalledTimes(1));
    // non-vacuous: exact stripped payload (no display fields, no client price on inventory/quick)
    expect(createSale).toHaveBeenCalledWith({
      lines: [{ kind: 'quick', quickItemId: 7, quantity: 1 }],
      payment: 'karte',
      discount: null,
      voucherCode: null,
    });
    await waitFor(() => expect(screen.queryByTestId('kasse-cart-item-quick-7')).toBeNull());
    expect(screen.getByTestId('kasse-submit')).toBeDisabled();
  });
});
