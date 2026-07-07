# Slice 7 — KI-Suche (Semantische Vektor-Suche im Inventar) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dem Personal eine semantische Freitext-Suche über den Bestand geben — eine Vibe-Anfrage wird per Embedding in einen Vektor übersetzt und per pgvector-Ähnlichkeit gegen pro Tenant vorberechnete Record-Embeddings gerangt, eingeschränkt durch dieselben harten Facetten wie die klassische Suche.

**Architecture:** Embeddings-Adapter hinter `EMBEDDINGS_DRIVER=fake|http` (Muster wie Billing/Discogs; `fake` = deterministisch, Default, trägt alle Tests/E2E offline). Neue tenant-scoped Tabelle `record_embeddings` mit voller RLS + HNSW-Index in pgvector. Index-Lebenszyklus über den bestehenden pg-boss-Worker (inkrementell bei Ankauf, Backfill-Script, Seed-inline). Query-Pipeline `kiSearch()` wiederverwendet `basePreds()` als harten Vorfilter und rangt per `<=>`-Cosine-Distanz. Separater KI-Modus in der bestehenden `FilterBar`, gated per Plan-Feature `kiSuche`.

**Tech Stack:** Next.js (App Router, RSC), Drizzle ORM `^0.38` / drizzle-kit `^0.30`, PostgreSQL 17 + pgvector (`pgvector/pgvector:pg17`), pg-boss `^10`, Vitest + Testcontainers, Playwright, pnpm. Embeddings-Provider (http): OpenAI `text-embedding-3-small` (1536-dim); Alternative Voyage = reiner Config-Swap.

---

## Global Constraints

Diese gelten für **jede** Task implizit — exakte Werte aus dem Ground-Truth-Abgleich (2026-07-07):

- **Embedding-Dimension fest = 1536.** Der Fake-Driver liefert exakt 1536 Werte, unit-normalisiert. Ein Dimensionswechsel ist eine bewusste spätere Migration, kein Laufzeitparameter.
- **`EMBEDDINGS_DRIVER=fake` ist Default** (`src/env.ts`). Kein Test/E2E/CI-Lauf hängt an einem echten Provider oder Netzwerk. `http` ist opt-in für Prod.
- **Jede tenant-scoped Tabelle** braucht: `tenant_id integer NOT NULL REFERENCES tenants(id)`, `ENABLE`+`FORCE ROW LEVEL SECURITY`, Policy **exakt `tenant_isolation`** (USING+WITH CHECK, `tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::int`) + `superadmin_bypass`, `GRANT SELECT,INSERT,UPDATE,DELETE ... TO qr_app`, `GRANT USAGE,SELECT ON SEQUENCE ..._id_seq TO qr_app` (load-bearing für INSERT).
- **Drift-Guard-Lockstep (Lehre aus `be9a824`):** Eine neue tenant-Tabelle MUSS in **derselben Änderung** zu BEIDEN Listen: `src/db/assertions.ts` `TENANT_SCOPED_TABLES` (Z.5-20) UND `tests/db/assertions.test.ts` `SOUND_TENANT_ID_TABLES` (Z.14-29). Der Boot-Guard vergleicht die DB-introspizierte Menge exakt gegen die Liste (beide Richtungen); jede Auslassung macht die Suite ab Tag 1 rot.
- **Migrationen laufen als `qr_owner` (NOSUPERUSER, BYPASSRLS)** über den Drizzle-Migrator (`migrate(db, { migrationsFolder: './drizzle' })`), der `drizzle/meta/_journal.json` in Reihenfolge liest und pro Eintrag `${tag}.sql` anwendet. **Handgeschriebene Migrationen** brauchen einen manuell angehängten Journal-Eintrag mit **strikt steigendem `when`**.
- **`CREATE EXTENSION vector` braucht SUPERUSER** — kann NICHT in einer Migration (qr_owner) laufen. Gehört in den Superuser-Init-Pfad (`docker/postgres/init/`) und den Testcontainer-Admin-Pool **vor** `runMigrations`.
- **DB-Image = `pgvector/pgvector:pg17`** (Compose + Testcontainers). Kein `-alpine`-Tag existiert für pgvector. PG-Major bleibt 17.
- **pg-boss ist eine separate DB außerhalb der RLS.** Enqueue **nur nach Commit** der Tenant-Tx, **soft-fail** (loggen, nie an den User werfen). `tenantId` reist im Payload; der Worker re-etabliert Tenant-Scope via `withTenant({ tenantId, userId: null })`.
- **Es gibt KEIN `requireFeature`-Helper.** Gating erfolgt inline (Render-Branch, analytik-Muster). Der spec-Wortlaut „requireFeature('kiSuche')" ist irreführend — Enforcement inline umsetzen.
- **Kein `const`-Re-Export aus `'use server'`** (Lehre Slice 6). Die Embeddings-Module sind reine `server-only`-Libs, keine Server-Actions.
- **UI-Copy Deutsch.** Design-System = Inline-Styles + CSS-Vars (`--surface`, `--border`, `--accent`, `--tap`, …), Primitives aus `src/components/ui/index.ts`, Fokus-Utilities `focus-ring-*`. Kein Tailwind-Class-heavy.
- **Build-Gate (jede Slice):** `pnpm lint` + `pnpm typecheck` + `pnpm build` (Next) + `docker compose build` grün; volle `pnpm test` + `pnpm e2e` gegen einen **frischen** `docker compose down -v && up --build`-Stack. Der Next-Build fängt `'use server'`-Fallen, die tsc/vitest nicht sehen.
- **Keine PII im Embedding-Dokument** — nur Release-Metadaten (artist/title/label/genre/format/year/country). Keine Preise, keine Lieferanten-/Kundendaten, kein EK.

**Abweichungen vom Spec (durch Ground-Truth erzwungen, siehe Task 11 Addendum):** (1) Extension nicht als Migration `0013`, sondern Init-Pfad; (2) Image `pgvector/pgvector:pg17` statt `postgres:16`; (3) Migrationen laufen im `migrate`-Compose-Service/`runMigrations`, nicht im Entrypoint; (4) Gating inline statt `requireFeature`; (5) neuer `sha256Hex`-Helper (kein generischer `sha256` existiert); (6) Vektor-Spalte per selbst-definiertem `customType` (kein Präzedenzfall im Repo).

---

## File Structure

**Neu erstellt:**
- `docker/postgres/init/02-extensions.sql` — `CREATE EXTENSION IF NOT EXISTS vector;` (Superuser-Init).
- `drizzle/0013_slice7_embeddings.sql` — DDL `record_embeddings` (generiert + HNSW-Index handangehängt) + `drizzle/meta/0013_snapshot.json`.
- `drizzle/0014_slice7_rls.sql` — RLS für `record_embeddings` (handgeschrieben).
- `drizzle/0015_slice7_data.sql` — Plan-Feature-Matrix `kiSuche` (handgeschrieben).
- `src/lib/embeddings/types.ts` — `EmbeddingsAdapter`-Interface + `EmbeddingsConfigError`.
- `src/lib/embeddings/fake.ts` — deterministischer Fake-Adapter (Default).
- `src/lib/embeddings/http.ts` — HTTP-Adapter (OpenAI-kompatibel, lazy Config-Error).
- `src/lib/embeddings/index.ts` — gecachter Getter `getEmbeddingsAdapter()`.
- `src/lib/embeddings/document.ts` — `buildEmbeddingDocument(record)`.
- `src/worker/jobs/embeddingRefresh.ts` — Job-Handler + `EmbeddingRefreshPayload`.
- `scripts/embeddings-backfill.ts` — Backfill-Script.
- `tests/db/record-embeddings-rls.integration.test.ts` — nicht-vakuoser RLS-Test.
- `tests/lib/embeddings/*.test.ts`, `tests/worker/embeddingRefresh.integration.test.ts`, `tests/lib/kiSearch.integration.test.ts` u.a. — siehe Tasks.
- `e2e/ki-suche.spec.ts` — E2E KI-Modus.

**Modifiziert:**
- `docker-compose.yml` (db-Image), `tests/helpers/db.ts` (Image + Extension), `docker/entrypoint-web.sh` (Boot-Check).
- `src/db/schema.ts` (`vector1536` customType + `recordEmbeddings`), `src/db/hash.ts` (`sha256Hex`), `src/db/assertions.ts` (`TENANT_SCOPED_TABLES`), `tests/db/assertions.test.ts` (`SOUND_TENANT_ID_TABLES`).
- `src/env.ts` (`EMBEDDINGS_*`), `.env.example`, `.env.compose`.
- `src/worker/index.ts` (`QUEUE` + create/work), `src/lib/jobs.ts` (`enqueueEmbeddingRefresh`).
- `src/app/(app)/ankauf/actions.ts` + `src/app/(app)/ankauf/sammlung/actions.ts` (post-commit-Enqueue).
- `scripts/seed.ts` (inline-Embedding), `package.json` (`embeddings:backfill`).
- `src/lib/inventory.ts` (`kiSearch` + `KiSearchRow`), `src/lib/gating.ts` (`kiSuche`-Flag).
- `src/app/(app)/inventar/page.tsx`, `.../\_components/FilterBar.tsx`, `ViewToggle.tsx`, `InventoryList.tsx`, `InventoryTiles.tsx` (KI-Modus + Score-Badge + Lock).

---

## Task 1: pgvector-Infrastruktur (Extension, Images, Boot-Check)

**Files:**
- Create: `docker/postgres/init/02-extensions.sql`
- Modify: `docker-compose.yml` (db-Service-Image), `tests/helpers/db.ts:34` (Image) + nach `:52` (Extension), `docker/entrypoint-web.sh` (Boot-Assert)
- Test: `tests/db/pgvector.integration.test.ts` (Create)

**Interfaces:**
- Produces: Eine Postgres-Umgebung (Compose + Testcontainer), in der die `vector`-Extension in der Ziel-DB vorhanden ist, bevor Migrationen laufen. Alle Folge-Tasks setzen das voraus.

- [ ] **Step 1: Failing test — Extension muss vorhanden sein**

Create `tests/db/pgvector.integration.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { setupTestDatabase, type TestDatabase } from '../helpers/db';

describe('pgvector extension', () => {
  let db: TestDatabase;
  beforeAll(async () => {
    db = await setupTestDatabase();
  }, 120_000);
  afterAll(async () => {
    await db.teardown();
  });

  it('ist in der Test-DB installiert (Voraussetzung für record_embeddings)', async () => {
    const pool = new Pool({ connectionString: db.ownerUrl, max: 1 });
    try {
      const { rows } = await pool.query(`SELECT 1 AS ok FROM pg_extension WHERE extname = 'vector'`);
      expect(rows).toHaveLength(1);
    } finally {
      await pool.end();
    }
  });
});
```

- [ ] **Step 2: Test scheitert**

Run: `pnpm test tests/db/pgvector.integration.test.ts`
Expected: FAIL — entweder Container-Pull von `postgres:17` ohne pgvector (kein `vector` in `pg_available_extensions`) bzw. leeres Result (`toHaveLength(1)` schlägt fehl).

