'use client';

// Mobile bottom-tab navigation (C2) — sichtbar nur <768px via .app-tabbar (C1).
// Tab-Set, Active-Match und staffOnly-Filter spiegeln SidebarNav.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Search,
  Package,
  Heart,
  BarChart3,
  Lock,
  type LucideIcon,
} from 'lucide-react';
import type { Role } from '@/db/schema';

type Tab = { href: string; label: string; Icon: LucideIcon; staffOnly?: boolean };

const TABS: Tab[] = [
  { href: '/',             label: 'Start',    Icon: LayoutDashboard },
  { href: '/ankauf',       label: 'Suche',    Icon: Search,    staffOnly: true },
  { href: '/inventar',     label: 'Bestand',  Icon: Package },
  { href: '/wunschlisten', label: 'Wunsch',   Icon: Heart,     staffOnly: true },
  { href: '/analytik',     label: 'Analytik', Icon: BarChart3 },
];

export function BottomTabBar({ role, lockedHrefs = [] }: { role: Role; lockedHrefs?: string[] }) {
  const pathname = usePathname();
  const isStaff = role !== 'kunde';
  const tabs = TABS.filter((t) => !t.staffOnly || isStaff);

  return (
    <nav
      aria-label="Mobile Navigation"
      className="app-tabbar"
      data-testid="bottom-tabbar"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 35,
        display: 'flex',
        padding: '8px 8px calc(8px + env(safe-area-inset-bottom))',
        background: 'color-mix(in srgb, var(--surface) 82%, transparent)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderTop: '1px solid var(--border)',
      }}
    >
      {tabs.map(({ href, label, Icon }) => {
        const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href);
        const isLocked = lockedHrefs.includes(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={isActive ? 'page' : undefined}
            aria-label={isLocked ? `${label} (gesperrt im aktuellen Plan)` : undefined}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 3,
              padding: '6px 0',
              textDecoration: 'none',
              color: isActive ? 'var(--accent-ink)' : 'var(--text-3)',
              fontWeight: isActive ? 700 : 600,
              fontSize: '10.5px',
            }}
          >
            <span style={{ position: 'relative', display: 'inline-flex' }}>
              <Icon size={20} aria-hidden="true" />
              {isLocked ? (
                <Lock
                  size={10}
                  aria-hidden="true"
                  style={{ position: 'absolute', right: -6, top: -3, color: 'var(--text-3)' }}
                />
              ) : null}
            </span>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
