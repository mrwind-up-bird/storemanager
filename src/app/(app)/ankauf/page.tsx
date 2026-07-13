// src/app/(app)/ankauf/page.tsx
// RSC: auth gate → tenant → discogs connection check → render ConnectPrompt or the 1A AnkaufFlow.
// Banner support: ?connected=1 (success) / ?error=connect (OAuth failure).

import { requireSession } from '@/auth/session';
import { getCurrentTenant } from '@/lib/tenant';
import { getConnection } from '@/lib/discogs-connection';
import { ConnectPrompt } from './_components/ConnectPrompt';
import { AnkaufFlow } from './_components/AnkaufFlow';

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
        maxWidth: 1220,
      }}
    >
      {/* Banner: OAuth callback success */}
      {showConnectedBanner && (
        <div
          role="alert"
          style={{
            padding: '12px 16px',
            borderRadius: 'var(--r-md)',
            background: 'var(--ok-soft)',
            color: 'var(--ok)',
            border: '1px solid color-mix(in srgb, var(--ok) 30%, transparent)',
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
            background: 'var(--bad-soft)',
            color: 'var(--bad)',
            border: '1px solid color-mix(in srgb, var(--bad) 30%, transparent)',
            fontFamily: 'var(--font-body)',
            fontSize: '14px',
            fontWeight: 600,
          }}
        >
          ✗ Verbindung zu Discogs fehlgeschlagen. Bitte erneut versuchen.
        </div>
      )}

      {/* Main content: connect prompt or the 1A Ankauf flow */}
      {!conn ? <ConnectPrompt /> : <AnkaufFlow />}
    </div>
  );
}