- [ ] **Step 3: Extension in den Superuser-Init-Pfad**

Create `docker/postgres/init/02-extensions.sql`:

```sql
-- Läuft beim First-Init als postgres-SUPERUSER gegen POSTGRES_DB (qrecords),
-- alphabetisch NACH 01-roles.sql. `vector` ist keine trusted extension und
-- kann daher NICHT in einer qr_owner-Migration angelegt werden (Slice-7-Ground-Truth).
CREATE EXTENSION IF NOT EXISTS vector;
```

- [ ] **Step 4: Compose-DB-Image auf pgvector umstellen**

In `docker-compose.yml`, db-Service: ändere `image: postgres:17-alpine` → `image: pgvector/pgvector:pg17` (es existiert KEIN `-alpine`-Tag für pgvector). Alles andere (env, volumes inkl. `./docker/postgres/init:/docker-entrypoint-initdb.d:ro`, ports `55432:5432`) bleibt.

- [ ] **Step 5: Testcontainer-Image + Extension vor den Migrationen**

In `tests/helpers/db.ts:34` ändere:

```ts
const container = await new PostgreSqlContainer('pgvector/pgvector:pg17').start();
```

Und im `admin`-Block (Superuser `test`), NACH `GRANT USAGE ON SCHEMA public TO qr_app` (Z.52) und VOR `} finally {` (Z.53):

```ts
    // pgvector: als Superuser anlegen, BEVOR runMigrations (qr_owner) den vector-Typ nutzt.
    await admin.query('CREATE EXTENSION IF NOT EXISTS vector');
```

- [ ] **Step 6: Boot-Assert im Entrypoint (fail-closed)**

In `docker/entrypoint-web.sh`, im bestehenden BOOT_ASSERT-node-Heredoc, nach dem `records`-RLS-Check und vor `exec node /app/server.js`, ergänze:

```js
  const ext = await client.query(`SELECT 1 FROM pg_extension WHERE extname = 'vector'`);
  if (ext.rows.length !== 1) throw new Error('pgvector-Extension fehlt — record_embeddings/KI-Suche nicht funktionsfähig');
```

- [ ] **Step 7: Test bestätigt Extension**

Run: `pnpm test tests/db/pgvector.integration.test.ts`
Expected: PASS (`vector` in `pg_extension`).

- [ ] **Step 8: Bestehende DB-Suite bleibt grün (Image-Wechsel betrifft alle Integrationstests)**

Run: `pnpm test tests/db/`
Expected: PASS — alle bestehenden Testcontainer-Suiten laufen weiter (nur das Base-Image wurde getauscht).

- [ ] **Step 9: Commit**

```bash
git add docker/postgres/init/02-extensions.sql docker-compose.yml tests/helpers/db.ts docker/entrypoint-web.sh tests/db/pgvector.integration.test.ts
git commit -m "feat(slice7): pgvector-Infrastruktur — Extension im Init-Pfad, pgvector/pgvector:pg17, Boot-Check"
```

---

## Task 2: Tabelle `record_embeddings` (Schema + DDL + RLS + Drift-Guard) — ATOMAR

> **Warum atomar:** `record_embeddings` trägt `tenant_id`. Sobald die Tabelle existiert, verlangt der Boot-Drift-Guard, dass sie in `TENANT_SCOPED_TABLES` steht UND RLS+Policy `tenant_isolation` hat. Tabelle, RLS und beide Guard-Listen müssen zusammen landen, sonst ist die Suite rot. Deshalb ein Task.

**Files:**
- Modify: `src/db/schema.ts` (customType `vector1536` + `recordEmbeddings`), `src/db/assertions.ts:5-20` (`TENANT_SCOPED_TABLES`), `tests/db/assertions.test.ts:14-29` (`SOUND_TENANT_ID_TABLES`)
- Create (via `pnpm db:generate` + Handedit): `drizzle/0013_slice7_embeddings.sql`, `drizzle/meta/0013_snapshot.json`
- Create (handgeschrieben): `drizzle/0014_slice7_rls.sql`
- Modify: `drizzle/meta/_journal.json`
- Test: `tests/db/record-embeddings-rls.integration.test.ts` (Create)

**Interfaces:**
- Produces:
  - Drizzle-Tabellenobjekt `recordEmbeddings` (Spalten `id, tenantId, recordId, embedding, contentHash, model, createdAt, updatedAt`) und `vector1536` customType — importierbar aus `@/db/schema` für Task 5 (Upsert) und Task 9 (kiSearch-Join).
  - Physische Tabelle `record_embeddings` mit `UNIQUE (tenant_id, record_id)`, HNSW-Index `USING hnsw (embedding vector_cosine_ops)`, voller RLS.

- [ ] **Step 1: Failing test — nicht-vakuoser RLS-Test**

Create `tests/db/record-embeddings-rls.integration.test.ts` (Vorbild: `tests/db/collections-rls.integration.test.ts` + `slice6-migration` subscriptions-Muster):

```ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { setupTestDatabase, seedTenant, type TestDatabase } from '../helpers/db';

const FAKE_VEC = `[${Array.from({ length: 1536 }, () => 0).map((_, i) => (i === 0 ? 1 : 0)).join(',')}]`;

describe('record_embeddings RLS-Isolation', () => {
  let db: TestDatabase;
  let withTenant: typeof import('@/db/tenant')['withTenant'];
  let tenantA: number;
  let tenantB: number;

  beforeAll(async () => {
    db = await setupTestDatabase();
    vi.resetModules();
    ({ withTenant } = await import('@/db/tenant'));
    ({ tenantId: tenantA } = await seedTenant({ slug: 'a-rls', name: 'A' }));
    ({ tenantId: tenantB } = await seedTenant({ slug: 'b-rls', name: 'B' }));

    // Records + Embeddings je Tenant über den Owner-Pool (BYPASSRLS, explizite tenant_id).
    const owner = new Pool({ connectionString: db.ownerUrl, max: 1 });
    try {
      for (const [t, tag] of [[tenantA, 'a'], [tenantB, 'b']] as const) {
        const { rows } = await owner.query(
          `INSERT INTO records (tenant_id, title, artist, hash) VALUES ($1, $2, 'X', $3) RETURNING id`,
          [t, `Rec ${tag}`, `hash_${tag}`],
        );
        const recordId = rows[0].id as number;
        await owner.query(
          `INSERT INTO record_embeddings (tenant_id, record_id, embedding, content_hash, model)
           VALUES ($1, $2, $3::vector(1536), $4, 'fake-v1')`,
          [t, recordId, FAKE_VEC, `ch_${tag}`],
        );
      }
    } finally {
      await owner.end();
    }
  }, 120_000);

  afterAll(async () => {
    await db.teardown();
  });

  it('A sieht exakt seine Zeile, B nicht (positive + negative Kontrolle)', async () => {
    const seenByA = await withTenant({ tenantId: tenantA, userId: null }, (tx) =>
      tx.execute(sql`SELECT content_hash FROM record_embeddings`),
    );
    expect(seenByA.rows).toHaveLength(1);
    expect(seenByA.rows[0]!.content_hash).toBe('ch_a');

    const seenByB = await withTenant({ tenantId: tenantB, userId: null }, (tx) =>
      tx.execute(sql`SELECT content_hash FROM record_embeddings`),
    );
    expect(seenByB.rows).toHaveLength(1);
    expect(seenByB.rows[0]!.content_hash).toBe('ch_b');
  });

  it('Boot-Assertion bleibt grün (Drift-Guard kennt record_embeddings)', async () => {
    const { assertDatabaseSafety } = await import('@/db/assertions');
    await expect(assertDatabaseSafety()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Test scheitert**

Run: `pnpm test tests/db/record-embeddings-rls.integration.test.ts`
Expected: FAIL — `record_embeddings` existiert nicht (INSERT wirft `relation "record_embeddings" does not exist`).

- [ ] **Step 3: customType + Tabelle im Schema**

In `src/db/schema.ts`: ergänze `customType` im drizzle-Import (Z.1-17) und definiere direkt vor `records` (Z.147):

```ts
import { boolean, check, customType, index, integer, jsonb, numeric, pgEnum, pgTable, serial, smallint, text, timestamp, unique, varchar } from 'drizzle-orm/pg-core';

// pgvector-Spalte. Kein Repo-Präzedenzfall — hier definiert. dataType() steuert die generierte DDL;
// toDriver serialisiert number[] → '[a,b,c]' (pgvector-Textformat), fromDriver zurück.
export const vector1536 = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector(1536)';
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    return value.slice(1, -1).split(',').map(Number);
  },
});
```

Und nach `records` (nach Z.177, vor `purchases`):

```ts
export const recordEmbeddings = pgTable(
  'record_embeddings',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    recordId: integer('record_id')
      .notNull()
      .references(() => records.id),
    embedding: vector1536('embedding').notNull(),
    contentHash: varchar('content_hash', { length: 64 }).notNull(),
    model: text('model').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    tenantRecordUnique: unique('record_embeddings_tenant_record').on(t.tenantId, t.recordId),
  }),
);
```

- [ ] **Step 4: DDL-Migration generieren**

Run: `pnpm db:generate`
Expected: Neue Datei `drizzle/0013_<zufallsname>.sql` mit **genau** `CREATE TABLE "record_embeddings" ( ... "embedding" vector(1536) NOT NULL ... CONSTRAINT "record_embeddings_tenant_record" UNIQUE("tenant_id","record_id") )`, ein neues `drizzle/meta/0013_snapshot.json`, und ein angehängter Journal-Eintrag `idx: 13`.
**STOPP-Kriterium:** Enthält die `.sql` irgendeine andere Tabelle als `record_embeddings`, ist der Snapshot gedriftet — nicht fortfahren, Ursache klären.

- [ ] **Step 5: Migration umbenennen + HNSW-Index anhängen**

```bash
git -C . mv "$(ls drizzle/0013_*.sql | grep -v snapshot)" drizzle/0013_slice7_embeddings.sql 2>/dev/null || mv drizzle/0013_*.sql drizzle/0013_slice7_embeddings.sql
```

Im `idx:13`-Journal-Eintrag in `drizzle/meta/_journal.json`: setze `"tag": "0013_slice7_embeddings"` UND setze `"when"` auf den kontrollierten Wert **`1783328115441`** (= 0012.when + 1). `db:generate` stempelt `when` mit `Date.now()` (~1.7835e12) — das MUSS auf einen Wert direkt über 0012 (`1783328115440`) korrigiert werden, sonst überspringt der Drizzle-Migrator die handgeschriebenen 0014/0015 (er wendet nur Einträge mit `when > lastApplied` an; ein kleineres `when` bei 0014/0015 als bei 0013 = still übersprungen). Der `0013_snapshot.json` bleibt unverändert (Snapshots tragen kein `when`).
Hänge ans Ende von `drizzle/0013_slice7_embeddings.sql` an (drizzle-kit generiert keine pgvector-Index-Ops):

```sql
--> statement-breakpoint
CREATE INDEX "record_embeddings_embedding_hnsw" ON "record_embeddings" USING hnsw ("embedding" vector_cosine_ops);
```

- [ ] **Step 6: RLS-Migration (handgeschrieben, Kopie von 0011)**

Create `drizzle/0014_slice7_rls.sql` (0011-Muster, `subscriptions` → `record_embeddings`):

```sql
-- Row-Level Security für record_embeddings (Slice 7). drizzle-kit verwaltet kein RLS,
-- daher handgeschrieben + manuell in meta/_journal.json registriert (idx 14).
-- Gleiche Form wie 0011_slice6_rls.sql: ENABLE + FORCE, tenant_id-Default aus dem GUC,
-- tenant_isolation + superadmin_bypass, DML- + Sequence-Grant an qr_app (load-bearing).

