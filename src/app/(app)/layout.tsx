// src/app/(app)/layout.tsx
import { requireSession } from '@/auth/session';
import { getCurrentTenant } from '@/lib/tenant';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { AccentSwitch } from '@/components/theme/AccentSwitch';
import { VinylDisc } from '@/components/ui/VinylDisc';
import { SidebarNav } from './_components/SidebarNav';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Enforces session↔tenant invariant; redirects to /login if no session.
  const user = await requireSession();
  const tenant = await getCurrentTenant();

  const initial = (user.email[0] ?? '?').toUpperCase();

  return (
    <div
      style={{
        display: 'flex',
        minHeight: '100vh',
        background: 'var(--bg)',
        color: 'var(--text)',
        fontFamily: 'var(--font-body)',
      }}
    >
      {/* ── Sidebar ── */}
      <aside
        style={{
          position: 'sticky',
          top: 0,
          height: '100vh',
          flexShrink: 0,
          width: '248px',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--surface)',
          borderRight: '1px solid var(--border)',
          padding: '18px 14px',
          gap: '6px',
          zIndex: 30,
          overflowY: 'auto',
        }}
      >
        {/* Logo */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '11px',
            padding: '6px 8px 18px',
          }}
        >
          {/* VinylDisc from Task 3 — uses --disc-label token (pinned coral, not accent-tracked).
              The component is aria-hidden internally; do not pass aria-hidden (not in VinylDiscProps). */}
          <VinylDisc size={36} />
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
            <span
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 800,
                fontSize: '18px',
                letterSpacing: '-.02em',
              }}
            >
              q·records
            </span>
            <span
              style={{
                fontSize: '10.5px',
                color: 'var(--text-3)',
                fontWeight: 500,
                letterSpacing: '.05em',
              }}
            >
              STOREMANAGER · 2026
            </span>
          </div>
        </div>

        {/* Nav — client component (needs usePathname for active state) */}
        <SidebarNav />

        {/* User card */}
        <div
          style={{
            marginTop: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: '11px',
            padding: '12px 10px',
            borderRadius: 'var(--r-md)',
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
          }}
        >
          <div
            aria-hidden="true"
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '50%',
              flexShrink: 0,
              background: 'linear-gradient(135deg,var(--accent),var(--honey))',
              display: 'grid',
              placeItems: 'center',
              color: 'var(--on-accent)',
              fontWeight: 800,
              fontFamily: 'var(--font-display)',
              fontSize: '14px',
            }}
          >
            {initial}
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              lineHeight: 1.25,
              minWidth: 0,
            }}
          >
            <span
              style={{
                fontWeight: 700,
                fontSize: '13.5px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {user.email}
            </span>
            <span style={{ fontSize: '11px', color: 'var(--text-3)', textTransform: 'capitalize' }}>
              {user.role} · {tenant.name}
            </span>
          </div>
        </div>
      </aside>

      {/* ── Main content area ── */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {/* Sticky topbar */}
        <header
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 25,
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '14px clamp(18px,3vw,32px)',
            background: 'color-mix(in srgb,var(--surface) 88%,transparent)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <span style={{ marginRight: 'auto' }} />
          <AccentSwitch />
          <ThemeToggle />
        </header>

        <main style={{ flex: 1, padding: 'clamp(18px,3vw,32px)' }}>
          {children}
        </main>
      </div>
    </div>
  );
}
