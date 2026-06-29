// @vitest-environment jsdom
// tests/theme-provider.test.tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { ThemeProvider, useTheme } from '@/components/theme/ThemeProvider';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { AccentSwitch } from '@/components/theme/AccentSwitch';

// Helper probe component
function Probe() {
  const { theme, accent } = useTheme();
  return (
    <div
      data-testid="probe"
      data-theme-val={theme}
      data-accent-val={accent}
    />
  );
}

afterEach(() => {
  cleanup();
});

describe('ThemeProvider', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-accent');
    localStorage.clear();
    // Clear theme cookies
    document.cookie = 'qr-theme=; max-age=0';
    document.cookie = 'qr-accent=; max-age=0';
  });

  it('applies data-theme and data-accent to documentElement on mount', async () => {
    render(
      <ThemeProvider defaultTheme="dark" defaultAccent="indigo">
        <Probe />
      </ThemeProvider>,
    );
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
      expect(document.documentElement.getAttribute('data-accent')).toBe('indigo');
    });
  });

  it('exposes correct values through useTheme context', () => {
    render(
      <ThemeProvider defaultTheme="light" defaultAccent="forest">
        <Probe />
      </ThemeProvider>,
    );
    const probe = screen.getByTestId('probe');
    expect(probe.getAttribute('data-theme-val')).toBe('light');
    expect(probe.getAttribute('data-accent-val')).toBe('forest');
  });

  it('useTheme throws when used outside ThemeProvider', () => {
    // Suppress React error boundary noise
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow('useTheme must be inside ThemeProvider');
    spy.mockRestore();
  });
});

describe('ThemeToggle', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    localStorage.clear();
  });

  it('renders a button with correct aria-label for light theme', () => {
    render(
      <ThemeProvider defaultTheme="light" defaultAccent="coral">
        <ThemeToggle />
      </ThemeProvider>,
    );
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('aria-label')).toMatch(/dunkel/i);
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });

  it('toggles theme from light to dark on click', async () => {
    render(
      <ThemeProvider defaultTheme="light" defaultAccent="coral">
        <ThemeToggle />
        <Probe />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
      expect(screen.getByTestId('probe').getAttribute('data-theme-val')).toBe('dark');
    });
  });

  it('persists theme to localStorage', async () => {
    render(
      <ThemeProvider defaultTheme="light" defaultAccent="coral">
        <ThemeToggle />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => {
      expect(localStorage.getItem('qr-theme')).toBe('dark');
    });
  });
});

describe('AccentSwitch', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-accent');
    localStorage.clear();
  });

  it('renders radio buttons for coral, indigo, forest', () => {
    render(
      <ThemeProvider defaultTheme="light" defaultAccent="coral">
        <AccentSwitch />
      </ThemeProvider>,
    );
    const group = screen.getByRole('radiogroup', { name: /akzentfarbe/i });
    expect(group).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Coral' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Indigo' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Forest' })).toBeTruthy();
  });

  it('marks active accent as checked', () => {
    render(
      <ThemeProvider defaultTheme="light" defaultAccent="indigo">
        <AccentSwitch />
      </ThemeProvider>,
    );
    expect(
      screen.getByRole('radio', { name: 'Indigo' }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      screen.getByRole('radio', { name: 'Coral' }).getAttribute('aria-checked'),
    ).toBe('false');
  });

  it('clicking Indigo sets data-accent on documentElement', async () => {
    render(
      <ThemeProvider defaultTheme="light" defaultAccent="coral">
        <AccentSwitch />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Indigo' }));
    await waitFor(() => {
      expect(document.documentElement.getAttribute('data-accent')).toBe('indigo');
    });
  });

  it('persists accent to localStorage', async () => {
    render(
      <ThemeProvider defaultTheme="light" defaultAccent="coral">
        <AccentSwitch />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Forest' }));
    await waitFor(() => {
      expect(localStorage.getItem('qr-accent')).toBe('forest');
    });
  });
});
