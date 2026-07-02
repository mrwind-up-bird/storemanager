// tests/app/label-print-modal.test.tsx
// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom/vitest" />
//
// LabelPrintModal (Slice 4, Task 9) — jsPDF/qrcode are loaded via dynamic import() inside the
// submit handler (keeps them out of the initial bundle), so we mock both modules; vi.mock
// intercepts dynamic import() the same way it intercepts static imports. We assert on the mocked
// jsPDF instance (save called with the expected filename) and prove the QR-gating is non-vacuous:
// toDataURL must be called exactly once — only for the item that HAS a discogsId.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockDoc = vi.hoisted(() => ({
  text: vi.fn(),
  setFontSize: vi.fn(),
  setFont: vi.fn(),
  addImage: vi.fn(),
  addPage: vi.fn(),
  save: vi.fn(),
}));

vi.mock('jspdf', () => ({ jsPDF: vi.fn(() => mockDoc) }));
vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,x') },
}));

import { LabelPrintModal } from '@/app/(app)/inventar/_components/LabelPrintModal';
import type { LabelItem } from '@/lib/labels';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import QRCode from 'qrcode';

afterEach(cleanup);
beforeEach(() => {
  Object.values(mockDoc).forEach((fn) => fn.mockClear());
  (QRCode.toDataURL as ReturnType<typeof vi.fn>).mockClear();
});

const ITEMS: LabelItem[] = [
  {
    artist: 'Depeche Mode',
    title: 'Violator',
    format: 'Vinyl',
    conditionRecord: 5,
    priceCents: 2800,
    discogsId: 12345,
  },
  {
    artist: 'Unbekannter Künstler',
    title: 'Manuell erfasst',
    format: null,
    conditionRecord: 3,
    priceCents: null,
    discogsId: null,
  },
];

describe('LabelPrintModal', () => {
  it('renders the modal, template select and submit button', () => {
    render(<LabelPrintModal items={ITEMS} open onClose={vi.fn()} />);
    expect(screen.getByTestId('label-print-modal')).toBeInTheDocument();
    expect(screen.getByTestId('label-template-select')).toBeInTheDocument();
    expect(screen.getByTestId('label-print-submit')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(<LabelPrintModal items={ITEMS} open={false} onClose={vi.fn()} />);
    expect(screen.queryByTestId('label-print-modal')).not.toBeInTheDocument();
  });

  it('on submit builds the PDF and saves it as etiketten.pdf, fetching a QR ONLY for the item with a discogsId', async () => {
    const user = userEvent.setup();
    render(<LabelPrintModal items={ITEMS} open onClose={vi.fn()} />);

    await user.click(screen.getByTestId('label-print-submit'));

    await waitFor(() => expect(mockDoc.save).toHaveBeenCalledTimes(1));
    expect(mockDoc.save).toHaveBeenCalledWith('etiketten.pdf');

    // Non-vacuous: exactly one of the two items has a discogsId — QR must be fetched exactly once.
    expect(QRCode.toDataURL).toHaveBeenCalledTimes(1);
    expect(QRCode.toDataURL).toHaveBeenCalledWith('https://www.discogs.com/release/12345');

    // The label content (artist — title, price) was actually drawn.
    expect(mockDoc.text).toHaveBeenCalled();
    expect(mockDoc.addImage).toHaveBeenCalledTimes(1);
  });
});
