// src/app/(app)/inventar/[recordId]/page.tsx
// Lagerbestand-Kachel — record detail (catalog row + its physical copies). RSC gate + fetch.
import { notFound } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { getCurrentTenant } from '@/lib/tenant';
import { getRecordDetail } from '@/lib/records';
import { RecordDetail } from '../_components/RecordDetail';

export default async function RecordDetailPage({
  params,
}: {
  params: Promise<{ recordId: string }>;
}) {
  const user = await requireSession();
  const tenant = await getCurrentTenant();

  const { recordId } = await params;
  const id = Number(recordId);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const detail = await getRecordDetail({ tenantId: tenant.id, userId: user.id }, id);
  if (!detail) notFound();

  const canEdit = user.role !== 'kunde';

  return <RecordDetail detail={detail} canEdit={canEdit} />;
}
