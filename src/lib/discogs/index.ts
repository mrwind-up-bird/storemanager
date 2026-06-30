import 'server-only';
import { env } from '@/env';
import type { DiscogsAdapter } from './types';
import { createHttpDiscogsAdapter } from './client';
import { createFakeDiscogsAdapter } from './fake';

let cached: DiscogsAdapter | null = null;
export function getDiscogsAdapter(): DiscogsAdapter {
  if (cached) return cached;
  cached = env.DISCOGS_DRIVER === 'fake' ? createFakeDiscogsAdapter() : createHttpDiscogsAdapter();
  return cached;
}
