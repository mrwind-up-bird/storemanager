import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { recordHash } from '@/db/hash';

/** Reference implementation used only inside this test to build expected values. */
function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

describe('recordHash', () => {
  it('returns a 64-character lowercase hex string', () => {
    const h = recordHash({ title: 'Blue Lines', artist: 'Massive Attack' });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable — identical inputs produce identical output', () => {
    const input = {
      title: 'Blue Lines',
      artist: 'Massive Attack',
      country: 'UK',
      year: 1991,
      label: ['Wild Bunch Records'],
    };
    expect(recordHash(input)).toBe(recordHash(input));
  });

  it('is case-insensitive for all string fields', () => {
    expect(
      recordHash({ title: 'Blue Lines', artist: 'Massive Attack', country: 'UK' }),
    ).toBe(
      recordHash({ title: 'BLUE LINES', artist: 'MASSIVE ATTACK', country: 'uk' }),
    );
  });

  it('trims leading and trailing whitespace before hashing', () => {
    expect(
      recordHash({ title: '  Blue Lines  ', artist: '  Massive Attack  ' }),
    ).toBe(
      recordHash({ title: 'Blue Lines', artist: 'Massive Attack' }),
    );
  });

  it('treats null country as empty string (same as undefined)', () => {
    expect(recordHash({ title: 'T', artist: 'A', country: null })).toBe(
      recordHash({ title: 'T', artist: 'A', country: undefined }),
    );
  });

  it('treats null year as empty string (same as undefined)', () => {
    expect(recordHash({ title: 'T', artist: 'A', year: null })).toBe(
      recordHash({ title: 'T', artist: 'A', year: undefined }),
    );
  });

  it('treats empty label array identically to undefined label', () => {
    expect(recordHash({ title: 'T', artist: 'A', label: [] })).toBe(
      recordHash({ title: 'T', artist: 'A', label: undefined }),
    );
  });

  it('matches the known canonical vector (documents exact field order)', () => {
    // Canonical join order: artist | title | country | year | labels-joined-by-comma
    // All values are trimmed and lowercased before joining.
    const canonical = 'massive attack|blue lines|uk|1991|wild bunch records';
    expect(
      recordHash({
        title: 'Blue Lines',
        artist: 'Massive Attack',
        country: 'UK',
        year: 1991,
        label: ['Wild Bunch Records'],
      }),
    ).toBe(sha256(canonical));
  });

  it('produces distinct hashes for distinct title+artist pairs', () => {
    expect(
      recordHash({ title: 'Blue Lines', artist: 'Massive Attack' }),
    ).not.toBe(
      recordHash({ title: 'Protection', artist: 'Massive Attack' }),
    );
  });

  it('includes label in the hash — different labels produce different hashes', () => {
    expect(
      recordHash({ title: 'T', artist: 'A', label: ['Warp'] }),
    ).not.toBe(
      recordHash({ title: 'T', artist: 'A', label: ['Ninja Tune'] }),
    );
  });
});
