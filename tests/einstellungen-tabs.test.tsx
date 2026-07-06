// Slice 6 T7 — TabNav (aktiver Tab, 4 Links, Deep-Link-Hrefs) + SidebarNav/MobileHeader-Gates.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TabNav } from '@/app/(app)/einstellungen/_components/TabNav';
import { SidebarNav } from '@/app/(app)/_components/SidebarNav';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

describe('TabNav', () => {
  it('rendert 4 Tabs mit ?tab=-Hrefs, aktiver Tab trägt aria-current', () => {
    render(<TabNav active="abo" />);
    const nav = screen.getByTestId('einstellungen-tabs');
    const links = nav.querySelectorAll('a');
    expect(links).toHaveLength(4);
    expect(links[0]!.getAttribute('href')).toBe('/einstellungen?tab=info');
    expect(links[3]!.getAttribute('href')).toBe('/einstellungen?tab=abo');
    expect(links[3]!.getAttribute('aria-current')).toBe('page');
    expect(links[0]!.getAttribute('aria-current')).toBeNull();
  });
});

describe('SidebarNav Einstellungen-Gate', () => {
  it('admin sieht Einstellungen, mitarbeiter und kunde nicht', () => {
    const { unmount } = render(<SidebarNav role="admin" isSuperadmin={false} />);
    expect(screen.getByText('Einstellungen')).toBeInTheDocument();
    unmount();
    const second = render(<SidebarNav role="mitarbeiter" isSuperadmin={false} />);
    expect(screen.queryByText('Einstellungen')).not.toBeInTheDocument();
    second.unmount();
    render(<SidebarNav role="kunde" isSuperadmin={false} />);
    expect(screen.queryByText('Einstellungen')).not.toBeInTheDocument();
  });

  it('isSuperadmin sieht Einstellungen auch ohne role=admin (canonical admin gate)', () => {
    render(<SidebarNav role="mitarbeiter" isSuperadmin />);
    expect(screen.getByText('Einstellungen')).toBeInTheDocument();
  });
});
