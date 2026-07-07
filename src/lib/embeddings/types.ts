export interface EmbeddingsAdapter {
  /** Je Text ein 1536-dim Vektor, Reihenfolge-stabil zum Input. */
  embed(texts: string[]): Promise<number[][]>;
  /** Fürs `model`-Feld der Zeile + Drift-Erkennung. */
  readonly model: string;
}

/** Konfigurations-/Provider-Fehler (fehlender Key etc.) — 500er-Klasse, kein User-Fehler. */
export class EmbeddingsConfigError extends Error {}