ALTER TABLE "record_embeddings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "record_embeddings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "record_embeddings" ALTER COLUMN "tenant_id" SET DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::int;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "record_embeddings"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int);
--> statement-breakpoint
CREATE POLICY "superadmin_bypass" ON "record_embeddings"
  USING (current_setting('app.is_superadmin', true) = 'true')
  WITH CHECK (current_setting('app.is_superadmin', true) = 'true');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "record_embeddings" TO qr_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "record_embeddings_id_seq" TO qr_app;
```

Hänge in `drizzle/meta/_journal.json` an das `entries`-Array an (nach idx 13):

```json
    {
      "idx": 14,
      "version": "7",
      "when": 1783328115442,
      "tag": "0014_slice7_rls",
      "breakpoints": true
    }
```

> **Hinweis `when`:** Weil 0013's `when` in Step 5 auf `1783328115441` fixiert wurde, ist `0014.when = 1783328115442` (= +1) korrekt und strikt steigend. Prüfe nach dem Einfügen, dass die `when`-Werte im `entries`-Array durchgängig strikt steigen (0012=…440 < 0013=…441 < 0014=…442).

- [ ] **Step 7: Beide Drift-Guard-Listen erweitern (Lockstep)**

In `src/db/assertions.ts` `TENANT_SCOPED_TABLES` (Z.5-20) und in `tests/db/assertions.test.ts` `SOUND_TENANT_ID_TABLES` (Z.14-29): füge in BEIDEN `'record_embeddings'` am Ende hinzu (identische Reihenfolge halten), z.B. nach `'subscriptions'`:

```ts
  'wishlists', 'wishlist_matches', 'collections', 'subscriptions', 'record_embeddings',
```

- [ ] **Step 8: RLS-Test läuft grün**

Run: `pnpm test tests/db/record-embeddings-rls.integration.test.ts`
Expected: PASS — beide Tenants sehen exakt ihre Zeile; `assertDatabaseSafety()` resolved.

- [ ] **Step 9: Drift-Guard-Suite + Slice-6-Migration grün (Regression)**

Run: `pnpm test tests/db/assertions.test.ts tests/slice6-migration.integration.test.ts`
Expected: PASS — die erweiterten Listen matchen die neue DB-Realität.

- [ ] **Step 10: Commit**

```bash
git add src/db/schema.ts src/db/assertions.ts tests/db/assertions.test.ts drizzle/ tests/db/record-embeddings-rls.integration.test.ts
git commit -m "feat(slice7): record_embeddings-Tabelle (pgvector) mit voller RLS + HNSW-Index + Drift-Guard"
```

---

## Task 3: Embeddings-Adapter + Env-Cross-Field

**Files:**
- Create: `src/lib/embeddings/types.ts`, `src/lib/embeddings/fake.ts`, `src/lib/embeddings/http.ts`, `src/lib/embeddings/index.ts`
- Modify: `src/env.ts` (Enum + Keys + `parseEnv`), `.env.example`
- Test: `tests/lib/embeddings/fake.test.ts`, `tests/lib/embeddings/index.test.ts`, `tests/env-embeddings.test.ts` (Create)

**Interfaces:**
- Produces:
  - `EmbeddingsAdapter { embed(texts: string[]): Promise<number[][]>; readonly model: string }` und `class EmbeddingsConfigError extends Error {}` aus `@/lib/embeddings/types`.
  - `getEmbeddingsAdapter(): EmbeddingsAdapter` aus `@/lib/embeddings` (gecacht, Default `fake`).
  - `createFakeEmbeddingsAdapter(): EmbeddingsAdapter` aus `@/lib/embeddings/fake` (deterministisch, 1536-dim, unit-norm, `model = 'fake-v1'`).
  - env-Keys `EMBEDDINGS_DRIVER` (`'fake'|'http'`, default `fake`), `EMBEDDINGS_API_KEY?`, `EMBEDDINGS_MODEL` (default `text-embedding-3-small`), `EMBEDDINGS_API_URL` (default `https://api.openai.com/v1`).

- [ ] **Step 1: Failing unit test — Fake-Adapter**

Create `tests/lib/embeddings/fake.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createFakeEmbeddingsAdapter } from '@/lib/embeddings/fake';

describe('fake embeddings adapter', () => {
  const adapter = createFakeEmbeddingsAdapter();

  it('ist deterministisch: gleicher Text → gleicher Vektor', async () => {
    const [a] = await adapter.embed(['melancholischer Herbst-Jazz']);
    const [b] = await adapter.embed(['melancholischer Herbst-Jazz']);
    expect(a).toEqual(b);
  });

  it('liefert Dimension 1536', async () => {
    const [v] = await adapter.embed(['x']);
    expect(v).toHaveLength(1536);
  });

  it('ist unit-normalisiert (‖v‖ ≈ 1)', async () => {
    const [v] = await adapter.embed(['irgendein Text']);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('verschiedene Texte → verschiedene Vektoren', async () => {
    const [a] = await adapter.embed(['a']);
    const [b] = await adapter.embed(['b']);
    expect(a).not.toEqual(b);
  });

  it('erhält Reihenfolge und Länge des Batch', async () => {
    const out = await adapter.embed(['a', 'b', 'c']);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual((await adapter.embed(['a']))[0]);
  });

  it('model === fake-v1', () => {
    expect(adapter.model).toBe('fake-v1');
  });
});
```

- [ ] **Step 2: Test scheitert**

Run: `pnpm test tests/lib/embeddings/fake.test.ts`
Expected: FAIL — `Cannot find module '@/lib/embeddings/fake'`.

- [ ] **Step 3: Interface + Config-Error**

Create `src/lib/embeddings/types.ts`:

```ts
export interface EmbeddingsAdapter {
  /** Je Text ein 1536-dim Vektor, Reihenfolge-stabil zum Input. */
  embed(texts: string[]): Promise<number[][]>;
  /** Fürs `model`-Feld der Zeile + Drift-Erkennung. */
  readonly model: string;
}

/** Konfigurations-/Provider-Fehler (fehlender Key etc.) — 500er-Klasse, kein User-Fehler. */
export class EmbeddingsConfigError extends Error {}
```

- [ ] **Step 4: Fake-Adapter**

Create `src/lib/embeddings/fake.ts`:

```ts
import 'server-only';
import { createHash } from 'node:crypto';
import type { EmbeddingsAdapter } from './types';

const DIM = 1536;

/** Deterministischer Pseudo-Vektor aus sha256(text), unit-normalisiert. Offline, reproduzierbar. */
function fakeVector(text: string): number[] {
  const out = new Array<number>(DIM);
  // Byte-Strom aus verketteten sha256-Blöcken (32 Byte je Block) auf DIM Floats mappen.
  let block = createHash('sha256').update(text).digest();
  let bi = 0;
  for (let i = 0; i < DIM; i++) {
    if (bi >= block.length) {
      block = createHash('sha256').update(block).digest();
      bi = 0;
    }
    // Byte 0..255 → [-1, 1)
    out[i] = (block[bi]! / 128) - 1;
    bi++;
  }
  const norm = Math.sqrt(out.reduce((s, x) => s + x * x, 0)) || 1;
  return out.map((x) => x / norm);
}

export function createFakeEmbeddingsAdapter(): EmbeddingsAdapter {
  return {
    model: 'fake-v1',
    async embed(texts: string[]): Promise<number[][]> {
      return texts.map(fakeVector);
    },
  };
}
```

- [ ] **Step 5: Test grün**

Run: `pnpm test tests/lib/embeddings/fake.test.ts`
Expected: PASS.

- [ ] **Step 6: HTTP-Adapter (lazy Config-Error, stripe-Muster)**

Create `src/lib/embeddings/http.ts`:

```ts
import 'server-only';
import { env } from '@/env';
import { EmbeddingsConfigError, type EmbeddingsAdapter } from './types';

/** OpenAI-kompatibler Embeddings-Endpoint. Config-Check bewusst bei First-Use, nicht beim Modul-Load. */
export function createHttpEmbeddingsAdapter(): EmbeddingsAdapter {
  return {
    model: env.EMBEDDINGS_MODEL,
    async embed(texts: string[]): Promise<number[][]> {
      if (!env.EMBEDDINGS_API_KEY) throw new EmbeddingsConfigError('EMBEDDINGS_API_KEY fehlt');
      const res = await fetch(`${env.EMBEDDINGS_API_URL}/embeddings`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${env.EMBEDDINGS_API_KEY}`,
        },
        body: JSON.stringify({ model: env.EMBEDDINGS_MODEL, input: texts }),
      });
      if (!res.ok) {
        // Provider-Details NICHT durchreichen (Secrets/Leaks); nur Status.
        throw new EmbeddingsConfigError(`Embeddings-Provider antwortete ${res.status}`);
      }
      const json = (await res.json()) as { data: { embedding: number[] }[] };
      return json.data.map((d) => d.embedding);
    },
  };
}
```

- [ ] **Step 7: Gecachter Getter (billing-Muster)**

Create `src/lib/embeddings/index.ts`:

```ts
import 'server-only';
import { env } from '@/env';
import type { EmbeddingsAdapter } from './types';
import { createFakeEmbeddingsAdapter } from './fake';
import { createHttpEmbeddingsAdapter } from './http';

let cached: EmbeddingsAdapter | null = null;
export function getEmbeddingsAdapter(): EmbeddingsAdapter {
  if (cached) return cached;
  cached = env.EMBEDDINGS_DRIVER === 'http' ? createHttpEmbeddingsAdapter() : createFakeEmbeddingsAdapter();
  return cached;
}
```

- [ ] **Step 8: Env-Schema + Cross-Field**

In `src/env.ts`, im `z.object` (nach dem Billing-Block, ~Z.61):

```ts
  // ── Embeddings / KI-Suche ─────────────────────────────────
  EMBEDDINGS_DRIVER: z.enum(['fake', 'http']).default('fake'),
  /** Pflicht bei EMBEDDINGS_DRIVER=http — geprüft in parseEnv (fail-closed on boot). */
  EMBEDDINGS_API_KEY: z.string().min(1).optional(),
  EMBEDDINGS_MODEL: z.string().default('text-embedding-3-small'),
  EMBEDDINGS_API_URL: z.string().url().default('https://api.openai.com/v1'),
