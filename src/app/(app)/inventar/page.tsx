// src/app/(app)/inventar/page.tsx
import { requireSession } from '@/auth/session';
import { getCurrentTenant } from '@/lib/tenant';
import { getEntitlements } from '@/lib/gating';
import {
  listInventory,
  inventoryAggregates,
  parseInventoryFilters,
  kiSearch,
  type InventoryRow,
} from '@/lib/inventory';
import { FilterBar } from './_components/FilterBar';
import { StatusTabs } from './_components/StatusTabs';
import { ViewToggle } from './_components/ViewToggle';

export default async function InventarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // requireSession: auth gate + tenant↔session invariant check
  const user = await requireSession();
  // getCurrentTenant: React cache — deduped within this request
  const tenant = await getCurrentTenant();

  const sp = await searchParams;
  const filters = parseInventoryFilters(sp);

  // Explicit tenantId in ctx (defence-in-depth alongside RLS per Global Constraints)
  const ctx = { tenantId: tenant.id, userId: user.id };
  const ent = await getEntitlements(tenant.id);

  // parseInventoryFilters parst mode/q bewusst NICHT — beide direkt aus sp lesen.
  const rawMode = typeof sp.mode === 'string' ? sp.mode : Array.isArray(sp.mode) ? sp.mode[0] : undefined;
  const kiMode = rawMode === 'ki' && ent.features.kiSuche;
  const query = typeof sp.q === 'string' ? sp.q : Array.isArray(sp.q) ? sp.q[0] ?? '' : '';

  // inventoryAggregates läuft immer (Treffer/Wert + Facettenzähler bleiben korrekt, auch im KI-Modus).
  const aggs = await inventoryAggregates(ctx, filters);
  let rows: (InventoryRow & { score?: number })[];
  let kiUnavailable = false;
  if (kiMode) {
    const res = await kiSearch(ctx, { query, filters });
    rows = res.rows;
    kiUnavailable = res.unavailable ?? false;
  } else {
    rows = await listInventory(ctx, filters);
  }
  const isAdmin = user.role === 'admin' || user.isSuperadmin;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        maxWidth: 1200,
      }}
    >
      {/* Filter card: search + barcode + format/genre/condition + treffer/wert + KI-Modus */}
      <FilterBar
        genreOptions={aggs.genreOptions}
        resultCount={aggs.total}
        valueAvailable={aggs.valueAvailable}
        kiEnabled={ent.features.kiSuche}
        planName={ent.planName}
        isAdmin={isAdmin}
      />

      {/* Status tabs: Alle / im Lager / Verliehen / Verkauft with counts */}
      <StatusTabs byStatus={aggs.byStatus} total={aggs.total} />

      {/* List/tile toggle + active view + empty state (KI-unavailable state, Score-Badge) */}
      <ViewToggle rows={rows} total={aggs.total} kiMode={kiMode} kiUnavailable={kiUnavailable} />
    </div>
  );
}
