// tests/inventar/lagerbestand.test.tsx
// @vitest-environment jsdom

/// <reference types="@testing-library/jest-dom/vitest" />

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Components under test — imported AFTER env, no async DB imports here
import { InventoryList } from '@/app/(app)/inventar/_components/InventoryList';
import { InventoryTiles } from '@/app/(app)/inventar/_components/InventoryTiles';
import { ViewToggle } from '@/app/(app)/inventar/_components/ViewToggle';
import type { InventoryRow } from '@/lib/inventory';

afterEach(cleanup);

const ROWS: InventoryRow[] = [
  {
    copyId: 1,
    recordId: 10,
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
  },
  {
    copyId: 2,
    recordId: 11,
    title: 'Remain in Light',
    artist: 'Talking Heads',
    label: ['Sire'],
    releaseYear: 1980,
    country: 'US',
    format: 'Vinyl',
    genre: ['Rock'],
    ek: '5.00',
    vk: '22.00',
    status: 'verkauft',
    conditionRecord: 4,
    conditionCover: 3,
  },
];

// ── InventoryList smoke ────────────────────────────────────────────────────────

describe('InventoryList', () => {
  it('renders a <table> with correct column headers', () => {
    render(<InventoryList rows={ROWS} total={ROWS.length} />);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('Artikel')).toBeInTheDocument();
    expect(screen.getByText('Zustand')).toBeInTheDocument();
    expect(screen.getByText('EK / VK')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Aktion')).toBeInTheDocument();
  });

  it('shows title and artist for each row', () => {
    render(<InventoryList rows={ROWS} total={ROWS.length} />);
    expect(screen.getByText('Violator')).toBeInTheDocument();
    expect(screen.getByText('Depeche Mode')).toBeInTheDocument();
    expect(screen.getByText('Remain in Light')).toBeInTheDocument();
    expect(screen.getByText('Talking Heads')).toBeInTheDocument();
  });

  it('shows EK and VK values', () => {
    render(<InventoryList rows={ROWS} total={ROWS.length} />);
    expect(screen.getByText('8.00')).toBeInTheDocument();
    expect(screen.getByText('28.00')).toBeInTheDocument();
  });

  it('renders StatusBadge with correct label', () => {
    render(<InventoryList rows={ROWS} total={ROWS.length} />);
    expect(screen.getByText('im Lager')).toBeInTheDocument();
    // "Verkauft" appears twice: StatusBadge + disabled Aktion button for sold row
    expect(screen.getAllByText('Verkauft').length).toBeGreaterThan(0);
  });

  it('renders ConditionPill for rows with conditionRecord', () => {
    render(<InventoryList rows={ROWS} total={ROWS.length} />);
    // conditionRecord=5 → VG+, conditionRecord=4 → VG
    expect(screen.getByText('VG+')).toBeInTheDocument();
    expect(screen.getByText('VG')).toBeInTheDocument();
  });

  it('applies opacity .62 to verkauft rows', () => {
    const { container } = render(<InventoryList rows={ROWS} total={ROWS.length} />);
    const rows = container.querySelectorAll('tbody tr');
    // First row (verfuegbar): opacity 1 (or default)
    expect((rows[0] as HTMLElement).style.opacity).toBe('');
    // Second row (verkauft): opacity 0.62
    expect((rows[1] as HTMLElement).style.opacity).toBe('0.62');
  });

  it('all Aktion buttons are disabled (no mutations in Slice 1)', () => {
    render(<InventoryList rows={ROWS} total={ROWS.length} />);
    const btns = screen.getAllByRole('button', { name: /Verkauf/i });
    btns.forEach((btn) => expect(btn).toBeDisabled());
  });

  it('shows footer with row count', () => {
    render(<InventoryList rows={ROWS} total={10} />);
    expect(screen.getByText(/2 von 10/)).toBeInTheDocument();
  });

  it('shows — for null EK/VK', () => {
    const rowsWithNull: InventoryRow[] = [
      { ...ROWS[0], ek: null, vk: null },
    ];
    render(<InventoryList rows={rowsWithNull} total={1} />);
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('renders nothing for null conditionRecord (no pill)', () => {
    const rowsNoCond: InventoryRow[] = [
      { ...ROWS[0], conditionRecord: null },
    ];
    const { container } = render(<InventoryList rows={rowsNoCond} total={1} />);
    // VG+ won't be in document
    expect(container.querySelector('[class*="pill"]')).toBeNull();
    expect(screen.queryByText('VG+')).not.toBeInTheDocument();
  });
});

// ── InventoryTiles smoke ───────────────────────────────────────────────────────

describe('InventoryTiles', () => {
  it('renders article cards for each row', () => {
    render(<InventoryTiles rows={ROWS} />);
    const articles = screen.getAllByRole('article');
    expect(articles).toHaveLength(ROWS.length);
  });

  it('shows title and artist in each card', () => {
    render(<InventoryTiles rows={ROWS} />);
    expect(screen.getByText('Violator')).toBeInTheDocument();
    expect(screen.getByText('Depeche Mode')).toBeInTheDocument();
  });

  it('all Aktion buttons are disabled', () => {
    render(<InventoryTiles rows={ROWS} />);
    const btns = screen.getAllByRole('button', { name: /Verkauf/i });
    btns.forEach((btn) => expect(btn).toBeDisabled());
  });
});

// ── ViewToggle ─────────────────────────────────────────────────────────────────

describe('ViewToggle', () => {
  it('defaults to list view — renders a table', () => {
    render(<ViewToggle rows={ROWS} total={ROWS.length} />);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.queryAllByRole('article')).toHaveLength(0);
  });

  it('switches to tile view on Kacheln click — shows article cards, no table', async () => {
    const user = userEvent.setup();
    render(<ViewToggle rows={ROWS} total={ROWS.length} />);
    await user.click(screen.getByRole('radio', { name: /Kacheln/i }));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(ROWS.length);
  });

  it('switches back to list on Liste click', async () => {
    const user = userEvent.setup();
    render(<ViewToggle rows={ROWS} total={ROWS.length} />);
    await user.click(screen.getByRole('radio', { name: /Kacheln/i }));
    await user.click(screen.getByRole('radio', { name: /Liste/i }));
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('shows SegmentedControl radiogroup for view toggle', () => {
    render(<ViewToggle rows={ROWS} total={ROWS.length} />);
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
  });
});

// ── Empty state ────────────────────────────────────────────────────────────────

describe('Empty state', () => {
  it('shows empty state card when rows is empty', () => {
    render(<ViewToggle rows={[]} total={0} />);
    expect(screen.getByText('Kein Treffer im Sortiment')).toBeInTheDocument();
  });

  it('empty state does not render a table or articles', () => {
    render(<ViewToggle rows={[]} total={0} />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('empty state shows a reset link', () => {
    render(<ViewToggle rows={[]} total={0} />);
    expect(screen.getByRole('link', { name: /Filter zurücksetzen/i })).toBeInTheDocument();
  });
});
