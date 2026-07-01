'use client';

// src/app/(app)/wunschlisten/_components/MatchesSection.tsx
// "Offene Treffer" section (spec §5.4): each pending wishlist_match → Benachrichtigen (opens NotifyModal)
// + Verwerfen (dismissMatch, C11). Source: PendingMatchRow[] (C8 listPendingMatches).

import { useState } from 'react';
import type { PendingMatchRow } from '@/lib/wishlist';
import { dismissMatch } from '../actions';
import { NotifyModal } from './NotifyModal';

export interface MatchesSectionProps {
  matches: PendingMatchRow[];
  tenantName: string;
}

export function MatchesSection({ matches, tenantName }: MatchesSectionProps) {
  const [selected, setSelected] = useState<PendingMatchRow | null>(null);
  const [dismissing, setDismissing] = useState<number | null>(null);

  const handleDismiss = async (matchId: number) => {
    setDismissing(matchId);
    try {
      await dismissMatch({ matchId });
    } finally {
      setDismissing(null);
    }
  };

  return (
    <section
      data-testid="wishlist-matches"
      style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
    >
      <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '18px', color: 'var(--text)' }}>
        Offene Treffer
      </h2>

      {matches.length === 0 ? (
        <p style={{ color: 'var(--text-2)', fontSize: '14px', margin: 0 }}>Keine offenen Treffer.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {matches.map((m) => (
            <li
              key={m.matchId}
              data-testid={`wl-match-${m.matchId}`}
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
                  {m.artist} – {m.title}
                </span>
                <span style={{ color: 'var(--text-2)', fontSize: '13px' }}>
                  {m.customerName} · {m.customerEmail}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                <button
                  type="button"
                  data-testid={`wl-notify-${m.matchId}`}
                  onClick={() => setSelected(m)}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 'var(--r-pill)',
                    border: 'none',
                    background: 'var(--accent)',
                    color: 'var(--on-accent)',
                    fontWeight: 600,
                    fontSize: '13px',
                    cursor: 'pointer',
                  }}
                >
                  Benachrichtigen
                </button>
                <button
                  type="button"
                  data-testid={`wl-dismiss-${m.matchId}`}
                  onClick={() => handleDismiss(m.matchId)}
                  disabled={dismissing === m.matchId}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 'var(--r-pill)',
                    border: '1px solid var(--border-strong)',
                    background: 'var(--surface)',
                    color: 'var(--text)',
                    fontWeight: 600,
                    fontSize: '13px',
                    cursor: dismissing === m.matchId ? 'default' : 'pointer',
                    opacity: dismissing === m.matchId ? 0.6 : 1,
                  }}
                >
                  Verwerfen
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <NotifyModal match={selected} tenantName={tenantName} onClose={() => setSelected(null)} />
      )}
    </section>
  );
}
