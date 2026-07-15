'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { InventoryList } from './InventoryList';
import { InventoryTiles } from './InventoryTiles';
import { loadMoreInventory } from '../actions';
import type { InventoryRow } from '@/lib/inventory';

const VIEW_OPTIONS = [
  { value: 'list', label: '☰ Liste' },
  { value: 'tiles', label: '▦ Kacheln' },
];

export interface ViewToggleProps {
  rows: (InventoryRow & { score?: number })[];
  total: number;
  kiUnavailable?: boolean;
  initialCursor?: string | null;
}

export function ViewToggle({
  rows: initialRows,
  total,
  kiUnavailable,
  initialCursor = null,
}: ViewToggleProps) {
  const [view, setView] = useState<'list' | 'tiles'>('list');
  const searchParams = useSearchParams();
  const [extraRows, setExtraRows] = useState<(InventoryRow & { score?: number })[]>([]);
  const [prevInitial, setPrevInitial] = useState(initialRows);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // A fresh SSR payload (filter/status/search/mode change OR a revalidate/refresh after a
  // mutation like reserve/sell/cancel — see kasse/actions.ts revalidatePath('/inventar')) hands
  // us a new `initialRows` array identity. Detecting that during render (React's documented
  // "adjust state on prop change" pattern) resets the load-more accumulation so the fresh rows
  // are shown immediately, without relying on a remount key that would also wipe view/selection
  // state. Load-more itself only ever touches extraRows, so it never re-triggers this branch.
  if (prevInitial !== initialRows) {
    setPrevInitial(initialRows);
    setExtraRows([]);
    setCursor(initialCursor);
  }
  const rows = [...initialRows, ...extraRows];

  const onLoadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setLoadError(null);
    const result = await loadMoreInventory({ params: searchParams.toString(), cursor });
    if (result.ok) {
      setExtraRows((prev) => [...prev, ...result.rows]);
      setCursor(result.nextCursor);
    } else {
      setLoadError('Weitere Einträge konnten nicht geladen werden. Bitte erneut versuchen.');
    }
    setLoadingMore(false);
  };

  // KI-Suche (Slice 7): Embeddings-Adapter nicht konfiguriert/erreichbar — sauberer
  // Fehlerzustand statt leerem "Kein Treffer" (der falsch suggerieren würde, es gäbe keine Treffer).
  if (kiUnavailable) {
    return (
      <div
        style={{
          border: '1px dashed var(--border-strong)',
          borderRadius: 'var(--r-lg)',
          background: 'var(--surface)',
          padding: '48px 24px',
          textAlign: 'center',
          color: 'var(--text-3)',
        }}
      >
        <div aria-hidden="true" style={{ fontSize: 34, marginBottom: 8 }}>
          ⚠
        </div>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: 17,
            color: 'var(--text-2)',
          }}
        >
          KI-Suche momentan nicht verfügbar
        </div>
        <p
          style={{
            fontSize: '13.5px',
            lineHeight: 1.6,
            margin: '6px auto 16px',
            maxWidth: '38ch',
          }}
        >
          Bitte versuche es in Kürze erneut oder nutze die klassische Suche.
        </p>
        {/* Link löscht mode (+ alle anderen Params) — springt zurück in die klassische Suche */}
        <Link
          href="/inventar"
          className="focus-ring-button"
          style={{
            display: 'inline-block',
            minHeight: 40,
            padding: '0 18px',
            lineHeight: '40px',
            border: '1.5px solid var(--border-strong)',
            borderRadius: 'var(--r-pill)',
            background: 'var(--surface)',
            color: 'var(--text)',
            fontFamily: 'var(--font-body)',
            fontWeight: 600,
            fontSize: 13,
            textDecoration: 'none',
          }}
        >
          Zur klassischen Suche
        </Link>
      </div>
    );
  }

  // Empty state (verbatim from Q-Records App.dc.html lines 257-263)
  if (rows.length === 0) {
    return (
      <div
        style={{
          border: '1px dashed var(--border-strong)',
          borderRadius: 'var(--r-lg)',
          background: 'var(--surface)',
          padding: '48px 24px',
          textAlign: 'center',
          color: 'var(--text-3)',
        }}
      >
        <div aria-hidden="true" style={{ fontSize: 34, marginBottom: 8 }}>
          ⌕
        </div>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: 17,
            color: 'var(--text-2)',
          }}
        >
          Kein Treffer im Sortiment
        </div>
        <p
          style={{
            fontSize: '13.5px',
            lineHeight: 1.6,
            margin: '6px auto 16px',
            maxWidth: '38ch',
          }}
        >
          Andere Schreibweise probieren, Filter lockern — oder die Platte direkt
          über die Discogs-Suche ankaufen.
        </p>
        {/* Link clears all params — works as a plain anchor for the reset */}
        <Link
          href="/inventar"
          className="focus-ring-button"
          style={{
            display: 'inline-block',
            minHeight: 40,
            padding: '0 18px',
            lineHeight: '40px',
            border: '1.5px solid var(--border-strong)',
            borderRadius: 'var(--r-pill)',
            background: 'var(--surface)',
            color: 'var(--text)',
            fontFamily: 'var(--font-body)',
            fontWeight: 600,
            fontSize: 13,
            textDecoration: 'none',
          }}
        >
          Filter zurücksetzen
        </Link>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <SegmentedControl
          options={VIEW_OPTIONS}
          value={view}
          onChange={(v) => setView(v as 'list' | 'tiles')}
          aria-label="Ansicht wechseln"
        />
      </div>
      {view === 'list' ? (
        <InventoryList rows={rows} total={total} />
      ) : (
        <InventoryTiles rows={rows} />
      )}
      {cursor && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
            padding: '4px 0 8px',
          }}
        >
          {loadError && (
            <p role="alert" style={{ margin: 0, fontSize: '12.5px', color: 'var(--bad)' }}>
              {loadError}
            </p>
          )}
          <button
            type="button"
            data-testid="load-more"
            onClick={onLoadMore}
            disabled={loadingMore}
            className="focus-ring-button"
            style={{
              minHeight: 40,
              padding: '0 20px',
              border: '1.5px solid var(--border-strong)',
              borderRadius: 'var(--r-pill)',
              background: 'var(--surface)',
              color: 'var(--text)',
              fontFamily: 'var(--font-body)',
              fontWeight: 700,
              fontSize: 13,
              cursor: loadingMore ? 'progress' : 'pointer',
            }}
          >
            {loadingMore ? 'Lädt …' : 'Mehr laden'}
          </button>
        </div>
      )}
    </div>
  );
}
