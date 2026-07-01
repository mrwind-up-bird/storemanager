'use client';

import type { DiscountInput as DiscountKind } from '@/lib/sales';

/** The two selectable modes map to the C4 DiscountInput union literals 'amount' (€) and 'percent' (%). */
export function DiscountInput({
  mode,
  value,
  onModeChange,
  onValueChange,
}: {
  mode: DiscountKind['kind'];
  value: string;
  onModeChange: (mode: DiscountKind['kind']) => void;
  onValueChange: (value: string) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <select
        data-testid="kasse-discount-mode"
        value={mode}
        onChange={(e) => onModeChange(e.target.value as DiscountKind['kind'])}
        style={{
          padding: '8px 10px',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-md)',
          background: 'var(--surface)',
        }}
      >
        <option value="amount">€</option>
        <option value="percent">%</option>
      </select>
      <input
        data-testid="kasse-discount-input"
        inputMode="decimal"
        value={value}
        placeholder="Rabatt"
        onChange={(e) => onValueChange(e.target.value)}
        style={{
          width: 110,
          padding: '8px 10px',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-md)',
          background: 'var(--surface)',
        }}
      />
    </div>
  );
}