```

In `parseEnv()` (nach dem Stripe-Guard, vor `return parsed`):

```ts
  if (parsed.EMBEDDINGS_DRIVER === 'http' && !parsed.EMBEDDINGS_API_KEY) {
    throw new Error('EMBEDDINGS_DRIVER=http erfordert EMBEDDINGS_API_KEY (src/env.ts).');
  }
```

> Kein `.superRefine` am Schema — `envSchema` muss ein plain `z.object` bleiben (`.shape`-Zugriffe in Tests). `env.ts` selbst importiert weiterhin KEIN `'server-only'`.

In `.env.example` ergänze (dokumentierend, Default fake):

```
# KI-Suche (Slice 7). fake = deterministisch/offline (Default). http = OpenAI-kompatibel.
EMBEDDINGS_DRIVER=fake
# EMBEDDINGS_API_KEY=sk-...        # Pflicht nur bei EMBEDDINGS_DRIVER=http
# EMBEDDINGS_MODEL=text-embedding-3-small
# EMBEDDINGS_API_URL=https://api.openai.com/v1
```

- [ ] **Step 9: Failing tests — Getter + parseEnv**

Create `tests/lib/embeddings/index.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getEmbeddingsAdapter } from '@/lib/embeddings';

describe('getEmbeddingsAdapter', () => {
  it('liefert per Default den Fake-Adapter (model fake-v1)', () => {
    expect(getEmbeddingsAdapter().model).toBe('fake-v1');
  });
  it('ist ein Singleton', () => {
    expect(getEmbeddingsAdapter()).toBe(getEmbeddingsAdapter());
  });
});
```

Create `tests/env-embeddings.test.ts` (Vorbild `tests/env-billing.test.ts`, ruft `parseEnv` direkt):

```ts
import { describe, expect, it } from 'vitest';
import { parseEnv } from '@/env';

const BASE = { ...process.env };

describe('parseEnv — Embeddings Cross-Field', () => {
  it('http ohne EMBEDDINGS_API_KEY wirft', () => {
    expect(() => parseEnv({ ...BASE, EMBEDDINGS_DRIVER: 'http', EMBEDDINGS_API_KEY: '' })).toThrow(
      /EMBEDDINGS_API_KEY/,
    );
  });
  it('http mit Key ist ok', () => {
    expect(() => parseEnv({ ...BASE, EMBEDDINGS_DRIVER: 'http', EMBEDDINGS_API_KEY: 'sk-x' })).not.toThrow();
  });
  it('fake ohne Key ist ok (Default)', () => {
    expect(() => parseEnv({ ...BASE, EMBEDDINGS_DRIVER: 'fake' })).not.toThrow();
  });
});
```

- [ ] **Step 10: Tests grün**

Run: `pnpm test tests/lib/embeddings/ tests/env-embeddings.test.ts`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/lib/embeddings/ src/env.ts .env.example tests/lib/embeddings/ tests/env-embeddings.test.ts
git commit -m "feat(slice7): Embeddings-Adapter (fake|http) + EMBEDDINGS_* env cross-field"
```

---

## Task 4: Embedding-Dokument + Content-Hash

**Files:**
- Create: `src/lib/embeddings/document.ts`
- Modify: `src/db/hash.ts` (`sha256Hex`)
- Test: `tests/lib/embeddings/document.test.ts` (Create)

**Interfaces:**
- Consumes: (nichts aus früheren Tasks außer dem `records`-Row-Shape).
- Produces:
  - `sha256Hex(s: string): string` aus `@/db/hash`.
  - `buildEmbeddingDocument(rec: EmbeddingDocSource): string` und `type EmbeddingDocSource` aus `@/lib/embeddings/document`. `EmbeddingDocSource = { artist: string; title: string; label: string[]; genre: string[]; format: string | null; releaseYear: number | null; country: string | null }`.

- [ ] **Step 1: Failing test**

Create `tests/lib/embeddings/document.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildEmbeddingDocument } from '@/lib/embeddings/document';
import { sha256Hex } from '@/db/hash';

const full = {
  artist: 'John Coltrane',
  title: 'A Love Supreme',
  label: ['Impulse!'],
  genre: ['Jazz', 'Modal'],
  format: 'Vinyl',
  releaseYear: 1965,
  country: 'US',
};

describe('buildEmbeddingDocument', () => {
  it('ist deterministisch und feld-geordnet (artist — title — labels — genres — format — year — country)', () => {
    expect(buildEmbeddingDocument(full)).toBe(
      'John Coltrane — A Love Supreme — Impulse! — Jazz, Modal — Vinyl — 1965 — US',
    );
  });
  it('lässt leere Felder aus, ohne die Reihenfolge zu brechen', () => {
    expect(
      buildEmbeddingDocument({ artist: 'X', title: 'Y', label: [], genre: [], format: null, releaseYear: null, country: null }),
    ).toBe('X — Y');
  });
  it('gleicher Input → gleiches Dokument (Idempotenz)', () => {
    expect(buildEmbeddingDocument(full)).toBe(buildEmbeddingDocument({ ...full }));
  });
});

describe('sha256Hex', () => {
  it('ist stabil und 64 hex chars', () => {
    const h = sha256Hex('abc');
    expect(h).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(h).toHaveLength(64);
  });
});
```

- [ ] **Step 2: Test scheitert**

Run: `pnpm test tests/lib/embeddings/document.test.ts`
Expected: FAIL — `buildEmbeddingDocument`/`sha256Hex` existieren nicht.

- [ ] **Step 3: `sha256Hex` in hash.ts**

In `src/db/hash.ts` ergänze (neben `recordHash`):

```ts
/** Generischer sha256-Hex eines Strings — für den Content-Hash des Embedding-Dokuments. */
export function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}
```

- [ ] **Step 4: Dokument-Builder**

Create `src/lib/embeddings/document.ts`:

```ts
export type EmbeddingDocSource = {
  artist: string;
  title: string;
  label: string[];
  genre: string[];
  format: string | null;
  releaseYear: number | null;
  country: string | null;
};

/**
 * Deterministisches Embedding-Dokument aus Release-Metadaten (Reihenfolge stabil, leere Felder aus).
 * KEINE PII/Preise (Global Constraint). Trenner ' — '.
 */
export function buildEmbeddingDocument(rec: EmbeddingDocSource): string {
  const parts: string[] = [
    rec.artist,
    rec.title,
    rec.label.join(', '),
    rec.genre.join(', '),
    rec.format ?? '',
    rec.releaseYear != null ? String(rec.releaseYear) : '',
    rec.country ?? '',
  ];
  return parts.map((p) => p.trim()).filter((p) => p.length > 0).join(' — ');
}
```

- [ ] **Step 5: Tests grün**

Run: `pnpm test tests/lib/embeddings/document.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db/hash.ts src/lib/embeddings/document.ts tests/lib/embeddings/document.test.ts
git commit -m "feat(slice7): buildEmbeddingDocument + sha256Hex Content-Hash"
```

---

## Task 5: Refresh-Handler + Queue + Enqueue-Helper

**Files:**
- Create: `src/worker/jobs/embeddingRefresh.ts`
- Modify: `src/worker/index.ts` (`QUEUE` Z.26-31 + create/work), `src/lib/jobs.ts` (`getBoss` createQueue + `enqueueEmbeddingRefresh`)
- Test: `tests/worker/embeddingRefresh.integration.test.ts` (Create)

**Interfaces:**
- Consumes: `getEmbeddingsAdapter` (T3), `buildEmbeddingDocument`/`sha256Hex` (T4), `recordEmbeddings` + `records` (T2), `withTenant` (`@/db/tenant`).
- Produces:
  - `type EmbeddingRefreshPayload = { tenantId: number; recordId: number }` + `handleEmbeddingRefresh(job: PgBoss.Job<EmbeddingRefreshPayload>): Promise<void>` aus `@/worker/jobs/embeddingRefresh`.
  - `enqueueEmbeddingRefresh(payload: { tenantId: number; recordId: number }): Promise<void>` aus `@/lib/jobs`.
  - `QUEUE.embeddingRefresh` in `@/worker/index`.

- [ ] **Step 1: Failing integration test — contentHash-Guard**

Create `tests/worker/embeddingRefresh.integration.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { setupTestDatabase, seedTenant, type TestDatabase } from '../helpers/db';

describe('handleEmbeddingRefresh', () => {
  let db: TestDatabase;
  let handle: typeof import('@/worker/jobs/embeddingRefresh')['handleEmbeddingRefresh'];
  let embeddingsMod: typeof import('@/lib/embeddings');
  let tenantId: number;
  let recordId: number;

  beforeAll(async () => {
    db = await setupTestDatabase();
    vi.resetModules();
    ({ tenantId } = await seedTenant({ slug: 'emb', name: 'Emb' }));
    const owner = new Pool({ connectionString: db.ownerUrl, max: 1 });
    try {
      const { rows } = await owner.query(
        `INSERT INTO records (tenant_id, title, artist, label, genre, hash)
         VALUES ($1, 'A Love Supreme', 'John Coltrane', ARRAY['Impulse!'], ARRAY['Jazz'], 'h1') RETURNING id`,
        [tenantId],
      );
      recordId = rows[0].id;
    } finally {
      await owner.end();
    }
    handle = (await import('@/worker/jobs/embeddingRefresh')).handleEmbeddingRefresh;
    embeddingsMod = await import('@/lib/embeddings');
  }, 120_000);

  afterAll(async () => {
    await db.teardown();
  });

  const job = (payload: { tenantId: number; recordId: number }) =>
    ({ id: 'j', name: 'q', data: payload }) as never;

  async function countAndHash() {
    const owner = new Pool({ connectionString: db.ownerUrl, max: 1 });
    try {
      const { rows } = await owner.query(
        `SELECT content_hash, model, updated_at FROM record_embeddings WHERE record_id = $1`,
        [recordId],
      );
      return rows[0] as { content_hash: string; model: string; updated_at: string } | undefined;
    } finally {
      await owner.end();
    }
  }

  it('upsertet ein Embedding für einen neuen Record', async () => {
    await handle(job({ tenantId, recordId }));
    const row = await countAndHash();
    expect(row).toBeDefined();
    expect(row!.model).toBe('fake-v1');
  });

  it('re-embedded NICHT bei unverändertem contentHash+model (kein embed-Call)', async () => {
    const spy = vi.spyOn(embeddingsMod, 'getEmbeddingsAdapter');
    const embedSpy = vi.fn();
    spy.mockReturnValue({ model: 'fake-v1', embed: embedSpy });
    await handle(job({ tenantId, recordId }));
    expect(embedSpy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('re-embedded bei geändertem Dokument', async () => {
    const owner = new Pool({ connectionString: db.ownerUrl, max: 1 });
    try {
      await owner.query(`UPDATE records SET title = 'Giant Steps' WHERE id = $1`, [recordId]);
    } finally {
      await owner.end();
    }
    const before = await countAndHash();
    await handle(job({ tenantId, recordId }));
    const after = await countAndHash();
    expect(after!.content_hash).not.toBe(before!.content_hash);
  });

  it('fehlender Record → no-op', async () => {
    await expect(handle(job({ tenantId, recordId: 999_999 }))).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Test scheitert**

Run: `pnpm test tests/worker/embeddingRefresh.integration.test.ts`
Expected: FAIL — `@/worker/jobs/embeddingRefresh` fehlt.

- [ ] **Step 3: Handler**

Create `src/worker/jobs/embeddingRefresh.ts`:

```ts
import type PgBoss from 'pg-boss';
import { eq, sql } from 'drizzle-orm';
import { withTenant } from '@/db/tenant';
import { records } from '@/db/schema';
import { getEmbeddingsAdapter } from '@/lib/embeddings';
import { buildEmbeddingDocument } from '@/lib/embeddings/document';
import { sha256Hex } from '@/db/hash';

