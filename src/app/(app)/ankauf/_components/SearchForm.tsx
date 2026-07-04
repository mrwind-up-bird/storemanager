'use client';

// src/app/(app)/ankauf/_components/SearchForm.tsx
// Client component: search input, barcode placeholder, results grid + view toggle.
// Calls searchDiscogs (Server Action) via useTransition.
// Modal mount point for Task 13: look for the {selected && …} comment block near the bottom.

import { useEffect, useRef, useState, useTransition } from 'react';
import { useSearchParams } from 'next/navigation';
import { ScanLine } from 'lucide-react';
import { SearchField } from '@/components/ui/SearchField';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { searchDiscogs, searchDiscogsByBarcode } from '../actions';
import { ScannerSheet } from '@/components/scanner/ScannerSheet';
import { ResultsGrid } from './ResultsGrid';
import { AnkaufModal } from './AnkaufModal';
import type { DiscogsSearchResult } from '@/lib/discogs/types';

const VIEW_OPTIONS = [
  { value: 'grid', label: '▦ Karten' },
  { value: 'list', label: '☰ Liste' },
];

export interface SearchFormProps {
  /** Always true when this component is rendered (page.tsx only renders SearchForm if conn exists). */
  connected: boolean;
  /** Discogs username of the connected account. */
  username: string | null;
}

type SearchState =
  | { status: 'idle' }
  | { status: 'results'; results: DiscogsSearchResult[] }
  | { status: 'error'; reason: 'not_connected' | 'auth' | 'validation' | 'error' };

const ERROR_MESSAGES: Record<'not_connected' | 'auth' | 'validation' | 'error', string> = {
  not_connected: 'Discogs nicht verbunden. Bitte verbinde zuerst dein Konto.',
  auth: 'Discogs-Verbindung abgelaufen. Bitte erneut verbinden.',
  validation: 'Ungültiger Barcode — 8 bis 14 Ziffern.',
  error: 'Fehler bei der Discogs-Suche. Bitte später erneut versuchen.',
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- always true when rendered; kept for future conditional logic (e.g. re-auth banners)
export function SearchForm({ connected: _connected, username }: SearchFormProps) {
  const [query, setQuery] = useState('');
  const [searchState, setSearchState] = useState<SearchState>({ status: 'idle' });
  const [view, setView] = useState<'grid' | 'list'>('grid');
  // Task 13: AnkaufModal will receive `selected` and a close handler.
  const [selected, setSelected] = useState<DiscogsSearchResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const [scannerOpen, setScannerOpen] = useState(false);
  const searchParams = useSearchParams();
  const bootBarcodeFired = useRef(false);

  const runBarcodeSearch = (ean: string) => {
    startTransition(async () => {
      const res = await searchDiscogsByBarcode(ean);
      if (res.ok) {
        setSearchState({ status: 'results', results: res.results });
      } else {
        setSearchState({ status: 'error', reason: res.reason });
      }
    });
  };

  // C12→C13: Quick-Action "Scannen" landet auf /ankauf?barcode=… → einmalig suchen.
  useEffect(() => {
    if (bootBarcodeFired.current) return;
    bootBarcodeFired.current = true;
    const b = searchParams.get('barcode');
    if (b) runBarcodeSearch(b);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;

    startTransition(async () => {
      const res = await searchDiscogs(q);
      if (res.ok) {
        setSearchState({ status: 'results', results: res.results });
      } else {
        setSearchState({ status: 'error', reason: res.reason });
      }
    });
  };

  const handleAnkauf = (result: DiscogsSearchResult) => {
    setSelected(result);
    // Task 13: AnkaufModal renders based on `selected` state below.
  };

  const hasResults =
    searchState.status === 'results' && searchState.results.length > 0;

  return (
    <div data-testid="discogs-search-form">
      {/* Connected indicator */}
      {username && (
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
            color: 'var(--text-3)',
            marginBottom: 12,
          }}
        >
          Verbunden als{' '}
          <strong style={{ color: 'var(--text-2)' }}>{username}</strong>
        </div>
      )}

      {/* Search form */}
      <form
        onSubmit={handleSubmit}
        style={{
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-lg)',
          background: 'var(--surface)',
          boxShadow: 'var(--shadow-1)',
          padding: '16px 18px',
        }}
      >
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Search field */}
          <div style={{ flex: 1, minWidth: 230 }}>
            <SearchField
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Auf Discogs suchen…"
              aria-label="Auf Discogs suchen"
            />
          </div>

          {/* Barcode scanner (Slice 5, C13) */}
          <button
            type="button"
            aria-label="Barcode scannen"
            onClick={() => setScannerOpen(true)}
            disabled={isPending}
            className="focus-ring-button"
            style={{
              flexShrink: 0,
              width: 'var(--tap)',
              height: 'var(--tap)',
              border: 'none',
              borderRadius: 'var(--r-md)',
              background: 'var(--surface-3)',
              color: isPending ? 'var(--text-3)' : 'var(--text-2)',
              display: 'grid',
              placeItems: 'center',
              cursor: isPending ? 'not-allowed' : 'pointer',
            }}
          >
            <ScanLine size={20} aria-hidden="true" />
          </button>

          {/* Submit */}
          <button
            type="submit"
            disabled={isPending || !query.trim()}
            className="focus-ring-button"
            style={{
              flexShrink: 0,
              minHeight: 'var(--tap)',
              padding: '0 20px',
              border: 'none',
              borderRadius: 'var(--r-pill)',
              background: isPending || !query.trim() ? 'var(--surface-3)' : 'var(--accent)',
              color: isPending || !query.trim() ? 'var(--text-3)' : 'var(--on-accent)',
              fontFamily: 'var(--font-body)',
              fontWeight: 700,
              fontSize: '13.5px',
              cursor: isPending || !query.trim() ? 'not-allowed' : 'pointer',
              transition: 'background var(--dur-1) var(--ease)',
            }}
          >
            {isPending ? 'Suche…' : 'Suchen'}
          </button>
        </div>
      </form>

      {/* Inline error message */}
      {searchState.status === 'error' && (
        <p
          role="alert"
          style={{
            marginTop: 12,
            padding: '10px 14px',
            borderRadius: 'var(--r-md)',
            background: 'var(--bad-soft)',
            color: 'var(--bad)',
            border: '1px solid color-mix(in srgb, var(--bad) 30%, transparent)',
            fontFamily: 'var(--font-body)',
            fontSize: '13.5px',
          }}
        >
          {ERROR_MESSAGES[searchState.reason]}
        </p>
      )}

      {/* Results: view toggle + grid */}
      {searchState.status === 'results' && (
        <>
          {hasResults && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                alignItems: 'center',
                marginTop: 16,
                gap: 12,
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12px',
                  color: 'var(--text-3)',
                }}
              >
                <strong style={{ color: 'var(--text)' }}>
                  {searchState.results.length}
                </strong>{' '}
                Treffer
              </span>
              <SegmentedControl
                options={VIEW_OPTIONS}
                value={view}
                onChange={(v) => setView(v as 'grid' | 'list')}
                aria-label="Ansicht wechseln"
              />
            </div>
          )}

          <ResultsGrid
            results={searchState.results}
            onAnkauf={handleAnkauf}
            view={view}
          />
        </>
      )}

      <ScannerSheet
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        mode="ean"
        onDetectEan={(ean) => {
          setScannerOpen(false);
          if (isPending) return;
          runBarcodeSearch(ean);
        }}
      />

      {/* ── Ankauf modal (Task 13) ───────────────────────────────────────── */}
      {selected && (
        <AnkaufModal result={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
