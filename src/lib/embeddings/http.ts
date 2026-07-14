import 'server-only';
import { env } from '@/env';
import { EmbeddingsConfigError, type EmbeddingsAdapter } from './types';

/** Vertragliche Vektor-Dimension (record_embeddings.embedding = vector(1536)). */
const EMBEDDING_DIM = 1536;
/** Harte Obergrenze pro Provider-Request. Ohne Timeout hängt ein toter/langsamer Provider
 *  die KI-Suche unbegrenzt; Abbruch → fetch rejectet → kiSearch degradiert zu "unavailable". */
const REQUEST_TIMEOUT_MS = 10_000;

/** OpenAI-kompatibler Embeddings-Endpoint. Config-Check bewusst bei First-Use, nicht beim Modul-Load. */
export function createHttpEmbeddingsAdapter(): EmbeddingsAdapter {
  return {
    model: env.EMBEDDINGS_MODEL,
    async embed(texts: string[]): Promise<number[][]> {
      if (!env.EMBEDDINGS_API_KEY) throw new EmbeddingsConfigError('EMBEDDINGS_API_KEY fehlt');
      const res = await fetch(`${env.EMBEDDINGS_API_URL}/embeddings`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${env.EMBEDDINGS_API_KEY}`,
        },
        body: JSON.stringify({ model: env.EMBEDDINGS_MODEL, input: texts }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        // Provider-Details NICHT durchreichen (Secrets/Leaks); nur Status.
        throw new EmbeddingsConfigError(`Embeddings-Provider antwortete ${res.status}`);
      }
      const json = (await res.json()) as { data?: { embedding: number[] }[] };
      if (!Array.isArray(json.data)) {
        // Malformed 200 (kein data-Array) → Config-Klasse statt roher TypeError am .map().
        throw new EmbeddingsConfigError('Embeddings-Provider lieferte kein data-Array');
      }
      const vectors = json.data.map((d) => d.embedding);
      // Vertrags-Check: exakt 1536 Dimensionen. Ein fehlkonfiguriertes Modell (z.B. -large ⇒ 3072)
      // schlüge sonst erst am ::vector(1536)-Cast in kiSearch als roher Postgres-500 durch.
      for (const v of vectors) {
        if (!Array.isArray(v) || v.length !== EMBEDDING_DIM) {
          throw new EmbeddingsConfigError(
            `Embeddings-Provider lieferte ${Array.isArray(v) ? v.length : 'kein'} statt ${EMBEDDING_DIM} Dimensionen`,
          );
        }
      }
      return vectors;
    },
  };
}
