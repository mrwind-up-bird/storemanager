// tests/app/sammlung-wizard.test.tsx
// @vitest-environment jsdom

/// <reference types="@testing-library/jest-dom/vitest" />

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

// vi.hoisted: refs available inside the statically-hoisted vi.mock factory (sell-modal/wunschlisten pattern).
const createCollectionAction = vi.hoisted(() =>
  vi.fn(
    async (): Promise<
      | { ok: true; collectionId: number; count: number }
      | { ok: false; reason: 'validation' | 'error'; message?: string }
    > => ({ ok: true, collectionId: 1, count: 1 }),
  ),
);
const searchDiscogs = vi.hoisted(() => vi.fn(async () => ({ ok: true as const, results: [] })));
const getPriceSuggestion = vi.hoisted(() =>
  vi.fn(async () => ({ ok: true as const, suggestion: null, median: null })),
);
const push = vi.hoisted(() => vi.fn());

vi.mock('@/app/(app)/ankauf/sammlung/actions', () => ({ createCollectionAction }));
vi.mock('@/app/(app)/ankauf/actions', () => ({ searchDiscogs, getPriceSuggestion }));
// CollectionWizard calls useRouter().push() on a successful submit.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

import { CollectionWizard } from '@/app/(app)/ankauf/sammlung/_components/CollectionWizard';
import { DEFAULT_CONDITION_RECORD } from '@/lib/pricing';

beforeEach(() => {
  createCollectionAction.mockClear();
  createCollectionAction.mockResolvedValue({ ok: true, collectionId: 1, count: 1 });
  push.mockClear();
});
afterEach(cleanup);

describe('CollectionWizard', () => {
  it('renders the frozen sammlung-* testids', () => {
    render(<CollectionWizard />);
    expect(screen.getByTestId('sammlung-screen')).toBeInTheDocument();
    expect(screen.getByTestId('sammlung-seller-input')).toBeInTheDocument();
    expect(screen.getByTestId('sammlung-add-item')).toBeInTheDocument();
    expect(screen.getByTestId('sammlung-items')).toBeInTheDocument();
    expect(screen.getByTestId('sammlung-submit')).toBeInTheDocument();
  });

  it('sammlung-submit is disabled until sellerName AND at least one item are present', () => {
    render(<CollectionWizard />);
    expect(screen.getByTestId('sammlung-submit')).toBeDisabled();

    // Seller alone isn't enough.
    fireEvent.change(screen.getByTestId('sammlung-seller-input'), { target: { value: 'Max Mustermann' } });
    expect(screen.getByTestId('sammlung-submit')).toBeDisabled();

    // Seller + one item -> enabled.
    fireEvent.click(screen.getByTestId('sammlung-add-item'));
    expect(screen.getByTestId('sammlung-submit')).toBeEnabled();
  });

  it('an item alone (no seller) does not enable submit', () => {
    render(<CollectionWizard />);
    fireEvent.click(screen.getByTestId('sammlung-add-item'));
    expect(screen.getByTestId('sammlung-submit')).toBeDisabled();
  });

  it('adding two items shows a running EK total', () => {
    render(<CollectionWizard />);
    fireEvent.click(screen.getByTestId('sammlung-add-item'));
    fireEvent.click(screen.getByTestId('sammlung-add-item'));

    const ekInputs = screen.getAllByLabelText('Einkaufspreis (EK)');
    expect(ekInputs).toHaveLength(2);
    fireEvent.change(ekInputs[0]!, { target: { value: '5.00' } });
    fireEvent.change(ekInputs[1]!, { target: { value: '7.50' } });

    expect(screen.getByTestId('sammlung-items').parentElement!.textContent).toContain('12,50');
  });

  it('removing an item drops it from the running total', () => {
    render(<CollectionWizard />);
    fireEvent.click(screen.getByTestId('sammlung-add-item'));
    fireEvent.click(screen.getByTestId('sammlung-add-item'));
    const ekInputs = screen.getAllByLabelText('Einkaufspreis (EK)');
    fireEvent.change(ekInputs[0]!, { target: { value: '5.00' } });
    fireEvent.change(ekInputs[1]!, { target: { value: '7.50' } });

    fireEvent.click(screen.getByRole('button', { name: 'Artikel 1 entfernen' }));
    expect(screen.getAllByLabelText('Einkaufspreis (EK)')).toHaveLength(1);
    expect(screen.getByTestId('sammlung-items').parentElement!.textContent).toContain('7,50');
  });

  it('submits the assembled payload and routes to /ankauf/sammlungen on success', async () => {
    render(<CollectionWizard />);
    fireEvent.change(screen.getByTestId('sammlung-seller-input'), { target: { value: 'Max Mustermann' } });
    fireEvent.click(screen.getByTestId('sammlung-add-item'));
    // Manual entry (off-Discogs item) so the item-level payload assertion below can pin down
    // the CRITICAL fix: manual items must submit `discogsId: null`, never a synthetic sentinel.
    fireEvent.click(screen.getByRole('button', { name: 'Manuell erfassen' }));
    fireEvent.change(screen.getByLabelText('Titel'), { target: { value: 'Bedroom Tapes' } });
    fireEvent.change(screen.getByLabelText('Künstler'), { target: { value: 'DIY Artist' } });
    fireEvent.change(screen.getAllByLabelText('Einkaufspreis (EK)')[0]!, { target: { value: '5.00' } });

    fireEvent.click(screen.getByTestId('sammlung-submit'));
    await waitFor(() => expect(createCollectionAction).toHaveBeenCalledTimes(1));
    expect(createCollectionAction).toHaveBeenCalledWith(
      expect.objectContaining({
        sellerName: 'Max Mustermann',
        items: [
          expect.objectContaining({
            release: expect.objectContaining({
              discogsId: null,
              title: 'Bedroom Tapes',
              artist: 'DIY Artist',
            }),
            purchasePrice: '5.00',
            conditionRecord: DEFAULT_CONDITION_RECORD,
          }),
        ],
      }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith('/ankauf/sammlungen'));
  });

  it('shows the server error message on a non-ok result and does not navigate', async () => {
    createCollectionAction.mockResolvedValueOnce({
      ok: false,
      reason: 'validation',
      message: 'Bitte für jeden Artikel eine Auswahl treffen.',
    });
    render(<CollectionWizard />);
    fireEvent.change(screen.getByTestId('sammlung-seller-input'), { target: { value: 'Max Mustermann' } });
    fireEvent.click(screen.getByTestId('sammlung-add-item'));
    fireEvent.click(screen.getByTestId('sammlung-submit'));
    expect(await screen.findByText('Bitte für jeden Artikel eine Auswahl treffen.')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
