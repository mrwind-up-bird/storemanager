'use client';

import type { CartTotals } from '@/lib/sales';

/** UI cart line: display fields (label/unitPrice/key) on top of the C4 CartLineInput discriminant.
 *  key = inv-<purchaseId> | quick-<quickItemId> | adhoc-<index> (C12). */
export type UiCartLine =
  | { key: string; kind: 'inventory'; purchaseId: number; label: string; unitPrice: string }
  | { key: string; kind: 'quick'; quickItemId: number; label: string; unitPrice: string; quantity: number }
  | { key: string; kind: 'adhoc'; label: string; unitPrice: string; quantity: number };

export function Cart({
  lines,
  totals,
  onRemove,
  onSubmit,
  submitting,
}: {
  lines: UiCartLine[];
  totals: CartTotals;
  onRemove: (key: string) => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  const empty = lines.length === 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <ul
        data-testid="kasse-cart"
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {lines.map((l) => (
          <li
            key={l.key}
            data-testid={`kasse-cart-item-${l.key}`}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 8,
              padding: '6px 10px',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-md)',
              background: 'var(--surface)',
            }}
          >
            <span>{l.label}</span>
            <span>
              {l.kind === 'inventory' ? 1 : l.quantity} × {l.unitPrice} €
              <button
                type="button"
                onClick={() => onRemove(l.key)}
                aria-label="Position entfernen"
                style={{
                  marginLeft: 8,
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  color: 'var(--text-3)',
                }}
              >
                ✕
              </button>
            </span>
          </li>
        ))}
      </ul>
      <div data-testid="kasse-total" style={{ fontWeight: 700, textAlign: 'right' }}>
        {totals.total} €
      </div>
      <button
        type="button"
        data-testid="kasse-submit"
        disabled={empty || submitting}
        onClick={onSubmit}
        style={{
          padding: '10px 16px',
          border: 'none',
          borderRadius: 'var(--r-md)',
          background: 'var(--accent)',
          color: 'var(--on-accent)',
          cursor: empty || submitting ? 'not-allowed' : 'pointer',
          opacity: empty || submitting ? 0.5 : 1,
        }}
      >
        Verkaufen
      </button>
    </div>
  );
}
