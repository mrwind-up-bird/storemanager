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
  let adminUserId: number;

  beforeAll(async () => {
    db = await setupTestDatabase();
    ({ tenantId, adminUserId } = await seedTenant({ slug: 'demo', name: 'Q-Records Demo' }));

    owner = new Pool({ connectionString: db.ownerUrl, max: 2 });
    // v1-Quell-Fixture (nur die vom Import gelesenen Spalten).
    await owner.query(`CREATE SCHEMA v1src`);
    await owner.query(`CREATE TABLE v1src.records (
      id int PRIMARY KEY, title varchar, artist varchar, label text[], release_year int,
      genre text[], styles text[], tags text[], format varchar, country varchar,
      discogs_id bigint, cover_image varchar, notes text, price numeric(10,2), sold boolean,
      record_status varchar)`);
    await owner.query(`CREATE TABLE v1src.purchases (
      id int PRIMARY KEY, record_id int, purchase_price numeric(10,2), target_price numeric(10,2),
      sold_price numeric(10,2), sold_date timestamptz, payment_method varchar, purchase_date timestamptz)`);
    await owner.query(`CREATE TABLE v1src.conditions (
      id int PRIMARY KEY, record_id int, purchase_id int, condition_cover int, condition_record int)`);

    // #1 Medium verfügbar. #2 Medium verkauft + bigint-discogs_id (jenseits int4 → null).
    // #3 Getränk (format='Getränk') → ausgeschlossen. #4 Medium mit sold_price aber OHNE sold_date.
    await owner.query(`INSERT INTO v1src.records (id,title,artist,label,release_year,genre,format,country,discogs_id,price,sold,record_status) VALUES
      (1,'A Love Supreme','John Coltrane','{Impulse!}',1965,'{Jazz}','Vinyl','US',249504,25.00,false,'20'),
      (2,'Autobahn','Kraftwerk','{Philips}',1974,'{Electronic}','CD','DE',9999999999,20.00,true,'40'),
      (3,'Espresso','Hausbar',NULL,NULL,NULL,'Getränk',NULL,NULL,2.50,false,'20'),
      (4,'Kind of Blue','Miles Davis','{Columbia}',1959,'{Jazz}','Vinyl','US',12345,30.00,false,'30')`);
    await owner.query(`INSERT INTO v1src.purchases (id,record_id,purchase_price,target_price,sold_price,sold_date,payment_method,purchase_date) VALUES
      (10,1,8.00,25.00,NULL,NULL,'cash','2026-01-05'),
      (20,2,5.00,18.00,18.00,'2026-06-01','card','2026-02-01'),
      (30,3,0.50,2.50,2.50,'2026-03-01','cash','2026-03-01'),
      (40,4,12.00,30.00,30.00,NULL,'cash','2026-04-01')`);
    await owner.query(`INSERT INTO v1src.conditions (id,record_id,purchase_id,condition_cover,condition_record) VALUES
      (100,1,10,4,5),
      (200,2,20,6,7),
      (400,4,40,5,5)`);

    process.env.V1_SOURCE_DATABASE_URL = db.ownerUrl;
    process.env.V1_SOURCE_SCHEMA = 'v1src';
    process.env.DEMO_TENANT_SLUG = 'demo';
    delete process.env.IMPORT_DRY_RUN;
    delete process.env.IMPORT_CONFIRM_WIPE;

    vi.resetModules();
    ({ importQrecords } = await import('../scripts/import-qrecords'));
  }, 120_000);

  afterAll(async () => {
    for (const k of ['V1_SOURCE_DATABASE_URL', 'V1_SOURCE_SCHEMA', 'DEMO_TENANT_SLUG', 'IMPORT_DRY_RUN', 'IMPORT_CONFIRM_WIPE']) {
      delete process.env[k];
    }
    await owner.end().catch(() => undefined);
    await db.teardown();
  });

  it('DRY-RUN zählt, reportet Verteilungen und schreibt NICHTS', async () => {
    process.env.IMPORT_DRY_RUN = '1';
    const summary = await importQrecords();
    delete process.env.IMPORT_DRY_RUN;

    expect(summary.dryRun).toBe(true);
    expect(summary.recordsTotal).toBe(4);
    expect(summary.recordsImported).toBe(3); // #3 Getränk ausgeschlossen, 3 distinkte Medien
    expect(summary.recordsSkippedNonMedia).toBe(1);
    // Verifikations-Reports (Aletheia #1/#2):
    expect(summary.recordStatusSeen).toMatchObject({ '20': 2, '40': 1, '30': 1 });
    expect(summary.conditionRange).toMatchObject({ min: 4, max: 7 });
    // Nichts geschrieben:
    const { rows } = await owner.query(`SELECT count(*)::int AS n FROM records WHERE tenant_id = $1`, [tenantId]);
    expect(rows[0].n).toBe(0);
  });

  it('echter Lauf OHNE IMPORT_CONFIRM_WIPE bricht ab (kein versehentlicher Wipe)', async () => {
    delete process.env.IMPORT_CONFIRM_WIPE;
    await expect(importQrecords()).rejects.toThrow(/IMPORT_CONFIRM_WIPE/);
    const { rows } = await owner.query(`SELECT count(*)::int AS n FROM records WHERE tenant_id = $1`, [tenantId]);
    expect(rows[0].n).toBe(0); // nichts geschrieben
  });

  it('importiert nur Medien, mappt Status/Condition/Preise, überspringt Getränke', async () => {
    process.env.IMPORT_CONFIRM_WIPE = '1';
    const summary = await importQrecords();
    expect(summary).toMatchObject({ recordsImported: 3, recordsSkippedNonMedia: 1, copiesImported: 3, copiesSold: 1 });

    const recs = await owner.query(
      `SELECT title, discogs_id FROM records WHERE tenant_id = $1 ORDER BY title`,
      [tenantId],
    );
    expect(recs.rows.map((r) => r.title)).toEqual(['A Love Supreme', 'Autobahn', 'Kind of Blue']);
    // bigint discogs_id (9999999999) jenseits int4 → null, nicht Overflow
    expect(recs.rows.find((r) => r.title === 'Autobahn').discogs_id).toBeNull();

    // verfügbares Exemplar: Coltrane, condition 5/4, EK 8 / VK 25
    const cop = await owner.query(
      `SELECT p.status, p.condition_record, p.condition_cover, p.purchase_price, p.target_price
         FROM purchases p JOIN records r ON r.id = p.record_id WHERE r.tenant_id = $1 AND r.title = 'A Love Supreme'`,
      [tenantId],
    );
    expect(cop.rows[0]).toMatchObject({ status: 'verfuegbar', condition_record: 5, condition_cover: 4 });
    expect(Number(cop.rows[0].purchase_price)).toBe(8);
    expect(Number(cop.rows[0].target_price)).toBe(25);

    // verkauftes Exemplar: Kraftwerk, sold_price 18 + sold_date gesetzt
    const sold = await owner.query(
      `SELECT p.status, p.sold_price, p.sold_date FROM purchases p JOIN records r ON r.id = p.record_id
        WHERE r.tenant_id = $1 AND r.title = 'Autobahn'`,
      [tenantId],
    );
    expect(sold.rows[0].status).toBe('verkauft');
    expect(Number(sold.rows[0].sold_price)).toBe(18);
    expect(sold.rows[0].sold_date).not.toBeNull();

    // Aletheia #4: sold_price OHNE sold_date → verfuegbar UND sold_price genullt (kein Widerspruch)
    const miles = await owner.query(
      `SELECT p.status, p.sold_price, p.sold_date FROM purchases p JOIN records r ON r.id = p.record_id
        WHERE r.tenant_id = $1 AND r.title = 'Kind of Blue'`,
      [tenantId],
    );
    expect(miles.rows[0].status).toBe('verfuegbar');
    expect(miles.rows[0].sold_price).toBeNull();
    expect(miles.rows[0].sold_date).toBeNull();

    // Getränk NICHT importiert
    const bev = await owner.query(`SELECT count(*)::int AS n FROM records WHERE tenant_id = $1 AND title = 'Espresso'`, [tenantId]);
    expect(bev.rows[0].n).toBe(0);
  });

  it('Wipe löscht FK-Abhängige (wishlist_matches) und wirft KEIN 23503 beim Re-Run', async () => {
    process.env.IMPORT_CONFIRM_WIPE = '1';
    // Ein importiertes Exemplar + Record als Ziel für ein wishlist_match (FKt records UND purchases).
    const { rows: pr } = await owner.query(
      `SELECT p.id AS purchase_id, r.id AS record_id FROM purchases p JOIN records r ON r.id = p.record_id
        WHERE r.tenant_id = $1 LIMIT 1`,
      [tenantId],
    );
    const { purchase_id, record_id } = pr[0];
    const { rows: wl } = await owner.query(
      `INSERT INTO wishlists (tenant_id, created_by_user_id, customer_name, customer_email, artist)
       VALUES ($1,$2,'Kunde','k@example.test','Coltrane') RETURNING id`,
      [tenantId, adminUserId],
    );
    await owner.query(
      `INSERT INTO wishlist_matches (tenant_id, wishlist_id, purchase_id, record_id) VALUES ($1,$2,$3,$4)`,
      [tenantId, wl[0].id, purchase_id, record_id],
    );

    // Re-Run: ohne die FK-Abhängigen-Löschung würde DELETE FROM purchases/records mit 23503 scheitern.
    await expect(importQrecords()).resolves.toMatchObject({ recordsImported: 3 });

    const { rows: matchN } = await owner.query(`SELECT count(*)::int AS n FROM wishlist_matches WHERE tenant_id = $1`, [tenantId]);
    expect(matchN[0].n).toBe(0); // FK-Abhängige weggewiped
    const { rows: recN } = await owner.query(`SELECT count(*)::int AS n FROM records WHERE tenant_id = $1`, [tenantId]);
    expect(recN[0].n).toBe(3); // idempotent, keine Duplikate
  });
});
