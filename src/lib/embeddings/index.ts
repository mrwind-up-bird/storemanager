import 'server-only';
import { env } from '@/env';
import type { EmbeddingsAdapter } from './types';
import { createFakeEmbeddingsAdapter } from './fake';
import { createHttpEmbeddingsAdapter } from './http';

let cached: EmbeddingsAdapter | null = null;
export function getEmbeddingsAdapter(): EmbeddingsAdapter {
  if (cached) return cached;
  cached = env.EMBEDDINGS_DRIVER === 'http' ? createHttpEmbeddingsAdapter() : createFakeEmbeddingsAdapter();
  return cached;
}
