// src/app/(app)/ankauf/sammlungen/[id]/page.tsx
// RSC: staff-only gate → resolve :id (Next 15: `params` is a Promise) → load the collection detail
// (404 via `notFound()` when the id is malformed or RLS resolves it to null, i.e. a foreign id) →
// render.

import { forbidden, notFound } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { getCurrentTenant } from '@/lib/tenant';
import { getCollection } from '@/lib/collections';
import { CollectionDetailView } from '../_components/CollectionDetailView';

export default async function SammlungDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireSession();
  if (user.role === 'kunde') forbidden();
  const tenant = await getCurrentTenant();
  const ctx = { tenantId: tenant.id, userId: user.id };

  const { id } = await params;
  const num = Number(id);
  if (!Number.isInteger(num)) notFound();

  const collection = await getCollection(ctx, num);
  if (!collection) notFound();

  return (
    <div style={{ maxWidth: 1100 }}>
      <CollectionDetailView collection={collection} />
    </div>
  );
}
