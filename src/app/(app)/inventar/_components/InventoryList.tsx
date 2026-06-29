import type { InventoryRow } from '@/lib/inventory';
import type { Condition } from '@/components/ui/ConditionPill';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ConditionPill } from '@/components/ui/ConditionPill';

export interface InventoryListProps {
  rows: InventoryRow[];
  total: number; // from inventoryAggregates.total (ignores status tab) → footer
}

export function InventoryList({ rows, total }: InventoryListProps) {
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-lg)',
        background: 'var(--surface)',
        boxShadow: 'var(--shadow-1)',
        overflow: 'hidden',
      }}
    >
      <div style={{ overflowX: 'auto' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 14,
            minWidth: 720,
          }}
        >
          <thead>
            <tr
              style={{
                textAlign: 'left',
                color: 'var(--text-3)',
                background: 'var(--surface-2)',
              }}
            >
              <th
                scope="col"
                style={{
                  padding: '12px 18px',
                  fontWeight: 600,
                  fontSize: '11.5px',
                  textTransform: 'uppercase',
                  letterSpacing: '.05em',
                }}
              >
                Artikel
              </th>
              <th
                scope="col"
                style={{
                  padding: '12px 12px',
                  fontWeight: 600,
                  fontSize: '11.5px',
                  textTransform: 'uppercase',
                  letterSpacing: '.05em',
                }}
              >
                Jahr · Label
              </th>
              <th
                scope="col"
                style={{
                  padding: '12px 12px',
                  fontWeight: 600,
                  fontSize: '11.5px',
                  textTransform: 'uppercase',
                  letterSpacing: '.05em',
                }}
              >
                Zustand
              </th>
              <th
                scope="col"
                style={{
                  padding: '12px 12px',
                  fontWeight: 600,
                  fontSize: '11.5px',
                  textTransform: 'uppercase',
                  letterSpacing: '.05em',
                  textAlign: 'right',
                }}
              >
                EK / VK
              </th>
              <th
                scope="col"
                style={{
                  padding: '12px 12px',
                  fontWeight: 600,
                  fontSize: '11.5px',
                  textTransform: 'uppercase',
                  letterSpacing: '.05em',
                }}
              >
                Status
              </th>
              <th
                scope="col"
                style={{
                  padding: '12px 18px',
                  fontWeight: 600,
                  fontSize: '11.5px',
                  textTransform: 'uppercase',
                  letterSpacing: '.05em',
                  textAlign: 'right',
                }}
              >
                Aktion
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.copyId}
                style={{
                  borderTop: '1px solid var(--border)',
                  opacity: row.status === 'verkauft' ? 0.62 : undefined,
                }}
              >
                {/* Artikel: 36×36 cover thumb + title + artist */}
                <td style={{ padding: '13px 18px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {/* Cover thumbnail — hatched placeholder (36×36, r-xs=6px) */}
                    <span
                      aria-hidden="true"
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 6,
                        flexShrink: 0,
                        background:
                          'repeating-linear-gradient(135deg,var(--surface-3) 0 5px,var(--surface-2) 5px 10px)',
                      }}
                    />
                    <span style={{ minWidth: 0 }}>
                      <strong style={{ fontWeight: 700 }}>{row.title}</strong>
                      <br />
                      <span style={{ color: 'var(--text-2)', fontSize: 13 }}>
                        {row.artist}
                      </span>
                    </span>
                  </div>
                </td>

                {/* Jahr · Label */}
                <td
                  style={{
                    padding: '13px 12px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '12.5px',
                    color: 'var(--text-2)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {[row.releaseYear, row.label.join('/')]
                    .filter(Boolean)
                    .join(' · ')}
                </td>

                {/* Zustand — ConditionPill on conditionRecord */}
                <td style={{ padding: '13px 12px' }}>
                  {row.conditionRecord !== null && (
                    <ConditionPill condition={row.conditionRecord as Condition} />
                  )}
                </td>

                {/* EK / VK — right-aligned, mono */}
                <td
                  style={{
                    padding: '13px 12px',
                    textAlign: 'right',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 13,
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{ color: 'var(--text-3)' }}>{row.ek ?? '—'}</span>
                  {' · '}
                  <strong style={{ fontWeight: 700 }}>{row.vk ?? '—'}</strong>
                </td>

                {/* Status — StatusBadge (dot + label) */}
                <td style={{ padding: '13px 12px' }}>
                  <StatusBadge status={row.status} />
                </td>

                {/* Aktion — disabled placeholder (no mutations in Slice 1) */}
                <td style={{ padding: '13px 18px', textAlign: 'right' }}>
                  <button
                    type="button"
                    disabled
                    style={{
                      minHeight: 34,
                      padding: '0 14px',
                      border: 'none',
                      borderRadius: 'var(--r-pill)',
                      background: 'var(--surface-3)',
                      color: 'var(--text-3)',
                      fontFamily: 'var(--font-body)',
                      fontWeight: 600,
                      fontSize: '12.5px',
                      cursor: 'not-allowed',
                    }}
                  >
                    {row.status === 'verkauft' ? 'Verkauft' : 'Verkaufen'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer: n von total + mobile hint */}
      <div
        style={{
          padding: '13px 18px',
          borderTop: '1px solid var(--border)',
          fontSize: '12.5px',
          color: 'var(--text-3)',
          fontFamily: 'var(--font-mono)',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>
          {rows.length} von {total}
        </span>
        <span>↔ scrollt auf Mobile</span>
      </div>
    </div>
  );
}
