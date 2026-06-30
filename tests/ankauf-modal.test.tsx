// tests/ankauf-modal.test.tsx
// @vitest-environment jsdom

/// <reference types="@testing-library/jest-dom/vitest" />

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

// vi.hoisted ensures these fn refs are available inside the vi.mock() factory
// (which is statically hoisted above all imports by Vitest).
const ankaufRecord = vi.hoisted(() =>
  vi.fn(async () => ({ ok: true as const, recordId: 1, purchaseId: 1 })),
);
const getPriceSuggestion = vi.hoisted(() =>
  vi.fn(async () => ({
    ok: true as const,
    suggestion: { byGrade: { 'Very Good Plus (VG+)': 22.5, 'Very Good (VG)': 18 } },
    median: null,
  })),
);

vi.mock('@/app/(app)/ankauf/actions', () => ({ ankaufRecord, getPriceSuggestion }));

import { AnkaufModal } from '@/app/(app)/ankauf/_components/AnkaufModal';

const result = {
  discogsId: 42,
  title: 'Kind of Blue',
  artist: 'Miles Davis',
  country: 'US',
  year: 1959,
  format: 'Vinyl',
  genre: ['Jazz'],
  label: ['Columbia'],
  coverImage: null,
  community: { want: 9, have: 5 },
  median: 30,
};

describe('AnkaufModal', () => {
  afterEach(cleanup);

  beforeEach(() => {
    ankaufRecord.mockClear();
    getPriceSuggestion.mockClear();
    getPriceSuggestion.mockResolvedValue({
      ok: true,
      suggestion: { byGrade: { 'Very Good Plus (VG+)': 22.5, 'Very Good (VG)': 18 } },
      median: null,
    });
    ankaufRecord.mockResolvedValue({ ok: true, recordId: 1, purchaseId: 1 });
  });

  it('defaults pills VG+/VG and prefills VK from suggestion', async () => {
    render(<AnkaufModal result={result} onClose={() => {}} />);
    // Default condition grades are selected immediately (aria-checked from state)
    expect(screen.getByTestId('cond-record-VG+').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('cond-cover-VG').getAttribute('aria-checked')).toBe('true');
    // VK prefills to the VG+ price from the mock after the async fetch resolves
    await waitFor(() =>
      expect((screen.getByTestId('vk-input') as HTMLInputElement).value).toBe('22.5'),
    );
  });

  it('recomputes VK when record condition changes', async () => {
    render(<AnkaufModal result={result} onClose={() => {}} />);
    // Wait for initial VK from suggestion
    await waitFor(() =>
      expect((screen.getByTestId('vk-input') as HTMLInputElement).value).toBe('22.5'),
    );
    // Click VG pill — should switch to the VG price from byGrade
    fireEvent.click(screen.getByTestId('cond-record-VG'));
    await waitFor(() =>
      expect((screen.getByTestId('vk-input') as HTMLInputElement).value).toBe('18'),
    );
  });

  it('submits payload to ankaufRecord', async () => {
    render(<AnkaufModal result={result} onClose={() => {}} />);
    fireEvent.change(screen.getByTestId('ek-input'), { target: { value: '3.00' } });
    fireEvent.click(screen.getByTestId('ankauf-submit'));
    await waitFor(() =>
      expect(ankaufRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          release: expect.objectContaining({ discogsId: 42 }),
          purchasePrice: '3.00',
          conditionRecord: 5,
          conditionCover: 4,
        }),
      ),
    );
  });
});
