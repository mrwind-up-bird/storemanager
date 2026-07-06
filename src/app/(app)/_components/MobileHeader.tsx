'use client';

// Mobiler Sticky-Header (C3): Route-Titel-Map + ThemeToggle + optionaler €-FAB.
// Der FAB erscheint erst, wenn MobileChrome onSchnellverkauf übergibt (Task 7).

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Settings } from 'lucide-react';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import type { Role } from '@/db/schema';

type TitleEntry = {
  match: (pathname: string) => boolean;
  title: string;
  subtitle: (tenantName: string) => string;
};

const dateDE = () =>
  new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }).format(
    new Date(),
  );

const TITLES: TitleEntry[] = [
  { match: (p) => p === '/', title: 'Moin!', subtitle: (t) => `${dateDE()} · ${t}` },
  { match: (p) => p.startsWith('/ankauf'), title: 'Discogs-Suche', subtitle: () => 'Releases finden & ankaufen' },
  { match: (p) => p.startsWith('/inventar'), title: 'Lagerbestand', subtitle: () => 'Artikel & Status' },
  { match: (p) => p.startsWith('/wunschlisten'), title: 'Wunschlisten', subtitle: () => 'Kundenwünsche & Treffer' },
  { match: (p) => p.startsWith('/analytik'), title: 'Analytik', subtitle: (t) => `Auswertungen · ${t}` },
  { match: (p) => p.startsWith('/einstellungen'), title: 'Einstellungen', subtitle: (t) => t },
];

export interface MobileHeaderProps {
  role: Role;
  tenantName: string;
  /** FAB rendert nur, wenn gesetzt UND role !== 'kunde' (C3; Task 7 verdrahtet ihn). */
  onSchnellverkauf?: () => void;
}

export function MobileHeader({ role, tenantName, onSchnellverkauf }: MobileHeaderProps) {
  const pathname = usePathname();
  const entry = TITLES.find((t) => t.match(pathname));
  const title = entry?.title ?? 'q·records';
  const subtitle = entry ? entry.subtitle(tenantName) : tenantName;
  const showFab = onSchnellverkauf !== undefined && role !== 'kunde';

  return (
    <header
      className="app-header-mobile"
      data-testid="mobile-header"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 30,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '12px 16px',
        background: 'color-mix(in srgb, var(--surface) 88%, transparent)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0, lineHeight: 1.15 }}>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            fontSize: 22,
            letterSpacing: '-.02em',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {title}
        </div>
        {/* suppressHydrationWarning: dateDE() kann über Mitternacht SSR/CSR divergieren */}
        <div
          suppressHydrationWarning
          style={{ fontSize: '11.5px', color: 'var(--text-3)', fontWeight: 500 }}
        >
          {subtitle}
        </div>
      </div>
      <ThemeToggle />
      {(role === 'admin' || role === 'superadmin') && (
        <Link
          href="/einstellungen"
          aria-label="Einstellungen"
          data-testid="mobile-settings-link"
          style={{
            width: 38,
            height: 38,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            color: 'var(--text-2)',
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            flexShrink: 0,
          }}
        >
          <Settings size={18} aria-hidden="true" />
        </Link>
      )}
      {showFab && (
        <button
          type="button"
          aria-label="Schnellverkauf"
          data-testid="fab-schnellverkauf"
          onClick={onSchnellverkauf}
          className="focus-ring-button"
          style={{
            width: 38,
            height: 38,
            borderRadius: '50%',
            border: 'none',
            background: 'var(--accent)',
            color: 'var(--on-accent)',
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: 19,
            cursor: 'pointer',
            display: 'grid',
            placeItems: 'center',
            flexShrink: 0,
          }}
        >
          €
        </button>
      )}
    </header>
  );
}
