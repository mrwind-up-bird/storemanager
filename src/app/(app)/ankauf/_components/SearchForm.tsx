'use client';

// src/app/(app)/ankauf/_components/SearchForm.tsx
// Client component: search input, barcode placeholder, results grid + view toggle.
// Calls searchDiscogs (Server Action) via useTransition.
// Modal mount point for Task 13: look for the {selected && …} comment block near the bottom.

import { useState, useTransition } from 'react';
import { SearchField } from '@/components/ui/SearchField';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { searchDiscogs } from '../actions';
import { ResultsGrid } from './ResultsGrid';
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
  | { status: 'error'; reason: 'not_connected' | 'auth' | 'error' };

const ERROR_MESSAGES: Record<'not_connected' | 'auth' | 'error', string> = {
  not_connected: 'Discogs nicht verbunden. Bitte verbinde zuerst dein Konto.',
  auth: 'Discogs-Verbindung abgelaufen. Bitte erneut verbinden.',
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

          {/* Barcode scanner — disabled placeholder (future feature) */}
          <button
            type="button"
            aria-label="Barcode scannen (bald)"
            aria-disabled="true"
            disabled
            style={{
              flexShrink: 0,
              width: 'var(--tap)',
              height: 'var(--tap)',
              border: 'none',
              borderRadius: 'var(--r-md)',
              background: 'var(--surface-3)',
              color: 'var(--text-3)',
              fontSize: 21,
              display: 'grid',
              placeItems: 'center',
              cursor: 'not-allowed',
            }}
          >
            ▥
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

      {/* ── Task 13 modal mount point ─────────────────────────────────────────
       * When Task 13 implements AnkaufModal, replace this comment block with:
       *
       *   {selected && (
       *     <AnkaufModal
       *       release={selected}
       *       onClose={() => setSelected(null)}
       *     />
       *   )}
       *
       * `selected` holds the DiscogsSearchResult that the user clicked "Ankaufen" on.
       * Import AnkaufModal from './AnkaufModal'.
       * ─────────────────────────────────────────────────────────────────── */}
      {selected && (
        /* Task 13 placeholder — remove this div and add AnkaufModal import */
        <div
          role="dialog"
          aria-label="Ankaufen (wird implementiert)"
          data-testid="ankauf-modal-placeholder"
          style={{ display: 'none' }}
          data-selected-id={selected.discogsId}
        />
      )}
    </div>
  );
}
