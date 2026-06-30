// src/app/(app)/ankauf/_components/ResultsGrid.tsx
// Grid of Discogs search results — wraps ResultCard in a responsive grid.
// The data-testid="discogs-results" wrapper is stable across empty + non-empty
// branches so the E2E contract testid is always present once a search has run.

import type { DiscogsSearchResult } from '@/lib/discogs/types';
import { ResultCard } from './ResultCard';

export interface ResultsGridProps {
  results: DiscogsSearchResult[];
  onAnkauf: (result: DiscogsSearchResult) => void;
  /** 'grid' = tile cards (default), 'list' = future list view (same grid for now) */
  view?: 'grid' | 'list';
}

export function ResultsGrid({ results, onAnkauf, view = 'grid' }: ResultsGridProps) {
  if (results.length === 0) {
    return (
      <div data-testid="discogs-results" style={{ marginTop: 16 }}>
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
          <div aria-hidden="true" style={{ fontSize: 30, marginBottom: 8 }}>
            ⌕
          </div>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: 16,
              color: 'var(--text-2)',
            }}
          >
            Keine Ergebnisse
          </div>
          <p
            style={{
              fontSize: '13.5px',
              lineHeight: 1.6,
              margin: '6px auto 0',
              maxWidth: '36ch',
            }}
          >
            Andere Schreibweise probieren oder Suchbegriff eingrenzen.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="discogs-results"
      style={{
        display: 'grid',
        gridTemplateColumns:
          view === 'grid'
            ? 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))'
            : '1fr',
        gap: 16,
        marginTop: 16,
      }}
    >
      {results.map((result) => (
        <ResultCard key={result.discogsId} result={result} onAnkauf={onAnkauf} />
      ))}
    </div>
  );
}
