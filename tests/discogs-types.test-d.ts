import { describe, it, expect } from 'vitest';
import type { DiscogsAdapter } from '@/lib/discogs/types';
import { DiscogsAuthError } from '@/lib/discogs/types';

describe('discogs types', () => {
  it('error classes are Error subclasses', () => {
    expect(new DiscogsAuthError('x')).toBeInstanceOf(Error);
  });
  it('adapter shape compiles', () => {
    const a: Pick<DiscogsAdapter, 'search'> = { search: async () => [] };
    expect(typeof a.search).toBe('function');
  });
});
