// src/app/(app)/wunschlisten/_components/WishlistList.tsx
// Status-badged list of wishlists (spec §5.4). Presentational; no registered testid (C12) → none added.

import type { WishlistRow } from '@/lib/wishlist';
import type { WishlistStatus } from '@/db/schema';

const STATUS_LABEL: Record<WishlistStatus, string> = {
  open: 'Offen',
  notified: 'Benachrichtigt',
  closed: 'Geschlossen',
};

const STATUS_TOKEN: Record<WishlistStatus, { bg: string; ink: string; border: string }> = {
  open: { bg: 'var(--ok-soft)', ink: 'var(--ok)', border: 'color-mix(in srgb, var(--ok) 30%, transparent)' },
  notified: { bg: 'var(--info-soft)', ink: 'var(--info)', border: 'color-mix(in srgb, var(--info) 30%, transparent)' },
  closed: { bg: 'var(--surface-3)', ink: 'var(--text-2)', border: 'var(--border-strong)' },
};

function StatusPill({ status }: { status: WishlistStatus }) {
  const cfg = STATUS_TOKEN[status];
  return (
    <span
      style={{
        padding: '4px 11px',
        borderRadius: 'var(--r-pill)',
        background: cfg.bg,
        color: cfg.ink,
        border: `1px solid ${cfg.border}`,
        fontSize: '12px',
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export function WishlistList({ wishlists }: { wishlists: WishlistRow[] }) {
  if (wishlists.length === 0) {
    return <p style={{ color: 'var(--text-2)', fontSize: '14px', margin: 0 }}>Noch keine Wünsche erfasst.</p>;
  }
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {wishlists.map((w) => (
        <li
          key={w.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            padding: '12px 14px',
            borderRadius: 'var(--r-md)',
            border: '1px solid var(--border)',
            background: 'var(--surface)',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontWeight: 600, color: 'var(--text)', fontSize: '14px' }}>
              {w.artist}{w.title ? ` – ${w.title}` : ''}
            </span>
            <span style={{ color: 'var(--text-2)', fontSize: '13px' }}>
              <span>{w.customerName}</span>
              {' · '}
              <span>{w.customerEmail}</span>
            </span>
          </div>
          <StatusPill status={w.status} />
        </li>
      ))}
    </ul>
  );
}
