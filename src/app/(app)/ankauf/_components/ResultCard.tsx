// src/app/(app)/ankauf/_components/ResultCard.tsx
// Design-faithful Discogs search result card — mirrors the Slice-1 InventoryTile idiom.
// NO StatusBadge: Discogs results have no inventory status.
// Disc colour convention: CD → var(--info), everything else → var(--accent).

import { CoverPlaceholder } from '@/components/ui/CoverPlaceholder';
import type { DiscogsSearchResult } from '@/lib/discogs/types';

/** CD → var(--info), anything else (Vinyl, Kassette, …) → var(--accent) */
const discColor = (format: string | null) =>
  format === 'CD' ? 'var(--info)' : 'var(--accent)';

export interface ResultCardProps {
  result: DiscogsSearchResult;
  onAnkauf: (result: DiscogsSearchResult) => void;
}

export function ResultCard({ result, onAnkauf }: ResultCardProps) {
  const { title, artist, year, label, format, median, community } = result;

  return (
    <article
      data-testid="discogs-result-card"
      style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-lg)',
        background: 'var(--surface)',
        boxShadow: 'var(--shadow-1)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Card header: cover placeholder with format-coloured disc */}
      <CoverPlaceholder aspectRatio={1.9} labelColor={discColor(format)} />

      {/* Card body */}
      <div
        style={{
          padding: '14px 16px 16px',
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
        }}
      >
        {/* Title */}
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: '16.5px',
            lineHeight: 1.2,
            letterSpacing: '-.01em',
          }}
        >
          {title}
        </div>

        {/* Artist */}
        <div
          style={{
            fontSize: '13.5px',
            color: 'var(--text-2)',
            marginTop: 2,
          }}
        >
          {artist}
        </div>

        {/* Meta: Jahr · Label · Format (font-mono) */}
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '11.5px',
            color: 'var(--text-3)',
            marginTop: 8,
          }}
        >
          {[year, label.join('/'), format].filter(Boolean).join(' · ')}
        </div>

        {/* Median price + want/have (font-mono) */}
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
            color: 'var(--text-3)',
            marginTop: 6,
          }}
        >
          <span>
            Median{' '}
            <strong style={{ color: 'var(--text)', fontWeight: 700 }}>
              {median !== null ? `€ ${median.toFixed(2)}` : '—'}
            </strong>
          </span>
          <span
            style={{ margin: '0 6px', color: 'var(--border-strong)' }}
            aria-hidden="true"
          >
            ·
          </span>
          <span>
            ♡ {community.want} · ⬩ {community.have}
          </span>
        </div>

        {/* Actions row: Ankaufen + disabled wishlist */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            marginTop: 'auto',
            paddingTop: 14,
          }}
        >
          {/* Ankaufen — accent button */}
          <button
            type="button"
            data-testid="ankauf-open"
            onClick={() => onAnkauf(result)}
            className="focus-ring-button"
            style={{
              minHeight: 36,
              padding: '0 16px',
              border: 'none',
              borderRadius: 'var(--r-pill)',
              background: 'var(--accent)',
              color: 'var(--accent-ink)',
              fontFamily: 'var(--font-body)',
              fontWeight: 700,
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            Ankaufen
          </button>

          {/* Wishlist heart — disabled placeholder (future feature) */}
          <button
            type="button"
            disabled
            aria-disabled="true"
            aria-label="Merkliste (bald)"
            title="Merkliste (bald)"
            style={{
              width: 36,
              height: 36,
              border: 'none',
              borderRadius: 'var(--r-pill)',
              background: 'transparent',
              color: 'var(--text-3)',
              fontSize: 18,
              display: 'grid',
              placeItems: 'center',
              cursor: 'not-allowed',
              flexShrink: 0,
            }}
          >
            ♡
          </button>
        </div>
      </div>
    </article>
  );
}
