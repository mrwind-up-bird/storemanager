import { redirect } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { getCurrentTenant } from '@/lib/tenant';
import { getConnection } from '@/lib/discogs-connection';
import { listTeamUsers } from '@/lib/team';
import { ShopInfoForm } from '@/app/(app)/einstellungen/_components/ShopInfoForm';
import { DiscogsTab } from '@/app/(app)/einstellungen/_components/DiscogsTab';
import { TeamTab } from '@/app/(app)/einstellungen/_components/TeamTab';
import { WizardFrame } from './_components/WizardFrame';
import { completeOnboardingAction } from './actions';

/**
 * 4-Schritt-Wizard (Spec §11), AUSSERHALB der (app)-Gruppe (Redirect-Quelle ist das
 * (app)-Layout). Speichern pro Schritt — kein Big-Bang-Submit. Schritt 2 nutzt den
 * bestehenden Discogs-OAuth-Flow (?from=onboarding, Spec-Amendment).
 */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireSession();
  if (user.mustChangePassword) redirect('/passwort'); // Passwortzwang geht vor (Spec §11)
  if (!(user.role === 'admin' || user.isSuperadmin)) redirect('/'); // nur Admins
  const tenant = await getCurrentTenant();
  if (tenant.onboardingCompletedAt) redirect('/'); // nie zweimal

  const sp = await searchParams;
  const rawStep = Number(typeof sp.step === 'string' ? sp.step : '1');
  const step = (rawStep >= 1 && rawStep <= 4 ? rawStep : 1) as 1 | 2 | 3 | 4;

  if (step === 1) {
    return (
      <WizardFrame step={1} title="Shop-Infos" showNext={false}>
        <ShopInfoForm
          initialName={tenant.name}
          initialColor={tenant.branding.primaryColor}
          next="wizard"
          submitLabel="Weiter"
        />
      </WizardFrame>
    );
  }

  if (step === 2) {
    const conn = await getConnection({ tenantId: tenant.id, userId: user.id });
    return (
      <WizardFrame
        step={2}
        title="Discogs verbinden"
        hint="Verbinde deinen Discogs-Seller-Account, um Suche, Preisvorschläge und Listings zu nutzen. Du kannst das jederzeit unter Einstellungen → Discogs nachholen."
        showNext
        nextLabel="Später"
      >
        <DiscogsTab connectedUsername={conn?.discogsUsername ?? null} from="onboarding" />
      </WizardFrame>
    );
  }

  if (step === 3) {
    const users = await listTeamUsers({ tenantId: tenant.id, userId: user.id });
    return (
      <WizardFrame
        step={3}
        title="Team anlegen"
        hint="Lege Mitarbeiter- oder Kunden-Zugänge an — die Zugangsdaten gehen per Mail raus. Auch später unter Einstellungen → Team möglich."
        showNext
        nextLabel="Später"
      >
        <TeamTab users={users} />
      </WizardFrame>
    );
  }

  const conn = await getConnection({ tenantId: tenant.id, userId: user.id });
  const users = await listTeamUsers({ tenantId: tenant.id, userId: user.id });
  return (
    <WizardFrame step={4} title="Review" showNext={false}>
      <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 18px', fontSize: 14 }}>
        <dt style={{ color: 'var(--text-3)' }}>Shop-Name</dt>
        <dd style={{ margin: 0, fontWeight: 700 }}>{tenant.name}</dd>
        <dt style={{ color: 'var(--text-3)' }}>Primärfarbe</dt>
        <dd style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            aria-hidden="true"
            style={{
              width: 16,
              height: 16,
              borderRadius: 4,
              background: tenant.branding.primaryColor,
              border: '1px solid var(--border-strong)',
              display: 'inline-block',
            }}
          />
          <code>{tenant.branding.primaryColor}</code>
        </dd>
        <dt style={{ color: 'var(--text-3)' }}>Discogs</dt>
        <dd style={{ margin: 0 }}>{conn ? `verbunden als ${conn.discogsUsername}` : 'nicht verbunden'}</dd>
        <dt style={{ color: 'var(--text-3)' }}>Team</dt>
        <dd style={{ margin: 0 }}>{users.length} {users.length === 1 ? 'Zugang' : 'Zugänge'}</dd>
      </dl>
      <form action={completeOnboardingAction}>
        <button
          type="submit"
          data-testid="wizard-finish"
          className="focus-ring-button"
          style={{
            minHeight: 'var(--tap)',
            padding: '0 22px',
            borderRadius: 'var(--r-pill)',
            border: 'none',
            background: 'var(--accent)',
            color: 'var(--on-accent)',
            fontWeight: 700,
            fontSize: 15,
            cursor: 'pointer',
          }}
        >
          Los geht&apos;s
        </button>
      </form>
    </WizardFrame>
  );
}
