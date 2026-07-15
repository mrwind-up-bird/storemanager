// tests/inventar/lagerbestand.test.tsx
// @vitest-environment jsdom

/// <reference types="@testing-library/jest-dom/vitest" />

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// vi.hoisted refs so we can control return values per test.
const reserve = vi.hoisted(() =>
  vi.fn(
    async (): Promise<{ ok: true } | { ok: false; reason: 'conflict' | 'validation' | 'error'; message?: string }> =>
      ({ ok: true }),
  ),
);
const cancelReservation = vi.hoisted(() =>
  vi.fn(
    async (): Promise<{ ok: true } | { ok: false; reason: 'conflict' | 'validation' | 'error'; message?: string }> =>
      ({ ok: true }),
  ),
);
const mockRefresh = vi.hoisted(() => vi.fn());

// InventoryList now wires the T9 sale/reservation actions — mock the module so no server code loads.
vi.mock('@/app/(app)/kasse/actions', () => ({
  createSale: vi.fn(async () => ({ ok: true, transactionId: 1, total: '0.00' })),
  reserve,
  cancelReservation,
}));

const mockLoadMore = vi.hoisted(() =>
  vi.fn(
    async (): Promise<
      | { ok: true; rows: InventoryRow[]; nextCursor: string | null }
      | { ok: false; reason: 'validation' | 'error'; message?: string }
    > => ({ ok: true, rows: [], nextCursor: null }),
  ),
);

// InventoryList calls useRouter().refresh(); ViewToggle reads useSearchParams() for load-more.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
  useSearchParams: () => new URLSearchParams('status=verfuegbar'),
}));

// ViewToggle imports loadMoreInventory from ../actions (a 'use server' module) — mock it.
vi.mock('@/app/(app)/inventar/actions', () => ({ loadMoreInventory: mockLoadMore }));

// InventoryList's "Etiketten drucken" flow renders LabelPrintModal, which loads jsPDF/qrcode via
// dynamic import() inside its submit handler — mock both the same way label-print-modal.test.tsx
// does, so the I1 (discogsId flow-through) test can assert on the mocked QRCode call.
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

// Components under test — imported AFTER env, no async DB imports here
import { InventoryList } from '@/app/(app)/inventar/_components/InventoryList';
import { InventoryTiles } from '@/app/(app)/inventar/_components/InventoryTiles';
import { ViewToggle } from '@/app/(app)/inventar/_components/ViewToggle';
import type { InventoryRow } from '@/lib/inventory';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import QRCode from 'qrcode';

