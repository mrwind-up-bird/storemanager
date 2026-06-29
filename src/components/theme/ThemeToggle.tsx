// src/components/theme/ThemeToggle.tsx
'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from './ThemeProvider';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      aria-label={isDark ? 'Zu hellem Theme wechseln' : 'Dunkelmodus einschalten'}
      aria-pressed={isDark}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      style={{
        flexShrink: 0,
        width: '42px',
        height: '42px',
        border: '1.5px solid var(--border-strong)',
        borderRadius: 'var(--r-md)',
        background: 'var(--surface)',
        color: 'var(--text)',
        cursor: 'pointer',
        display: 'grid',
        placeItems: 'center',
        transition: 'border-color var(--dur-1) var(--ease)',
      }}
    >
      {isDark ? (
        <Sun size={18} aria-hidden="true" />
      ) : (
        <Moon size={18} aria-hidden="true" />
      )}
    </button>
  );
}
