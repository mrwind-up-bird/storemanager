'use client';

import type { QuickItemRow } from '@/lib/quickItems';

export function QuickItemButtons({
  items,
  onAdd,
}: {
  items: QuickItemRow[];
  onAdd: (item: QuickItemRow) => void;
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          data-testid={`kasse-quick-item-${it.id}`}
          onClick={() => onAdd(it)}
          style={{
            padding: '8px 12px',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-md)',
            background: 'var(--surface)',
            cursor: 'pointer',
          }}
        >
          {it.name} · {it.price} €
        </button>
      ))}
    </div>
  );
}
