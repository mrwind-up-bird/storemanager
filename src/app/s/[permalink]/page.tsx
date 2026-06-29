// src/app/s/[permalink]/page.tsx
import { notFound } from 'next/navigation';
import { getCurrentTenant } from '@/lib/tenant';
import { withTenant } from '@/db/tenant';
import { permalinks } from '@/db/schema';
import { eq, and } from 'drizzle-orm';

interface Props {
  params: Promise<{ permalink: string }>;
}

export default async function PublicPermalinkPage({ params }: Props) {
  const { permalink: slug } = await params;

  // getCurrentTenant reads x-tenant-slug from headers — set by edge middleware.
  // notFound() propagates naturally if the slug resolves to nothing.
  const tenant = await getCurrentTenant();

  const row = await withTenant({ tenantId: tenant.id, userId: null }, (tx) =>
    tx
      .select({ id: permalinks.id, filter: permalinks.filter, createdAt: permalinks.createdAt })
      .from(permalinks)
      .where(and(eq(permalinks.slug, slug), eq(permalinks.tenantId, tenant.id)))
      .then((rows) => rows[0] ?? null),
  );

  if (!row) {
    notFound(); // §9.4: unknown permalink → 404, NOT another tenant's data
  }

  // Slice 3 will render full public storefront here.
  return (
    <main style={{ padding: 'clamp(18px,3vw,32px)', fontFamily: 'var(--font-body)' }}>
      <h1
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 800,
          fontSize: 'clamp(28px,5vw,40px)',
          letterSpacing: '-.02em',
          marginBottom: '8px',
        }}
      >
        {tenant.name}
      </h1>
      <p style={{ color: 'var(--text-2)', fontSize: '15px' }}>
        Schaufenster · <span style={{ fontFamily: 'var(--font-mono)' }}>{slug}</span> — Slice 3 folgt.
      </p>
    </main>
  );
}

export async function generateMetadata({ params }: Props) {
  const { permalink: slug } = await params;
  try {
    const tenant = await getCurrentTenant();
    return { title: `${tenant.name} · ${slug}` };
  } catch {
    return { title: slug };
  }
}