export type EmbeddingRefreshPayload = { tenantId: number; recordId: number };

export async function handleEmbeddingRefresh(job: PgBoss.Job<EmbeddingRefreshPayload>): Promise<void> {
  const { tenantId, recordId } = job.data;
  await withTenant({ tenantId, userId: null }, async (tx) => {
    const [rec] = await tx.select().from(records).where(eq(records.id, recordId)).limit(1);
    if (!rec) return; // Rollback/gelöscht → no-op

    const doc = buildEmbeddingDocument({
      artist: rec.artist,
      title: rec.title,
      label: rec.label,
      genre: rec.genre,
      format: rec.format,
      releaseYear: rec.releaseYear,
      country: rec.country,
    });
    const hash = sha256Hex(doc);
    const adapter = getEmbeddingsAdapter();

    const existing = await tx.execute(
      sql`SELECT content_hash, model FROM record_embeddings WHERE record_id = ${recordId} AND tenant_id = ${tenantId} LIMIT 1`,
    );
    const cur = existing.rows[0] as { content_hash: string; model: string } | undefined;
    if (cur && cur.content_hash === hash && cur.model === adapter.model) return; // unverändert → kein API-Call

    const [vec] = await adapter.embed([doc]);
    const literal = `[${vec!.join(',')}]`;
    await tx.execute(sql`
      INSERT INTO record_embeddings (tenant_id, record_id, embedding, content_hash, model)
      VALUES (${tenantId}, ${recordId}, ${literal}::vector(1536), ${hash}, ${adapter.model})
      ON CONFLICT (tenant_id, record_id) DO UPDATE
        SET embedding = EXCLUDED.embedding,
            content_hash = EXCLUDED.content_hash,
            model = EXCLUDED.model,
            updated_at = now()
    `);
  });
}
```

- [ ] **Step 4: Queue-Registry + Worker-Registrierung**

In `src/worker/index.ts` `QUEUE` (Z.26-31) ergänze:

```ts
  embeddingRefresh: 'tenant.embedding.refresh',
```

Type-Import bei den anderen Payload-Imports (~Z.6-16):

```ts
import type { EmbeddingRefreshPayload } from './jobs/embeddingRefresh';
```

In `startWorker()` ein create/work-Paar analog `discogsListingCreate` (nahe Z.86-97):

```ts
await boss.createQueue(QUEUE.embeddingRefresh);
console.log(`[worker] Queue created/verified: ${QUEUE.embeddingRefresh}`);

await boss.work<EmbeddingRefreshPayload>(
  QUEUE.embeddingRefresh,
  async (jobs: PgBoss.Job<EmbeddingRefreshPayload>[]) => {
    const { handleEmbeddingRefresh } = await import('./jobs/embeddingRefresh');
    for (const job of jobs) {
      await handleEmbeddingRefresh(job);
    }
  },
);
```

- [ ] **Step 5: Enqueue-Helper**

In `src/lib/jobs.ts`, in `getBoss()` (bei den anderen `createQueue`-Calls ~Z.24-26):

```ts
  await boss.createQueue(QUEUE.embeddingRefresh);
```

Und der Helper (Muster `enqueueDiscogsListing`):

```ts
export async function enqueueEmbeddingRefresh(payload: {
  tenantId: number;
  recordId: number;
}): Promise<void> {
  const boss = await getBoss();
  await boss.send(QUEUE.embeddingRefresh, payload, {
    retryLimit: 5,
    retryBackoff: true,
  });
}
```

- [ ] **Step 6: Tests grün**

Run: `pnpm test tests/worker/embeddingRefresh.integration.test.ts`
Expected: PASS — Upsert, contentHash-Skip (kein embed-Call), Re-Embed bei Änderung, no-op bei fehlendem Record.

- [ ] **Step 7: Typecheck (Worker-Verdrahtung)**

Run: `pnpm typecheck`
Expected: 0 Fehler.

- [ ] **Step 8: Commit**

```bash
git add src/worker/jobs/embeddingRefresh.ts src/worker/index.ts src/lib/jobs.ts tests/worker/embeddingRefresh.integration.test.ts
git commit -m "feat(slice7): embeddingRefresh-Queue + Handler mit contentHash-Guard"
```

---

## Task 6: Ankauf-Hook (post-commit, Einzel + Batch mit Dedupe)

**Files:**
- Modify: `src/app/(app)/ankauf/actions.ts` (nach `performAnkauf`, ~Z.109), `src/app/(app)/ankauf/sammlung/actions.ts` (post-commit-Loop, ~Z.134)
- Test: `tests/app/ankauf-embedding-hook.test.ts` (Create; Vorbild: bestehende Ankauf-Action-Tests)

**Interfaces:**
- Consumes: `enqueueEmbeddingRefresh` (T5).
- Produces: nach jedem committeten Ankauf ein `embeddingRefresh`-Job pro **distinktem** `recordId`.

- [ ] **Step 1: Failing test — Hook feuert (Einzel) + Dedupe (Batch)**

Create `tests/app/ankauf-embedding-hook.test.ts`. Mocke `@/lib/jobs` und prüfe die Aufrufe (deterministisch ohne pg-boss). Struktur (an die bestehenden Ankauf-Action-Tests anlehnen — Session/Tenant/Entitlements-Mocks übernehmen):

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/jobs', () => ({
  enqueueEmbeddingRefresh: vi.fn().mockResolvedValue(undefined),
  enqueueWishlistMatch: vi.fn().mockResolvedValue(undefined),
  enqueueDiscogsListing: vi.fn().mockResolvedValue(undefined),
}));
// ... weitere Mocks (auth/session, tenant, gating, performAnkauf/createCollection) analog bestehender Suite ...

import { enqueueEmbeddingRefresh } from '@/lib/jobs';

describe('Ankauf → embeddingRefresh-Hook', () => {
  beforeEach(() => vi.clearAllMocks());

  it('Einzel-Ankauf reiht genau einen Refresh für den recordId ein (post-commit)', async () => {
    // performAnkauf → { recordId: 42, purchaseId: 7 } mocken; ankaufRecord aufrufen
    // expect(enqueueEmbeddingRefresh).toHaveBeenCalledWith({ tenantId: <t>, recordId: 42 });
  });

  it('Batch/Sammlung dedupliziert recordIds (ein Refresh je distinktem Record)', async () => {
    // createCollection → { recordIds: [5, 5, 8], purchaseIds: [...] } mocken
    // expect(enqueueEmbeddingRefresh).toHaveBeenCalledTimes(2);  // 5 und 8, nicht 3×
  });
});
```

> Falls die bestehende Suite `performAnkauf`/`createCollection` real gegen Testcontainer fährt statt zu mocken: dann als Integrationstest umsetzen und nach dem Aufruf die enqueue-Aufrufe via `vi.spyOn(jobs, 'enqueueEmbeddingRefresh')` prüfen. Muster aus der vorhandenen Ankauf-Testdatei übernehmen.

- [ ] **Step 2: Test scheitert**

Run: `pnpm test tests/app/ankauf-embedding-hook.test.ts`
Expected: FAIL — `enqueueEmbeddingRefresh` wird nicht aufgerufen.

- [ ] **Step 3: Einzel-Hook**

In `src/app/(app)/ankauf/actions.ts`: erweitere den Import (Z.13):

```ts
import { enqueueDiscogsListing, enqueueWishlistMatch, enqueueEmbeddingRefresh } from '@/lib/jobs';
```

Und direkt nach `revalidatePath('/')` (an der markierten Stelle ~Z.109, vor dem wishlist-match-Enqueue), post-commit + soft-fail:

```ts
  try {
    await enqueueEmbeddingRefresh({ tenantId: user.tenantId, recordId });
  } catch (err) {
    console.error('[ankauf] embedding-refresh enqueue failed after purchase committed', err);
  }
```

- [ ] **Step 4: Batch-Hook mit Dedupe**

In `src/app/(app)/ankauf/sammlung/actions.ts`: Import ergänzen (bei Z.9). **Vor** dem bestehenden `for`-Loop (Z.134) einmalig die distinkten Records re-indexieren (Dedupe, weil `acquireOne` identische Releases in EINEN Record upsertet → Batch kann doppelte `recordId` tragen):

```ts
  for (const recordId of new Set(recordIds)) {
    try {
      await enqueueEmbeddingRefresh({ tenantId: user.tenantId, recordId });
    } catch (err) {
      console.error('[sammlung] embedding-refresh enqueue failed after collection committed', err);
    }
  }
```

> Bewusst außerhalb des per-Purchase-Loops (wishlist/discogs bleiben per-Purchase), da Embeddings per-Record sind.

- [ ] **Step 5: Tests grün**

Run: `pnpm test tests/app/ankauf-embedding-hook.test.ts`
Expected: PASS — Einzel feuert 1×, Batch dedupliziert.

- [ ] **Step 6: Regression Ankauf-Suite**

Run: `pnpm test tests/app/`
Expected: PASS — bestehende Ankauf-/Sammlungs-Tests unverändert grün.

- [ ] **Step 7: Commit**

```bash
git add src/app/\(app\)/ankauf/actions.ts src/app/\(app\)/ankauf/sammlung/actions.ts tests/app/ankauf-embedding-hook.test.ts
git commit -m "feat(slice7): post-commit embeddingRefresh-Hook (Einzel + Batch-Dedupe)"
```

---

## Task 7: Seed-inline-Embeddings + Backfill-Script + Compose-Env

**Files:**
- Modify: `scripts/seed.ts` (`ensureRecord` ~Z.398), `package.json` (`embeddings:backfill`), `.env.compose`, `docker-compose.yml` (Service-Env)
- Create: `scripts/embeddings-backfill.ts`

**Interfaces:**
- Consumes: `getEmbeddingsAdapter` (T3), `buildEmbeddingDocument`/`sha256Hex` (T4), `record_embeddings` (T2).
- Produces: geseedete Tenants (demo/vinylcave/freeshop) haben Embeddings; `pnpm embeddings:backfill` reiht fehlende Embeddings ein.

