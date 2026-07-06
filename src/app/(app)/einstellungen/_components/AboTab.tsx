import type { Entitlements } from '@/lib/gating';
import type { SubscriptionInfo } from '@/lib/billing/store';
import { fromCents } from '@/lib/money';
import { startCheckoutAction, openPortalAction } from '../actions';

const dateDE = (d: Date | null): string =>
  d ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(d) : '—';

export function AboTab({
  ent,
  sub,
  plans,
  checkoutSuccess,
}: {
  ent: Entitlements;
  sub: SubscriptionInfo | null;
  plans: { slug: string; name: string; priceMonthlyCents: number }[];
  checkoutSuccess: boolean;
}) {
  const upgradeTargets = plans.filter((p) => p.slug !== ent.plan && p.slug !== 'free');
  return (
    <div data-testid="abo-tab" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {checkoutSuccess && sub === null ? (
        <p
          data-testid="checkout-pending"
          style={{
            margin: 0,
            padding: '10px 14px',
            borderRadius: 'var(--r-md)',
            background: 'var(--surface-2)',
            border: '1px solid var(--border-strong)',
          }}
        >
          Zahlung ausstehend — wird nach Bestätigung aktiv.
        </p>
      ) : null}

      <div>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--text-2)' }}>Aktueller Plan</p>
        <p data-testid="abo-current-plan" style={{ margin: '2px 0 0', fontSize: 20, fontWeight: 800, fontFamily: 'var(--font-display)' }}>
          {ent.planName} · {fromCents(ent.priceMonthlyCents)} € / Monat
        </p>
        {sub ? (
          <p data-testid="abo-subscription" style={{ margin: '6px 0 0', fontSize: 13.5, color: 'var(--text-3)' }}>
            Abo-Status: {sub.status}
            {sub.currentPeriodEnd ? ` · verlängert sich am ${dateDE(sub.currentPeriodEnd)}` : ''}
            {sub.cancelAtPeriodEnd ? ' · gekündigt zum Periodenende' : ''}
          </p>
        ) : (
          <p style={{ margin: '6px 0 0', fontSize: 13.5, color: 'var(--text-3)' }}>
            Kein aktives Abo.
          </p>
        )}
      </div>

      {upgradeTargets.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>Plan wechseln</h2>
          {upgradeTargets.map((p) => (
            <form key={p.slug} action={startCheckoutAction}>
              <input type="hidden" name="plan" value={p.slug} />
              <button
                type="submit"
                data-testid={`upgrade-${p.slug}`}
                className="focus-ring-button"
                style={{
                  minHeight: 'var(--tap)',
                  padding: '0 18px',
                  borderRadius: 'var(--r-pill)',
                  border: 'none',
                  background: 'var(--accent)',
                  color: 'var(--on-accent)',
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: 'pointer',
                }}
              >
                Upgrade auf {p.name} — {fromCents(p.priceMonthlyCents)} €/Monat
              </button>
            </form>
          ))}
        </div>
      ) : null}

      {sub ? (
        <form action={openPortalAction}>
          <button
            type="submit"
            data-testid="abo-portal"
            className="focus-ring-button"
            style={{
              minHeight: 'var(--tap)',
              padding: '0 18px',
              borderRadius: 'var(--r-pill)',
              border: '1px solid var(--border-strong)',
              background: 'var(--surface-2)',
              color: 'var(--text-2)',
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Abo verwalten
          </button>
        </form>
      ) : null}
    </div>
  );
}
