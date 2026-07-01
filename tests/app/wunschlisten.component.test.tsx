// tests/app/wunschlisten.component.test.tsx
// @vitest-environment jsdom

/// <reference types="@testing-library/jest-dom/vitest" />

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

// vi.hoisted: refs available inside the statically-hoisted vi.mock factory (ankauf-modal.test.tsx pattern).
const createWishlist = vi.hoisted(() =>
  vi.fn(
    async (): Promise<
      | { ok: true; id: number }
      | { ok: false; reason: 'validation' | 'error'; message?: string }
    > => ({ ok: true, id: 7 }),
  ),
);
const notifyWishlistMatch = vi.hoisted(() => vi.fn(async () => ({ ok: true as const })));
const dismissMatch = vi.hoisted(() => vi.fn(async () => ({ ok: true as const })));

vi.mock('@/app/(app)/wunschlisten/actions', () => ({
  createWishlist,
  notifyWishlistMatch,
  dismissMatch,
}));

import { WishlistForm } from '@/app/(app)/wunschlisten/_components/WishlistForm';
import { WishlistList } from '@/app/(app)/wunschlisten/_components/WishlistList';
import { NotifyModal } from '@/app/(app)/wunschlisten/_components/NotifyModal';
import { MatchesSection } from '@/app/(app)/wunschlisten/_components/MatchesSection';
import type { WishlistRow } from '@/lib/wishlist';
import type { PendingMatchRow } from '@/lib/wishlist';

afterEach(cleanup);

// ── WishlistForm ───────────────────────────────────────────────────────────────

