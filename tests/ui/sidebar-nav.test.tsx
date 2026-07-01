// tests/ui/sidebar-nav.test.tsx
// @vitest-environment jsdom

/// <reference types="@testing-library/jest-dom/vitest" />

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// SidebarNav is a client component that reads the active route via usePathname.
vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

import { SidebarNav } from '@/app/(app)/_components/SidebarNav';

afterEach(cleanup);

describe('SidebarNav role gating', () => {
  it('shows Kasse and Wunschlisten for staff (mitarbeiter)', () => {
    render(<SidebarNav role="mitarbeiter" />);
    expect(screen.getByRole('link', { name: 'Kasse' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Wunschlisten' })).toBeInTheDocument();
  });

  it('shows Kasse and Wunschlisten for admin', () => {
    render(<SidebarNav role="admin" />);
    expect(screen.getByRole('link', { name: 'Kasse' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Wunschlisten' })).toBeInTheDocument();
  });

  it('hides Kasse and Wunschlisten for a kunde', () => {
    render(<SidebarNav role="kunde" />);
    expect(screen.queryByRole('link', { name: 'Kasse' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Wunschlisten' })).toBeNull();
  });

  it('always shows the non-gated items regardless of role', () => {
    render(<SidebarNav role="kunde" />);
    expect(screen.getByRole('link', { name: 'Übersicht' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Lagerbestand' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Schaufenster' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Analytik' })).toBeInTheDocument();
  });

  it('links Kasse to /kasse', () => {
    render(<SidebarNav role="mitarbeiter" />);
    expect(screen.getByRole('link', { name: 'Kasse' })).toHaveAttribute('href', '/kasse');
  });
});
