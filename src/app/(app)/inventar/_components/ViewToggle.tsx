'use client';

import { useState } from 'react';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { InventoryList } from './InventoryList';
import { InventoryTiles } from './InventoryTiles';
import type { InventoryRow } from '@/lib/inventory';

const VIEW_OPTIONS = [
  { value: 'list', label: '☰ Liste' },
  { value: 'tiles', label: '▦ Kacheln' },
];

export interface ViewToggleProps {
  rows: InventoryRow[];
  total: number;
}

export function ViewToggle({ rows, total }: ViewToggleProps) {
  const [view, setView] = useState<'list' | 'tiles'>('list');

  // Empty state (verbatim from Q-Records App.dc.html lines 257-263)
  if (rows.length === 0) {
    return (
      <div
        style={{
          border: '1px dashed var(--border-strong)',
          borderRadius: 'var(--r-lg)',
          background: 'var(--surface)',
          padding: '48px 24px',
          textAlign: 'center',
          color: 'var(--text-3)',
        }}
      >
        <div aria-hidden="true" style={{ fontSize: 34, marginBottom: 8 }}>
          ⌕
        </div>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: 17,
            color: 'var(--text-2)',
          }}
        >
          Kein Treffer im Sortiment
        </div>
        <p
          style={{
            fontSize: '13.5px',
            lineHeight: 1.6,
            margin: '6px auto 16px',
            maxWidth: '38ch',
          }}
        >
          Andere Schreibweise probieren, Filter lockern — oder die Platte direkt
          über die Discogs-Suche ankaufen.
        </p>
        {/* Link clears all params — works as a plain anchor for the reset */}
        <a
          href="/inventar"
          className="focus-ring-button"
          style={{
            display: 'inline-block',
            minHeight: 40,
            padding: '0 18px',
            lineHeight: '40px',
            border: '1.5px solid var(--border-strong)',
            borderRadius: 'var(--r-pill)',
            background: 'var(--surface)',
            color: 'var(--text)',
            fontFamily: 'var(--font-body)',
            fontWeight: 600,
            fontSize: 13,
            textDecoration: 'none',
          }}
        >
          Filter zurücksetzen
        </a>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <SegmentedControl
          options={VIEW_OPTIONS}
          value={view}
          onChange={(v) => setView(v as 'list' | 'tiles')}
          aria-label="Ansicht wechseln"
        />
      </div>
      {view === 'list' ? (
        <InventoryList rows={rows} total={total} />
      ) : (
        <InventoryTiles rows={rows} />
      )}
    </div>
  );
}