afterEach(cleanup);
beforeEach(() => {
  reserve.mockReset();
  cancelReservation.mockReset();
  mockRefresh.mockReset();
  reserve.mockResolvedValue({ ok: true });
  cancelReservation.mockResolvedValue({ ok: true });
  mockLoadMore.mockReset();
  mockLoadMore.mockResolvedValue({ ok: true, rows: [], nextCursor: null });
  Object.values(mockDoc).forEach((fn) => fn.mockClear());
  (QRCode.toDataURL as ReturnType<typeof vi.fn>).mockClear();
});

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
    discogsId: 249232,
    coverImage: 'https://i.discogs.com/violator.jpg',
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
    discogsId: null,
    coverImage: null,
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
    // Slice 5: the same title/artist also renders in the mobile-card list (qr-mobile-only,
    // hidden only via CSS which jsdom doesn't evaluate) — scope to the desktop table.
    const table = within(screen.getByRole('table'));
    expect(table.getByText('Violator')).toBeInTheDocument();
    expect(table.getByText('Depeche Mode')).toBeInTheDocument();
    expect(table.getByText('Remain in Light')).toBeInTheDocument();
    expect(table.getByText('Talking Heads')).toBeInTheDocument();
  });

  it('shows EK and VK values', () => {
    render(<InventoryList rows={ROWS} total={ROWS.length} />);
    // VK also renders in the mobile card (EK does not) — scope to the desktop table.
    const table = within(screen.getByRole('table'));
    expect(table.getByText('8.00')).toBeInTheDocument();
    expect(table.getByText('28.00')).toBeInTheDocument();
  });

  it('renders StatusBadge with correct label', () => {
    render(<InventoryList rows={ROWS} total={ROWS.length} />);
    // StatusBadge also renders in the mobile card — scope to the desktop table.
    const table = within(screen.getByRole('table'));
    expect(table.getByText('im Lager')).toBeInTheDocument();
    // "Verkauft" appears multiple times: StatusBadge + disabled Aktion button, in both the
    // table and the mobile card.
    expect(screen.getAllByText('Verkauft').length).toBeGreaterThan(0);
  });

  it('renders ConditionPill for rows with conditionRecord', () => {
    render(<InventoryList rows={ROWS} total={ROWS.length} />);
    // ConditionPill also renders in the mobile card — scope to the desktop table.
    const table = within(screen.getByRole('table'));
    // conditionRecord=5 → VG+, conditionRecord=4 → VG
    expect(table.getByText('VG+')).toBeInTheDocument();
    expect(table.getByText('VG')).toBeInTheDocument();
  });

  it('applies opacity .62 to verkauft rows', () => {
    const { container } = render(<InventoryList rows={ROWS} total={ROWS.length} />);
    const rows = container.querySelectorAll('tbody tr');
    // First row (verfuegbar): opacity 1 (or default)
    expect((rows[0] as HTMLElement).style.opacity).toBe('');
    // Second row (verkauft): opacity 0.62
    expect((rows[1] as HTMLElement).style.opacity).toBe('0.62');
  });

  it('activates Verkaufen for sellable rows and disables it for verkauft', () => {
    render(<InventoryList rows={ROWS} total={ROWS.length} />);
    // The mobile card renders its own Verkaufen/Verkauft button per row — scope to the
    // desktop table so this asserts the table row's Aktion button specifically.
    const table = within(screen.getByRole('table'));
    // ROWS[0] is verfuegbar → enabled; ROWS[1] is verkauft → disabled "Verkauft".
    expect(table.getByRole('button', { name: /^Verkaufen$/i })).toBeEnabled();
    expect(table.getByRole('button', { name: /Verkauft/i })).toBeDisabled();
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

  it('surfaces an inline error and calls router.refresh() when reserve returns ok:false (conflict)', async () => {
    // Non-vacuous: the action resolves with an error, not ok:true.
    reserve.mockResolvedValueOnce({ ok: false, reason: 'conflict' });

    const user = userEvent.setup();
    render(<InventoryList rows={ROWS} total={ROWS.length} />);

    await user.click(screen.getByTestId('reserve-action'));

    // Error signal is rendered in the DOM — not silently swallowed.
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    // router.refresh() was triggered so the stale row gets an up-to-date status.
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });
});

// ── Row-selection checkbox has an accessible name but no visible duplicate text (finding F2) ───

describe('InventoryList — row-selection checkbox accessible name', () => {
  it('exposes the accessible name via getByLabel without rendering it as visible text', () => {
    render(<InventoryList rows={ROWS} total={ROWS.length} />);
    // The accessible name must still resolve (existing consumers rely on getByLabel/getByRole).
    expect(
      screen.getByLabelText(`„${ROWS[0].title}" für Etikettendruck auswählen`),
    ).toBeInTheDocument();
    // But it must NOT appear as a visible sentence in the row (it used to duplicate the Artikel
    // column and blow out the selection column — see InventoryList.tsx / Checkbox.tsx).
    expect(screen.queryByText(`„${ROWS[0].title}" für Etikettendruck auswählen`)).not.toBeInTheDocument();
  });
});

// ── Label print item mapping (review finding I1: discogsId flow-through) ───────

describe('InventoryList — label print item mapping', () => {
  it('carries the selected row discogsId into the printed label, QR only for the row that has one', async () => {
    const user = userEvent.setup();
    render(<InventoryList rows={ROWS} total={ROWS.length} />);

    // Select both rows — ROWS[0] has a discogsId, ROWS[1] does not (see fixture above).
    await user.click(screen.getByRole('checkbox', { name: `„${ROWS[0].title}" für Etikettendruck auswählen` }));
    await user.click(screen.getByRole('checkbox', { name: `„${ROWS[1].title}" für Etikettendruck auswählen` }));

    await user.click(screen.getByTestId('label-print-open'));
    await user.click(screen.getByTestId('label-print-submit'));

    await waitFor(() => expect(mockDoc.save).toHaveBeenCalledTimes(1));

    // Non-vacuous: exactly one of the two selected rows has a discogsId — QR must be fetched
    // exactly once, and for the correct release id (proves it's not hardcoded null).
    expect(QRCode.toDataURL).toHaveBeenCalledTimes(1);
    expect(QRCode.toDataURL).toHaveBeenCalledWith(`https://www.discogs.com/release/${ROWS[0].discogsId}`);
  });
});

// ── Selection survives a disjoint rows update (review finding I2) ──────────────

