import Link from 'next/link';
import type { SettingsTab } from '../page';

const TABS: { key: SettingsTab; label: string }[] = [
  { key: 'info', label: 'Info' },
  { key: 'discogs', label: 'Discogs' },
  { key: 'team', label: 'Team' },
  { key: 'abo', label: 'Abo' },
];

export function TabNav({ active }: { active: SettingsTab }) {
  return (
    <nav
      aria-label="Einstellungen-Tabs"
      data-testid="einstellungen-tabs"
      style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 18 }}
    >
      {TABS.map(({ key, label }) => {
        const isActive = key === active;
        return (
          <Link
            key={key}
            href={`/einstellungen?tab=${key}`}
            aria-current={isActive ? 'page' : undefined}
            style={{
              minHeight: 'var(--tap)',
              display: 'inline-flex',
              alignItems: 'center',
              padding: '0 16px',
              borderRadius: 'var(--r-pill)',
              textDecoration: 'none',
              fontWeight: isActive ? 700 : 600,
              fontSize: '14px',
              background: isActive ? 'var(--accent)' : 'var(--surface-2)',
              color: isActive ? 'var(--on-accent)' : 'var(--text-2)',
              border: isActive ? '1px solid transparent' : '1px solid var(--border)',
            }}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
