import Link from 'next/link';
import { requirePlatformSession } from '@/auth/platform';
import { platformLogoutAction } from './actions';

/** Minimale Desktop-Chrome der Platform-Zone (Spec §4) — kein (app)-Layout, kein Bottom-Tab/PWA. */
export default async function PlatformDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requirePlatformSession();
  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg)',
        color: 'var(--text)',
        fontFamily: 'var(--font-body)',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '14px 24px',
          background: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <Link
          href="/"
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            fontSize: 17,
            letterSpacing: '-.02em',
            color: 'var(--text)',
            textDecoration: 'none',
          }}
        >
          q·records · Platform
        </Link>
        <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--text-3)' }}>{user.email}</span>
        <form action={platformLogoutAction}>
          <button
            type="submit"
            className="focus-ring-button"
            style={{
              minHeight: 'var(--tap)',
              padding: '0 14px',
              borderRadius: 'var(--r-pill)',
              border: '1px solid var(--border-strong)',
              background: 'var(--surface-2)',
              color: 'var(--text-2)',
              fontWeight: 600,
              fontSize: 13.5,
              cursor: 'pointer',
            }}
          >
            Abmelden
          </button>
        </form>
      </header>
      <main style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>{children}</main>
    </div>
  );
}
