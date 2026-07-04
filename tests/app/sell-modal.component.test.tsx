// tests/app/sell-modal.component.test.tsx
// @vitest-environment jsdom

/// <reference types="@testing-library/jest-dom/vitest" />

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';

// vi.hoisted so the fn refs exist inside the statically-hoisted vi.mock factory.
const createSale = vi.hoisted(() =>
  vi.fn(
    async (): Promise<
      | { ok: true; transactionId: number; total: string }
      | { ok: false; reason: 'validation' | 'conflict' | 'error'; message?: string }
    > => ({ ok: true, transactionId: 1, total: '28.00' }),
  ),
);
const reserve = vi.hoisted(() => vi.fn(async () => ({ ok: true as const })));
const cancelReservation = vi.hoisted(() => vi.fn(async () => ({ ok: true as const })));

vi.mock('@/app/(app)/kasse/actions', () => ({ createSale, reserve, cancelReservation }));

// InventoryList (tested below) now calls useRouter().refresh() on action failure.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { SellModal } from '@/app/(app)/inventar/_components/SellModal';
import { InventoryList } from '@/app/(app)/inventar/_components/InventoryList';
import type { InventoryRow } from '@/lib/inventory';

const baseRow: InventoryRow = {
  copyId: 7,
  recordId: 70,
  title: 'Violator',
  artist: 'Depeche Mode',
  label: ['Mute'],
  releaseYear: 1990,
  country: 'DE',
  format: 'Vinyl',
  genre: ['Electronic'],
  ek: '8.00',
  vk: '28.00',
  status: 'verfuegbar',
  conditionRecord: 5,
  conditionCover: 5,
  discogsId: null,
};

