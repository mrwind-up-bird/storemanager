// src/app/(app)/ankauf/sammlungen/page.tsx
// RSC: staff-only gate (collections expose EK/purchase internals, same gate as kasse/wunschlisten)
// → load Sammlungen summaries → render the overview list.

import { forbidden } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { getCurrentTenant } from '@/lib/tenant';
import { listCollections } from '@/lib/collections';
import { CollectionsList } from './_components/CollectionsList';

export default async function SammlungenPage() {
  const user = await requireSession();
  if (user.role === 'kunde') forbidden();
  const tenant = await getCurrentTenant();
  const ctx = { tenantId: tenant.id, userId: user.id };

  const collections = await listCollections(ctx);

  return (
    <div style={{ maxWidth: 1100 }}>
      <header className="qr-page-header" style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: 'clamp(20px,3vw,26px)',
            letterSpacing: '-.02em',
            margin: 0,
          }}
        >
          Sammlungen
        </h1>
        <p style={{ color: 'var(--text-2)', fontSize: 15, margin: 0 }}>
          Batch-Ankäufe im Überblick — Verkäufer:in, Datum, Positionen und Gesamt-EK je Sammlung.
        </p>
      </header>
      <CollectionsList collections={collections} />
    </div>
  );
}
