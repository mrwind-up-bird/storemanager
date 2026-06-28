// src/lib/fonts.ts
// Self-hosted fonts loaded via next/font/local.
// Woff2 files live in src/fonts/ (downloaded during setup).
// Each font sets its CSS variable on whatever element receives the className,
// which is <html> in src/app/layout.tsx.
import localFont from 'next/font/local';

/** Bricolage Grotesque variable — display font.
 *  Sets --font-display on <html> when className is applied. */
export const displayFont = localFont({
  src: [
    {
      path: '../fonts/BricolageGrotesque-Variable.woff2',
      weight: '500 800',
      style: 'normal',
    },
  ],
  variable: '--font-display',
  display: 'swap',
  adjustFontFallback: 'Arial',
  fallback: ['system-ui', 'sans-serif'],
});

/** Hanken Grotesk variable — body font.
 *  Sets --font-body on <html> when className is applied. */
export const bodyFont = localFont({
  src: [
    {
      path: '../fonts/HankenGrotesk-Variable.woff2',
      weight: '400 700',
      style: 'normal',
    },
  ],
  variable: '--font-body',
  display: 'swap',
  adjustFontFallback: 'Arial',
  fallback: ['system-ui', '-apple-system', 'sans-serif'],
});

/** Geist Mono variable — monospace font for prices, IDs, catalog data.
 *  Sets --font-mono on <html> when className is applied. */
export const monoFont = localFont({
  src: [
    {
      path: '../fonts/GeistMono-Variable.woff2',
      weight: '400 500',
      style: 'normal',
    },
  ],
  variable: '--font-mono',
  display: 'swap',
  adjustFontFallback: false,
  fallback: ['ui-monospace', 'SFMono-Regular', 'monospace'],
});
