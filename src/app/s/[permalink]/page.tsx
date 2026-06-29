// src/app/s/[permalink]/page.tsx
import { notFound } from 'next/navigation';
import { getCurrentTenant } from '@/lib/tenant';
import { resolvePermalink, listStorefront } from '@/lib/storefront';
import { StorefrontGrid } from './_components/StorefrontGrid';
import { StorefrontSearch } from './_components/StorefrontSearch';

interface Props {
  params: Promise<{ permalink: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function readQ(sp: Record<string, string | string[] | undefined>): string {
  const raw = sp.q;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' ? value.trim().slice(0, 80) : '';
}

export default async function PublicStorefrontPage({ params, searchParams }: Props) {
  const { permalink: slug } = await params;
  const sp = await searchParams;
  const q = readQ(sp);

  // getCurrentTenant reads x-tenant-slug from headers — set by edge middleware. NO requireSession.
  const tenant = await getCurrentTenant();

  const resolved = await resolvePermalink({ tenantId: tenant.id }, slug);
  if (!resolved) {
    notFound(); // unknown permalink → 404, NEVER another tenant's data
  }

  const records = await listStorefront({ tenantId: tenant.id }, resolved.filter, q || undefined);

  return (
    <main
      style={{
        maxWidth: 1200,
        margin: '0 auto',
        padding: 'clamp(20px,4vw,40px)',
        fontFamily: 'var(--font-body)',
      }}
    >
      <p
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '12px',
          letterSpacing: '.08em',
          textTransform: 'uppercase',
          color: 'var(--text-3)',
          marginBottom: 6,
        }}
      >
        q·records · Live-Bestand
      </p>
      <h2
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 800,
          fontSize: 'clamp(28px,5vw,42px)',
          letterSpacing: '-.02em',
          marginBottom: 'clamp(16px,3vw,26px)',
          color: 'var(--text)',
        }}
      >
        {resolved.title}
      </h2>

      <StorefrontSearch initialQ={q} />
      <StorefrontGrid records={records} />

      <footer
        style={{
          marginTop: 'clamp(32px,6vw,56px)',
          paddingTop: 'clamp(16px,3vw,24px)',
          borderTop: '1px solid var(--border)',
          color: 'var(--text-3)',
          fontSize: '13px',
        }}
      >
        <p style={{ fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--text-2)' }}>{tenant.name}</p>
        <p style={{ marginTop: 4 }}>
          Öffnungszeiten &amp; Adresse folgen · betrieben mit q·records
        </p>
      </footer>
    </main>
  );
}

export async function generateMetadata({ params }: Props) {
  const { permalink: slug } = await params;
  try {
    const tenant = await getCurrentTenant();
    const resolved = await resolvePermalink({ tenantId: tenant.id }, slug);
    return { title: resolved ? `${tenant.name} · ${resolved.title}` : tenant.name };
  } catch {
    return { title: slug };
  }
}
