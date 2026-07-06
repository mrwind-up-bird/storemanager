// src/app/(app)/_components/SidebarNav.tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Heart,
  Library,
  Store,
  BarChart3,
  Settings,
  Lock,
  type LucideIcon,
} from 'lucide-react';
import type { Role } from '@/db/schema';

type NavItem = {
  href: string;
  label: string;
  Icon: LucideIcon;
  /** Visible only to staff (role ∈ {mitarbeiter, admin, superadmin}); hidden from `kunde`. */
  staffOnly?: boolean;
  /** Visible only to admin/superadmin (Spec §12: Einstellungen ist admin-only). */
  adminOnly?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { href: '/',             label: 'Übersicht',    Icon: LayoutDashboard                    },
  { href: '/inventar',     label: 'Lagerbestand', Icon: Package                            },
  { href: '/kasse',        label: 'Kasse',        Icon: ShoppingCart, staffOnly: true      },
  { href: '/wunschlisten', label: 'Wunschlisten', Icon: Heart,        staffOnly: true      },
  { href: '/ankauf/sammlungen', label: 'Sammlungen', Icon: Library,   staffOnly: true      },
  { href: '/schaufenster', label: 'Schaufenster', Icon: Store                              },
  { href: '/analytik',     label: 'Analytik',     Icon: BarChart3                          },
  { href: '/einstellungen', label: 'Einstellungen', Icon: Settings, adminOnly: true },
];

export function SidebarNav({
  role,
  isSuperadmin,
  lockedHrefs = [],
}: {
  role: Role;
  isSuperadmin: boolean;
  lockedHrefs?: string[];
}) {
  const pathname = usePathname();
  const isStaff = role !== 'kunde';
  const isAdmin = role === 'admin' || isSuperadmin;
  const items = NAV_ITEMS.filter(
    (item) => (!item.staffOnly || isStaff) && (!item.adminOnly || isAdmin),
  );

  return (
    <nav aria-label="Hauptnavigation" style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
      {items.map(({ href, label, Icon }) => {
        // Exact match for dashboard, prefix match for others
        const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href);
        const isLocked = lockedHrefs.includes(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={isActive ? 'page' : undefined}
            aria-label={isLocked ? `${label} (gesperrt im aktuellen Plan)` : undefined}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              minHeight: 'var(--tap)',
              padding: '0 14px',
              borderRadius: 'var(--r-md)',
              background: isActive ? 'var(--accent-soft)' : 'transparent',
              color: isActive ? 'var(--accent-ink)' : 'var(--text-2)',
              fontWeight: isActive ? 700 : 600,
              fontSize: '14.5px',
              textDecoration: 'none',
              borderLeft: isActive ? '3px solid var(--accent)' : '3px solid transparent',
              transition: 'background var(--dur-1) var(--ease), color var(--dur-1) var(--ease)',
            }}
          >
            <Icon size={18} aria-hidden="true" />
            {label}
            {isLocked ? (
              <Lock
                size={13}
                aria-hidden="true"
                data-testid={`nav-lock-${href.replace('/', '')}`}
                style={{ marginLeft: 'auto', color: 'var(--text-3)' }}
              />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
