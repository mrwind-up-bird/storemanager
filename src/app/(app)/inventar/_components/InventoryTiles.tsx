import type { InventoryRow } from '@/lib/inventory';
import type { Condition } from '@/components/ui/ConditionPill';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ConditionPill } from '@/components/ui/ConditionPill';
import { CoverPlaceholder } from '@/components/ui/CoverPlaceholder';

/** CD → --info, everything else (Vinyl, Kassette, null) → --accent */
const discColor = (format: string | null) =>
  format === 'CD' ? 'var(--info)' : 'var(--accent)';

export interface InventoryTilesProps {
  rows: InventoryRow[];
}

export function InventoryTiles({ rows }: InventoryTilesProps) {
  return (
    <div
      data-testid="inventory-tiles"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,260px),1fr))',
        gap: 16,
      }}
    >
      {rows.map((row) => (
        <article
          key={row.copyId}
          style={{
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-lg)',
            background: 'var(--surface)',
            boxShadow: 'var(--shadow-1)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            opacity: row.status === 'verkauft' ? 0.62 : undefined,
          }}
        >
          {/* Card header — single format-coloured disc via CoverPlaceholder */}
          <div style={{ position: 'relative' }}>
            <CoverPlaceholder aspectRatio={1.9} labelColor={discColor(row.format)} />
            {/* StatusBadge overlay — top-left, backdrop-blur */}
            <span
              style={{
                position: 'absolute',
                top: 10,
                left: 10,
                backdropFilter: 'blur(4px)',
                WebkitBackdropFilter: 'blur(4px)',
              }}
            >
              <StatusBadge status={row.status} />
            </span>
          </div>

          {/* Card body */}
          <div
            style={{
              padding: '14px 16px 16px',
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
            }}
          >
            {/* Title + artist row, ConditionPill top-right */}
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontWeight: 700,
                    fontSize: '16.5px',
                    lineHeight: 1.2,
                    letterSpacing: '-.01em',
                  }}
                >
                  {row.title}
                </div>
                <div
                  style={{
                    fontSize: '13.5px',
                    color: 'var(--text-2)',
                    marginTop: 2,
                  }}
                >
                  {row.artist}
                </div>
              </div>
              {row.conditionRecord !== null && (
                <span style={{ flexShrink: 0 }}>
                  <ConditionPill condition={row.conditionRecord as Condition} />
                </span>
              )}
            </div>

            {/* Meta: Jahr · Label · Format */}
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '11.5px',
                color: 'var(--text-3)',
                marginTop: 8,
              }}
            >
              {[row.releaseYear, row.label.join('/'), row.format]
                .filter(Boolean)
                .join(' · ')}
            </div>

            {/* EK · VK + disabled Aktion button */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                marginTop: 'auto',
                paddingTop: 14,
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 13,
                }}
              >
                <span style={{ color: 'var(--text-3)' }}>EK {row.ek ?? '—'}</span>
                {' · '}
                <strong style={{ fontWeight: 700, fontSize: 17 }}>
                  {row.vk ?? '—'}
                </strong>
              </span>
              <button
                type="button"
                disabled
                style={{
                  minHeight: 34,
                  padding: '0 12px',
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
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
