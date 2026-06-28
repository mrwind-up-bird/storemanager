// Exact bg/color values verbatim from Design System 2026.dc.html
// section "Zustand · Discogs-Skala"
export type Condition = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

interface ConditionCfg { label: string; bg: string; color: string }

const CONDITIONS: Record<Condition, ConditionCfg> = {
  7: { label: 'Mint', bg: '#1f8a52', color: '#ffffff' },
  6: { label: 'NM',   bg: '#2f9e68', color: '#ffffff' },
  5: { label: 'VG+',  bg: '#9bc34a', color: '#3a2400' },
  4: { label: 'VG',   bg: '#e2c044', color: '#3a2400' },
  3: { label: 'G+',   bg: '#efab3b', color: '#3a2400' },
  2: { label: 'G',    bg: '#e0762e', color: '#ffffff' },
  1: { label: 'Fair', bg: '#d65532', color: '#ffffff' },
  0: { label: 'Poor', bg: '#b6362c', color: '#ffffff' },
};

export interface ConditionPillProps { condition: Condition; className?: string }

export function ConditionPill({ condition, className }: ConditionPillProps) {
  const cfg = CONDITIONS[condition];
  return (
    <span
      className={className}
      style={{
        display: 'inline-block',
        padding: '6px 12px',
        borderRadius: 'var(--r-pill)',
        fontSize: '12.5px',
        fontWeight: 700,
        background: cfg.bg,
        color: cfg.color,
        lineHeight: 1,
      }}
    >
      {cfg.label}
    </span>
  );
}
