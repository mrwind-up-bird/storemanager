// src/app/(app)/ankauf/page.tsx
// RSC: auth gate → tenant → discogs connection check → render ConnectPrompt or SearchForm.
// Banner support: ?connected=1 (success) / ?error=connect (OAuth failure).

import { requireSession } from '@/auth/session';
import { getCurrentTenant } from '@/lib/tenant';
import { getConnection } from '@/lib/discogs-connection';
import { ConnectPrompt } from './_components/ConnectPrompt';
import { SearchForm } from './_components/SearchForm';

export default async function AnkaufPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Auth gate: any role may access /ankauf (no role restriction per C11)
  const user = await requireSession();
  // getCurrentTenant: React cache — deduped within this request
  const tenant = await getCurrentTenant();

  const ctx = { tenantId: tenant.id, userId: user.id };
  const conn = await getConnection(ctx);

  const sp = await searchParams;
  const showConnectedBanner = sp['connected'] === '1';
  const showErrorBanner = sp['error'] === 'connect';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        maxWidth: 1200,
      }}
    >
      {/* Banner: OAuth callback success */}
      {showConnectedBanner && (
        <div
          role="alert"
          style={{
            padding: '12px 16px',
            borderRadius: 'var(--r-md)',
            background: 'var(--success-surface, #f0fff4)',
            color: 'var(--success, #276749)',
            border: '1px solid var(--success-border, #c6f6d5)',
            fontFamily: 'var(--font-body)',
            fontSize: '14px',
            fontWeight: 600,
          }}
        >
          ✓ Discogs erfolgreich verbunden.
        </div>
      )}

      {/* Banner: OAuth callback failure */}
      {showErrorBanner && (
        <div
          role="alert"
          style={{
            padding: '12px 16px',
            borderRadius: 'var(--r-md)',
            background: 'var(--error-surface, #fff1f0)',
            color: 'var(--error, #c0392b)',
            border: '1px solid var(--error-border, #ffd7d5)',
            fontFamily: 'var(--font-body)',
            fontSize: '14px',
            fontWeight: 600,
          }}
        >
          ✗ Verbindung zu Discogs fehlgeschlagen. Bitte erneut versuchen.
        </div>
      )}

      {/* Main content: connect prompt or search form */}
      {!conn ? (
        <ConnectPrompt />
      ) : (
        <SearchForm connected username={conn.discogsUsername} />
      )}
    </div>
  );
}
