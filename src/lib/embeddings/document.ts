export type EmbeddingDocSource = {
  artist: string;
  title: string;
  label: string[];
  genre: string[];
  format: string | null;
  releaseYear: number | null;
  country: string | null;
};

/**
 * Deterministisches Embedding-Dokument aus Release-Metadaten (Reihenfolge stabil, leere Felder aus).
 * KEINE PII/Preise (Global Constraint). Trenner ' — '.
 */
export function buildEmbeddingDocument(rec: EmbeddingDocSource): string {
  const parts: string[] = [
    rec.artist,
    rec.title,
    rec.label.join(', '),
    rec.genre.join(', '),
    rec.format ?? '',
    rec.releaseYear != null ? String(rec.releaseYear) : '',
    rec.country ?? '',
  ];
  return parts.map((p) => p.trim()).filter((p) => p.length > 0).join(' — ');
}
