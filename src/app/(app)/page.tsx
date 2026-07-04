import { requireSession } from '@/auth/session';
import { getCurrentTenant } from '@/lib/tenant';
import { inventoryAggregates } from '@/lib/inventory';
import { KpiCard } from './_components/dashboard/KpiCard';
import { InventoryKpi } from './_components/dashboard/InventoryKpi';
import { EmptyPanel } from './_components/dashboard/EmptyPanel';
import { QuickActions } from './_components/QuickActions';

/**
 * Dashboard (Übersicht) — `/`
 *
 * Server Component. Real data: "Artikel im Lager" + formatSplit + Inventarwert
 * via inventoryAggregates(ctx, {}) (no filters = tenant-wide picture).
 * Everything else is a calm placeholder for Slice 2/3 features.
 *
 * Verbatim layout from Q-Records App.dc.html DASHBOARD section:
 *   outer: flex col gap-20 max-w-1200
 *   KPI row: grid repeat(auto-fit, minmax(min(100%,230px),1fr)) gap-16
 *   panel row: grid 1.55fr 1fr gap-20
 */
export default async function DashboardPage() {
  const [user, tenant] = await Promise.all([requireSession(), getCurrentTenant()]);
  const agg = await inventoryAggregates({ tenantId: tenant.id, userId: user.id }, {});

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '1200px' }}>

      {user.role !== 'kunde' && <QuickActions />}

      {/* ── KPI Row — 4 cards ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 230px), 1fr))',
          gap: '16px',
        }}
      >
        {/* 1. Tagesumsatz — calm placeholder, no fake number, flat sparkline */}
        <KpiCard label="Tagesumsatz">
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontWeight: 500,
              fontSize: '32px',
              marginTop: '10px',
              letterSpacing: '-.02em',
              color: 'var(--text-3)',
            }}
          >
            € 0
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-3)', marginTop: '8px' }}>
            Noch keine Verkäufe (Slice 3)
          </div>
          {/* flat sparkline — equal height bars, surface-3, no fake data */}
          <div
            aria-hidden="true"
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              gap: '5px',
              height: '34px',
              marginTop: '14px',
            }}
          >
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: '20%',
                  background: 'var(--surface-3)',
                  borderRadius: '3px 3px 0 0',
                }}
              />
            ))}
          </div>
        </KpiCard>

        {/* 2. Artikel im Lager — REAL data */}
        <InventoryKpi aggregates={agg} />

        {/* 3. Ankäufe heute — accent card, calm placeholder */}
        <KpiCard label="Ankäufe heute" icon="⤓" accent>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontWeight: 500,
              fontSize: '32px',
              marginTop: '10px',
              letterSpacing: '-.02em',
            }}
          >
            0
          </div>
          <div style={{ fontSize: '13px', marginTop: '16px', opacity: 0.92 }}>
            Ankauf folgt (Slice 2)
          </div>
        </KpiCard>

        {/* 4. Offene Wunschtreffer — disabled CTA placeholder */}
        <KpiCard label="Offene Wunschtreffer" icon="♡">
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontWeight: 500,
              fontSize: '32px',
              marginTop: '10px',
              letterSpacing: '-.02em',
              color: 'var(--text-3)',
            }}
          >
            0
          </div>
          {/* disabled placeholder CTA — no onClick, inert */}
          <button
            type="button"
            disabled
            style={{
              marginTop: '14px',
              minHeight: '34px',
              padding: '0 14px',
              border: '1.5px solid var(--border-strong)',
              borderRadius: 'var(--r-pill)',
              background: 'transparent',
              color: 'var(--text-3)',
              fontFamily: 'var(--font-body)',
              fontWeight: 700,
              fontSize: '12.5px',
              cursor: 'not-allowed',
            }}
          >
            Treffer ansehen → (Slice 3)
          </button>
        </KpiCard>
      </div>

      {/* ── Panel Row — 2 panels ── */}
      {/*
        Verbatim: grid-template-columns 1.55fr 1fr, gap 20px
        Source: Q-Records App.dc.html line 128 (.qr-dash-cols)
      */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.55fr 1fr',
          gap: '20px',
          alignItems: 'start',
        }}
      >
        {/* Letzte Verkäufe — wide panel, calm empty, disabled "Alle →" */}
        <EmptyPanel
          title="Letzte Verkäufe"
          testId="panel-letzte-verkaeufe"
          emptyMessage="Noch keine Verkäufe — Verkauf folgt (Slice 3)."
          headerExtra={
            <button
              type="button"
              disabled
              style={{
                border: 'none',
                background: 'transparent',
                color: 'var(--text-3)',
                fontFamily: 'var(--font-body)',
                fontWeight: 600,
                fontSize: '13px',
                cursor: 'not-allowed',
              }}
            >
              Alle →
            </button>
          }
        />

        {/* Wunschlisten-Treffer — narrow panel, honey dot prefix, calm empty */}
        <EmptyPanel
          title="Wunschlisten-Treffer"
          testId="panel-wunschlisten"
          emptyMessage="Noch keine Treffer — Wunschlisten folgt (Slice 3)."
          titlePrefix={
            /*
             * Verbatim from Q-Records App.dc.html line 150:
             *   width:9px height:9px border-radius:50% background:var(--honey)
             *   box-shadow:0 0 0 4px var(--honey-soft)
             */
            <span
              aria-hidden="true"
              style={{
                width: '9px',
                height: '9px',
                borderRadius: '50%',
                background: 'var(--honey)',
                boxShadow: '0 0 0 4px var(--honey-soft)',
                display: 'inline-block',
                flexShrink: 0,
              }}
            />
          }
        />
      </div>
    </div>
  );
}
