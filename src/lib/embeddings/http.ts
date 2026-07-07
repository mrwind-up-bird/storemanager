import 'server-only';
import { env } from '@/env';
import { EmbeddingsConfigError, type EmbeddingsAdapter } from './types';

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
      });
      if (!res.ok) {
        // Provider-Details NICHT durchreichen (Secrets/Leaks); nur Status.
        throw new EmbeddingsConfigError(`Embeddings-Provider antwortete ${res.status}`);
      }
      const json = (await res.json()) as { data: { embedding: number[] }[] };
      return json.data.map((d) => d.embedding);
    },
  };
}
