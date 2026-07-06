import { requireSession } from '@/auth/session';
import { getCurrentTenant } from '@/lib/tenant';
import { ChangePasswordForm } from './ChangePasswordForm';

/**
 * AUSSERHALB der (app)-Gruppe (Spec §11): das (app)-Layout redirectet mustChangePassword-User
 * hierher — läge die Seite in der Gruppe, wäre das eine Redirect-Schleife.
 * Erreichbar für JEDE Rolle (kunde unterliegt demselben Zwang), auch ohne gesetztes Flag
 * (freiwilliger Passwortwechsel).
 */
export default async function PasswortPage() {
  const user = await requireSession();
  const tenant = await getCurrentTenant();
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: 'var(--bg)',
        color: 'var(--text)',
        fontFamily: 'var(--font-body)',
        padding: 24,
      }}
    >
      <section
        style={{
          width: 'min(420px, 100%)',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-lg)',
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22, margin: 0 }}>
          Passwort ändern
        </h1>
        {user.mustChangePassword ? (
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-3)' }}>
            Dein Zugang wurde mit einem temporären Passwort angelegt — bitte vergib jetzt ein
            eigenes Passwort für {tenant.name}.
          </p>
        ) : null}
        <ChangePasswordForm />
      </section>
    </main>
  );
}