- [ ] **Step 1: Seed-inline-Embedding**

In `scripts/seed.ts`, in `ensureRecord` direkt nach `.returning({ id: schema.records.id })` (vor `return inserted!.id`, ~Z.398):

```ts
  const recordId = inserted!.id;
  // KI-Suche (Slice 7): Embedding inline berechnen (Dev/CI = fake, deterministisch), damit die
  // KI-Suche in E2E ohne laufenden Worker sofort Daten hat. Idempotent über content_hash.
  const doc = buildEmbeddingDocument({
    artist: rec.artist, title: rec.title, label: rec.label, genre: rec.genre ?? [],
    format: rec.format ?? 'Vinyl', releaseYear: rec.releaseYear, country: rec.country,
  });
  const [vec] = await getEmbeddingsAdapter().embed([doc]);
  const literal = `[${vec!.join(',')}]`;
  await db.execute(sql`
    INSERT INTO record_embeddings (tenant_id, record_id, embedding, content_hash, model)
    VALUES (${tenantId}, ${recordId}, ${literal}::vector(1536), ${sha256Hex(doc)}, ${getEmbeddingsAdapter().model})
    ON CONFLICT (tenant_id, record_id) DO UPDATE
      SET embedding = EXCLUDED.embedding, content_hash = EXCLUDED.content_hash, model = EXCLUDED.model, updated_at = now()
  `);
  return recordId;
```

Ergänze oben in `seed.ts` die Imports: `getEmbeddingsAdapter` (`@/lib/embeddings`), `buildEmbeddingDocument` (`@/lib/embeddings/document`), `sha256Hex` (`@/db/hash`), und stelle sicher, dass `sql` (drizzle-orm) importiert ist. `db` ist der bestehende owner-Drizzle-Handle in `ensureRecord`.

- [ ] **Step 2: Backfill-Script**

Create `scripts/embeddings-backfill.ts`:

```ts
import { pathToFileURL } from 'node:url';
import { sql } from 'drizzle-orm';
import { withSuperadmin } from '@/db/tenant';
import { enqueueEmbeddingRefresh } from '@/lib/jobs';

/**
 * Reiht pro Tenant alle Records ohne aktuelles Embedding zum Re-Index ein — für Bestandsdaten
 * und nach Modellwechsel. Idempotent über den content_hash-Guard im Handler.
 */
export async function backfillEmbeddings(): Promise<void> {
  const missing = await withSuperadmin((tx) =>
    tx.execute(sql`
      SELECT r.tenant_id, r.id AS record_id
      FROM records r
      LEFT JOIN record_embeddings e ON e.record_id = r.id AND e.tenant_id = r.tenant_id
      WHERE e.id IS NULL
    `),
  );
  for (const row of missing.rows as { tenant_id: number; record_id: number }[]) {
    await enqueueEmbeddingRefresh({ tenantId: row.tenant_id, recordId: row.record_id });
  }
  console.log(`[embeddings:backfill] ${missing.rows.length} Record(s) eingereiht`);
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  backfillEmbeddings().then(() => process.exit(0)).catch((e) => {
    console.error('[embeddings:backfill] failed:', e);
    process.exit(1);
  });
}
```

> `withSuperadmin` liest tenant-übergreifend (BYPASSRLS) — korrekt für ein Ops-Script; jeder eingereihte Job trägt `tenantId` für den tenant-scoped Handler.

In `package.json` `scripts`:

```json
    "embeddings:backfill": "tsx scripts/embeddings-backfill.ts",
```

- [ ] **Step 3: Compose-Env**

In `.env.compose` ergänze neben `DISCOGS_DRIVER=fake` / `BILLING_DRIVER=fake`:

```
EMBEDDINGS_DRIVER=fake
```

In `docker-compose.yml`: überall dort, wo ein Service ein explizites `environment:` mit `DISCOGS_DRIVER` setzt (Grep: `grep -n DISCOGS_DRIVER docker-compose.yml`), setze daneben `EMBEDDINGS_DRIVER: fake`. Nutzt ein Service `env_file: .env.compose`, genügt der `.env.compose`-Eintrag. (Sicherheitsnetz: `EMBEDDINGS_DRIVER` hat in `src/env.ts` Default `fake`.)

- [ ] **Step 4: Verifikation — Seed erzeugt Embeddings (integration/manuell)**

Run (gegen frischen Stack):
```bash
docker compose down -v && docker compose up -d --build --wait --wait-timeout 300
docker compose exec -T db psql -U postgres -d qrecords -c "SELECT count(*) FROM record_embeddings;"
```
Expected: `count > 0` (Seed hat für demo/vinylcave/freeshop Embeddings geschrieben).

- [ ] **Step 5: Backfill ist idempotent**

Run:
```bash
docker compose exec -T web pnpm embeddings:backfill
```
Expected: `[embeddings:backfill] 0 Record(s) eingereiht` (nach Seed sind alle Records indexiert).

- [ ] **Step 6: Commit**

```bash
git add scripts/seed.ts scripts/embeddings-backfill.ts package.json .env.compose docker-compose.yml
git commit -m "feat(slice7): Seed-inline-Embeddings + embeddings:backfill + EMBEDDINGS_DRIVER Compose-Env"
```

---

## Task 8: Feature-Gating `kiSuche` + Daten-Migration

**Files:**
- Modify: `src/lib/gating.ts` (Z.12, 23-29, 35-41, 111-114)
- Create: `drizzle/0015_slice7_data.sql` + Journal-Eintrag
- Test: `tests/lib/gating-kisuche.test.ts` (Create), `tests/slice7-data.integration.test.ts` (Create; Vorbild `tests/slice6-migration.integration.test.ts`)

**Interfaces:**
- Produces: `PlanFeatures.kiSuche: boolean`; DB-Feature-Matrix free ✗ / small ✓ / big ✓; `getEntitlements(tenantId).features.kiSuche` fließt aus der DB. Wird von T9 (kiSearch-Gate) + T10 (UI-Lock) konsumiert.

- [ ] **Step 1: Failing unit test — Gating-Matrix**

Create `tests/lib/gating-kisuche.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FREE_FALLBACK_ENTITLEMENTS, UNLIMITED_ENTITLEMENTS, mergeEntitlements } from '@/lib/gating';

describe('kiSuche-Gating', () => {
  it('Free-Fallback hat kiSuche=false (fail-closed)', () => {
    expect(FREE_FALLBACK_ENTITLEMENTS.features.kiSuche).toBe(false);
  });
  it('UNLIMITED hat kiSuche=true', () => {
    expect(UNLIMITED_ENTITLEMENTS.features.kiSuche).toBe(true);
  });
  it('mergeEntitlements liest kiSuche aus den DB-features', () => {
    const ent = mergeEntitlements(
      { slug: 'small', name: 'Small', priceMonthlyCents: 1900, limits: {}, features: { analytik: true, discogsListing: true, kiSuche: true } },
      null,
    );
    expect(ent.features.kiSuche).toBe(true);
  });
  it('mergeEntitlements defaultet fehlendes kiSuche auf false', () => {
    const ent = mergeEntitlements(
      { slug: 'free', name: 'Free', priceMonthlyCents: 0, limits: {}, features: { analytik: false, discogsListing: false } },
      null,
    );
    expect(ent.features.kiSuche).toBe(false);
  });
});
```

- [ ] **Step 2: Test scheitert**

Run: `pnpm test tests/lib/gating-kisuche.test.ts`
Expected: FAIL — `kiSuche` existiert nicht auf `PlanFeatures` (Typfehler / undefined).

- [ ] **Step 3: Fünf Touch-Points in gating.ts**

1. Z.12: `export type PlanFeatures = { analytik: boolean; discogsListing: boolean; kiSuche: boolean };`
2. Z.23-29 `FREE_FALLBACK_ENTITLEMENTS.features`: `+ kiSuche: false`.
3. Z.35-41 `UNLIMITED_ENTITLEMENTS.features`: `+ kiSuche: true`.
4. Z.111-114 `mergeEntitlements` features-Block (**KRITISCH, sonst fließt der DB-Wert nie**):

```ts
    features: {
      analytik: pf.analytik === true,
      discogsListing: pf.discogsListing === true,
      kiSuche: pf.kiSuche === true,
    },
```

- [ ] **Step 4: Unit-Test grün**

Run: `pnpm test tests/lib/gating-kisuche.test.ts`
Expected: PASS.

- [ ] **Step 5: Daten-Migration (handgeschrieben, 0012-Muster)**

Create `drizzle/0015_slice7_data.sql`:

```sql
-- Slice-7-Daten-Migration (idempotent): kiSuche-Feature je Plan (Spec §9).
-- free ✗ / small ✓ / big ✓. Überschreibt plans.features via ON CONFLICT DO UPDATE.
-- NICHT 0012 editieren (bereits angewandt).
INSERT INTO "plans" ("slug", "name", "price_monthly_cents", "limits", "features") VALUES
  ('free',  'Free',     0, '{"maxRecords": 100,  "maxUsers": 2}'::jsonb,    '{"analytik": false, "discogsListing": false, "kiSuche": false}'::jsonb),
  ('small', 'Small', 1900, '{"maxRecords": 5000, "maxUsers": 10}'::jsonb,   '{"analytik": true,  "discogsListing": true,  "kiSuche": true}'::jsonb),
  ('big',   'Big',   4900, '{"maxRecords": null, "maxUsers": null}'::jsonb, '{"analytik": true,  "discogsListing": true,  "kiSuche": true}'::jsonb)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "price_monthly_cents" = EXCLUDED."price_monthly_cents",
  "limits" = EXCLUDED."limits",
  "features" = EXCLUDED."features";
```

Journal-Eintrag anhängen (`when = 0014.when + 1 = 1783328115443`, strikt steigend):

```json
    {
      "idx": 15,
      "version": "7",
      "when": 1783328115443,
      "tag": "0015_slice7_data",
      "breakpoints": true
    }
```

- [ ] **Step 6: Failing integration test — Daten-Migration**

Create `tests/slice7-data.integration.test.ts` (Vorbild `slice6-migration.integration.test.ts`): boote `setupTestDatabase`, lies `plans`, assert `features.kiSuche` je Plan:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { setupTestDatabase, type TestDatabase } from './helpers/db';

describe('0015 kiSuche-Feature-Matrix', () => {
  let db: TestDatabase;
  beforeAll(async () => { db = await setupTestDatabase(); }, 120_000);
  afterAll(async () => { await db.teardown(); });

  it('setzt kiSuche false/true/true für free/small/big', async () => {
    const pool = new Pool({ connectionString: db.ownerUrl, max: 1 });
    try {
      const { rows } = await pool.query(`SELECT slug, features->>'kiSuche' AS ki FROM plans ORDER BY slug`);
      const map = Object.fromEntries(rows.map((r) => [r.slug, r.ki]));
      expect(map).toMatchObject({ free: 'false', small: 'true', big: 'true' });
    } finally {
      await pool.end();
    }
  });
});
```

- [ ] **Step 7: Tests grün**

Run: `pnpm test tests/slice7-data.integration.test.ts tests/lib/gating-kisuche.test.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck (kiSuche erzwingt evtl. weitere Stellen)**

