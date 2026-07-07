import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { setupTestDatabase, seedTenant, type TestDatabase } from '../helpers/db';

// `@/lib/embeddings` transitively imports `@/env`, which parses process.env at module-load
// time — so, per the harness ordering contract (tests/helpers/db.ts), it must be imported
// dynamically AFTER setupTestDatabase() publishes env, never statically at file top-level.
describe('kiSearch', () => {
  let db: TestDatabase;
  let kiSearch: typeof import('@/lib/inventory')['kiSearch'];
  let buildEmbeddingDocument: typeof import('@/lib/embeddings/document')['buildEmbeddingDocument'];
  let getEmbeddingsAdapter: typeof import('@/lib/embeddings')['getEmbeddingsAdapter'];
  let tenantId: number;
  const coltrane = { artist: 'John Coltrane', title: 'A Love Supreme', label: ['Impulse!'], genre: ['Jazz'], format: 'Vinyl', releaseYear: 1965, country: 'US' };
  const kraftwerk = { artist: 'Kraftwerk', title: 'Autobahn', label: ['Philips'], genre: ['Electronic'], format: 'Vinyl', releaseYear: 1974, country: 'DE' };

  beforeAll(async () => {
    db = await setupTestDatabase();
    vi.resetModules();
    ({ buildEmbeddingDocument } = await import('@/lib/embeddings/document'));
    ({ getEmbeddingsAdapter } = await import('@/lib/embeddings'));
    ({ tenantId } = await seedTenant({ slug: 'ki', name: 'KI' }));
    // Plan mit kiSuche=true zuweisen (small) + zwei Records + Embeddings + je 1 verfügbare purchase.
    const owner = new Pool({ connectionString: db.ownerUrl, max: 1 });
    try {
      await owner.query(`UPDATE tenants SET plan = 'small' WHERE id = $1`, [tenantId]);
      for (const r of [coltrane, kraftwerk]) {
        const doc = buildEmbeddingDocument(r);
        const [vec] = await getEmbeddingsAdapter().embed([doc]);
        const { rows } = await owner.query(
          `INSERT INTO records (tenant_id, title, artist, label, genre, format, release_year, country, hash)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [tenantId, r.title, r.artist, r.label, r.genre, r.format, r.releaseYear, r.country, r.title],
        );
        const recordId = rows[0].id;
        await owner.query(
          `INSERT INTO record_embeddings (tenant_id, record_id, embedding, content_hash, model)
           VALUES ($1,$2,$3::vector(1536),$4,'fake-v1')`,
          [tenantId, recordId, `[${vec!.join(',')}]`, r.title],
        );
        await owner.query(
          `INSERT INTO purchases (tenant_id, record_id, status) VALUES ($1,$2,'verfuegbar')`,
          [tenantId, recordId],
        );
      }
    } finally {
      await owner.end();
    }
    kiSearch = (await import('@/lib/inventory')).kiSearch;
  }, 120_000);

  afterAll(async () => { await db.teardown(); });

  it('rangt den exakt passenden Record auf Platz 1 (score ≈ 1)', async () => {
    const { rows } = await kiSearch({ tenantId, userId: null }, { query: buildEmbeddingDocument(coltrane), filters: {} });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.artist).toBe('John Coltrane');
    expect(rows[0]!.score).toBeCloseTo(1, 4);
  });

  it('Facetten-Vorfilter schränkt hart ein (genre=Electronic → nur Kraftwerk)', async () => {
    const { rows } = await kiSearch({ tenantId, userId: null }, { query: buildEmbeddingDocument(coltrane), filters: { genre: 'Electronic' } });
    // Nicht-vakuos: exakt die eine Kraftwerk-Kopie muss durch den Facetten-Vorfilter kommen —
    // eine Regression, die alle Zeilen auf leer fallen ließe, würde .every() sonst still passieren.
    expect(rows).toHaveLength(1);
    expect(rows.every((r) => r.artist === 'Kraftwerk')).toBe(true);
  });

  it('leere Query → leeres Ergebnis ohne embed-Call', async () => {
    const { rows } = await kiSearch({ tenantId, userId: null }, { query: '   ', filters: {} });
    expect(rows).toHaveLength(0);
  });

  it('Gate: Free-Tenant (kiSuche=false) → leeres Ergebnis trotz vorhandenem Record+Embedding', async () => {
    const { tenantId: freeId } = await seedTenant({ slug: 'ki-free', name: 'KIF' });
    // Nicht-vakuos: freeId braucht einen echten Treffer, sonst liefert kiSearch auch OHNE
    // Gate ein leeres Ergebnis (weil freeId sonst 0 Records hat) und der Test wäre trivial grün.
    const owner = new Pool({ connectionString: db.ownerUrl, max: 1 });
    try {
      const doc = buildEmbeddingDocument(coltrane);
      const [vec] = await getEmbeddingsAdapter().embed([doc]);
      const { rows: recRows } = await owner.query(
        `INSERT INTO records (tenant_id, title, artist, label, genre, format, release_year, country, hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [freeId, coltrane.title, coltrane.artist, coltrane.label, coltrane.genre, coltrane.format, coltrane.releaseYear, coltrane.country, `${coltrane.title}-free`],
      );
      const recordId = recRows[0].id;
      await owner.query(
        `INSERT INTO record_embeddings (tenant_id, record_id, embedding, content_hash, model)
         VALUES ($1,$2,$3::vector(1536),$4,'fake-v1')`,
        [freeId, recordId, `[${vec!.join(',')}]`, coltrane.title],
      );
      await owner.query(
        `INSERT INTO purchases (tenant_id, record_id, status) VALUES ($1,$2,'verfuegbar')`,
        [freeId, recordId],
      );
    } finally {
      await owner.end();
    }

    const { rows } = await kiSearch({ tenantId: freeId, userId: null }, { query: buildEmbeddingDocument(coltrane), filters: {} });
    expect(rows).toHaveLength(0);
  });

  it('Regression: q darf im KI-Modus NICHT als harter ILIKE-Vorfilter auf die Query selbst wirken', async () => {
    // Spiegelt, wie die Seite q sowohl in query ALS AUCH in filters.q einträgt. Ein
    // frei erfundener Vibe-Text matcht garantiert keinen Titel/Artist/Label per ILIKE —
    // ohne den Fix würde basePreds(filters) diesen q-Substring-Predicate anwenden und
    // alle semantisch passenden Treffer wegfiltern → 0 rows trotz vorhandener Embeddings.
    const vibe = 'komplett fiktiver vibe text';
    const { rows } = await kiSearch({ tenantId, userId: null }, { query: vibe, filters: { q: vibe } });
    expect(rows.length).toBeGreaterThan(0);
  });
});
