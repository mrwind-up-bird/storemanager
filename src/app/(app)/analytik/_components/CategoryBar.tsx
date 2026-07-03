// src/app/(app)/analytik/_components/CategoryBar.tsx
import { Card } from '@/components/ui';
import type { CategorySlice } from '@/lib/analytics';
import { formatEuroWhole } from '@/lib/format';

export interface CategoryBarProps {
  slices: CategorySlice[];
}

/**
 * Umsatz nach Kategorie panel — Q-Records App.dc.html analytics section (~line 472).
 * Stacked track (height:12, r-pill, bg surface-3) with one segment per slice, width
 * (v/total*100).toFixed(1)+'%', bg c.colorVar (colors fixed per C7). Legend rows below:
 * swatch + label + amount + pct.
 */
export function CategoryBar({ slices }: CategoryBarProps) {
  const total = slices.reduce((sum, s) => sum + s.valueCents, 0);
  const pctOf = (v: number) => (total > 0 ? (v / total) * 100 : 0);

  return (
    <Card data-testid="analytik-category-bar" elevation={1}>
      <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16 }}>
          Umsatz nach Kategorie
        </span>
      </div>
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div
          style={{
            height: 12,
            borderRadius: 'var(--r-pill)',
            background: 'var(--surface-3)',
            overflow: 'hidden',
            display: 'flex',
          }}
        >
          {slices.map((s) => (
            <span
              key={s.label}
              data-segment
              style={{ width: `${pctOf(s.valueCents).toFixed(1)}%`, background: s.colorVar }}
            />
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          {slices.map((s) => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span
                aria-hidden="true"
                style={{ width: 10, height: 10, borderRadius: 3, flex: 'none', background: s.colorVar }}
              />
              <span style={{ flex: 1, fontSize: '13.5px', fontWeight: 600 }}>{s.label}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{formatEuroWhole(s.valueCents)}</span>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '11.5px',
                  color: 'var(--text-3)',
                  width: 42,
                  textAlign: 'right',
                }}
              >
                {pctOf(s.valueCents).toFixed(1)} %
              </span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
