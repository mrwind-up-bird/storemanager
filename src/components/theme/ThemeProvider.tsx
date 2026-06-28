// src/components/theme/ThemeProvider.tsx
'use client';

import { createContext, useContext, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
export type Accent = 'coral' | 'indigo' | 'forest';

export interface ThemeContextValue {
  theme: Theme;
  accent: Accent;
  setTheme(t: Theme): void;
  setAccent(a: Accent): void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be inside ThemeProvider');
  return ctx;
}

interface ThemeProviderProps {
  defaultTheme: Theme;
  defaultAccent: Accent;
  children: React.ReactNode;
}

export function ThemeProvider({ defaultTheme, defaultAccent, children }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(defaultTheme);
  const [accent, setAccentState] = useState<Accent>(defaultAccent);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-accent', accent);
  }, [theme, accent]);

  function setTheme(t: Theme) {
    setThemeState(t);
    try {
      localStorage.setItem('qr-theme', t);
      // Not __Host- — preference cookie, not auth
      document.cookie = `qr-theme=${t};path=/;max-age=31536000;SameSite=Lax`;
    } catch {
      // SSR guard
    }
  }

  function setAccent(a: Accent) {
    setAccentState(a);
    try {
      localStorage.setItem('qr-accent', a);
      document.cookie = `qr-accent=${a};path=/;max-age=31536000;SameSite=Lax`;
    } catch {
      // SSR guard
    }
  }

  return (
    <ThemeContext.Provider value={{ theme, accent, setTheme, setAccent }}>
      {children}
    </ThemeContext.Provider>
  );
}
