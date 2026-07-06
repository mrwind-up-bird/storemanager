import 'server-only';
import { cache } from 'react';
import { count, eq, inArray } from 'drizzle-orm';
import { withSuperadmin, type Tx } from '@/db/tenant';
import { plans, records, tenants, users } from '@/db/schema';

// ---------------------------------------------------------------------------
// Typen (CONTRACTS C7)
// ---------------------------------------------------------------------------

export type PlanLimits = { maxRecords: number | null; maxUsers: number | null };
export type PlanFeatures = { analytik: boolean; discogsListing: boolean };

export type Entitlements = {
  plan: string;
  planName: string;
  priceMonthlyCents: number;
  limits: PlanLimits;
  features: PlanFeatures;
};

/** Fail-closed-Matrix bei unbekanntem/verwaistem tenants.plan (Spec §10). */
export const FREE_FALLBACK_ENTITLEMENTS: Entitlements = {
  plan: 'free',
  planName: 'Free',
  priceMonthlyCents: 0,
  limits: { maxRecords: 100, maxUsers: 2 },
  features: { analytik: false, discogsListing: false },
};

/**
 * NUR für vertrauenswürdige Fixture-Pfade (scripts/seed.ts, Test-Setups) — niemals
 * aus Request-Kontext verwenden. Request-Pfade laden IMMER getEntitlements(tenantId).
 */
export const UNLIMITED_ENTITLEMENTS: Entitlements = {
  plan: 'big',
  planName: 'Big',
  priceMonthlyCents: 4900,
  limits: { maxRecords: null, maxUsers: null },
  features: { analytik: true, discogsListing: true },
};

export class LimitExceededError extends Error {
  constructor(
    message: string,
    public readonly current: number,
    public readonly max: number,
  ) {
    super(message);
    this.name = 'LimitExceededError';
  }
}

// ---------------------------------------------------------------------------
// Merge (pure — unit-getestet)
// ---------------------------------------------------------------------------

/**
 * Liest einen Limit-Override aus tenants.limits.
 *  - Key fehlt            → undefined (Plan-Wert gilt)
 *  - JSON null            → null (unbegrenzt — GÜLTIGER Override)
 *  - nicht-negatives int  → Zahl
 *  - alles andere         → undefined + Warn-Log (defekter Override wird ignoriert)
 */
function overrideValue(
  overrides: Record<string, unknown>,
  key: 'maxRecords' | 'maxUsers',
): number | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(overrides, key)) return undefined;
  const v = overrides[key];
  if (v === null) return null;
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return v;
  console.warn(`[gating] ungültiger limits-Override ${key}=${String(v)} — ignoriert`);
  return undefined;
}

function baseLimit(planLimits: Record<string, unknown>, key: 'maxRecords' | 'maxUsers'): number | null {
  const v = planLimits[key];
  if (v === null) return null;
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return v;
  // Defekte/alte Plan-Zeile (z. B. Slice-0-Keys) → fail-closed auf Free-Wert.
  return FREE_FALLBACK_ENTITLEMENTS.limits[key];
}

/** Feldweiser Merge: tenants.limits gewinnt je Feld über plans.limits (Spec §10). */
export function mergeEntitlements(
  planRow: {
    slug: string;
    name: string;
    priceMonthlyCents: number;
    limits: unknown;
    features: unknown;
  },
  tenantOverrides: unknown,
): Entitlements {
  const pl = (planRow.limits ?? {}) as Record<string, unknown>;
  const pf = (planRow.features ?? {}) as Record<string, unknown>;
  const ov = (tenantOverrides ?? {}) as Record<string, unknown>;

  const ovRecords = overrideValue(ov, 'maxRecords');
  const ovUsers = overrideValue(ov, 'maxUsers');

  return {
    plan: planRow.slug,
    planName: planRow.name,
    priceMonthlyCents: planRow.priceMonthlyCents,
    limits: {
      maxRecords: ovRecords === undefined ? baseLimit(pl, 'maxRecords') : ovRecords,
      maxUsers: ovUsers === undefined ? baseLimit(pl, 'maxUsers') : ovUsers,
    },
    features: {
      analytik: pf.analytik === true,
      discogsListing: pf.discogsListing === true,
    },
  };
}

