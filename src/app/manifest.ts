import type { MetadataRoute } from 'next';
import { getCurrentTenant } from '@/lib/tenant';

// Dynamisch pro Request: jede Tenant-Subdomain ist eine eigene Origin → das Manifest
// ist automatisch tenant-rein (C11). Unbekannte Subdomain → getCurrentTenant() → 404.
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const tenant = await getCurrentTenant();
  return {
    name: `${tenant.name} — Q-Records`,
    short_name: tenant.name.slice(0, 12),
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#FAF6F1', // Light --bg (= --n-50, tokens.css)
    theme_color: tenant.branding.primaryColor,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
