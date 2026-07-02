// src/app/(app)/ankauf/sammlungen/_components/CollectionDetailView.tsx
// Presentational: single-Sammlung detail (spec Slice 4 — Batch-Ankauf drill-in). Header
// (seller/date/positions/total, sellerContact/note when present) + item table (Artist — Title,
// Format, Zustand via `conditionLabel`, EK). `sammlung-print-labels` is the label-print entry
// point (C14) — wired to LabelPrintModal in Task 9; for now present with its testid, disabled/no-op.

import { Card } from '@/components/ui';
import type { CollectionDetail } from '@/lib/collections';
import { conditionLabel, type ConditionGrade } from '@/lib/pricing';
import { formatEuro, formatDate } from './format';

export interface CollectionDetailViewProps {
  collection: CollectionDetail;
}

const thStyle: React.CSSProperties = {
  padding: '11px 18px',
  fontWeight: 600,
  fontSize: '11.5px',
  textTransform: 'uppercase',
  letterSpacing: '.05em',
};

export function CollectionDetailView({ collection: c }: CollectionDetailViewProps) {
  return (
    <div data-testid="sammlung-detail" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 16,
          flexWrap: 'wrap',
          padding: 16,
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-lg)',
          background: 'var(--surface)',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18 }}>
            {c.sellerName}
          </span>
          <span style={{ color: 'var(--text-2)', fontSize: 13.5 }}>
            {formatDate(c.acquiredAt)} · {c.itemCount} Positionen · {formatEuro(c.totalEkCents)}
          </span>
          {c.sellerContact && <span style={{ color: 'var(--text-2)', fontSize: 13.5 }}>{c.sellerContact}</span>}
          {c.note && <span style={{ color: 'var(--text-3)', fontSize: 13 }}>{c.note}</span>}
        </div>

        {/* Task 9 wires this to LabelPrintModal with c.items — testid present now, no-op until then. */}
        <button
          type="button"
          data-testid="sammlung-print-labels"
          disabled
          style={{
            minHeight: 'var(--tap)',
            padding: '0 18px',
            border: '1.5px solid var(--border-strong)',
            borderRadius: 'var(--r-pill)',
            background: 'var(--surface-3)',
            color: 'var(--text-3)',
            fontWeight: 700,
            fontSize: 13.5,
            cursor: 'not-allowed',
          }}
        >
          Etiketten drucken
        </button>
      </header>

      <Card elevation={1}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, minWidth: 640 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-3)', background: 'var(--surface-2)' }}>
                <th scope="col" style={{ ...thStyle, padding: '11px 18px' }}>Artist — Titel</th>
                <th scope="col" style={thStyle}>Format</th>
                <th scope="col" style={thStyle}>Zustand</th>
                <th scope="col" style={{ ...thStyle, textAlign: 'right', padding: '11px 18px' }}>EK</th>
              </tr>
            </thead>
            <tbody>
              {c.items.map((it) => (
                <tr key={it.purchaseId} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '13px 18px' }}>
                    <strong style={{ fontWeight: 700 }}>{it.artist}</strong> — {it.title}
                  </td>
                  <td style={{ padding: '13px 12px', color: 'var(--text-2)' }}>{it.format ?? '—'}</td>
                  <td style={{ padding: '13px 12px' }}>{conditionLabel(it.conditionRecord as ConditionGrade)}</td>
                  <td style={{ padding: '13px 18px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                    {formatEuro(it.purchasePriceCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