describe('InventoryList — selection state after a rows prop change', () => {
  it('drops the displayed count and disables the print button once selected ids are no longer in rows', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<InventoryList rows={ROWS} total={ROWS.length} />);

    await user.click(screen.getByRole('checkbox', { name: `„${ROWS[0].title}" für Etikettendruck auswählen` }));
    await user.click(screen.getByRole('checkbox', { name: `„${ROWS[1].title}" für Etikettendruck auswählen` }));

    expect(screen.getByText('2 ausgewählt')).toBeInTheDocument();
    expect(screen.getByTestId('label-print-open')).toBeEnabled();

    // Same component instance (rerender, not remount) receives a disjoint rows array — this is
    // what happens when the server re-renders after a status-tab switch (searchParams change).
    const otherRows: InventoryRow[] = [
      { ...ROWS[0], copyId: 99, title: 'A Completely Different Record' },
    ];
    rerender(<InventoryList rows={otherRows} total={otherRows.length} />);

    expect(screen.getByText('0 ausgewählt')).toBeInTheDocument();
    expect(screen.getByTestId('label-print-open')).toBeDisabled();
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
  it('defaults to tile view — renders article cards, no table', () => {
    render(<ViewToggle rows={ROWS} total={ROWS.length} />);
    expect(screen.getAllByRole('article')).toHaveLength(ROWS.length);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('switches to list view on Liste click — shows a table, no article cards', async () => {
    const user = userEvent.setup();
    render(<ViewToggle rows={ROWS} total={ROWS.length} />);
    await user.click(screen.getByRole('radio', { name: /Liste/i }));
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.queryAllByRole('article')).toHaveLength(0);
  });

  it('switches back to tiles on Kacheln click', async () => {
    const user = userEvent.setup();
    render(<ViewToggle rows={ROWS} total={ROWS.length} />);
    await user.click(screen.getByRole('radio', { name: /Liste/i }));
    await user.click(screen.getByRole('radio', { name: /Kacheln/i }));
    expect(screen.getAllByRole('article')).toHaveLength(ROWS.length);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
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

// ── KI-Suche (Slice 7): Score-Badge + Unavailable-State ─────────────────────────

describe('KI-Suche — Score-Badge (row.score → gerundeter %-Wert)', () => {
  it('InventoryList: rendert ki-score nur für Zeilen mit gesetztem score, gerundet auf %', () => {
    const rowsWithScore = [
      { ...ROWS[0], score: 0.873 },
      { ...ROWS[1], score: undefined },
    ];
    render(<InventoryList rows={rowsWithScore} total={rowsWithScore.length} />);
    const badges = screen.getAllByTestId('ki-score');
    // einmal in der Desktop-Tabelle, einmal in der Mobile-Karte — beide zeigen 87%.
    expect(badges.length).toBeGreaterThan(0);
    badges.forEach((b) => expect(b).toHaveTextContent('87%'));
  });

  it('InventoryTiles: rendert ki-score gerundet auf %, wenn row.score gesetzt ist', () => {
    const rowsWithScore = [{ ...ROWS[0], score: 0.5 }];
    render(<InventoryTiles rows={rowsWithScore} />);
    expect(screen.getByTestId('ki-score')).toHaveTextContent('50%');
  });

  it('kein ki-score-Badge ohne row.score (klassische Suche)', () => {
    render(<InventoryList rows={ROWS} total={ROWS.length} />);
    expect(screen.queryByTestId('ki-score')).not.toBeInTheDocument();
  });
});

describe('ViewToggle — kiUnavailable', () => {
  it('zeigt den KI-Unavailable-Zustand statt der normalen Liste/Kacheln', () => {
    render(<ViewToggle rows={[]} total={0} kiUnavailable />);
    expect(screen.getByText('KI-Suche momentan nicht verfügbar')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('Kein Treffer im Sortiment')).not.toBeInTheDocument();
  });
});

// ── ViewToggle — Mehr laden (keyset paging, Task 5) ─────────────────────────────

describe('ViewToggle — Mehr laden', () => {
  it('renders no "Mehr laden" button when initialCursor is null', () => {
    render(<ViewToggle rows={ROWS} total={ROWS.length} initialCursor={null} />);
    expect(screen.queryByTestId('load-more')).toBeNull();
  });

  it('shows the button for a non-null cursor, appends rows on click, and hides it when exhausted', async () => {
    const user = userEvent.setup();
    const extraRow: InventoryRow = { ...ROWS[0], copyId: 99999, title: 'Nachgeladen' };
    mockLoadMore.mockResolvedValueOnce({ ok: true, rows: [extraRow], nextCursor: null });

    render(<ViewToggle rows={ROWS} total={ROWS.length + 1} initialCursor="cur-1" />);

    const btn = screen.getByTestId('load-more');
    expect(btn).toBeInTheDocument();

    await user.click(btn);

    // Action called with the current searchParams string + the cursor.
    expect(mockLoadMore).toHaveBeenCalledWith({ params: 'status=verfuegbar', cursor: 'cur-1' });
    // Appended row is now visible — InventoryList renders both a desktop table row and a
    // mobile card per row (see "InventoryList" describe block above), so use getAllByText.
    await waitFor(() => expect(screen.getAllByText('Nachgeladen').length).toBeGreaterThan(0));
    // … and the button is gone (nextCursor was null).
    expect(screen.queryByTestId('load-more')).toBeNull();
  });

  it('surfaces an inline error and keeps the button on action failure', async () => {
    const user = userEvent.setup();
    mockLoadMore.mockResolvedValueOnce({ ok: false, reason: 'error' });

    render(<ViewToggle rows={ROWS} total={ROWS.length + 1} initialCursor="cur-1" />);
    await user.click(screen.getByTestId('load-more'));

    await waitFor(() =>
      expect(screen.getByText(/konnten nicht geladen werden/i)).toBeInTheDocument(),
    );
    expect(screen.getByTestId('load-more')).toBeInTheDocument(); // cursor unchanged → still there
  });

  // Review finding C1: a fresh SSR payload (e.g. router.refresh() after revalidatePath('/inventar')
  // post-reserve/sell/cancel, WITHOUT any filter change) used to be silently ignored because
  // ViewToggle accumulated rows in useState(initialRows) and page.tsx no longer remounts it via a
  // reset key. Locks the derive-from-props reset: a rerender with a new `rows` array identity must
  // (a) show the updated row content and (b) drop any load-more accumulation from before.
  it('resets accumulated rows when a fresh rows prop arrives (e.g. post-mutation revalidate), even without a remount', async () => {
    const user = userEvent.setup();
    const extraRow: InventoryRow = { ...ROWS[0], copyId: 99999, title: 'Nachgeladen' };
    mockLoadMore.mockResolvedValueOnce({ ok: true, rows: [extraRow], nextCursor: null });

    const { rerender } = render(
      <ViewToggle rows={ROWS} total={ROWS.length + 1} initialCursor="cur-1" />,
    );

    await user.click(screen.getByTestId('load-more'));
    await waitFor(() => expect(screen.getAllByText('Nachgeladen').length).toBeGreaterThan(0));

    // Simulate a revalidate/refresh after a mutation: SAME component instance (rerender, not a
    // remount — no key prop involved), a NEW rows array identity, first row's status flipped.
    const revalidatedRows: InventoryRow[] = [
      { ...ROWS[0], status: 'reserviert' },
      ROWS[1],
    ];
    rerender(<ViewToggle rows={revalidatedRows} total={ROWS.length} initialCursor="cur-1" />);

    // (a) updated row content from the fresh props is shown (StatusBadge label for 'reserviert').
    await waitFor(() => expect(screen.getAllByText('Reserviert').length).toBeGreaterThan(0));
    // (b) the previously-appended extra row is gone — accumulation reset, not silently kept stale.
    expect(screen.queryAllByText('Nachgeladen').length).toBe(0);
  });
});

// ── InventoryTiles cover image ─────────────────────────────────────────────────

describe('InventoryTiles — cover image', () => {
  it('renders the real cover <img> when coverImage is set, placeholder otherwise', () => {
    render(<InventoryTiles rows={ROWS} />);
    // ROWS[0] (Violator) has a cover URL → exactly one <img>; ROWS[1] (null) → hatched placeholder.
    const imgs = screen.getAllByRole('img');
    expect(imgs).toHaveLength(1);
    expect(imgs[0]).toHaveAttribute('src', 'https://i.discogs.com/violator.jpg');
    expect(imgs[0]).toHaveAccessibleName('Violator – Depeche Mode');
    // The cover-less row still shows the hatched placeholder ("cover" label).
    expect(screen.getByText('cover')).toBeInTheDocument();
  });

  it('falls back to the placeholder when the cover image fails to load', () => {
    render(<InventoryTiles rows={[ROWS[0]]} />);
    const img = screen.getByRole('img');
    fireEvent.error(img);
    // After onError the <img> is replaced by the placeholder.
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('cover')).toBeInTheDocument();
  });
});
