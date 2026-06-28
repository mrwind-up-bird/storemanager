// Exact mask-gradient from Design System 2026.dc.html button loading state (line 323)
export interface SpinnerProps {
  /** px diameter — default 16 */
  size?: number;
  /** CSS color — default 'var(--on-accent)' for use inside accent buttons */
  color?: string;
  className?: string;
}

export function Spinner({ size = 16, color = 'var(--on-accent)', className }: SpinnerProps) {
  return (
    <span
      aria-hidden="true"
      className={className}
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        flexShrink: 0,
        animation: 'spin 1s linear infinite',
        background: [
          `radial-gradient(circle at 50% 50%,#0000 0 30%,${color} 31% 42%,#0000 43%)`,
          `conic-gradient(${color} 0 25%,#0000 25% 100%)`,
        ].join(','),
        WebkitMask: 'radial-gradient(circle at 50% 50%,#0000 0 30%,#000 31%)',
        mask:        'radial-gradient(circle at 50% 50%,#0000 0 30%,#000 31%)',
      }}
    />
  );
}
