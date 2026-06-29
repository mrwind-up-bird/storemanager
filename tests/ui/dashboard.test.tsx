// tests/ui/dashboard.test.tsx
// @vitest-environment jsdom

/// <reference types="@testing-library/jest-dom/vitest" />

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { InventoryAggregates } from '@/lib/inventory';
import { InventoryKpi } from '@/app/(app)/_components/dashboard/InventoryKpi';
import { EmptyPanel } from '@/app/(app)/_components/dashboard/EmptyPanel';

afterEach(cleanup);

const MOCK_AGG: InventoryAggregates = {
  total: 12,
  byStatus: { verfuegbar: 8, reserviert: 1, verkauft: 2, verliehen: 1 },
  valueAvailable: 240,
  formatSplit: { vinyl: 5, cd: 2, other: 1 },
  genreOptions: ['Jazz', 'Rock'],
};

describe('InventoryKpi', () => {
  it('shows the available-copy count from byStatus.verfuegbar', () => {
    render(<InventoryKpi aggregates={MOCK_AGG} />);
    // 8 is byStatus.verfuegbar; toLocaleString('de-DE') of 8 = '8'
    expect(screen.getByText('8')).toBeDefined();
  });

  it('shows the label "Artikel im Lager"', () => {
    render(<InventoryKpi aggregates={MOCK_AGG} />);
    expect(screen.getByText('Artikel im Lager')).toBeDefined();
  });

  it('renders format-split caption with Vinyl/CD/Andere percentages', () => {
    render(<InventoryKpi aggregates={MOCK_AGG} />);
    // vinyl=5 cd=2 other=1 total=8 → Vinyl 63% · CD 25% · Andere 12%
    const caption = screen.getByTestId('format-caption');
    expect(caption.textContent).toMatch(/^Vinyl \d+% · CD \d+% · Andere \d+%$/);
  });

  it('shows Inventarwert when valueAvailable > 0', () => {
    render(<InventoryKpi aggregates={MOCK_AGG} />);
    expect(screen.getByTestId('inventarwert')).toBeDefined();
  });

  it('hides Inventarwert when valueAvailable is 0', () => {
    render(<InventoryKpi aggregates={{ ...MOCK_AGG, valueAvailable: 0 }} />);
    expect(screen.queryByTestId('inventarwert')).toBeNull();
  });

  it('shows zero available as "0" when byStatus.verfuegbar is 0', () => {
    const agg: InventoryAggregates = {
      ...MOCK_AGG,
      byStatus: { verfuegbar: 0, reserviert: 0, verkauft: 0, verliehen: 0 },
      valueAvailable: 0,
      formatSplit: { vinyl: 0, cd: 0, other: 0 },
    };
    render(<InventoryKpi aggregates={agg} />);
    expect(screen.getByText('0')).toBeDefined();
  });
});

describe('EmptyPanel', () => {
  it('renders the title and calm empty-state message', () => {
    render(
      <EmptyPanel
        title="Letzte Verkäufe"
        emptyMessage="Noch keine Verkäufe — Verkauf folgt (Slice 3)."
      />,
    );
    expect(screen.getByText('Letzte Verkäufe')).toBeDefined();
    expect(screen.getByText('Noch keine Verkäufe — Verkauf folgt (Slice 3).')).toBeDefined();
  });

  it('contains no monetary figure in the empty-panel output', () => {
    render(
      <EmptyPanel
        title="Letzte Verkäufe"
        emptyMessage="Noch keine Verkäufe — Verkauf folgt (Slice 3)."
      />,
    );
    const text = document.body.textContent ?? '';
    // must not contain any "€ 1.284" or similar fake sales number
    expect(text).not.toMatch(/€\s*[\d.,]+/);
  });

  it('renders Wunschlisten-Treffer panel with placeholder copy', () => {
    render(
      <EmptyPanel
        title="Wunschlisten-Treffer"
        emptyMessage="Noch keine Treffer — Wunschlisten folgt (Slice 3)."
      />,
    );
    expect(screen.getByText('Wunschlisten-Treffer')).toBeDefined();
    expect(screen.getByText('Noch keine Treffer — Wunschlisten folgt (Slice 3).')).toBeDefined();
  });

  it('renders optional titlePrefix slot', () => {
    render(
      <EmptyPanel
        title="Wunschlisten-Treffer"
        emptyMessage="Noch keine Treffer — Wunschlisten folgt (Slice 3)."
        titlePrefix={<span data-testid="honey-dot" />}
      />,
    );
    expect(screen.getByTestId('honey-dot')).toBeDefined();
  });
});
