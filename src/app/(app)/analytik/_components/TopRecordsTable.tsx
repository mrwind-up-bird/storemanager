// src/app/(app)/analytik/_components/TopRecordsTable.tsx
import type { CSSProperties } from 'react';
import { Card } from '@/components/ui';
import type { TopRecord } from '@/lib/analytics';
import { formatEuroWhole } from '@/lib/format';

export interface TopRecordsTableProps {
  rows: TopRecord[];
}

const thStyle: CSSProperties = {
  padding: '11px 18px',
  fontWeight: 600,
  fontSize: '11.5px',
  textTransform: 'uppercase',
  letterSpacing: '.05em',
};

/**
 * Top verkaufte Platten table — Q-Records App.dc.html analytics section (~line 528).
 * Genre pill on `var(--surface-3)`; Marge cell colored `var(--ok)` (margin is always a positive
 * headline number here — no bad-margin case in this table per spec).
 */
export function TopRecordsTable({ rows }: TopRecordsTableProps) {
  return (
    <Card data-testid="analytik-top-records" elevation={1}>
      <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16 }}>
          Top verkaufte Platten
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, minWidth: 640 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--text-3)', background: 'var(--surface-2)' }}>
              <th scope="col" style={thStyle}>Platte</th>
              <th scope="col" style={thStyle}>Genre</th>
              <th scope="col" style={{ ...thStyle, textAlign: 'right' }}>Verkäufe</th>
              <th scope="col" style={{ ...thStyle, textAlign: 'right' }}>Umsatz</th>
              <th scope="col" style={{ ...thStyle, textAlign: 'right' }}>Marge</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.artist}-${r.title}`} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '12px 18px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span
                      aria-hidden="true"
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 6,
                        flex: 'none',
                        background: 'repeating-linear-gradient(135deg, var(--surface-3) 0 5px, var(--surface-2) 5px 10px)',
                      }}
                    />
                    <span>
                      <strong style={{ fontWeight: 700 }}>{r.title}</strong>
                      <br />
                      <span style={{ color: 'var(--text-2)', fontSize: 13 }}>{r.artist}</span>
                    </span>
                  </div>
                </td>
                <td style={{ padding: '12px 12px' }}>
                  <span style={{ padding: '4px 10px', borderRadius: 'var(--r-pill)', fontSize: 12, fontWeight: 600, background: 'var(--surface-3)', color: 'var(--text-2)' }}>
                    {r.genre ?? '—'}
                  </span>
                </td>
                <td style={{ padding: '12px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                  {r.sales}
                </td>
                <td style={{ padding: '12px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                  {formatEuroWhole(r.revenueCents)}
                </td>
                <td style={{ padding: '12px 18px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--ok)', fontWeight: 600 }}>
                  {r.marginPct} %
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
