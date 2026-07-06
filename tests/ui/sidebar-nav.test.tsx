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
  it('shows Kasse, Wunschlisten and Sammlungen for staff (mitarbeiter)', () => {
    render(<SidebarNav role="mitarbeiter" />);
    expect(screen.getByRole('link', { name: 'Kasse' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Wunschlisten' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sammlungen' })).toBeInTheDocument();
  });

  it('shows Kasse, Wunschlisten and Sammlungen for admin', () => {
    render(<SidebarNav role="admin" />);
    expect(screen.getByRole('link', { name: 'Kasse' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Wunschlisten' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sammlungen' })).toBeInTheDocument();
  });

  it('hides Kasse, Wunschlisten and Sammlungen for a kunde', () => {
    render(<SidebarNav role="kunde" />);
    expect(screen.queryByRole('link', { name: 'Kasse' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Wunschlisten' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Sammlungen' })).toBeNull();
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

  it('links Sammlungen to /ankauf/sammlungen', () => {
    render(<SidebarNav role="mitarbeiter" />);
    expect(screen.getByRole('link', { name: 'Sammlungen' })).toHaveAttribute('href', '/ankauf/sammlungen');
  });

  it('lockedHrefs renders a lock icon + "(gesperrt im aktuellen Plan)" aria-label on the affected item only', () => {
    render(<SidebarNav role="admin" lockedHrefs={['/analytik']} />);

    const locked = screen.getByRole('link', { name: 'Analytik (gesperrt im aktuellen Plan)' });
    expect(locked).toBeInTheDocument();
    expect(screen.getByTestId('nav-lock-analytik')).toBeInTheDocument();

    // Unaffected items keep their plain accessible name (no aria-label override, no lock icon).
    const kasse = screen.getByRole('link', { name: 'Kasse' });
    expect(kasse).not.toHaveAttribute('aria-label');
    expect(screen.queryByTestId('nav-lock-kasse')).toBeNull();
  });
});