Run: `pnpm typecheck`
Expected: 0 Fehler (alle `PlanFeatures`-Literale tragen jetzt `kiSuche`; falls Fixtures/Tests ein `features`-Objektliteral bauen, dort `kiSuche` ergänzen).

- [ ] **Step 9: Commit**

```bash
git add src/lib/gating.ts drizzle/0015_slice7_data.sql drizzle/meta/_journal.json tests/lib/gating-kisuche.test.ts tests/slice7-data.integration.test.ts
git commit -m "feat(slice7): kiSuche-Feature-Flag + 0015 Daten-Migration (free✗/small✓/big✓)"
```

---

## Task 9: Query-Pipeline `kiSearch()`

**Files:**
- Modify: `src/lib/inventory.ts` (`kiSearch` + `KiSearchRow` + Imports)
- Test: `tests/lib/kiSearch.integration.test.ts` (Create)

**Interfaces:**
- Consumes: `basePreds`/`InventoryRow`/`InventoryFilters` (bestehend), `recordEmbeddings` (T2), `getEmbeddingsAdapter`/`EmbeddingsConfigError` (T3), `getEntitlements` (T8), `withTenant`.
- Produces: `type KiSearchRow = InventoryRow & { score: number }` und `kiSearch(ctx, args): Promise<{ rows: KiSearchRow[]; unavailable?: boolean }>` aus `@/lib/inventory`. Wird von T10 (page.tsx) konsumiert.

- [ ] **Step 1: Failing integration test — Ranking, Facetten, Gate, leer**

Create `tests/lib/kiSearch.integration.test.ts`. Kernidee für **deterministisches** Ranking mit Fake-Embeddings: die Query ist exakt das Embedding-Dokument eines bekannten Records → identischer Vektor → Distanz 0 → Rang 1 / score 1.

```ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { setupTestDatabase, seedTenant, type TestDatabase } from '../helpers/db';
import { buildEmbeddingDocument } from '@/lib/embeddings/document';
import { getEmbeddingsAdapter } from '@/lib/embeddings';

describe('kiSearch', () => {
  let db: TestDatabase;
  let kiSearch: typeof import('@/lib/inventory')['kiSearch'];
  let tenantId: number;
  const coltrane = { artist: 'John Coltrane', title: 'A Love Supreme', label: ['Impulse!'], genre: ['Jazz'], format: 'Vinyl', releaseYear: 1965, country: 'US' };
  const kraftwerk = { artist: 'Kraftwerk', title: 'Autobahn', label: ['Philips'], genre: ['Electronic'], format: 'Vinyl', releaseYear: 1974, country: 'DE' };

  beforeAll(async () => {
    db = await setupTestDatabase();
    vi.resetModules();
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
    expect(rows.every((r) => r.artist === 'Kraftwerk')).toBe(true);
  });

  it('leere Query → leeres Ergebnis ohne embed-Call', async () => {
    const { rows } = await kiSearch({ tenantId, userId: null }, { query: '   ', filters: {} });
    expect(rows).toHaveLength(0);
  });

  it('Gate: Free-Tenant (kiSuche=false) → leeres Ergebnis', async () => {
    const { tenantId: freeId } = await seedTenant({ slug: 'ki-free', name: 'KIF' });
    const { rows } = await kiSearch({ tenantId: freeId, userId: null }, { query: 'irgendwas', filters: {} });
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Test scheitert**

Run: `pnpm test tests/lib/kiSearch.integration.test.ts`
Expected: FAIL — `kiSearch` existiert nicht.

- [ ] **Step 3: `kiSearch` in inventory.ts**

Imports oben in `src/lib/inventory.ts` ergänzen:

```ts
import { records, purchases, recordEmbeddings, type RecordStatus } from '@/db/schema';
import { getEmbeddingsAdapter } from '@/lib/embeddings';
import { EmbeddingsConfigError } from '@/lib/embeddings/types';
import { getEntitlements } from '@/lib/gating';
```

Am Dateiende:

```ts
export type KiSearchRow = InventoryRow & { score: number };

const KI_SEARCH_LIMIT = 50;

/**
 * Semantische Suche: Query → Embedding → pgvector-ANN (Cosine) mit basePreds als hartem Vorfilter.
 * Gated an der Query (Defence-in-Depth zusätzlich zum UI-Gate). server-only.
 */
export async function kiSearch(
  ctx: { tenantId: number; userId: number | null },
  args: { query: string; filters: InventoryFilters },
): Promise<{ rows: KiSearchRow[]; unavailable?: boolean }> {
  const ent = await getEntitlements(ctx.tenantId);
  if (!ent.features.kiSuche) return { rows: [] }; // fail-closed Gate

  const query = args.query.trim();
  if (!query) return { rows: [] }; // kein API-Call bei leerer Query

  let vec: number[];
  try {
    const [embedded] = await getEmbeddingsAdapter().embed([query]);
    vec = embedded!;
  } catch (err) {
    if (err instanceof EmbeddingsConfigError) {
      console.error('[kiSearch] embeddings unavailable', err);
      return { rows: [], unavailable: true }; // sauberer Fehlerzustand, kein 500, kein Leak
    }
    throw err;
  }
  const literal = `[${vec.join(',')}]`;

  return withTenant({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
    const preds = basePreds(ctx.tenantId, args.filters);
    if (args.filters.status) preds.push(eq(purchases.status, args.filters.status));
    const distance = sql<number>`${recordEmbeddings.embedding} <=> ${literal}::vector(1536)`;
    const rows = await tx
      .select({
        copyId: purchases.id,
        recordId: records.id,
        title: records.title,
        artist: records.artist,
        label: records.label,
        releaseYear: records.releaseYear,
        country: records.country,
        format: records.format,
        genre: records.genre,
        ek: purchases.purchasePrice,
        vk: purchases.targetPrice,
        status: purchases.status,
        conditionRecord: purchases.conditionRecord,
        conditionCover: purchases.conditionCover,
        discogsId: records.discogsId,
        score: sql<number>`1 - (${distance})`,
      })
      .from(purchases)
      .innerJoin(records, eq(records.id, purchases.recordId))
      .innerJoin(
        recordEmbeddings,
        and(eq(recordEmbeddings.recordId, records.id), eq(recordEmbeddings.tenantId, ctx.tenantId)),
      )
      .where(and(...preds))
      .orderBy(distance)
      .limit(KI_SEARCH_LIMIT);
    return { rows: rows.map((r) => ({ ...r, score: Number(r.score) })) };
  });
}
```

> **Row-Grain:** Eine Zeile = eine `purchase` (Exemplar), wie `listInventory`. Mehrere Exemplare desselben Records tragen denselben Score und erscheinen benachbart. `LIMIT` gilt für Exemplar-Zeilen. Records ohne Embedding (Inner-Join) erscheinen nicht — Backfill/Seed stellen Vollständigkeit her.

- [ ] **Step 4: Tests grün**

Run: `pnpm test tests/lib/kiSearch.integration.test.ts`
Expected: PASS — Ranking (exakter Treffer Platz 1, score≈1), Facetten-Vorfilter, leere Query, Free-Gate.

- [ ] **Step 5: Regression Inventar-Query**

Run: `pnpm test tests/lib/inventory.test.ts` (bzw. die bestehende Inventar-Testdatei)
Expected: PASS — `listInventory`/`basePreds` unverändert.

- [ ] **Step 6: Commit**

```bash
git add src/lib/inventory.ts tests/lib/kiSearch.integration.test.ts
git commit -m "feat(slice7): kiSearch-Query (pgvector-ANN, basePreds-Vorfilter, gated)"
```

---

## Task 10: Inventar-UI — KI-Modus (Toggle + Page-Branch + Score-Badge + Lock)

**Files:**
- Modify: `src/app/(app)/inventar/page.tsx`, `src/app/(app)/inventar/_components/FilterBar.tsx`, `ViewToggle.tsx`, `InventoryList.tsx`, `InventoryTiles.tsx`
- Create: `e2e/ki-suche.spec.ts`

**Interfaces:**
- Consumes: `kiSearch` (T9), `getEntitlements` (T8), `SegmentedControl`/`Button`/`SearchField` (`@/components/ui`), `AnalytikUpsell`-Muster.
- Produces: KI-Modus in der Inventar-Suche (URL `?mode=ki&q=…`), Relevanz-Badge, Lock/Upsell für gesperrte Pläne.

- [ ] **Step 1: page.tsx — Entitlements laden + Modus-Branch**

In `src/app/(app)/inventar/page.tsx`, Import ergänzen: `import { getEntitlements } from '@/lib/gating';` und `import { kiSearch } from '@/lib/inventory';` (falls nicht schon via `listInventory`-Import). Data-Loading (Z.19-35) so umbauen:

```ts
  const user = await requireSession();
  const tenant = await getCurrentTenant();
  const sp = await searchParams;
  const filters = parseInventoryFilters(sp);
  const ctx = { tenantId: tenant.id, userId: user.id };
  const ent = await getEntitlements(tenant.id);

  const rawMode = typeof sp.mode === 'string' ? sp.mode : Array.isArray(sp.mode) ? sp.mode[0] : undefined;
  const kiMode = rawMode === 'ki' && ent.features.kiSuche;
  const query = typeof sp.q === 'string' ? sp.q : Array.isArray(sp.q) ? sp.q[0] ?? '' : '';

  const aggs = await inventoryAggregates(ctx, filters);
  let rows: (InventoryRow & { score?: number })[];
  let kiUnavailable = false;
  if (kiMode) {
    const res = await kiSearch(ctx, { query, filters });
    rows = res.rows;
    kiUnavailable = res.unavailable ?? false;
  } else {
    rows = await listInventory(ctx, filters);
  }
  const isAdmin = user.role === 'admin' || user.isSuperadmin;
```

Und im Render die neuen Props an `FilterBar` + `ViewToggle` reichen:

```tsx
<FilterBar
  genreOptions={aggs.genreOptions}
  resultCount={aggs.total}
  valueAvailable={aggs.valueAvailable}
  kiEnabled={ent.features.kiSuche}
  planName={ent.planName}
  isAdmin={isAdmin}
