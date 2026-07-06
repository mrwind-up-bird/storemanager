import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

/**
 * Zone-Guard (Defence-in-Depth zu Middleware-404 + Header-Strip): erreichbar NUR, wenn die
 * Middleware den Rewrite von admin.<ROOT_DOMAIN> gesetzt hat. Direkte /platform*-Requests
 * beantwortet bereits die Middleware mit 404 — dieser Guard fängt jeden Restpfad.
 */
export default async function PlatformZoneLayout({ children }: { children: React.ReactNode }) {
  const h = await headers();
  if (h.get('x-platform-zone') !== '1') notFound();
  return <>{children}</>;
}
