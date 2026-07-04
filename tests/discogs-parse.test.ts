import { describe, it, expect } from 'vitest';
import { parseDiscogsReleaseUrl } from '@/lib/discogs/parse';
import { discogsReleaseUrl } from '@/lib/labels';

describe('parseDiscogsReleaseUrl', () => {
  it.each([
    ['https://www.discogs.com/release/11111', 11111],
    ['https://discogs.com/release/22222', 22222],
    ['http://www.discogs.com/release/33333', 33333],
    ['https://www.discogs.com/release/249504-Rick-Astley-Never-Gonna-Give-You-Up', 249504],
    ['https://www.discogs.com/release/11111?ev=rr', 11111],
    ['https://www.discogs.com/release/11111#anchor', 11111],
    ['  https://www.discogs.com/release/11111  ', 11111],
  ])('parst %s → %d', (input, expected) => {
    expect(parseDiscogsReleaseUrl(input)).toBe(expected);
  });

  it('Roundtrip mit discogsReleaseUrl (Etiketten-QR, Slice 4)', () => {
    expect(parseDiscogsReleaseUrl(discogsReleaseUrl(12345))).toBe(12345);
  });

  it.each([
    'kein link',
    '4988031234567',
    '',
    'https://example.com/release/5',
    'https://www.discogs.com/master/1234',
    'https://www.discogs.com/release/',
    'https://www.discogs.com/release/0',
    'discogs.com/release/5',
  ])('lehnt %s ab (null)', (input) => {
    expect(parseDiscogsReleaseUrl(input)).toBeNull();
  });
});
