import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MobileHeader } from '@/app/(app)/_components/MobileHeader';

let currentPath = '/';
vi.mock('next/navigation', () => ({ usePathname: () => currentPath }));
vi.mock('@/components/theme/ThemeToggle', () => ({
  ThemeToggle: () => <button type="button" aria-label="Theme" />,
}));

afterEach(() => { cleanup(); currentPath = '/'; });

describe('MobileHeader (C3)', () => {
  it('Titel-Map: /ankauf → Discogs-Suche + fester Untertitel', () => {
    currentPath = '/ankauf';
    render(<MobileHeader role="admin" isSuperadmin={false} tenantName="Demo Records" />);
    expect(screen.getByText('Discogs-Suche')).toBeInTheDocument();
    expect(screen.getByText('Releases finden & ankaufen')).toBeInTheDocument();
  });

  it('Titel-Map: /analytik → Untertitel enthält Tenant-Namen', () => {
    currentPath = '/analytik';
    render(<MobileHeader role="admin" isSuperadmin={false} tenantName="Demo Records" />);
    expect(screen.getByText('Analytik')).toBeInTheDocument();
    expect(screen.getByText('Auswertungen · Demo Records')).toBeInTheDocument();
  });

  it('ohne onSchnellverkauf KEIN FAB (kein toter Button vor Task 7)', () => {
    render(<MobileHeader role="admin" isSuperadmin={false} tenantName="Demo" />);
    expect(screen.queryByRole('button', { name: 'Schnellverkauf' })).toBeNull();
  });

  it('mit onSchnellverkauf: FAB für admin, NICHT für kunde', () => {
    const fn = vi.fn();
    render(<MobileHeader role="admin" isSuperadmin={false} tenantName="Demo" onSchnellverkauf={fn} />);
    screen.getByRole('button', { name: 'Schnellverkauf' }).click();
    expect(fn).toHaveBeenCalledOnce();
    cleanup();
    render(<MobileHeader role="kunde" isSuperadmin={false} tenantName="Demo" onSchnellverkauf={fn} />);
    expect(screen.queryByRole('button', { name: 'Schnellverkauf' })).toBeNull();
  });

  it('Gear-Icon: verborgen für Staff ohne isSuperadmin, sichtbar bei isSuperadmin=true (canonical admin gate)', () => {
    render(<MobileHeader role="mitarbeiter" isSuperadmin={false} tenantName="Demo" />);
    expect(screen.queryByTestId('mobile-settings-link')).toBeNull();
    cleanup();
    render(<MobileHeader role="mitarbeiter" isSuperadmin tenantName="Demo" />);
    expect(screen.getByTestId('mobile-settings-link')).toBeInTheDocument();
  });
});
