import Link from 'next/link';
import { BarChart3 } from 'lucide-react';

/** Upsell-Karte statt Charts (Spec §10): die Analytics-Queries laufen dann GAR NICHT. */
export function AnalytikUpsell({ planName, isAdmin }: { planName: string; isAdmin: boolean }) {
  return (
    <section
      data-testid="analytik-upsell"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        textAlign: 'center',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-lg)',
        padding: '48px 24px',
        maxWidth: 560,
        margin: '32px auto',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 56,
          height: 56,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          background: 'var(--surface-3)',
          border: '1px solid var(--border-strong)',
          color: 'var(--text-3)',
        }}
      >
        <BarChart3 size={26} />
      </span>
      <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22, margin: 0 }}>
        Analytik ist im {planName}-Plan nicht enthalten
      </h1>
      <p style={{ margin: 0, fontSize: 14, color: 'var(--text-2)' }}>
        Umsatz, Rohmarge, Kategorien und Top-Seller — verfügbar ab Small.
      </p>
      {isAdmin ? (
        <Link
          href="/einstellungen?tab=abo"
          data-testid="analytik-upsell-cta"
          style={{
            minHeight: 'var(--tap)',
            display: 'inline-flex',
            alignItems: 'center',
            padding: '0 20px',
            borderRadius: 'var(--r-pill)',
            background: 'var(--accent)',
            color: 'var(--on-accent)',
            fontWeight: 700,
            fontSize: 14,
            textDecoration: 'none',
          }}
        >
          Zum Abo-Tab
        </Link>
      ) : (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-3)' }}>
          Bitte wende dich an deinen Admin für ein Upgrade.
        </p>
      )}
    </section>
  );
}
