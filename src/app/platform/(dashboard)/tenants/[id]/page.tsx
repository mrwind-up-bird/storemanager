import { notFound } from 'next/navigation';
import { getTenantDetail } from '@/lib/platform/tenants';
import { env, tenantUrl } from '@/env';
import { PlanOverrideForm } from './_components/PlanOverrideForm';
import { ResendCredentialsButton } from './_components/ResendCredentialsButton';

const dateDE = (d: Date | null): string =>
  d ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(d) : '—';

export default async function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenantId = Number(id);
  if (!Number.isInteger(tenantId) || tenantId <= 0) notFound();
  const detail = await getTenantDetail(tenantId);
  if (!detail) notFound();

  const cardStyle: React.CSSProperties = {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--r-lg)',
    padding: 20,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  };

  return (
    <section data-testid="platform-tenant-detail" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 24, margin: 0 }}>
        {detail.name}
      </h1>

      <div style={cardStyle}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Stammdaten</h2>
        <p style={{ margin: 0 }}>
          URL: <a href={tenantUrl(detail.slug)}>{detail.slug}.{env.ROOT_DOMAIN}</a>
        </p>
        <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          Primärfarbe:
          <span
            aria-hidden="true"
            style={{
              width: 16,
              height: 16,
              borderRadius: 4,
              background: detail.primaryColor,
              border: '1px solid var(--border-strong)',
              display: 'inline-block',
            }}
          />
          <code>{detail.primaryColor}</code>
        </p>
        <p style={{ margin: 0 }}>Angelegt am: {dateDE(detail.createdAt)}</p>
        <p style={{ margin: 0 }}>
          Onboarding: {detail.onboardingCompletedAt ? `abgeschlossen (${dateDE(detail.onboardingCompletedAt)})` : 'offen'}
        </p>
      </div>

      <div style={cardStyle}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Plan &amp; Abo</h2>
        <p style={{ margin: 0 }}>
          Aktueller Plan: <strong data-testid="tenant-plan" style={{ textTransform: 'capitalize' }}>{detail.plan}</strong>
        </p>
        {detail.subscription ? (
          <p style={{ margin: 0 }} data-testid="tenant-subscription">
            Abo: {detail.subscription.planSlug} · Status {detail.subscription.status}
            {detail.subscription.currentPeriodEnd ? ` · läuft bis ${dateDE(detail.subscription.currentPeriodEnd)}` : ''}
            {detail.subscription.cancelAtPeriodEnd ? ' · gekündigt zum Periodenende' : ''}
          </p>
        ) : (
          <p style={{ margin: 0, color: 'var(--text-3)' }} data-testid="tenant-subscription">
            Kein aktives Abo (Free oder manueller Override).
          </p>
        )}
        <PlanOverrideForm tenantId={detail.id} currentPlan={detail.plan} />
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-3)' }}>
          Der manuelle Override schreibt nur tenants.plan (Sonderkonditionen, Webhook-Fallback) —
          er ändert keine Stripe-Objekte.
        </p>
      </div>

      <div style={cardStyle}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Zugang</h2>
        {detail.adminEmail ? (
          <ResendCredentialsButton tenantId={detail.id} adminEmail={detail.adminEmail} />
        ) : (
          <p style={{ margin: 0, color: 'var(--text-3)' }}>Kein Admin-User gefunden.</p>
        )}
      </div>
    </section>
  );
}
