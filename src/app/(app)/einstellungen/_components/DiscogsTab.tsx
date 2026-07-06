import { TestConnectionButton } from './TestConnectionButton';

/**
 * Verbindungsstatus + OAuth-Connect (Spec-§12-Amendment: Verbinden über den bestehenden
 * OAuth-Flow mit ?from=einstellungen — vorhandene Secrets werden NIE angezeigt).
 * Trennen bleibt beim bestehenden disconnectDiscogs auf /ankauf — hier nur Status/Test/Connect.
 */
export function DiscogsTab({
  connectedUsername,
  from,
}: {
  connectedUsername: string | null;
  from: 'einstellungen' | 'onboarding';
}) {
  return (
    <div data-testid="discogs-tab" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {connectedUsername ? (
        <>
          <p style={{ margin: 0 }}>
            Status: <strong data-testid="discogs-status">verbunden als {connectedUsername}</strong>
          </p>
          <TestConnectionButton />
          <a
            href={`/api/discogs/connect?from=${from}`}
            style={{ fontSize: 13.5, color: 'var(--accent-ink)' }}
          >
            Neu verbinden (überschreibt die bestehende Verbindung)
          </a>
        </>
      ) : (
        <>
          <p style={{ margin: 0 }} data-testid="discogs-status">
            Status: nicht verbunden
          </p>
          <a
            href={`/api/discogs/connect?from=${from}`}
            data-testid="discogs-connect-link"
            style={{
              minHeight: 'var(--tap)',
              display: 'inline-flex',
              alignItems: 'center',
              alignSelf: 'flex-start',
              padding: '0 16px',
              borderRadius: 'var(--r-pill)',
              background: 'var(--accent)',
              color: 'var(--on-accent)',
              fontWeight: 700,
              fontSize: 14,
              textDecoration: 'none',
            }}
          >
            Mit Discogs verbinden
          </a>
        </>
      )}
    </div>
  );
}