beforeEach(() => {
  createSale.mockClear();
  reserve.mockClear();
  cancelReservation.mockClear();
  createSale.mockResolvedValue({ ok: true, transactionId: 1, total: '28.00' });
  reserve.mockResolvedValue({ ok: true });
  cancelReservation.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe('SellModal (§5.2)', () => {
  it('renders the handoff cluster with a READ-ONLY price showing the stored targetPrice', () => {
    render(
      <SellModal purchaseId={7} title="Violator" artist="Depeche Mode" targetPrice="28.00" onClose={() => {}} />,
    );
    expect(screen.getByTestId('sell-modal')).toBeInTheDocument();
    const price = screen.getByTestId('sell-price-input') as HTMLInputElement;
    expect(price.value).toBe('28.00');
    expect(price).toHaveAttribute('readonly');
    // four payment options, default bar selected
    for (const m of ['bar', 'karte', 'paypal', 'gutschein']) {
      expect(screen.getByTestId(`sell-pay-${m}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId('sell-pay-bar')).toHaveAttribute('aria-checked', 'true');
    // voucher field hidden until gutschein
    expect(screen.queryByTestId('voucher-code-input')).not.toBeInTheDocument();
    expect(screen.getByTestId('sell-submit')).toBeEnabled();
  });

  it('submits a 1-line inventory cart with NO client price (server is price authority)', async () => {
    render(
      <SellModal purchaseId={7} title="Violator" artist="Depeche Mode" targetPrice="28.00" onClose={() => {}} />,
    );
    fireEvent.click(screen.getByTestId('sell-submit'));
    await waitFor(() =>
      expect(createSale).toHaveBeenCalledWith({
        lines: [{ kind: 'inventory', purchaseId: 7 }],
        payment: 'bar',
        discount: null,
        voucherCode: null,
      }),
    );
  });

  it('gutschein reveals the voucher field, gates submit, and forwards the trimmed code', async () => {
    render(
      <SellModal purchaseId={7} title="Violator" artist="Depeche Mode" targetPrice="28.00" onClose={() => {}} />,
    );
    fireEvent.click(screen.getByTestId('sell-pay-gutschein'));
    const voucher = screen.getByTestId('voucher-code-input');
    expect(voucher).toBeInTheDocument();
    // submit blocked while voucher empty
    expect(screen.getByTestId('sell-submit')).toBeDisabled();
    fireEvent.click(screen.getByTestId('sell-submit'));
    expect(createSale).not.toHaveBeenCalled();
    // enter a code → submit enabled, code forwarded trimmed
    fireEvent.change(voucher, { target: { value: '  ABC-123  ' } });
    expect(screen.getByTestId('sell-submit')).toBeEnabled();
    fireEvent.click(screen.getByTestId('sell-submit'));
    await waitFor(() =>
      expect(createSale).toHaveBeenCalledWith({
        lines: [{ kind: 'inventory', purchaseId: 7 }],
        payment: 'gutschein',
        discount: null,
        voucherCode: 'ABC-123',
      }),
    );
  });

  it('FAIL-CLOSED: missing targetPrice disables submit, shows "kein VK-Preis hinterlegt", never calls createSale', () => {
    render(
      <SellModal purchaseId={7} title="Violator" artist="Depeche Mode" targetPrice={null} onClose={() => {}} />,
    );
    expect(screen.getByText('kein VK-Preis hinterlegt')).toBeInTheDocument();
    const submit = screen.getByTestId('sell-submit');
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(createSale).not.toHaveBeenCalled();
  });

  it('closes on cancel and on a successful sale', async () => {
    const onClose = vi.fn();
    render(
      <SellModal purchaseId={7} title="Violator" artist="Depeche Mode" targetPrice="28.00" onClose={onClose} />,
    );
    fireEvent.click(screen.getByTestId('sell-cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('sell-submit'));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
  });

  it('surfaces the action error message on a non-ok result', async () => {
    createSale.mockResolvedValueOnce({ ok: false, reason: 'conflict', message: 'Exemplar bereits verkauft.' });
    render(
      <SellModal purchaseId={7} title="Violator" artist="Depeche Mode" targetPrice="28.00" onClose={() => {}} />,
    );
    fireEvent.click(screen.getByTestId('sell-submit'));
    expect(await screen.findByText('Exemplar bereits verkauft.')).toBeInTheDocument();
  });
});

describe('InventoryList row wiring (§5.2/§5.3/§5.6)', () => {
  const rows: InventoryRow[] = [
    baseRow, // verfuegbar
    { ...baseRow, copyId: 8, recordId: 80, title: 'Music for the Masses', status: 'reserviert' },
    { ...baseRow, copyId: 9, recordId: 90, title: 'Remain in Light', artist: 'Talking Heads', vk: '22.00', status: 'verkauft' },
  ];

  it('verfuegbar row: Verkaufen enabled, Reservieren shown, ♡ links to the prefilled wishlist form', () => {
    render(<InventoryList rows={rows} total={rows.length} />);
    const row = within(screen.getByRole('table')).getByText('Violator').closest('tr')!;
    const u = within(row as HTMLElement);
    expect(u.getByRole('button', { name: /^Verkaufen$/i })).toBeEnabled();
    expect(u.getByTestId('reserve-action')).toBeInTheDocument();
    expect(u.queryByTestId('reserve-cancel-action')).not.toBeInTheDocument();
    const wish = u.getByTestId('add-to-wishlist');
    expect(wish).toHaveAttribute(
      'href',
      '/wunschlisten?artist=Depeche%20Mode&title=Violator',
    );
  });

  it('reserviert row: Verkaufen enabled, "Reservierung aufheben" shown instead of Reservieren', () => {
    render(<InventoryList rows={rows} total={rows.length} />);
    const row = within(screen.getByRole('table')).getByText('Music for the Masses').closest('tr')!;
    const u = within(row as HTMLElement);
    expect(u.getByRole('button', { name: /^Verkaufen$/i })).toBeEnabled();
    expect(u.getByTestId('reserve-cancel-action')).toBeInTheDocument();
    expect(u.queryByTestId('reserve-action')).not.toBeInTheDocument();
  });

  it('verkauft row: action button disabled (Verkauft), no reserve actions', () => {
    render(<InventoryList rows={rows} total={rows.length} />);
    const row = within(screen.getByRole('table')).getByText('Remain in Light').closest('tr')!;
    const u = within(row as HTMLElement);
    expect(u.getByRole('button', { name: /Verkauft/i })).toBeDisabled();
    expect(u.queryByTestId('reserve-action')).not.toBeInTheDocument();
    expect(u.queryByTestId('reserve-cancel-action')).not.toBeInTheDocument();
  });

  it('clicking Reservieren calls reserve with the row purchaseId', async () => {
    render(<InventoryList rows={rows} total={rows.length} />);
    const row = within(screen.getByRole('table')).getByText('Violator').closest('tr')!;
    fireEvent.click(within(row as HTMLElement).getByTestId('reserve-action'));
    await waitFor(() => expect(reserve).toHaveBeenCalledWith({ purchaseId: 7 }));
  });

  it('clicking "Reservierung aufheben" calls cancelReservation with the row purchaseId', async () => {
    render(<InventoryList rows={rows} total={rows.length} />);
    const row = within(screen.getByRole('table')).getByText('Music for the Masses').closest('tr')!;
    fireEvent.click(within(row as HTMLElement).getByTestId('reserve-cancel-action'));
    await waitFor(() => expect(cancelReservation).toHaveBeenCalledWith({ purchaseId: 8 }));
  });

  it('clicking Verkaufen opens the SellModal for that row with its targetPrice', () => {
    render(<InventoryList rows={rows} total={rows.length} />);
    const row = within(screen.getByRole('table')).getByText('Violator').closest('tr')!;
    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: /^Verkaufen$/i }));
    expect(screen.getByTestId('sell-modal')).toBeInTheDocument();
    expect((screen.getByTestId('sell-price-input') as HTMLInputElement).value).toBe('28.00');
  });
});
