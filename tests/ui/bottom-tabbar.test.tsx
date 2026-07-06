import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { BottomTabBar } from '@/app/(app)/_components/BottomTabBar';

let currentPath = '/';
vi.mock('next/navigation', () => ({ usePathname: () => currentPath }));

afterEach(() => { cleanup(); currentPath = '/'; });

describe('BottomTabBar (C2)', () => {
  it('admin sieht 5 Tabs in Handoff-Reihenfolge', () => {
    render(<BottomTabBar role="admin" />);
    expect(screen.getAllByRole('link').map((l) => l.textContent)).toEqual([
      'Start', 'Suche', 'Bestand', 'Wunsch', 'Analytik',
    ]);
  });

  it('kunde sieht Suche + Wunsch nicht (staffOnly wie SidebarNav)', () => {
    render(<BottomTabBar role="kunde" />);
    expect(screen.getAllByRole('link').map((l) => l.textContent)).toEqual([
      'Start', 'Bestand', 'Analytik',
    ]);
  });

  it('aria-current="page" sitzt auf dem aktiven Tab (Prefix-Match)', () => {
    currentPath = '/inventar';
    render(<BottomTabBar role="admin" />);
    expect(screen.getByRole('link', { name: /bestand/i })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /start/i })).not.toHaveAttribute('aria-current');
  });

  it('Start matcht nur exakt / (nicht z. B. /inventar)', () => {
    currentPath = '/';
    render(<BottomTabBar role="admin" />);
    expect(screen.getByRole('link', { name: /start/i })).toHaveAttribute('aria-current', 'page');
  });

  it('lockedHrefs zeigt Lock-Icon + "(gesperrt im aktuellen Plan)" aria-label nur auf dem betroffenen Tab', () => {
    render(<BottomTabBar role="admin" lockedHrefs={['/analytik']} />);

    const locked = screen.getByRole('link', { name: 'Analytik (gesperrt im aktuellen Plan)' });
    expect(locked).toBeInTheDocument();

    // Andere Tabs bleiben ungesperrt (kein aria-label-Override).
    expect(screen.getByRole('link', { name: 'Start' })).not.toHaveAttribute('aria-label');
  });
});
