// src/app/(app)/inventar/page.tsx
import { requireSession } from '@/auth/session';
import { getCurrentTenant } from '@/lib/tenant';
import {
  listInventory,
  inventoryAggregates,
  parseInventoryFilters,
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

  // Parallel fetch — both are read-only; no shared write-state risk.
  // Note: two short read transactions per request are acceptable for Slice 1 (read-only, no concurrent writes);
  // single-withTenant-pass optimisation (exposing _tx variants) is deferred to a later slice.
  const [rows, aggs] = await Promise.all([
    listInventory(ctx, filters),
    inventoryAggregates(ctx, filters),
  ]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        maxWidth: 1200,
      }}
    >
      {/* Filter card: search + barcode + format/genre/condition + treffer/wert */}
      <FilterBar
        genreOptions={aggs.genreOptions}
        resultCount={aggs.total}
        valueAvailable={aggs.valueAvailable}
      />

      {/* Status tabs: Alle / im Lager / Verliehen / Verkauft with counts */}
      <StatusTabs byStatus={aggs.byStatus} total={aggs.total} />

      {/* List/tile toggle + active view + empty state */}
      <ViewToggle rows={rows} total={aggs.total} />
    </div>
  );
}