// ---------------------------------------------------------------------------
// Laden (einmal pro Request — React cache())
// ---------------------------------------------------------------------------

export const getEntitlements: (tenantId: number) => Promise<Entitlements> = cache(
  async (tenantId: number): Promise<Entitlements> => {
    const rows = await withSuperadmin((tx) =>
      tx
        .select({
          tenantPlan: tenants.plan,
          overrides: tenants.limits,
          slug: plans.slug,
          name: plans.name,
          priceMonthlyCents: plans.priceMonthlyCents,
          planLimits: plans.limits,
          planFeatures: plans.features,
        })
        .from(tenants)
        .leftJoin(plans, eq(plans.slug, tenants.plan))
        .where(eq(tenants.id, tenantId))
        .limit(1),
    );
    const r = rows[0];
    if (!r) {
      console.warn(`[gating] Tenant ${tenantId} nicht gefunden — fail-closed Free`);
      return FREE_FALLBACK_ENTITLEMENTS;
    }
    if (!r.slug || r.name === null || r.priceMonthlyCents === null) {
      // Verwaister tenants.plan-Wert: Free-Matrix als Basis, Overrides bleiben wirksam
      // (Sonderkonditionen hängen am Tenant, nicht am Plan).
      console.warn(`[gating] Unbekannter Plan "${r.tenantPlan}" (Tenant ${tenantId}) — fail-closed Free`);
      return mergeEntitlements(
        {
          slug: FREE_FALLBACK_ENTITLEMENTS.plan,
          name: FREE_FALLBACK_ENTITLEMENTS.planName,
          priceMonthlyCents: FREE_FALLBACK_ENTITLEMENTS.priceMonthlyCents,
          limits: FREE_FALLBACK_ENTITLEMENTS.limits,
          features: FREE_FALLBACK_ENTITLEMENTS.features,
        },
        r.overrides,
      );
    }
    return mergeEntitlements(
      {
        slug: r.slug,
        name: r.name,
        priceMonthlyCents: r.priceMonthlyCents,
        limits: r.planLimits,
        features: r.planFeatures,
      },
      r.overrides,
    );
  },
);

// ---------------------------------------------------------------------------
// Kapazitäts-Checks (laufen INNERHALB der withTenant-Tx des Aufrufers — der
// RLS-Kontext der Transaktion scoped die Counts auf den Tenant)
// ---------------------------------------------------------------------------

/** count(records) + addCount ≤ maxRecords, sonst LimitExceededError. count+add == max ist ERLAUBT. */
export async function checkRecordCapacity(tx: Tx, ent: Entitlements, addCount: number): Promise<void> {
  const max = ent.limits.maxRecords;
  if (max === null) return;
  const [row] = await tx.select({ n: count() }).from(records);
  const current = row?.n ?? 0;
  if (current + addCount > max) {
    throw new LimitExceededError(
      `Plan-Limit erreicht: max. ${max} Platten im ${ent.planName}-Plan. Upgrade unter Einstellungen → Abo.`,
      current,
      max,
    );
  }
}

/** Zählt NUR Staff (admin + mitarbeiter) — kunde-Konten sind unbegrenzt (Spec §10). */
export async function checkUserCapacity(tx: Tx, ent: Entitlements, addCount: number): Promise<void> {
  const max = ent.limits.maxUsers;
  if (max === null) return;
  const [row] = await tx
    .select({ n: count() })
    .from(users)
    .where(inArray(users.role, ['admin', 'mitarbeiter']));
  const current = row?.n ?? 0;
  if (current + addCount > max) {
    throw new LimitExceededError(
      `Plan-Limit erreicht: max. ${max} Nutzer im ${ent.planName}-Plan. Upgrade unter Einstellungen → Abo.`,
      current,
      max,
    );
  }
}
