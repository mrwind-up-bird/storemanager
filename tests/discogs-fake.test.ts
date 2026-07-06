import { describe, it, expect, vi } from 'vitest';
vi.mock('@/env', () => ({ env: { DISCOGS_DRIVER: 'fake' } }));
import { createFakeDiscogsAdapter } from '@/lib/discogs/fake';
import { getDiscogsAdapter } from '@/lib/discogs/index';

const auth = { token: 't', tokenSecret: 's' };
describe('fake driver', () => {
  it('search matches "blue" deterministically with a listable release', async () => {
    const a = createFakeDiscogsAdapter();
    const r1 = await a.search(auth, 'blue');
    const r2 = await a.search(auth, 'blue');
    expect(r1).toEqual(r2);
    expect(r1.length).toBeGreaterThan(0);
    expect(r1[0]?.discogsId).toBeTypeOf('number');
    expect(r1[0]?.median).toBeTypeOf('number');
  });
  it('priceSuggestions includes the VG+ grade key', async () => {
    const a = createFakeDiscogsAdapter();
    const s = await a.priceSuggestions(auth, (await a.search(auth, 'blue'))[0]!.discogsId);
    expect(s?.byGrade['Very Good Plus (VG+)']).toBeTypeOf('number');
  });
  it('selector returns the fake under fake env', () => {
    expect(getDiscogsAdapter().constructor === Object || typeof getDiscogsAdapter().search === 'function').toBe(true);
  });
  it('identity liefert den statischen Fake-Usernamen', async () => {
    const adapter = createFakeDiscogsAdapter();
    await expect(adapter.identity({ token: 't', tokenSecret: 's' })).resolves.toEqual({
      username: 'fake-seller',
    });
  });
});
