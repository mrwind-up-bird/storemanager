/**
 * KI-Suche (Slice 7): Relevanz-Badge. Geteilt von InventoryList + InventoryTiles, damit die
 * Darstellung an genau einer Stelle lebt. Gerendert wo immer `row.score` gesetzt ist.
 */
export function ScoreBadge({ score }: { score: number }) {
  // score = 1 - cosineDistance ∈ [-1, 1]; bei negativer Korrelation < 0. Auf 0 clampen,
  // damit nie ein negatives Relevanz-Prozent ("-20 %") angezeigt wird.
  const pct = Math.round(Math.max(0, score) * 100);
  return (
    <span
      data-testid="ki-score"
      aria-label={`Relevanz: ${pct} Prozent`}
      style={{
        marginLeft: 8,
        padding: '1px 6px',
        borderRadius: 'var(--r-pill)',
        background: 'var(--accent-soft)',
        color: 'var(--accent-ink)',
        fontWeight: 600,
        fontSize: 12,
      }}
    >
      {pct}%
    </span>
  );
}
