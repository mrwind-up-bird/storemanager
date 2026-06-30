// src/app/(app)/ankauf/_components/ConnectPrompt.tsx
// Calm empty state shown when no Discogs connection exists for this tenant.

export function ConnectPrompt() {
  return (
    <div
      data-testid="connect-discogs-prompt"
      style={{
        border: '1px dashed var(--border-strong)',
        borderRadius: 'var(--r-lg)',
        background: 'var(--surface)',
        padding: '56px 24px',
        textAlign: 'center',
        maxWidth: 480,
        margin: '0 auto',
      }}
    >
      {/* Disc icon — decorative */}
      <div aria-hidden="true" style={{ fontSize: 40, marginBottom: 12, color: 'var(--text-3)' }}>
        ◉
      </div>

      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: 20,
          letterSpacing: '-.01em',
          marginBottom: 8,
        }}
      >
        Discogs verbinden
      </div>

      <p
        style={{
          fontSize: '14px',
          lineHeight: 1.6,
          color: 'var(--text-2)',
          margin: '0 auto 24px',
          maxWidth: '34ch',
        }}
      >
        Verknüpfe dein Discogs-Konto, um Platten zu suchen und direkt anzukaufen.
      </p>

      {/* Primary action — anchor styled as accent button */}
      <a
        href="/api/discogs/connect"
        className="focus-ring-button"
        style={{
          display: 'inline-block',
          minHeight: 'var(--tap)',
          padding: '0 24px',
          lineHeight: 'var(--tap)',
          borderRadius: 'var(--r-pill)',
          background: 'var(--accent)',
          color: 'var(--on-accent)',
          fontFamily: 'var(--font-body)',
          fontWeight: 700,
          fontSize: '14px',
          textDecoration: 'none',
          border: 'none',
        }}
      >
        Mit Discogs verbinden
      </a>
    </div>
  );
}
