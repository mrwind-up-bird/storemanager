import { describe, it, expect } from 'vitest';
import { createFakeDiscogsAdapter, FAKE_BARCODE_HIT } from '@/lib/discogs/fake';

const auth = { token: 't', tokenSecret: 's' };

describe('fake adapter searchByBarcode', () => {
  it('Treffer-EAN liefert exakt die 2 Fixtures (Kind of Blue + Abbey Road)', async () => {
    const results = await createFakeDiscogsAdapter().searchByBarcode(auth, FAKE_BARCODE_HIT);
    expect(results.map((r) => r.discogsId)).toEqual([11111, 22222]);
    expect(results[0]!.title).toBe('Kind of Blue');
  });

  it('Treffer ist trim-tolerant', async () => {
    const results = await createFakeDiscogsAdapter().searchByBarcode(auth, `  ${FAKE_BARCODE_HIT} `);
    expect(results).toHaveLength(2);
  });

  it('fremder EAN liefert []', async () => {
    const results = await createFakeDiscogsAdapter().searchByBarcode(auth, '0000000000000');
    expect(results).toEqual([]);
  });
});
