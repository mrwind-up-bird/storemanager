// Stepper nach Design-Handoff (Design System 2026.dc.html): 30px-Kreise, done/current in
// var(--accent)/var(--on-accent), future var(--surface-3)+var(--border-strong), 2px-Connectoren.
const STEPS = ['Info', 'Discogs', 'Admin', 'Review'] as const;

export function WizardStepper({ current }: { current: 1 | 2 | 3 | 4 }) {
  return (
    <ol
      data-testid="wizard-stepper"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        listStyle: 'none',
        margin: 0,
        padding: 0,
      }}
    >
      {STEPS.map((label, i) => {
        const step = i + 1;
        const state = step < current ? 'done' : step === current ? 'current' : 'future';
        const filled = state !== 'future';
        return (
          <li
            key={label}
            data-testid="wizard-step"
            data-state={state}
            aria-current={state === 'current' ? 'step' : undefined}
            style={{ display: 'flex', alignItems: 'center', flex: i === 0 ? '0 0 auto' : '1 1 0' }}
          >
            {i > 0 ? (
              <span
                aria-hidden="true"
                style={{
                  flex: 1,
                  height: 2,
                  background: filled ? 'var(--accent)' : 'var(--border-strong)',
                  margin: '0 8px',
                }}
              />
            ) : null}
            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <span
                aria-hidden="true"
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: '50%',
                  display: 'grid',
                  placeItems: 'center',
                  fontWeight: 700,
                  fontSize: 13,
                  background: filled ? 'var(--accent)' : 'var(--surface-3)',
                  color: filled ? 'var(--on-accent)' : 'var(--text-3)',
                  border: filled ? '1px solid transparent' : '1px solid var(--border-strong)',
                }}
              >
                {state === 'done' ? '✓' : step}
              </span>
              <span
                style={{
                  fontSize: 11.5,
                  fontWeight: state === 'current' ? 700 : 600,
                  color: state === 'current' ? 'var(--text)' : 'var(--text-3)',
                }}
              >
                {label}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
