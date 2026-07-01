'use client';

import { useState } from 'react';
import type { InventoryRow } from '@/lib/inventory';

/** Renders ONLY the rows it is given (the page pre-filters to verfuegbar/reserviert). In-results
 *  case-insensitive substring search over "artist title"; clicking a result emits the full row. */
export function InventorySearch({
  rows,
  onAdd,
}: {
  rows: InventoryRow[];
  onAdd: (row: InventoryRow) => void;
}) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const matches = needle
    ? rows.filter((r) => `${r.artist} ${r.title}`.toLowerCase().includes(needle)).slice(0, 8)
    : [];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <input
        data-testid="kasse-inventory-search"
        placeholder="Inventar durchsuchen…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{
          padding: '8px 10px',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-md)',
          background: 'var(--surface)',
        }}
      />
      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        {matches.map((r) => (
          <li key={r.copyId}>
            <button
              type="button"
              onClick={() => onAdd(r)}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '6px 10px',
                border: '1px solid var(--border)',
                borderRadius: 'var(--r-md)',
                background: 'var(--surface)',
                cursor: 'pointer',
              }}
            >
              {r.artist} – {r.title} · {r.vk ?? '—'} €
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
