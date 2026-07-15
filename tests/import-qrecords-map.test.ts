import { describe, expect, it } from 'vitest';
import {
  isMediaFormat,
  mapStatus,
  clampCondition,
  toDiscogsId,
  safeSchema,
} from '../scripts/import-qrecords-map';

describe('isMediaFormat', () => {
  it('lässt Medien-Formate durch', () => {
    for (const f of ['Vinyl', 'LP', 'CD', 'DVD', 'Blu-ray', 'Cassette', '7"', '12"', 'CD, Album']) {
      expect(isMediaFormat(f)).toBe(true);
    }
  });
  it('behandelt formatlose Records als Medium (Discogs-Katalog ohne Format)', () => {
    expect(isMediaFormat(null)).toBe(true);
    expect(isMediaFormat('')).toBe(true);
    expect(isMediaFormat('   ')).toBe(true);
  });
  it('schließt Nicht-Medien aus (Getränke/Merch)', () => {
    for (const f of ['Getränk', 'Kaffee', 'Coffee', 'T-Shirt', 'Poster', 'Sticker', 'Tote Bag']) {
      expect(isMediaFormat(f)).toBe(false);
    }
  });
});

describe('mapStatus', () => {
  it('sold_date gesetzt → verkauft', () => {
    expect(mapStatus(new Date('2020-01-01'))).toBe('verkauft');
    expect(mapStatus('2020-01-01')).toBe('verkauft');
  });
  it('kein sold_date, kein sold-Flag → verfuegbar', () => {
    expect(mapStatus(null)).toBe('verfuegbar');
    expect(mapStatus(undefined)).toBe('verfuegbar');
  });
  it('sold-Flag als Fallback (ohne sold_date) → verkauft', () => {
    expect(mapStatus(null, true)).toBe('verkauft');
  });
});

describe('clampCondition', () => {
  it('lässt 0–7 unverändert', () => {
    for (let i = 0; i <= 7; i++) expect(clampCondition(i)).toBe(i);
  });
  it('clamped außerhalb [0,7]', () => {
    expect(clampCondition(-3)).toBe(0);
    expect(clampCondition(8)).toBe(7);
    expect(clampCondition(99)).toBe(7);
  });
  it('null/NaN → null', () => {
    expect(clampCondition(null)).toBeNull();
    expect(clampCondition(undefined)).toBeNull();
    expect(clampCondition(NaN)).toBeNull();
  });
});

describe('toDiscogsId', () => {
  it('gültige int4-Werte 1:1 (auch aus String)', () => {
    expect(toDiscogsId(249504)).toBe(249504);
    expect(toDiscogsId('249504')).toBe(249504);
  });
  it('null bei bigint jenseits int4 (statt Overflow)', () => {
    expect(toDiscogsId(9_999_999_999)).toBeNull();
    expect(toDiscogsId(-5)).toBeNull();
  });
  it('null bei null/ungültig', () => {
    expect(toDiscogsId(null)).toBeNull();
    expect(toDiscogsId('nope')).toBeNull();
  });
});

describe('safeSchema', () => {
  it('akzeptiert gültige Identifier', () => {
    expect(safeSchema('public')).toBe('public');
    expect(safeSchema('v1_src')).toBe('v1_src');
  });
  it('wirft bei Injection-Versuchen', () => {
    expect(() => safeSchema('public; DROP TABLE records')).toThrow();
    expect(() => safeSchema('a b')).toThrow();
    expect(() => safeSchema('1abc')).toThrow();
  });
});
