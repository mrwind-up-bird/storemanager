# Q-Records v2 — Slice 7: KI-Suche (Semantische Vektor-Suche im Inventar) (Design/Spec)

**Datum:** 2026-07-07
**Status:** Design abgenommen (Brainstorming 2026-07-07), bereit für Implementierungsplan
**Branch:** `feat/v2-slice7-ki-suche-semantic-search`
**Vorgänger:** Slice 6 (Onboarding + Superadmin + Billing) gemerged via PR #8 (`cebb1b4`) + PR #9 (`9cc8bee`); `main` @ `9cc8bee`
**Dachdokument:** `2026-06-25-qrecords-v2-architecture-overview.md`

---

## 1. Ziel & Scope

Die Roadmap-Zeile 7 (`KI-Suche + GDPR/ELSTER + Social + POS`) bündelt **vier unabhängige Subsysteme**. Nach der Slice-Disziplin (ein Spec = ein lauffähiges, testbares Subsystem) wird sie zerlegt; dieser Slice baut **ausschließlich die KI-Suche**. Der Rest wandert als eigene Roadmap-Zeilen nach hinten (§ Nicht-Ziele).

Slice 7 gibt dem Personal eine **semantische Suche über den Bestand**: eine Freitext-/Vibe-Anfrage („melancholischer Herbst-Jazz auf Vinyl, gut erhalten") wird per Embedding in einen Vektor übersetzt und gegen pro Tenant vorab berechnete Record-Embeddings per **pgvector**-Ähnlichkeit gerangt — eingeschränkt durch dieselben harten Facetten wie die klassische Suche.

1. **Embeddings-Adapter** hinter `EMBEDDINGS_DRIVER=fake|http` (Muster wie Billing/Discogs); `http` = OpenAI `text-embedding-3-small` (1536-dim), `fake` = deterministischer Pseudo-Vektor (Default, trägt alle Tests/E2E offline).
2. **pgvector-Store**: neue tenant-scoped Tabelle `record_embeddings` (volle RLS), HNSW-Index, `content_hash`-Idempotenz.
3. **Index-Lebenszyklus** über den bestehenden pg-boss-Worker: inkrementell bei jedem Ankauf/Record-Update, plus einmaliger Backfill, plus Seed-Inline-Berechnung.
4. **Query-Pipeline** `kiSearch()`: Query-Embedding → pgvector-ANN mit Facetten-Vorfilter → gerangte `InventoryRow[]` mit Relevanz-Score.
5. **UI**: separater **KI-Modus** in der bestehenden Inventar-Suchleiste (Desktop + Mobile); klassische Keyword-Suche unangetastet.
6. **Feature-Gating**: neues Flag `kiSuche` je Plan (Small/Big an, Free gesperrt), serverseitig an der Action erzwungen, Upsell/Lock in der UI.

**Nicht-Ziele (bewusst raus):**
- **GDPR/ELSTER-Export, Social-Publishing, POS-Integrationen (SumUp/Square)** — je eigener Slice (8–10); die Interface-Stubs in `src/lib/integrations/index.ts` bleiben unangetastet.
- **Kundenseitige/öffentliche semantische Suche** (Schaufenster) — nur intern hinter Auth; anonymer Zugang, Caching, Rate-Limiting/Abuse-Schutz und Kosten-Deckelung sind ein separater Folge-Slice.
- **Semantisches Re-Ranking der klassischen Keyword-Suche / Hybrid-Modus** — die beiden Modi bleiben getrennt.
- **Konversationelle Suche / RAG / Antwort-Generierung** — nur Retrieval (Ähnlichkeitsrangliste), kein LLM-Chat.
- **Query-Caching / Embedding-Cache pro Anfrage** — 1 Embedding-Call je Suche ist billig genug; Optimierung erst bei Bedarf.
- **Self-hosted Embedding-Modell** — externer API-Call, `http`-Driver; Provider-Wechsel (z. B. Voyage) ist reiner Config-Swap am gleichen Interface.

## 2. Ausgangslage (bereits vorhanden, wird benutzt statt neu gebaut)

| Baustein | Fundort | Nutzung |
|---|---|---|
| Inventar-Query `listInventory(ctx, f)` + `InventoryRow` (Zeile = Exemplar/`purchase`) | `src/lib/inventory.ts:66–96`, `:17–33` | Ergebnis-Shape + Render-Karten wiederverwenden |
| Facetten-Prädikate `basePreds()` (q/format/genre/condition, Status separat) | `src/lib/inventory.ts:48–64` | als **harte Vorfilter** im KI-Query wiederverwenden |
| `parseInventoryFilters(sp)` (Whitelisting) | `src/lib/inventory.ts:155–181` | Facetten aus URL im KI-Modus identisch parsen |
| `records` (id/tenantId/title/artist/label[]/country/releaseYear/format/genre[]/discogsId/hash) | `src/db/schema.ts:147–177` | Embedding-Quelle (Dokument-Felder) |
| `purchases` (status-Enum, condition, prices, recordId) | `src/db/schema.ts:199–240` | Join-Partner für Status/Zustand-Facetten |
| RLS-Wrapper `withTenant(ctx, fn)` (+ `withOwner`) | `src/db/tenant.ts:28–44` | jeder Embedding-Zugriff tenant-scoped |
| Record-Schreibpunkt `acquireOne()` (records-Upsert Z.53–80, in Aufrufer-Tx) | `src/lib/ankauf.ts:38–100` | **Andockpunkt** für inkrementellen Re-Index |
| pg-boss-Queue-Registry + `startWorker()` | `src/worker/index.ts:26–31`, `:50–144` | neue Queue `embeddingRefresh` |
| Enqueue-Muster `enqueueDiscogsListing({tenantId, …})` | `src/lib/jobs.ts:33–42` | Vorbild für `enqueueEmbeddingRefresh` |
| Gating `getEntitlements()`, `PlanFeatures`, Upsell-Muster | `src/lib/gating.ts:11–171`, `analytik/page.tsx:22–38`, `AnalytikUpsell.tsx` | Flag `kiSuche` + Lock analog |
| Plan-Daten (`free`/`small`/`big`) | `drizzle/0012_slice6_data.sql:8–11` | Feature-Matrix erweitern |
| Driver-Muster (env-Enum + Cross-Field-Pflicht + gecachter Getter) | `src/env.ts:55–84`, `src/lib/billing/{index,fake,stripe,types}.ts` | 1:1 für Embeddings nachbauen |
| Migrations-/RLS-Konvention (DDL/RLS getrennt, Journal, `qr_app`-Grants) | `drizzle/0011_slice6_rls.sql`, `drizzle/meta/_journal.json` | für `record_embeddings` nachbauen |
| `sha256`-Helper | `src/db/hash.ts` | `content_hash` des Embedding-Dokuments |

**Fehlt:** pgvector (kommt im Repo nirgends vor — `CREATE EXTENSION` ist neuer Präzedenzfall), jegliche Embedding-Infrastruktur, KI-Modus-UI.

> **Hinweis Interface-Stub:** `src/lib/integrations/index.ts:61–69` skizziert aus Slice 0 einen `AiSearchAdapter` (`searchRecords`+`indexRecord`, `tenantId:number`). Er ist interface-only/aspirational und passt nicht zum v2-Muster (vermengt Embedding-Erzeugung und Query). Slice 7 **ersetzt** ihn konzeptionell durch die sauberere Trennung *Embeddings-Adapter* (nur `embed`) + *`kiSearch`-Query*; der Stub bleibt physisch stehen (andere Zukunfts-Slices referenzieren Nachbar-Interfaces), wird aber nicht implementiert.

## 3. Architektur-Entscheidung

**Semantische Vektor-Suche (nicht NL→Filter), intern, separater Modus, Fake-Driver-first.** Begründung der vier Weichen (Brainstorming 2026-07-07):
- **Vektor statt NL→Filter:** Vibe-Discovery über unscharfe Treffer ist das gewünschte Produktverhalten; entspricht dem ursprünglichen `AiSearchAdapter`-Gedanken.
- **Intern (Mitarbeiter/Inventar):** kleinste, sicherste, voll testbare Fläche — hinter Auth, tenant-RLS, keine anonyme Fläche, kein Missbrauchs-/Rate-Limiting. Schaufenster ist Folge-Slice.
- **Separater KI-Modus mit Facetten als harten Vorfiltern:** klar getrennt, erklärbar, Rückfall auf die exakte Keyword-Suche (Katalog-Nr, exakter Titel) garantiert.
- **pgvector im bestehenden Postgres** statt externem Vektor-Store: bleibt im Stack (Drizzle/RLS/withTenant/Testcontainers), tenant-Isolation kommt gratis über dieselbe RLS-Disziplin.
- **Externer Embedding-Provider (OpenAI `text-embedding-3-small`), Platform-Key, `fake` als Default:** null Modell-Serving-Ops; Record-Metadaten sind öffentliche Discogs-Daten (geringe Sensibilität); Provider-Wechsel = Config.

Verworfen: NL→strukturierter Filter (deterministisch, aber kein Vibe-Matching); Hybrid (größter Scope); self-hosted Modell (Ops-Last für internes Tool über öffentliche Metadaten); externer Vektor-Store (zusätzlicher Service, RLS neu erfinden).

## 4. Datenmodell (drei Migrationen, Konvention DDL/RLS getrennt)

1. **`0013_slice7_pgvector.sql`** — `CREATE EXTENSION IF NOT EXISTS vector;` (eigene Migration, **vor** der Tabellen-DDL).
2. **`0014_slice7_embeddings.sql`** (DDL, drizzle-kit; Drizzle-Schema in `src/db/schema.ts` ergänzen — pgvector-Spalte als `customType`):

```
record_embeddings (tenant-scoped, volle RLS wie alle Tenant-Tabellen):
  id           serial PK
  tenantId     integer NOT NULL → tenants.id
  recordId     integer NOT NULL → records.id
  embedding    vector(1536) NOT NULL
  contentHash  varchar(64)  NOT NULL          -- sha256 des Embedding-Dokuments (Idempotenz)
  model        text NOT NULL                  -- z.B. 'text-embedding-3-small' | 'fake-v1'
  updatedAt    timestamptz NOT NULL DEFAULT now()
  UNIQUE (tenantId, recordId)                 -- genau ein Embedding pro Record pro Tenant
  INDEX hnsw   (embedding vector_cosine_ops)  -- ANN; USING hnsw
```

3. **`0015_slice7_rls.sql`** — identisches Muster wie `0011_slice6_rls.sql`: `ENABLE`+`FORCE ROW LEVEL SECURITY`, `tenant_id`-Default via `NULLIF(current_setting('app.current_tenant', true), '')::int`, Policies `tenant_isolation` (USING+WITH CHECK) + `superadmin_bypass`, `GRANT SELECT,INSERT,UPDATE,DELETE ON record_embeddings TO qr_app`, `GRANT USAGE,SELECT ON SEQUENCE record_embeddings_id_seq TO qr_app` (load-bearing für INSERT).

- **Dimension fest auf 1536** (OpenAI `text-embedding-3-small`); der Fake-Driver liefert exakt 1536 Werte. Ein Modell-/Dimensionswechsel ist eine bewusste spätere Migration (Spalte + Re-Embed-Backfill), kein Laufzeitparameter.
- **Boot-Assertion / Drift-Guard:** `record_embeddings` hat `tenant_id` → wird vom Guard in `src/db/assertions.ts` automatisch introspiziert und braucht rowsecurity+force+policy (durch Migration 0015 erfüllt). **Bindend (Lehre aus `be9a824`):** die Mock-Baseline `SOUND_TENANT_ID_TABLES` in `tests/db/assertions.test.ts` muss `record_embeddings` mitführen, sonst ist die Suite ab Tag 1 rot — obwohl der reale RLS-Pfad korrekt ist.
- **RLS-Test nicht-vakuos:** beide Tenants besitzen je ≥1 Embedding-Zeile; A sieht exakt seine, B exakt seine (analog `subscriptions`-Test).

## 5. Embeddings-Adapter (`src/lib/embeddings/`)

Spiegel des Billing/Discogs-Musters; Auswahl via `EMBEDDINGS_DRIVER` (`'fake'` Default, `'http'`).

```ts
// types.ts
export interface EmbeddingsAdapter {
  embed(texts: string[]): Promise<number[][]>; // je Text ein 1536-dim Vektor, Reihenfolge-stabil
  readonly model: string;                      // fürs `model`-Feld / Drift-Erkennung
}
export class EmbeddingsConfigError extends Error {}
```

- **`fake.ts`** (Default): deterministischer, seed-basierter Pseudo-Vektor aus `sha256(text)` → 1536 Floats, **unit-normalisiert** (damit Cosine-Distanz sinnvoll rangt). Reproduzierbar, offline, `model = 'fake-v1'`. Trägt alle Unit-/Integration-/E2E-Tests.
- **`http.ts`**: `POST {EMBEDDINGS_API_URL}/embeddings`, Body `{ model, input: texts }`, `Authorization: Bearer {EMBEDDINGS_API_KEY}`. Batch (ein Call für n Texte). Fehler/kein Key → `EmbeddingsConfigError` (graceful, siehe §7). API-Key wird **nie geloggt**, nie an den Client gereicht.
- **`index.ts`**: gecachter Getter `getEmbeddingsAdapter(): EmbeddingsAdapter` — `env.EMBEDDINGS_DRIVER === 'fake' ? createFakeAdapter() : createHttpAdapter()` (Singleton wie `getBillingAdapter`).
- **`document.ts`** (server-only, testbar isoliert): `buildEmbeddingDocument(record): string` — deterministisch aus `artist — title — label(s, join ', ') — genre(s) — format — releaseYear — country` (leere Felder ausgelassen, stabile Reihenfolge). `contentHash = sha256(doc)`.
- **`src/env.ts`**: `EMBEDDINGS_DRIVER: z.enum(['http','fake']).default('fake')`, `EMBEDDINGS_API_KEY: z.string().min(1).optional()`, `EMBEDDINGS_MODEL: z.string().default('text-embedding-3-small')`, `EMBEDDINGS_API_URL: z.string().url().default('https://api.openai.com/v1')`. Cross-Field-Pflicht in `parseEnv()` (analog Stripe, `env.ts:76–84`): `EMBEDDINGS_DRIVER === 'http'` ⇒ `EMBEDDINGS_API_KEY` erforderlich, sonst Throw beim Modul-Load. `.env.example` + `.env.compose` ergänzen (Compose bleibt `fake`).

## 6. Index-Lebenszyklus (pg-boss-Worker)

- **Enqueue** `enqueueEmbeddingRefresh(payload: { tenantId: number; recordId: number }): Promise<void>` in `src/lib/jobs.ts` (Muster `enqueueDiscogsListing`, `retryLimit:5, retryBackoff:true`). Neue Queue-Konstante `embeddingRefresh` in `QUEUE` (`src/worker/index.ts:26–31`) + `boss.createQueue` + `boss.work` in `startWorker()`.
- **Handler** `src/worker/embeddingRefresh.ts` (bzw. `src/lib/embeddings/refresh.ts`), pro Job im Tenant-Kontext (`withTenant({tenantId, userId:null})`):
  1. Record laden (`records` WHERE id=recordId). Fehlt (Rollback/gelöscht) → no-op.
  2. `doc = buildEmbeddingDocument(record)`, `hash = sha256(doc)`.
  3. Vorhandene `record_embeddings`-Zeile lesen; `contentHash === hash` **und** `model === adapter.model` → no-op (kein API-Call).
  4. Sonst `adapter.embed([doc])` → Upsert (`ON CONFLICT (tenantId, recordId) DO UPDATE`) `embedding/contentHash/model/updatedAt`.
- **Inkrementeller Trigger:** nach dem records-Upsert in `acquireOne` (nach `src/lib/ankauf.ts:80`, `recordId` bekannt) wird der Record zum Re-Index vorgemerkt; das `enqueueEmbeddingRefresh` feuert **nach Commit** der Ankauf-Tx (kein Enqueue innerhalb der Tenant-Tx — Rollback-sicher), am selben Ort/Muster, an dem Einzel-/Batch-Ankauf ihre Nacharbeiten anstoßen. Gilt für Einzel-Ankauf, Sammlungs-/Batch-Ankauf und Barcode-Scan-Ankauf (alle laufen durch `acquireOne`).
- **Backfill** `scripts/embeddings-backfill.ts` (`pnpm embeddings:backfill`): reiht pro Tenant alle Records ohne aktuelles Embedding ein — für Bestandsdaten und nach Modellwechsel. Idempotent über den `contentHash`-Guard.
- **Seed:** `scripts/seed.ts` berechnet für die geseedeten Records die Embeddings **inline** über `getEmbeddingsAdapter()` (in Dev/CI = `fake`, deterministisch) und schreibt sie direkt — damit die KI-Suche in E2E **ohne** laufenden Worker und ohne Timing-Race sofort Daten hat. Re-Seed überschreibt idempotent.

## 7. Query-Pipeline (KI-Modus)

Server-Action/Query `kiSearch(ctx, args: { query: string; filters: InventoryFilters }): Promise<{ rows: KiSearchRow[] }>` (`KiSearchRow = InventoryRow & { score: number }`), server-only, in `withTenant`:
1. **Gate:** `requireFeature(entitlements, 'kiSuche')` — serverseitig, nicht nur UI (§9).
2. Leerer/whitespace `query` → leeres Ergebnis ohne API-Call.
3. `[[vec]] = await getEmbeddingsAdapter().embed([query])`.
4. SQL (ein Statement): `purchases ⨝ records ⨝ record_embeddings` **WHERE** = wiederverwendete `basePreds(filters)` inkl. Status-Prädikat **ORDER BY** `record_embeddings.embedding <=> $vec` (Cosine-Distanz, `vector_cosine_ops`) **LIMIT k** (Default 50). `score = 1 - distance`, absteigend zurückgegeben. Explizite `eq(*.tenantId, …)` als Defence-in-Depth neben RLS (wie `inventory.ts:50–51`).
5. **Failure-Handling:** `EmbeddingsConfigError`/Provider-Fehler → sauberer Fehlerzustand in der UI („KI-Suche momentan nicht verfügbar"), **kein** 500, kein Leak von Provider-Details/Keys.

Records ohne Embedding erscheinen (Inner-Join) nicht — Backfill/Seed stellen Vollständigkeit her; neu angekaufte Records tauchen auf, sobald der Worker sie indexiert hat (Sekunden). Facetten bleiben **harte** Vorfilter; die klassische Keyword-Suche (`listInventory`) bleibt vollständig unangetastet.

## 8. UI (Inventar, intern — Desktop + Mobile)

Additive Erweiterung der bestehenden Suchleiste (`src/app/(app)/inventar/_components/FilterBar.tsx`), **kein** neuer Screen:
- **Modus-Umschalter** „Klassisch ⇄ KI-Suche" neben dem Suchfeld (Design-System-Tokens/Primitives, `focus-ring`, `aria`-Label, Tastaturbedienbar).
- Im KI-Modus: Platzhalter „Beschreibe, wonach du suchst…"; Submit ruft `kiSearch` (Facetten-Controls bleiben sichtbar/wirksam als Vorfilter). Ergebnisliste = bestehende `InventoryList`-Karten, ergänzt um ein kleines **Relevanz-Badge** (Score, z. B. Prozent). Leerer/Fehlerzustand als Karte.
- Der Modus-Zustand lebt in der URL (`?mode=ki&q=…`), damit Back-Navigation/Deep-Link wie bei den bestehenden Facetten funktioniert.
- **Gating:** fehlt `ent.features.kiSuche`, ist der KI-Umschalter **gesperrt** (Schloss-Indikator + Upsell wie `AnalytikUpsell`: „Verfügbar ab Small", CTA `/einstellungen?tab=abo` nur für `admin`, sonst Hinweistext). Klassische Suche bleibt für alle Pläne nutzbar.
- Mobile (Slice-5-Suchfeld/Bottom-Sheet): identischer Umschalter; kein Layout-Shift, Desktop-≥768px-Verhalten unverändert.

## 9. Feature-Gating

- **Shape:** `PlanFeatures` (`src/lib/gating.ts:11–20`) += `kiSuche: boolean`. `FREE_FALLBACK_ENTITLEMENTS` += `kiSuche: false` (fail-closed).
- **Feature-Matrix** (Daten-Migration `0016_slice7_data.sql`, Nachfolger von `0012_slice6_data.sql`, überschreibt `plans.features`):

| Plan | analytik | discogsListing | **kiSuche** |
|---|---|---|---|
| free | ✗ | ✗ | **✗** |
| small | ✓ | ✓ | **✓** |
| big | ✓ | ✓ | **✓** |

- **Enforcement:** `kiSearch` ruft `requireFeature(ent, 'kiSuche')` (Action ist die Sicherheitsgrenze, nicht die UI). Die Inventar-Page lädt `getEntitlements(tenant.id)` und reicht `ent.features.kiSuche` an die `FilterBar`, um den Umschalter zu sperren/freizugeben. Kein neuer Read-Query läuft für gesperrte Tenants.
- Seed-Konsequenz: `demo`=`big` und `vinylcave`=`small` haben KI-Suche; der bestehende `freeshop`=`free` ist gesperrt → deterministisches Ziel für die Gating-E2E (§12).

## 10. Infra/Ops (bindend)

- **Postgres-Image mit pgvector:** `postgres:16` führt die `vector`-Extension **nicht** mit. `docker-compose.yml` (db-Service) auf `pgvector/pgvector:pg16` umstellen (bzw. Extension ins eigene DB-Image bauen). Ohne das schlägt Migration `0013` fehl.
- **Migrations-Reihenfolge:** `0013` (Extension) vor `0014` (Tabelle) — im Journal `drizzle/meta/_journal.json` entsprechend registriert; `pnpm db:migrate` (`runMigrations`, `qr_owner`) läuft in Journal-Reihenfolge.
- **Boot-Assertion (optional, empfohlen):** `docker/entrypoint-web.sh` um eine Prüfung ergänzen, dass `vector` in `pg_extension` vorhanden ist (früher, klarer Fehlschlag statt kryptischem Migrationsfehler).
- Keine neuen Services, kein neuer Worker-Prozess (bestehende pg-boss-Worker-Instanz übernimmt die neue Queue).

## 11. Sicherheit & Invarianten (bindend)

1. **RLS-Isolation** ausschließlich via `withTenant`/`withSuperadmin`/`withOwner`; `record_embeddings` voll tenant-RLS (ENABLE+FORCE+Policies), `qr_app`-Grants inkl. Sequence. Kein Cross-Tenant-Leak über den ANN-Index (Query läuft im Tenant-Kontext, `eq(tenantId)` zusätzlich).
2. **Worker schreibt Embeddings nur im Tenant-Kontext** (`withTenant(payload.tenantId)`); der Job-Payload trägt `tenantId` explizit, kein impliziter Owner-Bypass.
3. **`kiSearch` ist gated an der Action** (`requireFeature('kiSuche')`), nie nur in der UI; `getEntitlements` fällt bei unbekanntem Plan fail-closed auf Free (kein Feature) zurück.
4. **Rollen:** KI-Suche ist wie das übrige Inventar Staff-Werkzeug; `kunde` hat im `(app)`-Inventar ohnehin keinen Zugriff — keine neue Fläche für Kundenkonten.
5. **Secrets:** `EMBEDDINGS_API_KEY` nur serverseitig (`src/env.ts`, `server-only`), nie geloggt, nie an den Client. Provider-Fehlermeldungen werden nicht durchgereicht.
6. **Preis/Kosten:** ein Embedding-Call je Suche und je geänderten Record; der `contentHash`-Guard verhindert Re-Embeds unveränderter Records (Kosten- und Rate-Schutz).
7. **Keine PII im Embedding-Dokument:** nur Release-Metadaten (artist/title/label/genre/format/year/country) — keine Preise, keine Lieferanten-/Kundendaten, kein EK.
8. **Determinismus der Tests:** `fake`-Driver ist Default in Dev/CI/E2E; kein Test hängt an einem echten Provider oder Netzwerk.

## 12. Tests & Gates

**Unit (Vitest):** `buildEmbeddingDocument` (deterministisch, Feldreihenfolge, leere Felder), `sha256`-`contentHash`-Stabilität, Fake-Adapter (Determinismus gleicher Text → gleicher Vektor, Dimension 1536, Unit-Norm), `parseEnv` Cross-Field (`http` ohne Key wirft; `fake` ohne Key ok), `kiSearch`-Score-Mapping (Distanz→Score, Sortierung), Gating-Matrix (`kiSuche` je Plan, Free-Fallback).

**Integration (Testcontainers, mit pgvector-Image):**
- **RLS auf `record_embeddings` nicht-vakuos** (beide Tenants je ≥1 Zeile, exakte Sichtbarkeit).
- **Drift-Guard grün** mit `record_embeddings` (real) + Mock-Baseline `SOUND_TENANT_ID_TABLES` erweitert.
- **Refresh-Handler:** Upsert bei neuem Record; **kein** Re-Embed bei unverändertem `contentHash`; Re-Embed bei geändertem Dokument/Modell; fehlender Record → no-op.
- **`kiSearch`-Ranking** mit Fake-Embeddings: erwartete Reihenfolge, Facetten-Vorfilter (Status/Genre/Format/Zustand) schränkt Treffer hart ein.
- **Ankauf-Hook:** nach `acquireOne`/Ankauf-Action ist eine `embeddingRefresh`-Job eingereiht (bzw. Embedding vorhanden), Rollback → kein Orphan-Effekt.
- **Gating-Gate:** `kiSearch` für Free-Tenant wirft/verweigert.

**E2E (Playwright, Stack mit `EMBEDDINGS_DRIVER=fake` + `docker compose down -v`, deterministisch):**
1. `demo` (big): Inventar → KI-Modus → Vibe-Anfrage → gerangte Treffer mit Relevanz-Badge; ein Facetten-Filter (z. B. Status „verfügbar") schränkt die Treffer sichtbar ein.
2. Frisch angekaufter Record erscheint nach kurzer Worker-Verarbeitung in der KI-Suche (oder: Seed-Inline stellt Baseline sicher; neuer Ankauf → Treffer).
3. `freeshop` (free): KI-Umschalter gesperrt (Upsell/Lock), klassische Suche weiter nutzbar.

**Gates (wie alle Slices):** `pnpm lint` + `pnpm typecheck` grün; **`pnpm build` (Next) + `docker compose build` grün** (Build-Gate — fängt `'use server'`-Fallen, die tsc/vitest nicht sehen); alle bestehenden Unit/Integration + 64 E2E bleiben grün, neue Tests grün; finaler E2E-Lauf gegen frischen `down -v`-Stack.

## 13. Referenzen

- Dachdokument: `docs/superpowers/specs/2026-06-25-qrecords-v2-architecture-overview.md` (§5 Roadmap Slice 7 — hier zerlegt in Slices 7–10)
- Muster: Billing-Adapter (`src/lib/billing/{index,fake,stripe,types}.ts`), Discogs-Adapter (`src/lib/discogs/`), Gating (`src/lib/gating.ts` + `analytik` Upsell), Tenant-Kontext (`src/db/tenant.ts`), Inventar-Query (`src/lib/inventory.ts`), Ankauf (`src/lib/ankauf.ts`), Worker/Jobs (`src/worker/index.ts`, `src/lib/jobs.ts`), Migrations-/RLS-Konvention (`drizzle/0011_slice6_rls.sql`), Env-Driver-Muster (`src/env.ts`)
- Interface-Stub (ersetzt, nicht implementiert): `src/lib/integrations/index.ts:61–69` (`AiSearchAdapter`)
- pgvector: Extension `vector`, Operator `<=>` (Cosine mit `vector_cosine_ops`), HNSW-Index; Image `pgvector/pgvector:pg17` (siehe §14)
- Provider: OpenAI `text-embedding-3-small` (1536-dim); Alternative bei multilingualem Bedarf: Voyage `voyage-3` (reiner Config-Swap am `EmbeddingsAdapter`)

## 14. Korrekturen nach Ground-Truth (2026-07-07)

Die Umsetzung (Plan `docs/superpowers/plans/2026-07-07-…-slice7-…md`, SDD T1–T11) hat mehrere Spec-Annahmen gegen das echte v2-Repo verifiziert und korrigiert. Diese Sektion hält den Design-of-Record ehrlich.

**Vor der Umsetzung (Ground-Truth-Fan-out) erzwungen:**
1. **`CREATE EXTENSION vector` ist KEINE Migration (0013).** Migrationen laufen als `qr_owner` (NOSUPERUSER); die Extension braucht SUPERUSER. Sie liegt im Init-Pfad (`docker/postgres/init/02-extensions.sql`) + im Testcontainer-Admin-Pool (`tests/helpers/db.ts` **und** `tests/migration.integration.test.ts`) VOR `runMigrations`. `docker/entrypoint-web.sh` prüft `pg_extension` fail-closed.
2. **DB-Image = `pgvector/pgvector:pg17`** (Compose + Testcontainers), nicht `postgres:16`. Kein `-alpine`-Tag für pgvector.
3. **Migrationen laufen im `migrate`-Compose-Service / `runMigrations`** (Drizzle-Migrator liest `_journal.json`), nicht im Entrypoint. Handgeschriebene Einträge brauchen strikt steigendes `when`.
4. **Kein `requireFeature`-Helper** — Gating inline (Render-Branch analytik-Muster in page.tsx + fail-closed Re-Check in `kiSearch`).
5. **Neuer `sha256Hex`-Helper** (kein generischer sha256; `recordHash` hat andere Shape) + **selbst-definierter `vector1536` customType** (kein Präzedenzfall) — DDL via `db:generate` (0013), HNSW-Index handangehängt.
6. **`kiSuche` fließt nur, wenn `mergeEntitlements` (gating.ts) den Key explizit setzt** (`kiSuche: pf.kiSuche === true`) — sonst still false trotz DB-Wert.

**Während der Umsetzung entdeckt (E2E gegen den echten Stack):**
7. **`kiSearch` darf den Freitext NICHT als Keyword-Vorfilter anwenden.** Die Seite reicht `filters` (inkl. `q`) an `kiSearch`; `basePreds` würde `q` als `ILIKE` anwenden → jede semantische Vibe-Query, die kein Literal-Substring ist, liefert 0 Zeilen. `kiSearch` strippt `q` vor `basePreds` (Freitext = semantische Query; nur Facetten format/genre/condition/status sind harte Vorfilter).
8. **`record_embeddings.record_id → records.id` bleibt `ON DELETE no action`** (Haus-Konvention wie `purchases`/`wishlist_matches`) — Record-Kinder werden explizit child-first gelöscht (E2E-Cleanup `purgeBlueLines` löscht jetzt record_embeddings vor records), KEIN CASCADE. Die App hat keinen Record-Delete-Pfad.
9. **Runtime-Fakt server-only:** `server-only` wirft unter reinem `tsx`; seed/worker/migrate/**embeddings-backfill** laufen als esbuild-CJS-Bundles mit `--alias:server-only`-Stub (Dockerfile). `embeddings:backfill` wurde als 4. Bundle in das Runner-Image aufgenommen; echtes Kommando: `docker compose run --rm worker node /app/embeddings-backfill.cjs` (nicht `pnpm embeddings:backfill`/tsx). Entry-Guard spiegelt `seed.ts` (self-run unter leerem `import.meta.url`).
10. **Score-Badge rendert in beiden Layouts** (Desktop-Tabelle + `.qr-mobile-only`-Karte); E2E scoped auf die sichtbare `tbody`.
