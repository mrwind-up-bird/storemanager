export type RecordStatus = 'verfuegbar' | 'reserviert' | 'verkauft' | 'verliehen';

interface StatusCfg { label: string; bg: string; ink: string; dot: string; border: string }

const STATUS: Record<RecordStatus, StatusCfg> = {
  verfuegbar: {
    label: 'im Lager',
    bg: 'var(--ok-soft)',
    ink: 'var(--ok)',
    dot: 'var(--ok)',
    border: 'color-mix(in srgb, var(--ok) 30%, transparent)',
  },
  reserviert: {
    label: 'Reserviert',
    bg: 'var(--honey-soft)',
    ink: 'var(--honey-ink)',
    dot: 'var(--honey)',
    border: 'var(--accent-soft-border)',
  },
  verkauft: {
    label: 'Verkauft',
    bg: 'var(--surface-3)',
    ink: 'var(--text-2)',
    dot: 'var(--text-3)',
    border: 'var(--border-strong)',
  },
  verliehen: {
    label: 'Verliehen',
    bg: 'var(--info-soft)',
    ink: 'var(--info)',
    dot: 'var(--info)',
    border: 'color-mix(in srgb, var(--info) 30%, transparent)',
  },
};

export interface StatusBadgeProps { status: RecordStatus; className?: string }

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const cfg = STATUS[status];
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '7px',
        padding: '6px 13px 6px 11px', borderRadius: 'var(--r-pill)',
        background: cfg.bg, color: cfg.ink, border: `1px solid ${cfg.border}`,
        fontSize: '13px', fontWeight: 600,
      }}
    >
      <span
        aria-hidden="true"
        style={{ width: 8, height: 8, borderRadius: '50%', background: cfg.dot, flexShrink: 0 }}
      />
      {cfg.label}
    </span>
  );
}
