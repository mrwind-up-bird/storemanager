import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const searchMock = vi.fn();
const findMock = vi.fn();
vi.mock('@/app/(app)/kasse/actions', () => ({
  searchAvailableCopies: (q: string) => searchMock(q),
  findAvailableCopiesByRelease: (id: number) => findMock(id),
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

import { VerkaufSheet } from '@/app/(app)/_components/VerkaufSheet';

const copy = (purchaseId: number) => ({
  purchaseId, title: 'Kind of Blue', artist: 'Miles Davis',
  targetPrice: '22.50', conditionRecord: 5, conditionCover: 4,
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('VerkaufSheet (C9)', () => {
  it('Suche ab 2 Zeichen listet Treffer; Auswahl öffnet SellModal', async () => {
    const user = userEvent.setup();
    searchMock.mockResolvedValue({ ok: true, copies: [copy(7), copy(8)] });
    render(<VerkaufSheet open onClose={() => {}} />);
    await user.type(screen.getByLabelText('Artikel suchen'), 'kind');
    const entries = await screen.findAllByRole('button', { name: /Miles Davis – Kind of Blue/ });
    expect(entries).toHaveLength(2);
    await user.click(entries[0]!);
    expect(await screen.findByTestId('sell-modal-stub')).toHaveTextContent('7');
  });

  it('Etiketten-Scan mit 0 Treffern → exakte Meldung', async () => {
    const user = userEvent.setup();
    findMock.mockResolvedValue({ ok: true, copies: [] });
    render(<VerkaufSheet open onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Etikett scannen' }));
    await user.click(await screen.findByRole('button', { name: 'stub-scan' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Kein verfügbares Exemplar zu diesem Release im Bestand.',
    );
  });

  it('Etiketten-Scan mit 1 Treffer → SellModal direkt', async () => {
    const user = userEvent.setup();
    findMock.mockResolvedValue({ ok: true, copies: [copy(9)] });
    render(<VerkaufSheet open onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Etikett scannen' }));
    await user.click(await screen.findByRole('button', { name: 'stub-scan' }));
    expect(await screen.findByTestId('sell-modal-stub')).toHaveTextContent('9');
  });
});