describe('WishlistForm', () => {
  beforeEach(() => {
    createWishlist.mockClear();
    createWishlist.mockResolvedValue({ ok: true, id: 7 });
  });

  it('renders all wl-* fields and the form/submit testids', () => {
    render(<WishlistForm />);
    expect(screen.getByTestId('wishlist-form')).toBeTruthy();
    for (const id of [
      'wl-customer-name',
      'wl-customer-email',
      'wl-artist',
      'wl-label',
      'wl-title',
      'wl-country',
      'wishlist-submit',
    ]) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
  });

  it('prefills artist/title from the §5.6 ♡ props', () => {
    render(<WishlistForm initialArtist="Miles Davis" initialTitle="Kind of Blue" />);
    expect((screen.getByTestId('wl-artist') as HTMLInputElement).value).toBe('Miles Davis');
    expect((screen.getByTestId('wl-title') as HTMLInputElement).value).toBe('Kind of Blue');
  });

  it('submits trimmed payload to createWishlist (empty optionals → null) and resets on success', async () => {
    render(<WishlistForm />);
    fireEvent.change(screen.getByTestId('wl-customer-name'), { target: { value: 'Ada Lovelace' } });
    fireEvent.change(screen.getByTestId('wl-customer-email'), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByTestId('wl-artist'), { target: { value: 'Miles Davis' } });
    fireEvent.change(screen.getByTestId('wl-label'), { target: { value: '  Columbia  ' } });
    fireEvent.click(screen.getByTestId('wishlist-submit'));

    await waitFor(() => expect(createWishlist).toHaveBeenCalledTimes(1));
    expect(createWishlist).toHaveBeenCalledWith({
      customerName: 'Ada Lovelace',
      customerEmail: 'ada@example.com',
      artist: 'Miles Davis',
      label: 'Columbia',
      title: null,
      country: null,
    });
    // resets the artist field after a successful create
    await waitFor(() =>
      expect((screen.getByTestId('wl-artist') as HTMLInputElement).value).toBe(''),
    );
  });

  it('shows the error message when createWishlist fails', async () => {
    createWishlist.mockResolvedValueOnce({ ok: false, reason: 'validation', message: 'Künstler fehlt.' });
    render(<WishlistForm />);
    fireEvent.change(screen.getByTestId('wl-customer-name'), { target: { value: 'X' } });
    fireEvent.change(screen.getByTestId('wl-customer-email'), { target: { value: 'x@example.com' } });
    fireEvent.change(screen.getByTestId('wl-artist'), { target: { value: 'Y' } });
    fireEvent.click(screen.getByTestId('wishlist-submit'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Künstler fehlt.'));
  });
});

// ── WishlistList ───────────────────────────────────────────────────────────────

const wishlistRows: WishlistRow[] = [
  {
    id: 1,
    customerName: 'Ada Lovelace',
    customerEmail: 'ada@example.com',
    artist: 'Miles Davis',
    label: 'Columbia',
    title: 'Kind of Blue',
    country: 'US',
    status: 'open',
    createdAt: new Date('2026-06-01T10:00:00Z'),
  },
  {
    id: 2,
    customerName: 'Alan Turing',
    customerEmail: 'alan@example.com',
    artist: 'John Coltrane',
    label: null,
    title: null,
    country: null,
    status: 'notified',
    createdAt: new Date('2026-06-02T10:00:00Z'),
  },
];

describe('WishlistList', () => {
  it('renders each wish with customer + artist/title and a German status label', () => {
    render(<WishlistList wishlists={wishlistRows} />);
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    expect(screen.getByText(/Miles Davis – Kind of Blue/)).toBeTruthy();
    expect(screen.getByText('Offen')).toBeTruthy();
    expect(screen.getByText('Alan Turing')).toBeTruthy();
    // notified-status wish maps to the "Benachrichtigt" label
    expect(screen.getByText('Benachrichtigt')).toBeTruthy();
  });

  it('renders an empty hint when there are no wishes', () => {
    render(<WishlistList wishlists={[]} />);
    expect(screen.getByText(/Noch keine Wünsche erfasst/)).toBeTruthy();
  });
});

// ── NotifyModal ────────────────────────────────────────────────────────────────

const pendingMatch: PendingMatchRow = {
  matchId: 55,
  wishlistId: 1,
  customerName: 'Ada Lovelace',
  customerEmail: 'ada@example.com',
  artist: 'Miles Davis',
  title: 'Kind of Blue',
  coverImage: null,
  createdAt: new Date('2026-06-03T10:00:00Z'),
};

describe('NotifyModal', () => {
  beforeEach(() => {
    notifyWishlistMatch.mockClear();
    notifyWishlistMatch.mockResolvedValue({ ok: true });
  });

  it('renders the read-only template preview with the C10 subject + recipient (no editable field)', () => {
    render(<NotifyModal match={pendingMatch} tenantName="Q-Records" onClose={() => {}} />);
    expect(screen.getByTestId('notify-modal')).toBeTruthy();
    const preview = screen.getByTestId('notify-preview');
    // Read-only: the preview is NOT a textbox/textarea (CONTRACTS §0a delta 1).
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(preview.tagName).not.toBe('TEXTAREA');
    expect(preview.tagName).not.toBe('INPUT');
    // Renders the locked C10 copy (greeting + tenant name + artist – title).
    expect(preview.textContent).toContain('Hallo Ada Lovelace');
    expect(preview.textContent).toContain('Q-Records');
    expect(preview.textContent).toContain('Miles Davis – Kind of Blue');
    // Recipient + locked subject are shown to the staff member.
    expect(screen.getByText(/ada@example.com/)).toBeTruthy();
    expect(screen.getByText(/Dein Wunsch ist da: Miles Davis – Kind of Blue/)).toBeTruthy();
  });

  it('notify-send calls notifyWishlistMatch once with the matchId then closes', async () => {
    const onClose = vi.fn();
    render(<NotifyModal match={pendingMatch} tenantName="Q-Records" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('notify-send'));
    await waitFor(() => expect(notifyWishlistMatch).toHaveBeenCalledTimes(1));
    expect(notifyWishlistMatch).toHaveBeenCalledWith({ matchId: 55 });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('notify-cancel closes without calling the action', () => {
    const onClose = vi.fn();
    render(<NotifyModal match={pendingMatch} tenantName="Q-Records" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('notify-cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(notifyWishlistMatch).not.toHaveBeenCalled();
  });
});

// ── MatchesSection ─────────────────────────────────────────────────────────────

describe('MatchesSection', () => {
  beforeEach(() => {
    dismissMatch.mockClear();
    dismissMatch.mockResolvedValue({ ok: true });
    notifyWishlistMatch.mockClear();
    notifyWishlistMatch.mockResolvedValue({ ok: true });
  });

  it('renders the section + a row with notify/dismiss controls keyed by matchId', () => {
    render(<MatchesSection matches={[pendingMatch]} tenantName="Q-Records" />);
    expect(screen.getByTestId('wishlist-matches')).toBeTruthy();
    expect(screen.getByTestId('wl-match-55')).toBeTruthy();
    expect(screen.getByTestId('wl-notify-55')).toBeTruthy();
    expect(screen.getByTestId('wl-dismiss-55')).toBeTruthy();
    expect(screen.getByText(/Miles Davis – Kind of Blue/)).toBeTruthy();
    // modal is not mounted until "Benachrichtigen" is clicked
    expect(screen.queryByTestId('notify-modal')).toBeNull();
  });

  it('wl-notify opens the NotifyModal for that match', () => {
    render(<MatchesSection matches={[pendingMatch]} tenantName="Q-Records" />);
    fireEvent.click(screen.getByTestId('wl-notify-55'));
    expect(screen.getByTestId('notify-modal')).toBeTruthy();
    expect(screen.getByTestId('notify-preview').textContent).toContain('Hallo Ada Lovelace');
  });

  it('wl-dismiss calls dismissMatch once with the matchId', async () => {
    render(<MatchesSection matches={[pendingMatch]} tenantName="Q-Records" />);
    fireEvent.click(screen.getByTestId('wl-dismiss-55'));
    await waitFor(() => expect(dismissMatch).toHaveBeenCalledTimes(1));
    expect(dismissMatch).toHaveBeenCalledWith({ matchId: 55 });
  });

  it('renders an empty hint when there are no pending matches', () => {
    render(<MatchesSection matches={[]} tenantName="Q-Records" />);
    expect(screen.getByTestId('wishlist-matches')).toBeTruthy();
    expect(screen.getByText(/Keine offenen Treffer/)).toBeTruthy();
  });
});
