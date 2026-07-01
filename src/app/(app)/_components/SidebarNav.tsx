// src/app/(app)/_components/SidebarNav.tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  Heart,
  Store,
  BarChart3,
  type LucideIcon,
} from 'lucide-react';
import type { Role } from '@/db/schema';

type NavItem = {
  href: string;
  label: string;
  Icon: LucideIcon;
  /** Visible only to staff (role ∈ {mitarbeiter, admin, superadmin}); hidden from `kunde`. */
  staffOnly?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { href: '/',             label: 'Übersicht',    Icon: LayoutDashboard                    },
  { href: '/inventar',     label: 'Lagerbestand', Icon: Package                            },
  { href: '/kasse',        label: 'Kasse',        Icon: ShoppingCart, staffOnly: true      },
  { href: '/wunschlisten', label: 'Wunschlisten', Icon: Heart,        staffOnly: true      },
  { href: '/schaufenster', label: 'Schaufenster', Icon: Store                              },
  { href: '/analytik',     label: 'Analytik',     Icon: BarChart3                          },
];

export function SidebarNav({ role }: { role: Role }) {
  const pathname = usePathname();
  const isStaff = role !== 'kunde';
  const items = NAV_ITEMS.filter((item) => !item.staffOnly || isStaff);

  return (
    <nav aria-label="Hauptnavigation" style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
      {items.map(({ href, label, Icon }) => {
        // Exact match for dashboard, prefix match for others
        const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={isActive ? 'page' : undefined}
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
          </Link>
        );
      })}
    </nav>
  );
}
