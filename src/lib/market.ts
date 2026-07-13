// src/lib/market.ts
// Derived Discogs market signals — demand level + rarity — computed PURELY from the
// community want/have counts the Discogs search already returns. No new API surface, no
// fabricated history (the Ankauf/Kachel designs' sparkline & static "RAR" had no data source;
// these two signals are the honest, backed subset). Pure + framework-free → usable from both
// client rows (Ankaufseite) and server components.

export type DemandLevel = 'hot' | 'high' | 'normal' | 'low' | 'unknown';

export interface MarketSignal {
  /** want / max(have, 1); null when the community block is missing entirely. */
  ratio: number | null;
  level: DemandLevel;
  /** German UI label for the demand chip. */
  label: string;
  /** Low supply relative to demand — the honest replacement for the design's static RAR badge. */
  rare: boolean;
}

const LABELS: Record<DemandLevel, string> = {
  hot: 'heiß begehrt',
  high: 'stark gefragt',
  normal: 'gefragt',
  low: 'ruhig',
  unknown: '—',
};

/**
 * want/have → demand bucket + rarity.
 *  - demand: ratio of collectors wanting vs. owning a release (Discogs community).
 *  - rare: few copies out there relative to demand (want ≥ 3× have and have ≤ 40), or a
 *    near-unowned release with real want. Deliberately conservative so the badge stays meaningful.
 */
export function marketSignal(
  community: { want: number; have: number } | null | undefined,
): MarketSignal {
  if (!community) return { ratio: null, level: 'unknown', label: LABELS.unknown, rare: false };

  const want = Math.max(0, Math.trunc(community.want));
  const have = Math.max(0, Math.trunc(community.have));

  if (want === 0 && have === 0) {
    return { ratio: null, level: 'unknown', label: LABELS.unknown, rare: false };
  }

  const ratio = want / Math.max(have, 1);

  let level: DemandLevel;
  if (ratio >= 2.5) level = 'hot';
  else if (ratio >= 1.2) level = 'high';
  else if (ratio >= 0.5) level = 'normal';
  else level = 'low';

  const rare = have === 0 ? want >= 5 : have <= 40 && want >= have * 3;

  return { ratio, level, label: LABELS[level], rare };
}
