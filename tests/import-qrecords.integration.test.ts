import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { setupTestDatabase, seedTenant, type TestDatabase } from './helpers/db';

// Import-ETL end-to-end gegen eine v1-Fixture im selben Container (Schema `v1src`, damit die
// v1-Tabellennamen records/purchases NICHT mit den v2-Tabellen in public kollidieren).
// @/... wird dynamisch NACH setupTestDatabase importiert (Harness-Ordering-Contract, s. helpers/db).
describe('importQrecords', () => {
  let db: TestDatabase;
  let importQrecords: typeof import('../scripts/import-qrecords')['importQrecords'];
  let owner: Pool;
  let tenantId: number;

  beforeAll(async () => {
    db = await setupTestDatabase();
    ({ tenantId } = await seedTenant({ slug: 'demo', name: 'Demo' }));

    owner = new Pool({ connectionString: db.ownerUrl, max: 2 });
    // v1-Quell-Fixture (nur die vom Import gelesenen Spalten).
    await owner.query(`CREATE SCHEMA v1src`);
    await owner.query(`CREATE TABLE v1src.records (
      id int PRIMARY KEY, title varchar, artist varchar, label text[], release_year int,
      genre text[], styles text[], tags text[], format varchar, country varchar,
      discogs_id bigint, cover_image varchar, notes text, price numeric(10,2), sold boolean)`);
    await owner.query(`CREATE TABLE v1src.purchases (
      id int PRIMARY KEY, record_id int, purchase_price numeric(10,2), target_price numeric(10,2),
      sold_price numeric(10,2), sold_date timestamptz, payment_method varchar, purchase_date timestamptz)`);
    await owner.query(`CREATE TABLE v1src.conditions (
      id int PRIMARY KEY, record_id int, purchase_id int, condition_cover int, condition_record int)`);

    // #1 Medium, verfügbar. #2 Medium, verkauft + bigint-discogs_id (jenseits int4 → null).
    // #3 Getränk (format='Getränk') → muss ausgeschlossen werden.
    await owner.query(`INSERT INTO v1src.records (id,title,artist,label,release_year,genre,format,country,discogs_id,price,sold) VALUES
      (1,'A Love Supreme','John Coltrane','{Impulse!}',1965,'{Jazz}','Vinyl','US',249504,25.00,false),
      (2,'Autobahn','Kraftwerk','{Philips}',1974,'{Electronic}','CD','DE',9999999999,20.00,true),
      (3,'Espresso','Hausbar',NULL,NULL,NULL,'Getränk',NULL,NULL,2.50,false)`);
    await owner.query(`INSERT INTO v1src.purchases (id,record_id,purchase_price,target_price,sold_price,sold_date,payment_method,purchase_date) VALUES
      (10,1,8.00,25.00,NULL,NULL,'cash','2026-01-05'),
      (20,2,5.00,18.00,18.00,'2026-06-01','card','2026-02-01'),
      (30,3,0.50,2.50,2.50,'2026-03-01','cash','2026-03-01')`);
    await owner.query(`INSERT INTO v1src.conditions (id,record_id,purchase_id,condition_cover,condition_record) VALUES
      (100,1,10,4,5),
      (200,2,20,6,7)`);

    process.env.V1_SOURCE_DATABASE_URL = db.ownerUrl;
    process.env.V1_SOURCE_SCHEMA = 'v1src';
    process.env.DEMO_TENANT_SLUG = 'demo';

    vi.resetModules();
    ({ importQrecords } = await import('../scripts/import-qrecords'));
  }, 120_000);

  afterAll(async () => {
    delete process.env.V1_SOURCE_DATABASE_URL;
    delete process.env.V1_SOURCE_SCHEMA;
    delete process.env.DEMO_TENANT_SLUG;
    delete process.env.IMPORT_DRY_RUN;
    await owner.end().catch(() => undefined);
    await db.teardown();
  });

  it('DRY-RUN zählt korrekt und schreibt NICHTS', async () => {
    process.env.IMPORT_DRY_RUN = '1';
    const summary = await importQrecords();
    delete process.env.IMPORT_DRY_RUN;

    expect(summary.dryRun).toBe(true);
    expect(summary.recordsTotal).toBe(3);
    expect(summary.recordsImported).toBe(2); // #3 Getränk ausgeschlossen
    expect(summary.recordsSkippedNonMedia).toBe(1);
    // Nichts geschrieben:
    const { rows } = await owner.query(`SELECT count(*)::int AS n FROM records WHERE tenant_id = $1`, [tenantId]);
    expect(rows[0].n).toBe(0);
  });

  it('importiert nur Medien, mappt Status/Condition/Preise, überspringt Getränke', async () => {
    const summary = await importQrecords();
    expect(summary).toMatchObject({ recordsImported: 2, recordsSkippedNonMedia: 1, copiesImported: 2, copiesSold: 1 });

    const recs = await owner.query(
      `SELECT title, artist, discogs_id, genre, format FROM records WHERE tenant_id = $1 ORDER BY title`,
      [tenantId],
    );
    expect(recs.rows.map((r) => r.title)).toEqual(['A Love Supreme', 'Autobahn']);
    // bigint discogs_id (9999999999) jenseits int4 → null, nicht Overflow
    const autobahn = recs.rows.find((r) => r.title === 'Autobahn');
    expect(autobahn.discogs_id).toBeNull();

    // verfügbares Exemplar: Coltrane, condition 5/4, EK 8 / VK 25
    const cop = await owner.query(
      `SELECT p.status, p.condition_record, p.condition_cover, p.purchase_price, p.target_price, p.sold_price, p.sold_date
         FROM purchases p JOIN records r ON r.id = p.record_id
        WHERE r.tenant_id = $1 AND r.title = 'A Love Supreme'`,
      [tenantId],
    );
    expect(cop.rows[0]).toMatchObject({ status: 'verfuegbar', condition_record: 5, condition_cover: 4 });
    expect(Number(cop.rows[0].purchase_price)).toBe(8);
    expect(Number(cop.rows[0].target_price)).toBe(25);

    // verkauftes Exemplar: Kraftwerk, sold_price 18 + sold_date gesetzt, condition 7/6
    const sold = await owner.query(
      `SELECT p.status, p.condition_record, p.condition_cover, p.sold_price, p.sold_date
         FROM purchases p JOIN records r ON r.id = p.record_id
        WHERE r.tenant_id = $1 AND r.title = 'Autobahn'`,
      [tenantId],
    );
    expect(sold.rows[0].status).toBe('verkauft');
    expect(Number(sold.rows[0].sold_price)).toBe(18);
    expect(sold.rows[0].sold_date).not.toBeNull();
    expect(sold.rows[0].condition_record).toBe(7);

    // Getränk NICHT importiert
    const bev = await owner.query(`SELECT count(*)::int AS n FROM records WHERE tenant_id = $1 AND title = 'Espresso'`, [tenantId]);
    expect(bev.rows[0].n).toBe(0);
  });

  it('ist idempotent (Wipe & reload) — zweiter Lauf ergibt dieselben Zahlen, keine Duplikate', async () => {
    await importQrecords();
    const { rows } = await owner.query(`SELECT count(*)::int AS n FROM records WHERE tenant_id = $1`, [tenantId]);
    expect(rows[0].n).toBe(2); // kein Duplikat trotz zweitem Lauf
  });
});
