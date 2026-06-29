//
// Verbatim from design handoff:
//   disc-behind-card — Q-Records App.dc.html line 404 / Design System 2026.dc.html line 467
//     position: right:-32%, width:78%, vertically centred
//     gradient: card variant (hole=var(--surface), label ring 5.4%–30%, groove 1.5px/3.4px)
//   cover hatch — Design System 2026.dc.html line 468
//     repeating-linear-gradient(135deg,var(--surface-3) 0 11px,var(--surface-2) 11px 22px)

export interface CoverPlaceholderProps {
  aspectRatio?: number;  // default 1 (square), set 1.9 for landscape card variant
  className?: string;
}

export function CoverPlaceholder({ aspectRatio = 1, className }: CoverPlaceholderProps) {
  return (
    <div className={className} style={{ position: 'relative', aspectRatio, overflow: 'hidden' }}>
      {/* Disc peeking from the right — verbatim positions from Q-Records App.dc.html line 404 */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute', right: '-32%', top: '50%', transform: 'translateY(-50%)',
          width: '78%', aspectRatio: 1, borderRadius: '50%', boxShadow: 'var(--shadow-2)',
          background: [
            'radial-gradient(circle at 50% 50%,var(--surface) 0 5%,#0000 5.4%)',
            'radial-gradient(circle at 50% 50%,var(--disc-label) 5.4% 30%,#0000 30.4%)',
            'repeating-radial-gradient(circle at 50% 50%,var(--disc-groove-a) 0 1.5px,var(--disc-groove-b) 1.5px 3.4px)',
            'var(--disc-base)',
          ].join(','),
        }}
      />
      {/* Cover area: hatched placeholder occupying left ~80% — verbatim from Design System 2026.dc.html line 468 */}
      <div
        style={{
          position: 'absolute', inset: 0, width: '80%',
          background: 'repeating-linear-gradient(135deg,var(--surface-3) 0 11px,var(--surface-2) 11px 22px)',
          display: 'grid', placeItems: 'center',
          borderRight: '1px solid var(--border)',
        }}
      >
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-3)', letterSpacing: '.05em' }}>
          cover
        </span>
      </div>
    </div>
  );
}
