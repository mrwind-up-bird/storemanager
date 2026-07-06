import Link from 'next/link';
import { WizardStepper } from './WizardStepper';
import { completeOnboardingAction } from '../actions';

const pillLink: React.CSSProperties = {
  minHeight: 'var(--tap)',
  display: 'inline-flex',
  alignItems: 'center',
  padding: '0 18px',
  borderRadius: 'var(--r-pill)',
  textDecoration: 'none',
  fontWeight: 600,
  fontSize: 14,
  border: '1px solid var(--border-strong)',
  background: 'var(--surface-2)',
  color: 'var(--text-2)',
};

export function WizardFrame({
  step,
  title,
  hint,
  children,
  showNext,
  nextLabel = 'Weiter',
}: {
  step: 1 | 2 | 3 | 4;
  title: string;
  hint?: string;
  children: React.ReactNode;
  /** Schritte 2/3 haben einen „Später"-Link als Weiter; Schritt 1 submitted sein Formular selbst. */
  showNext: boolean;
  nextLabel?: string;
}) {
  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'var(--bg)',
        color: 'var(--text)',
        fontFamily: 'var(--font-body)',
        padding: 24,
        display: 'grid',
        placeItems: 'start center',
      }}
    >
      <section
        data-testid="onboarding-wizard"
        style={{
          width: 'min(640px, 100%)',
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
          marginTop: 32,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 24, margin: 0 }}>
            Onboarding
          </h1>
          <form action={completeOnboardingAction} style={{ marginLeft: 'auto' }}>
            <button
              type="submit"
              data-testid="wizard-skip"
              className="focus-ring-button"
              style={{
                border: 'none',
                background: 'none',
                color: 'var(--text-3)',
                fontSize: 13.5,
                fontWeight: 600,
                cursor: 'pointer',
                minHeight: 'var(--tap)',
              }}
            >
              Überspringen
            </button>
          </form>
        </div>
        <WizardStepper current={step} />
        <div
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-lg)',
            padding: 22,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 17 }}>
            Schritt {step} · {title}
          </h2>
          {hint ? <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-3)' }}>{hint}</p> : null}
          {children}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {step > 1 ? (
            <Link href={`/onboarding?step=${step - 1}`} data-testid="wizard-back" style={pillLink}>
              Zurück
            </Link>
          ) : null}
          {showNext ? (
            <Link
              href={`/onboarding?step=${step + 1}`}
              data-testid="wizard-next"
              style={{ ...pillLink, marginLeft: 'auto', background: 'var(--accent)', color: 'var(--on-accent)', border: '1px solid transparent', fontWeight: 700 }}
            >
              {nextLabel}
            </Link>
          ) : null}
        </div>
      </section>
    </main>
  );
}
