'use client';

// src/app/(app)/ankauf/sammlungen/_components/CollectionDetailView.tsx
// Presentational (+ the label-print modal's local open state): single-Sammlung detail (spec
// Slice 4 — Batch-Ankauf drill-in). Header (seller/date/positions/total, sellerContact/note when
// present) + item table (Artist — Title, Format, Zustand via `conditionLabel`, EK).
// `sammlung-print-labels` opens LabelPrintModal (C12) with the collection's items mapped to
// LabelItem — 'use client' only for that button + modal; the data itself still comes from the
// server page as a prop (`import type` on CollectionDetail is erased, so 'server-only' in
// @/lib/collections never reaches this client bundle).

import { useState } from 'react';
import { Card } from '@/components/ui';
import type { CollectionDetail } from '@/lib/collections';
import { conditionLabel, type ConditionGrade } from '@/lib/pricing';
import { LabelPrintModal } from '@/app/(app)/inventar/_components/LabelPrintModal';
import type { LabelItem } from '@/lib/labels';
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
  const [printOpen, setPrintOpen] = useState(false);

  const labelItems: LabelItem[] = c.items.map((it) => ({
    artist: it.artist,
    title: it.title,
    format: it.format,
    conditionRecord: it.conditionRecord,
    priceCents: it.targetPriceCents,
    discogsId: it.discogsId,
  }));

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

        <button
          type="button"
          data-testid="sammlung-print-labels"
          onClick={() => setPrintOpen(true)}
          disabled={c.items.length === 0}
          style={{
            minHeight: 'var(--tap)',
            padding: '0 18px',
            border: '1.5px solid var(--border-strong)',
            borderRadius: 'var(--r-pill)',
            background: c.items.length === 0 ? 'var(--surface-3)' : 'var(--surface)',
            color: c.items.length === 0 ? 'var(--text-3)' : 'var(--text)',
            fontWeight: 700,
            fontSize: 13.5,
            cursor: c.items.length === 0 ? 'not-allowed' : 'pointer',
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

      <LabelPrintModal items={labelItems} open={printOpen} onClose={() => setPrintOpen(false)} />
    </div>
  );
}
