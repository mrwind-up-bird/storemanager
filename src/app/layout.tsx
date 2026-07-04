// src/app/layout.tsx
import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { getCurrentTenantSlug, getCurrentTenant, accentOnColor } from '@/lib/tenant';
import { ThemeProvider, type Theme, type Accent } from '@/components/theme/ThemeProvider';
import { SwRegistration } from '@/components/pwa/SwRegistration';
import { displayFont, bodyFont, monoFont } from '@/lib/fonts';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: { default: 'q·records storemanager', template: '%s · q·records' },
  appleWebApp: { capable: true, statusBarStyle: 'default' },
  icons: { apple: '/icons/apple-touch-icon.png' },
};

// Statisch (KEIN Tenant-Zugriff): generateViewport liefe auch auf tenant-losen
// Infrastruktur-Routen — tenant-genaues theme_color liefert das Manifest (C11).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#FF5A5F',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // SSR theme preference from cookie (set by ThemeProvider client-side)
  const cookieStore = await cookies();
  const rawTheme = cookieStore.get('qr-theme')?.value;
  const rawAccent = cookieStore.get('qr-accent')?.value;
  const initialTheme: Theme = rawTheme === 'dark' ? 'dark' : 'light';
  const initialAccent: Accent =
    rawAccent === 'indigo' || rawAccent === 'forest' ? rawAccent : 'coral';

  // SSR tenant branding — inline in <head> to eliminate FOUC.
  // getCurrentTenantSlug() returns null when x-tenant-slug header is absent
  // (middleware blocks unknown subdomains before reaching here, but system
  // routes like /_next/* have no tenant slug and must be handled gracefully).
  let brandingStyle = '';
  const slug = await getCurrentTenantSlug();
  if (slug) {
    // getCurrentTenant() calls notFound() for unresolved slugs — middleware
    // already prevented unknown tenants, so this is always valid here.
    const tenant = await getCurrentTenant();
    const { primaryColor } = tenant.branding;
    const onAccent = accentOnColor(primaryColor);
    // Override the FULL accent family from the tenant's primaryColor via CSS color-mix()
    // so hover/press/soft/soft-border/ink stay consistent with --accent for any tenant
    // colour (not just coral). No JS colour math; mixes against --surface so it adapts to
    // light/dark. color-mix() is supported in all 2026 evergreen browsers.
    brandingStyle =
      `:root{` +
      `--accent:${primaryColor};` +
      `--accent-hover:color-mix(in srgb, ${primaryColor} 88%, #000);` +
      `--accent-press:color-mix(in srgb, ${primaryColor} 78%, #000);` +
      `--accent-soft:color-mix(in srgb, ${primaryColor} 12%, var(--surface));` +
      `--accent-soft-border:color-mix(in srgb, ${primaryColor} 30%, var(--surface));` +
      `--accent-ink:color-mix(in srgb, ${primaryColor} 70%, #000);` +
      `--on-accent:${onAccent};` +
      `--focus:${primaryColor};` +
      `}`;
  }

  return (
    <html
      lang="de"
      data-theme={initialTheme}
      data-accent={initialAccent}
      className={`${displayFont.variable} ${bodyFont.variable} ${monoFont.variable}`}
    >
      <head>
        {brandingStyle ? (
          <style
            // biome-ignore lint/security/noDangerouslySetInnerHtml: verbatim CSS injection is safe here — values come from DB, not user input
            dangerouslySetInnerHTML={{ __html: brandingStyle }}
            data-qr-branding
          />
        ) : null}
      </head>
      <body>
        <ThemeProvider defaultTheme={initialTheme} defaultAccent={initialAccent}>
          {children}
        </ThemeProvider>
        <SwRegistration />
      </body>
    </html>
  );
}
