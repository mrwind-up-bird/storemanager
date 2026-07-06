import { forbidden } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { getCurrentTenant } from '@/lib/tenant';
import { getConnection } from '@/lib/discogs-connection';
import { listTeamUsers } from '@/lib/team';
import { getEntitlements } from '@/lib/gating';
import { getSubscriptionForTenant, listPlans } from '@/lib/billing/store';
import { TabNav } from './_components/TabNav';
import { ShopInfoForm } from './_components/ShopInfoForm';
import { DiscogsTab } from './_components/DiscogsTab';
import { TeamTab } from './_components/TeamTab';
import { AboTab } from './_components/AboTab';

export type SettingsTab = 'info' | 'discogs' | 'team' | 'abo';
const SETTINGS_TABS: readonly SettingsTab[] = ['info', 'discogs', 'team', 'abo'];

export default async function EinstellungenPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireSession();
  // Admin-only (Spec §12): mitarbeiter/kunde → 403.
  if (!(user.role === 'admin' || user.isSuperadmin)) forbidden();
  const tenant = await getCurrentTenant();

  const sp = await searchParams;
  const raw = typeof sp.tab === 'string' ? sp.tab : 'info';
  const tab: SettingsTab = (SETTINGS_TABS as readonly string[]).includes(raw)
    ? (raw as SettingsTab)
    : 'info';

  return (
    <section data-testid="einstellungen-screen" style={{ maxWidth: 760 }}>
      <header className="qr-page-header" style={{ marginBottom: 14 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 24, margin: 0 }}>
          Einstellungen
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 13.5, color: 'var(--text-3)' }}>{tenant.name}</p>
      </header>
      <TabNav active={tab} />
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-lg)',
          padding: 20,
        }}
      >
        {tab === 'info' ? (
          <ShopInfoForm initialName={tenant.name} initialColor={tenant.branding.primaryColor} />
        ) : null}
        {tab === 'discogs' ? (
          <DiscogsTab
            connectedUsername={
              (await getConnection({ tenantId: tenant.id, userId: user.id }))?.discogsUsername ?? null
            }
            from="einstellungen"
          />
        ) : null}
        {tab === 'team' ? (
          <TeamTab users={await listTeamUsers({ tenantId: tenant.id, userId: user.id })} />
        ) : null}
        {tab === 'abo' ? (
          <AboTab
            ent={await getEntitlements(tenant.id)}
            sub={await getSubscriptionForTenant({ tenantId: tenant.id, userId: user.id })}
            plans={await listPlans()}
            checkoutSuccess={sp.checkout === 'success'}
          />
        ) : null}
      </div>
    </section>
  );
}
