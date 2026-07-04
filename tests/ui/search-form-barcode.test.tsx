import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DiscogsSearchResult } from '@/lib/discogs/types';

const fixture = (id: number, title: string): DiscogsSearchResult => ({
  discogsId: id, title, artist: 'Miles Davis', country: 'US', year: 1959,
  format: 'Vinyl', genre: ['Jazz'], label: ['Columbia'], coverImage: null,
  community: { want: 1, have: 1 }, median: 24.99,
});

const searchByBarcodeMock = vi.fn();
vi.mock('@/app/(app)/ankauf/actions', () => ({
  searchDiscogs: vi.fn(async () => ({ ok: true, results: [] })),
  searchDiscogsByBarcode: (b: string) => searchByBarcodeMock(b),
  getPriceSuggestion: vi.fn(async () => ({ ok: true, suggestion: null, median: null })),
  ankaufRecord: vi.fn(async () => ({ ok: true, recordId: 1, purchaseId: 1 })),
  disconnectDiscogs: vi.fn(async () => undefined),
}));

// ScannerSheet-Stub: Button feuert onDetectEan mit dem Fake-Treffer-EAN.
vi.mock('@/components/scanner/ScannerSheet', () => ({
  ScannerSheet: ({ open, onDetectEan }: { open: boolean; onDetectEan?: (e: string) => void }) =>
    open ? (
      <button type="button" onClick={() => onDetectEan?.('4988031234567')}>
        stub-detect
      </button>
    ) : null,
}));

let searchParams = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParams,
}));

import { SearchForm } from '@/app/(app)/ankauf/_components/SearchForm';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  searchParams = new URLSearchParams();
});

describe('SearchForm Barcode-Flow (C13)', () => {
  it('Scanner-Button öffnet Sheet; Detect → Barcode-Suche → Treffer gerendert', async () => {
    const user = userEvent.setup();
    searchByBarcodeMock.mockResolvedValue({
      ok: true,
      results: [fixture(11111, 'Kind of Blue'), fixture(22222, 'Abbey Road')],
    });
    render(<SearchForm connected username="demo" />);
    await user.click(screen.getByRole('button', { name: 'Barcode scannen' }));
    await user.click(await screen.findByRole('button', { name: 'stub-detect' }));
    expect(searchByBarcodeMock).toHaveBeenCalledOnce();
    expect(searchByBarcodeMock).toHaveBeenCalledWith('4988031234567');
    expect(await screen.findByText('Kind of Blue')).toBeInTheDocument();
    expect(screen.getAllByTestId('discogs-result-card')).toHaveLength(2);
  });

  it('validation-Fehler → exakter deutscher Fehlertext', async () => {
    const user = userEvent.setup();
    searchByBarcodeMock.mockResolvedValue({ ok: false, reason: 'validation' });
    render(<SearchForm connected username="demo" />);
    await user.click(screen.getByRole('button', { name: 'Barcode scannen' }));
    await user.click(await screen.findByRole('button', { name: 'stub-detect' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ungültiger Barcode — 8 bis 14 Ziffern.',
    );
  });

  it('?barcode=-Param feuert die Suche genau einmal beim Mount (C12→C13)', async () => {
    searchByBarcodeMock.mockResolvedValue({ ok: true, results: [fixture(11111, 'Kind of Blue')] });
    searchParams = new URLSearchParams('barcode=4988031234567');
    render(<SearchForm connected username="demo" />);
    expect(await screen.findByText('Kind of Blue')).toBeInTheDocument();
    expect(searchByBarcodeMock).toHaveBeenCalledTimes(1);
  });
});
