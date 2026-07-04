'use client';

export function ReloadButton() {
  return (
    <button
      type="button"
      onClick={() => location.reload()}
      className="focus-ring-button"
      style={{
        minHeight: 'var(--tap)', padding: '0 22px', border: 'none',
        borderRadius: 'var(--r-pill)', background: 'var(--accent)',
        color: 'var(--on-accent)', fontFamily: 'var(--font-body)',
        fontWeight: 700, fontSize: 14.5, cursor: 'pointer',
      }}
    >
      Erneut versuchen
    </button>
  );
}