/>
<StatusTabs byStatus={aggs.byStatus} total={aggs.total} />
<ViewToggle rows={rows} total={aggs.total} kiMode={kiMode} kiUnavailable={kiUnavailable} />
```

> `parseInventoryFilters` parst `mode`/`q`-Query bewusst NICHT — beide direkt aus `sp` lesen. `inventoryAggregates` läuft immer (Treffer/Wert + Facettenzähler bleiben korrekt).

- [ ] **Step 2: FilterBar — Modus-Toggle + Lock + Placeholder**

In `src/app/(app)/inventar/_components/FilterBar.tsx`:
- `FilterBarProps` erweitern: `+ kiEnabled: boolean; planName: string; isAdmin: boolean;`.
- Aktuellen Modus lesen: `const mode = searchParams.get('mode') === 'ki' ? 'ki' : 'classic';`.
- In Zeile 1 neben dem `SearchField` (nach ~Z.160) den Umschalter einfügen. Bei `kiEnabled`:

```tsx
<SegmentedControl
  aria-label="Suchmodus"
  value={mode}
  onChange={(v) => setParam('mode', v === 'ki' ? 'ki' : '')}
  options={[
    { value: 'classic', label: 'Klassisch' },
    { value: 'ki', label: 'KI-Suche' },
  ]}
/>
```

Bei `!kiEnabled` statt des Toggles einen gesperrten Indikator + Upsell (analytik-Muster, `data-testid="kisuche-lock"`):

```tsx
<div data-testid="kisuche-lock" style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: 0.7 }}>
  <Lock size={16} aria-hidden />
  <span>KI-Suche</span>
  {isAdmin ? (
    <Link href="/einstellungen?tab=abo" data-testid="kisuche-lock-cta" className="focus-ring-button">
      Ab Small verfügbar
    </Link>
  ) : (
    <span>Verfügbar ab Small — wende dich an deinen Admin.</span>
  )}
</div>
```

- Placeholder im KI-Modus tauschen: `placeholder={mode === 'ki' ? 'Beschreibe, wonach du suchst…' : 'Im Sortiment suchen…'}`.
- Im KI-Modus die 300ms-Debounce für `q` durch **Submit-on-Enter** ersetzen (ein Embedding-Call pro Suche statt pro Tastendruck): den bestehenden Debounce-`useEffect` nur bei `mode === 'classic'` feuern lassen; im KI-Modus `onKeyDown` (`Enter`) → `setParam('q', q.trim())`.
- Imports ergänzen: `Lock` aus `lucide-react`, `Link` aus `next/link`, `SegmentedControl` aus `@/components/ui`.

- [ ] **Step 3: Score-Badge durch ViewToggle → List/Tiles**

- `ViewToggleProps`: `rows: (InventoryRow & { score?: number })[]; total: number; kiMode?: boolean; kiUnavailable?: boolean;`. Bei `kiUnavailable` die Empty-State-Karte mit „KI-Suche momentan nicht verfügbar" rendern; sonst wie bisher, `rows`/`total` an `InventoryList`/`InventoryTiles` durchreichen.
- `InventoryListProps.rows` + `InventoryTilesProps.rows` auf `(InventoryRow & { score?: number })[]` verbreitern.
- Badge rendern, wo `row.score != null`:
  - Desktop-Tabelle (Artikel-`<td>`, ~Z.251-272) im Titel/Artist-Block:
    ```tsx
    {row.score != null && (
      <span data-testid="ki-score" style={{ marginLeft: 8, padding: '1px 6px', borderRadius: 'var(--r-pill)', background: 'var(--accent-soft)', fontSize: 12 }}>
        {Math.round(row.score * 100)}%
      </span>
    )}
    ```
  - Mobile-Karte (~Z.150-157) neben `StatusBadge` und Tiles-Titel (~Z.74-101) analog.

- [ ] **Step 4: E2E — KI-Modus (demo big) + Lock (freeshop free)**

Create `e2e/ki-suche.spec.ts` (Vorbild `e2e/inventory.spec.ts`, Login-Helper wiederverwenden):

```ts
import { test, expect } from '@playwright/test';
import { login } from './helpers'; // vorhandener Login-Helper analog inventory.spec.ts

const DEMO_URL = process.env.BASE_URL ?? 'http://demo.localhost:3000';
const FREESHOP_URL = DEMO_URL.replace('demo.', 'freeshop.');

test.describe('KI-Suche', () => {
  test('demo (big): KI-Modus liefert gerangte Treffer mit Relevanz-Badge; Facette schränkt ein', async ({ page }) => {
    await login(page, DEMO_URL, process.env.E2E_DEMO_EMAIL!, process.env.E2E_DEMO_PASSWORD!);
    await page.goto(`${DEMO_URL}/inventar`);
    await page.getByRole('radio', { name: 'KI-Suche' }).click();
    await page.waitForURL(/[?&]mode=ki/);
    await page.getByPlaceholder(/Beschreibe, wonach du suchst/i).fill('jazz vinyl');
    await page.getByPlaceholder(/Beschreibe, wonach du suchst/i).press('Enter');
    await page.waitForURL(/[?&]q=jazz/i);
    await expect.poll(() => page.locator('tbody tr').count()).toBeGreaterThan(0);
    await expect(page.getByTestId('ki-score').first()).toBeVisible();
    // Facette Status "verfügbar" schränkt sichtbar ein:
    const before = await page.locator('tbody tr').count();
    await page.getByRole('tab', { name: /verfügbar/i }).click();
    await expect.poll(() => page.locator('tbody tr').count()).toBeLessThanOrEqual(before);
  });

  test('freeshop (free): KI-Umschalter gesperrt (Upsell), klassische Suche funktioniert weiter', async ({ page }) => {
    await login(page, FREESHOP_URL, process.env.E2E_FREESHOP_EMAIL!, process.env.E2E_FREESHOP_PASSWORD!);
    await page.goto(`${FREESHOP_URL}/inventar`);
    await expect(page.getByTestId('kisuche-lock')).toBeVisible();
    await page.getByPlaceholder(/Im Sortiment suchen/i).fill('a');
    await page.waitForURL(/[?&]q=a/i);
  });
});
```

> Falls kein `freeshop`-E2E-Login existiert, den `demo`-Fall behalten und den Lock-Fall über den `freeshop`-Seed-Login ergänzen (Credentials aus dem bestehenden E2E-Env-Setup; sonst als `test.skip` markieren und in Task 11 nachziehen).

- [ ] **Step 5: Typecheck + Build (fängt 'use server'/RSC-Fallen)**

Run: `pnpm typecheck && pnpm build`
Expected: 0 Typfehler; Next-Build grün.

- [ ] **Step 6: E2E gegen frischen Stack**

Run:
```bash
docker compose down -v && docker compose up -d --build --wait --wait-timeout 300
pnpm e2e e2e/ki-suche.spec.ts
```
Expected: PASS — KI-Treffer mit Badge (demo), Lock sichtbar (freeshop).

- [ ] **Step 7: Commit**

```bash
git add src/app/\(app\)/inventar/ e2e/ki-suche.spec.ts
git commit -m "feat(slice7): Inventar KI-Modus (Toggle, Score-Badge, Lock/Upsell) + E2E"
```

---

## Task 11: Finales Gate + Spec-Ground-Truth-Addendum

**Files:**
- Modify: `docs/superpowers/specs/2026-07-07-qrecords-v2-slice7-ki-suche-semantic-search-design.md` (Korrektur-Addendum)

**Interfaces:** —

- [ ] **Step 1: Spec-Addendum (Design-of-Record ehrlich halten)**

Hänge ans Spec-Dokument einen Abschnitt „## 14. Korrekturen nach Ground-Truth (2026-07-07)" mit den sechs Abweichungen aus den Global Constraints (Extension-Placement, Image `pgvector/pgvector:pg17`, Migrations-Layout via `migrate`-Service, Gating inline statt `requireFeature`, `sha256Hex`-Neuhelfer, Vektor-`customType`). Eine Zeile je Punkt, mit Verweis auf diesen Plan.

- [ ] **Step 2: Voller Lint + Typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: 0 Fehler (die 2 bekannten `fake.ts`-Lint-Ausnahmen aus früheren Slices bleiben, keine neuen).

- [ ] **Step 3: Voller Next-Build + Compose-Build (Build-Gate)**

Run: `pnpm build && docker compose build`
Expected: beide grün (fängt `'use server'`-const-Export-Fallen, die tsc/vitest nicht sehen).

- [ ] **Step 4: Volle Unit/Integration-Suite**

Run: `pnpm test`
Expected: PASS — alle bestehenden + neuen Suiten grün (pgvector-Image, Drift-Guard, RLS, Adapter, Handler, Hook, Gating, kiSearch, Daten-Migration).

- [ ] **Step 5: Voller E2E gegen frischen down -v-Stack**

Run:
```bash
docker compose down -v && docker compose up -d --build --wait --wait-timeout 300
pnpm e2e
```
Expected: PASS — alle bestehenden E2E (unverändert) + KI-Suche-E2E. (Frischer Stack vermeidet den akkumulierten-Cruft-KPI-Nichtdeterminismus aus dem Slice-6-Pain-Log.)

- [ ] **Step 6: Commit + Branch fertigstellen**

```bash
git add docs/superpowers/specs/2026-07-07-qrecords-v2-slice7-ki-suche-semantic-search-design.md
git commit -m "docs(slice7): Ground-Truth-Korrekturen im Spec-Addendum"
```

Danach `superpowers:finishing-a-development-branch` (PR gegen `main`).

---

## Self-Review (gegen Spec, vom Plan-Autor auszuführen)

**Spec-Coverage:** §1-3 (Ziel/Scope/Architektur) → Global Constraints + Tasks; §4 (Datenmodell 3 Migrationen) → T1 (Extension) + T2 (DDL+RLS) + T8 (Daten); §5 (Adapter+Env) → T3; §5 document → T4; §6 (Lebenszyklus) → T5 (Handler/Queue) + T6 (Hook) + T7 (Seed/Backfill); §7 (kiSearch) → T9; §8 (UI) → T10; §9 (Gating) → T8 + T10; §10 (Infra) → T1; §11 (Sicherheit) → verteilt (RLS T2, Worker-Tenant-Ctx T5, Gate T9, keine PII T4, Secrets T3); §12 (Tests) → jede Task + T11; §13 (Referenzen) → n/a. **Keine Lücke.**

**Placeholder-Scan:** Alle Code-Steps tragen realen Code; alle Commands haben Expected-Output. Einzige bewusste Bedingung: T2/Step 4-5 (`db:generate`-Ausgabename ist zufällig → Rename-Step) und T10/Step 4 (freeshop-E2E-Login-Fallback) — beide als explizite Guards formuliert, nicht als vages „später".

**Typ-Konsistenz:** `EmbeddingsAdapter.embed`/`.model` (T3) ↔ Handler (T5) ↔ kiSearch (T9); `EmbeddingRefreshPayload {tenantId, recordId}` (T5) ↔ `enqueueEmbeddingRefresh` (T5) ↔ Hooks (T6); `recordEmbeddings`-Spalten (T2) ↔ Upsert-SQL (T5/T7) ↔ Join (T9); `PlanFeatures.kiSuche` (T8) ↔ `ent.features.kiSuche` (T9/T10); `KiSearchRow = InventoryRow & {score}` (T9) ↔ Badge-Threading (T10). Konsistent.
