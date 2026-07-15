import { forbidden } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { getCurrentTenant } from '@/lib/tenant';
import { listInventory } from '@/lib/inventory';
import { listActiveQuickItems } from '@/lib/quickItems';
import { KasseScreen } from './_components/KasseScreen';

export default async function KassePage() {
  // staff-only screen (spec §5.7); actions are independently gated (C11)
  const user = await requireSession();
  if (user.role === 'kunde') forbidden();
  const tenant = await getCurrentTenant();
  const ctx = { tenantId: tenant.id, userId: user.id };

  // Kasse needs the complete sellable set for client-side search (it's not paginated) — a
  // paginated/server-search POS is a separate follow-up. Opt out of the default 50-row cap.
  const [{ rows: allRows }, quickItems] = await Promise.all([
    listInventory(ctx, {}, { limit: 'all' }),
    listActiveQuickItems(ctx),
  ]);
  // Kasse offers only sellable copies (verfügbar/reserviert) — same gate performSale enforces server-side.
  const inventory = allRows.filter((r) => r.status === 'verfuegbar' || r.status === 'reserviert');

  return (
    <div style={{ maxWidth: 1200 }}>
      <KasseScreen inventory={inventory} quickItems={quickItems} />
    </div>
  );
}
