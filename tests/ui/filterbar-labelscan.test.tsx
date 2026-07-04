import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const findCopiesMock = vi.fn();
vi.mock('@/app/(app)/kasse/actions', () => ({
  findAvailableCopiesByRelease: (id: number) => findCopiesMock(id),
  searchAvailableCopies: vi.fn(async () => ({ ok: true, copies: [] })),
  createSale: vi.fn(),
}));
vi.mock('@/components/scanner/ScannerSheet', () => ({
  ScannerSheet: ({ open, onDetectRelease }: { open: boolean; onDetectRelease?: (id: number) => void }) =>
    open ? (
      <button type="button" onClick={() => onDetectRelease?.(11111)}>stub-scan</button>
    ) : null,
}));
vi.mock('@/app/(app)/inventar/_components/SellModal', () => ({
  SellModal: ({ purchaseId }: { purchaseId: number }) => (
    <div data-testid="sell-modal-stub">{purchaseId}</div>
  ),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/inventar',
  useSearchParams: () => new URLSearchParams(),
}));

import { FilterBar } from '@/app/(app)/inventar/_components/FilterBar';

const copy = (purchaseId: number) => ({
  purchaseId, title: 'Kind of Blue', artist: 'Miles Davis',
  targetPrice: '22.50', conditionRecord: 5, conditionCover: 4,
});
const props = { genreOptions: [], resultCount: 0, valueAvailable: 0 };

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('FilterBar Etiketten-Scan (Bestand → Verkauf)', () => {
  it('genau 1 Exemplar → SellModal direkt', async () => {
    const user = userEvent.setup();
    findCopiesMock.mockResolvedValue({ ok: true, copies: [copy(7)] });
    render(<FilterBar {...props} />);
    await user.click(screen.getByRole('button', { name: 'Etikett scannen' }));
    await user.click(await screen.findByRole('button', { name: 'stub-scan' }));
    expect(await screen.findByTestId('sell-modal-stub')).toHaveTextContent('7');
    expect(findCopiesMock).toHaveBeenCalledOnce();
    expect(findCopiesMock).toHaveBeenCalledWith(11111);
  });

  it('mehrere Exemplare → Picker → Auswahl → SellModal', async () => {
    const user = userEvent.setup();
    findCopiesMock.mockResolvedValue({ ok: true, copies: [copy(7), copy(8)] });
    render(<FilterBar {...props} />);
    await user.click(screen.getByRole('button', { name: 'Etikett scannen' }));
    await user.click(await screen.findByRole('button', { name: 'stub-scan' }));
    const picker = await screen.findByTestId('labelscan-picker');
    expect(picker).toHaveTextContent('Mehrere Exemplare — welches verkaufen?');
    const entries = screen.getAllByRole('button', { name: /Miles Davis – Kind of Blue/ });
    expect(entries).toHaveLength(2);
    await user.click(entries[1]!);
    expect(await screen.findByTestId('sell-modal-stub')).toBeInTheDocument();
  });

  it('0 Exemplare → exakte Meldung', async () => {
    const user = userEvent.setup();
    findCopiesMock.mockResolvedValue({ ok: true, copies: [] });
    render(<FilterBar {...props} />);
    await user.click(screen.getByRole('button', { name: 'Etikett scannen' }));
    await user.click(await screen.findByRole('button', { name: 'stub-scan' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Kein verfügbares Exemplar zu diesem Release im Bestand.',
    );
  });
});
