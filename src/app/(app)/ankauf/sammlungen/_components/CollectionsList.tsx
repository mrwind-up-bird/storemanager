// src/app/(app)/ankauf/sammlungen/_components/CollectionsList.tsx
// Presentational: Sammlungen overview table (spec Slice 4 — Batch-Ankauf drill-in). Each row's
// seller name links into the detail screen; "Sammlung anlegen" links to the batch-Ankauf wizard
// (no C14 testid for either link — selected by accessible name in tests). No hooks/browser APIs,
// so this renders identically as an RSC (real page) or a plain component (jsdom fixture tests).

import Link from 'next/link';
import { Card } from '@/components/ui';
import type { CollectionSummary } from '@/lib/collections';
import { formatEuro, formatDate } from './format';

export interface CollectionsListProps {
  collections: CollectionSummary[];
}

const thStyle: React.CSSProperties = {
  padding: '11px 18px',
  fontWeight: 600,
  fontSize: '11.5px',
  textTransform: 'uppercase',
  letterSpacing: '.05em',
};

export function CollectionsList({ collections }: CollectionsListProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Link
          href="/ankauf/sammlung"
          style={{
            minHeight: 'var(--tap)',
            display: 'inline-flex',
            alignItems: 'center',
            padding: '0 18px',
            borderRadius: 'var(--r-pill)',
            background: 'var(--accent)',
            color: 'var(--on-accent)',
            fontWeight: 700,
            fontSize: 13.5,
            textDecoration: 'none',
          }}
        >
          Sammlung anlegen
        </Link>
      </div>

      <Card data-testid="sammlungen-list" elevation={1}>
        {collections.length === 0 ? (
          <p style={{ margin: 0, padding: '20px 18px', color: 'var(--text-2)', fontSize: 14 }}>
            Noch keine Sammlungen erfasst.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, minWidth: 640 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-3)', background: 'var(--surface-2)' }}>
                  <th scope="col" style={{ ...thStyle, padding: '11px 18px' }}>Verkäufer</th>
                  <th scope="col" style={thStyle}>Datum</th>
                  <th scope="col" style={{ ...thStyle, textAlign: 'right' }}>Positionen</th>
                  <th scope="col" style={{ ...thStyle, textAlign: 'right', padding: '11px 18px' }}>Gesamt-EK</th>
                </tr>
              </thead>
              <tbody>
                {collections.map((c) => (
                  <tr key={c.id} data-testid="sammlung-row" style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '13px 18px' }}>
                      <Link
                        href={`/ankauf/sammlungen/${c.id}`}
                        style={{ color: 'var(--text)', fontWeight: 600, textDecoration: 'none' }}
                      >
                        {c.sellerName}
                      </Link>
                    </td>
                    <td
                      style={{
                        padding: '13px 12px',
                        color: 'var(--text-2)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 12.5,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {formatDate(c.acquiredAt)}
                    </td>
                    <td style={{ padding: '13px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                      {c.itemCount}
                    </td>
                    <td
                      style={{
                        padding: '13px 18px',
                        textAlign: 'right',
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 600,
                      }}
                    >
                      {formatEuro(c.totalEkCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
