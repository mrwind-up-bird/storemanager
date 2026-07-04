'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { InventoryRow } from '@/lib/inventory';
import type { Condition } from '@/components/ui/ConditionPill';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ConditionPill } from '@/components/ui/ConditionPill';
import { Checkbox } from '@/components/ui';
import { SellModal } from './SellModal';
import { LabelPrintModal } from './LabelPrintModal';
import { reserve, cancelReservation } from '@/app/(app)/kasse/actions';
import { toCents } from '@/lib/money';
import { DEFAULT_CONDITION_RECORD } from '@/lib/pricing';
import type { LabelItem } from '@/lib/labels';

export interface InventoryListProps {
  rows: InventoryRow[];
  total: number; // from inventoryAggregates.total (ignores status tab) → footer
}

const HEAD_CELL: React.CSSProperties = {
  padding: '12px 12px',
  fontWeight: 600,
  fontSize: '11.5px',
  textTransform: 'uppercase',
  letterSpacing: '.05em',
};

export function InventoryList({ rows, total }: InventoryListProps) {
  const router = useRouter();

  // The row whose Einzel-Verkauf-Modal is open (null = none). copyId === purchases.id.
  const [sellRow, setSellRow] = useState<InventoryRow | null>(null);
  // Per-row inline error messages keyed by copyId (purchaseId). Cleared on next attempt.
  const [rowErrors, setRowErrors] = useState<Map<number, string>>(new Map());
  // Rows picked for label printing (copyId set) + the print modal's open state.
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [printOpen, setPrintOpen] = useState(false);

  const toggleSelected = (copyId: number, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(copyId);
      else next.delete(copyId);
      return next;
    });
  };

  // Derived from the CURRENT rows, not from selectedIds alone — selectedIds can outlive a
  // status-tab switch (server re-renders this same component instance with a new, possibly
  // disjoint rows array), so intersecting with rows here keeps the displayed count, the print
  // button's enabled state, and labelItems permanently in sync with each other.
  const selectedRows = rows.filter((row) => selectedIds.has(row.copyId));

  // A missing/null conditionRecord falls back to the shop default grade so LabelItem's non-null
  // conditionRecord contract still holds.
  const labelItems: LabelItem[] = selectedRows.map((row) => ({
    artist: row.artist,
    title: row.title,
    format: row.format,
    conditionRecord: row.conditionRecord ?? DEFAULT_CONDITION_RECORD,
    priceCents: row.vk != null ? toCents(row.vk) : null,
    discogsId: row.discogsId,
  }));

  // Reserve / cancel await the T9 server action result so conflicts (e.g. a copy concurrently
  // sold while the staff member hovered the button) are surfaced rather than swallowed.
  // On ok:true the action calls revalidatePath('/inventar') server-side — no extra refresh needed.
  // On ok:false we show an inline error on the row AND call router.refresh() so the stale row
  // status (which the server revalidate did NOT update) gets corrected.
  const onReserve = async (purchaseId: number) => {
    setRowErrors((prev) => { const m = new Map(prev); m.delete(purchaseId); return m; });
    const result = await reserve({ purchaseId });
    if (!result.ok) {
      setRowErrors((prev) => new Map(prev).set(purchaseId, 'Reservierung fehlgeschlagen – Artikel möglicherweise nicht mehr verfügbar.'));
      router.refresh();
    }
  };
  const onCancelReservation = async (purchaseId: number) => {
    setRowErrors((prev) => { const m = new Map(prev); m.delete(purchaseId); return m; });
    const result = await cancelReservation({ purchaseId });
    if (!result.ok) {
      setRowErrors((prev) => new Map(prev).set(purchaseId, 'Reservierung aufheben fehlgeschlagen – Artikel möglicherweise geändert.'));
      router.refresh();
    }
  };

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-lg)',
        background: 'var(--surface)',
        boxShadow: 'var(--shadow-1)',
        overflow: 'hidden',
      }}
    >
      {/* Etiketten-Toolbar — visible whenever ≥1 row is selected for label printing */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 12,
          padding: '10px 18px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface-2)',
        }}
      >
        <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
          {selectedRows.length} ausgewählt
        </span>
        <button
          type="button"
          data-testid="label-print-open"
          onClick={() => setPrintOpen(true)}
          disabled={selectedRows.length === 0}
          style={{
            minHeight: 36,
            padding: '0 16px',
            border: '1.5px solid var(--border-strong)',
            borderRadius: 'var(--r-pill)',
            background: selectedRows.length === 0 ? 'var(--surface-3)' : 'var(--surface)',
            color: selectedRows.length === 0 ? 'var(--text-3)' : 'var(--text)',
            fontFamily: 'var(--font-body)',
            fontWeight: 700,
            fontSize: '12.5px',
            cursor: selectedRows.length === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          Etiketten drucken
        </button>
      </div>

      {/* Mobile Karten-Liste (Slice 5) — Desktop-Tabelle unverändert daneben (qr-desktop-only) */}
      <div className="qr-mobile-only" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map((row) => {
          const sellable = row.status === 'verfuegbar' || row.status === 'reserviert';
          return (
            <div
              key={row.copyId}
              data-testid="inventory-mobile-card"
              style={{
                border: '1px solid var(--border)', borderRadius: 'var(--r-lg)',
                background: 'var(--surface)', boxShadow: 'var(--shadow-1)',
                padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ minWidth: 0 }}>
                  <strong style={{ fontWeight: 700 }}>{row.title}</strong>
                  <br />
                  <span style={{ color: 'var(--text-2)', fontSize: 13 }}>{row.artist}</span>
                </span>
                <StatusBadge status={row.status} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {row.conditionRecord !== null && (
                  <ConditionPill condition={row.conditionRecord as Condition} />
                )}
                {row.format && (
                  <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{row.format}</span>
                )}
                <span
                  style={{
                    marginLeft: 'auto', fontFamily: 'var(--font-mono)',
                    fontWeight: 700, fontSize: 14,
                  }}
                >
                  {row.vk ?? '—'}
                </span>
                <button
                  type="button"
                  disabled={!sellable}
                  onClick={() => sellable && setSellRow(row)}
                  style={{
                    minHeight: 34, padding: '0 14px', border: 'none',
                    borderRadius: 'var(--r-pill)',
                    background: sellable ? 'var(--accent)' : 'var(--surface-3)',
                    color: sellable ? 'var(--on-accent)' : 'var(--text-3)',
                    fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: '12.5px',
                    cursor: sellable ? 'pointer' : 'not-allowed',
                  }}
                >
                  {row.status === 'verkauft' ? 'Verkauft' : 'Verkaufen'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="qr-desktop-only" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, minWidth: 720 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--text-3)', background: 'var(--surface-2)' }}>
              <th scope="col" style={{ ...HEAD_CELL, padding: '12px 0 12px 18px', width: 1 }}>
                <span
                  style={{
                    position: 'absolute', width: 1, height: 1, padding: 0,
                    margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', border: 0,
                  }}
                >
                  Auswahl
                </span>
              </th>
              <th scope="col" style={{ ...HEAD_CELL, padding: '12px 18px' }}>
                Artikel
              </th>
              <th scope="col" style={HEAD_CELL}>
                Jahr · Label
              </th>
              <th scope="col" style={HEAD_CELL}>
                Zustand
              </th>
              <th scope="col" style={{ ...HEAD_CELL, textAlign: 'right' }}>
                EK / VK
              </th>
              <th scope="col" style={HEAD_CELL}>
                Status
              </th>
              <th scope="col" style={{ ...HEAD_CELL, padding: '12px 18px', textAlign: 'right' }}>
                Aktion
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const sellable = row.status === 'verfuegbar' || row.status === 'reserviert';
              const wishHref = `/wunschlisten?artist=${encodeURIComponent(row.artist)}&title=${encodeURIComponent(
                row.title,
              )}`;
              return (
                <tr
                  key={row.copyId}
                  style={{
                    borderTop: '1px solid var(--border)',
                    opacity: row.status === 'verkauft' ? 0.62 : undefined,
                  }}
                >
                  {/* Auswahl für Etikettendruck */}
                  <td style={{ padding: '13px 0 13px 18px' }}>
                    <Checkbox
                      checked={selectedIds.has(row.copyId)}
                      onChange={(checked) => toggleSelected(row.copyId, checked)}
                      ariaLabel={`„${row.title}" für Etikettendruck auswählen`}
                    />
                  </td>

                  {/* Artikel: 36×36 cover thumb + title + artist */}
                  <td style={{ padding: '13px 18px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      {/* Cover thumbnail — hatched placeholder (36×36, r-xs=6px) */}
                      <span
                        aria-hidden="true"
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 6,
                          flexShrink: 0,
                          background:
                            'repeating-linear-gradient(135deg,var(--surface-3) 0 5px,var(--surface-2) 5px 10px)',
                        }}
                      />
                      <span style={{ minWidth: 0 }}>
                        <strong style={{ fontWeight: 700 }}>{row.title}</strong>
                        <br />
                        <span style={{ color: 'var(--text-2)', fontSize: 13 }}>{row.artist}</span>
                      </span>
                    </div>
                  </td>

                  {/* Jahr · Label */}
                  <td
                    style={{
                      padding: '13px 12px',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '12.5px',
                      color: 'var(--text-2)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {[row.releaseYear, row.label.join('/')].filter(Boolean).join(' · ')}
                  </td>

                  {/* Zustand — ConditionPill on conditionRecord */}
                  <td style={{ padding: '13px 12px' }}>
                    {row.conditionRecord !== null && (
                      <ConditionPill condition={row.conditionRecord as Condition} />
                    )}
                  </td>

                  {/* EK / VK — right-aligned, mono */}
                  <td
                    style={{
                      padding: '13px 12px',
                      textAlign: 'right',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 13,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <span style={{ color: 'var(--text-3)' }}>{row.ek ?? '—'}</span>
                    {' · '}
                    <strong style={{ fontWeight: 700 }}>{row.vk ?? '—'}</strong>
                  </td>

                  {/* Status — StatusBadge (dot + label) */}
                  <td style={{ padding: '13px 12px' }}>
                    <StatusBadge status={row.status} />
                  </td>

                  {/* Aktion — Verkaufen + Reservieren/Storno + ♡ Auf Wunschliste */}
                  <td style={{ padding: '13px 18px' }}>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap' }}>
                      {row.status === 'verfuegbar' && (
                        <button
                          type="button"
                          data-testid="reserve-action"
                          onClick={() => onReserve(row.copyId)}
                          style={{
                            minHeight: 34,
                            padding: '0 12px',
                            border: '1.5px solid var(--border-strong)',
                            borderRadius: 'var(--r-pill)',
                            background: 'var(--surface)',
                            color: 'var(--text-2)',
                            fontFamily: 'var(--font-body)',
                            fontWeight: 600,
                            fontSize: '12.5px',
                            cursor: 'pointer',
                          }}
                        >
                          Reservieren
                        </button>
                      )}
                      {row.status === 'reserviert' && (
                        <button
                          type="button"
                          data-testid="reserve-cancel-action"
                          onClick={() => onCancelReservation(row.copyId)}
                          style={{
                            minHeight: 34,
                            padding: '0 12px',
                            border: '1.5px solid var(--border-strong)',
                            borderRadius: 'var(--r-pill)',
                            background: 'var(--surface)',
                            color: 'var(--text-2)',
                            fontFamily: 'var(--font-body)',
                            fontWeight: 600,
                            fontSize: '12.5px',
                            cursor: 'pointer',
                          }}
                        >
                          Reservierung aufheben
                        </button>
                      )}

                      {/* ♡ Auf Wunschliste — links to the prefilled wishlist form (T12) */}
                      <a
                        href={wishHref}
                        data-testid="add-to-wishlist"
                        aria-label={`„${row.title}" auf Wunschliste setzen`}
                        title="Auf Wunschliste"
                        style={{
                          minHeight: 34,
                          minWidth: 34,
                          display: 'inline-grid',
                          placeItems: 'center',
                          border: '1.5px solid var(--border-strong)',
                          borderRadius: '50%',
                          background: 'var(--surface)',
                          color: 'var(--accent)',
                          fontSize: 15,
                          textDecoration: 'none',
                          cursor: 'pointer',
                        }}
                      >
                        <span aria-hidden="true">♡</span>
                      </a>

                      <button
                        type="button"
                        disabled={!sellable}
                        onClick={() => sellable && setSellRow(row)}
                        style={{
                          minHeight: 34,
                          padding: '0 14px',
                          border: 'none',
                          borderRadius: 'var(--r-pill)',
                          background: sellable ? 'var(--accent)' : 'var(--surface-3)',
                          color: sellable ? 'var(--on-accent)' : 'var(--text-3)',
                          fontFamily: 'var(--font-body)',
                          fontWeight: sellable ? 700 : 600,
                          fontSize: '12.5px',
                          cursor: sellable ? 'pointer' : 'not-allowed',
                        }}
                      >
                        {row.status === 'verkauft' ? 'Verkauft' : 'Verkaufen'}
                      </button>
                    </div>
                    {rowErrors.has(row.copyId) && (
                      <p
                        role="alert"
                        style={{
                          margin: '4px 0 0',
                          fontSize: '11.5px',
                          color: 'var(--bad)',
                          textAlign: 'right',
                        }}
                      >
                        {rowErrors.get(row.copyId)}
                      </p>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer: n von total + mobile hint */}
      <div
        style={{
          padding: '13px 18px',
          borderTop: '1px solid var(--border)',
          fontSize: '12.5px',
          color: 'var(--text-3)',
          fontFamily: 'var(--font-mono)',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>
          {rows.length} von {total}
        </span>
        <span className="qr-desktop-only">↔ scrollt auf Mobile</span>
      </div>

      {sellRow && (
        <SellModal
          purchaseId={sellRow.copyId}
          title={sellRow.title}
          artist={sellRow.artist}
          targetPrice={sellRow.vk}
          onClose={() => setSellRow(null)}
        />
      )}

      <LabelPrintModal items={labelItems} open={printOpen} onClose={() => setPrintOpen(false)} />
    </div>
  );
}
