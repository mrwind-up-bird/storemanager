# `/inventar` Performance — Keyset-Paging, records-Indexes, SQL-Aggregate

**Datum:** 2026-07-15
**Status:** Design freigegeben, bereit für Implementierungsplan
**Betrifft:** `src/app/(app)/inventar/*`, `src/lib/inventory.ts`, `src/db/schema.ts`, neue Drizzle-Migration

## Problem

`/inventar` (demo-Tenant, live auf `demo.qrsm.store`) lädt bei 12.606 Records **22–60 s**. Ursache
per Code-Analyse (nicht Cache-Mangel):

1. **Kein Paging.** `listInventory()` (`src/lib/inventory.ts:68`) hat kein `LIMIT` — zieht den
   vollen Join `purchases ⋈ records` für den ganzen Tenant, sortiert nach `artist, title` und gibt
   **alle** Zeilen an `ViewToggle`. Next.js serialisiert 12.606 Zeilen als RSC-Payload
   (~1,9 MB / ~22,8 s im Netzwerk-Trace). Dominanter Faktor.
2. **Aggregate ziehen tausende Zeilen zum JS-Summieren.** `inventoryAggregates()` (`:100`) feuert
   3 Queries; `availRows` (`:128`) holt **alle ~5.695 „verfügbar"-Zeilen** nur um `SUM`/Format-Split
   in einer JS-Schleife zu rechnen.
3. **`records` hat keinen brauchbaren Index.** Nur `records_hash_tenant` (unique auf `hash, tenant_id`
   — führt mit `hash`, nutzlos für `WHERE tenant_id=…`, den `(artist,title)`-Sort, den `format`-Filter).
   `purchases` ist gut indiziert, `records` faktisch gar nicht → Seq-Scan + Text-Sort über die
   volle Tabelle bei jeder Query.
4. **Kein Caching** — jede Filter-/Tab-/Such-Änderung rechnet alles neu.

Ein Cache-Server wurde **bewusst verworfen** als erster Schritt: er maskiert das Problem (kalter Load
bleibt 22 s), invalidiert bei jeder Filteränderung (searchParams → neue Query) und behebt das
RSC-Rendern von 12k Zeilen nicht.

## Ziel

Load `/inventar` von ~22 s auf **< 1 s** (erste Seite ~50 Zeilen statt 12.606; Aggregate in einer
Query). Keine neue Infrastruktur. Zähler/Aggregate bleiben über den **ganzen** gefilterten Satz korrekt.

## Nicht-Ziele (bewusst außen vor)

- **Kein Cache-Server** (aufgeschoben). Kandidaten für später: `genreOptions`, `byStatus`.
- **KI-Suche / pgvector unangetastet** — `kiSearch()` ist bereits auf `KI_SEARCH_LIMIT = 50` gecappt,
  opt-in, kein Load-More. Ein pgvector-ANN-Index ist ein separates Thema.
- **Kein Trigram-Index** für die `ILIKE`-Freitextsuche — nach Paging kein Flaschenhals mehr; später
  nachrüstbar falls die Suche langsam wird.

## Architektur & Datenfluss

Bleibt **SSR + searchParams-getrieben**. Nur die *Zeilen-Liste* wird gepagt; die Aggregate bleiben
unbeschränkt (nur SQL- statt JS-seitig).

### Row-Fetch: Keyset statt Offset

- `listInventory(ctx, f)` → `listInventory(ctx, f, opts?: { limit?: number; cursor?: string })`.
  Rückgabe wird `{ rows: InventoryRow[]; nextCursor: string | null }` (statt nacktes Array). Der
  Cursor ist an **allen** Grenzen (listInventory + Action) ein **opaker String**; Encode/Decode in die
  interne `InventoryCursor`-Form `{ artist, title, copyId }` bleibt eine Implementierungsdetail-Sache
  in `inventory.ts`.
- **Sort-Key:** `records.artist ASC, records.title ASC, purchases.id ASC`. `artist`/`title` sind
  NOT NULL (Schema), `purchases.id` (= `copyId`) ist unique → deterministische Totalordnung, keine
  Duplikate/Lücken über Seitengrenzen.
- **Cursor:** opaker (base64) Encode von `{ artist: string; title: string; copyId: number }` der
  letzten Zeile der aktuellen Seite. Encode/Decode als kleine, getestete Helfer in `inventory.ts`.
- **Next-Page-Prädikat:** Row-Value-Vergleich
  `sql\`(${records.artist}, ${records.title}, ${purchases.id}) > (${a}, ${t}, ${id})\``
  — nutzt dieselbe Collation wie das ORDER BY (konsistent, da Spalten-Default-Collation).
- **Page-Size:** `INVENTORY_PAGE_SIZE = 50`. Implementierung: `.limit(pageSize + 1)`, bei
  `pageSize + 1` zurückgegebenen Zeilen die letzte abschneiden und `nextCursor` aus der 50. Zeile
  setzen; sonst `nextCursor = null`.
- Der Cursor kapselt **nur** Sort-Position — Tenant/Filter kommen NIE aus dem Cursor.

### Load-More: Server-Action

Neue Action in `src/app/(app)/inventar/actions.ts` nach dem exakt bestehenden Muster
(`requireSession()` + Rollen-Check + `isValidOrigin()`-CSRF, Tenant **aus der Session**):

```ts
// grobe Signatur — Details im Plan
export async function loadMoreInventory(input: unknown): Promise<
  | { ok: true; rows: InventoryRow[]; nextCursor: string | null }
  | { ok: false; reason: 'validation' | 'error' }
>
```

- `input` (zod-validiert): `{ filters: <serialisierte InventoryFilters>, cursor: string }`.
- Filter werden **serverseitig re-validiert** (dieselben Regeln wie `parseInventoryFilters`); Client-
  Input wird nicht vertraut. Tenant/`ctx` aus `requireSession()`.
- Ruft `listInventory(ctx, filters, { cursor })`, gibt nächste Seite + `nextCursor` zurück.
- **Nur klassischer Modus.** KI-Modus (`mode=ki`) rendert keinen „Mehr laden"-Button.

### Client: akkumulierte Liste

- Ein schlanker Client-Wrapper hält die **akkumulierten** Rows als State, initialisiert mit der
  SSR-ersten-Seite (Props). „Mehr laden"-Button ruft `loadMoreInventory`, hängt Rows an, aktualisiert
  den lokalen Cursor. Button/Footer sichtbar solange `geladen < total` bzw. `nextCursor != null`.
- Platzierung: entweder `ViewToggle` erweitern (hält schon `view`-State) oder ein Wrapper darüber.
  `InventoryList`/`InventoryTiles` bekommen weiterhin nur `rows` — bleiben „dumm".
- **Selection-State** (Etikettendruck, keyed by `copyId` in `InventoryList`) ist append-kompatibel:
  neue Rows fügen nur Optionen hinzu.
- Nach Mutation (Verkauf/Reservieren → `revalidatePath('/inventar')`) rendert der Server Seite 1;
  akkumulierte Client-Seiten gehen dabei verloren — **erwartetes, akzeptables** Verhalten.
- Ladezustände: Button zeigt Pending; Fehler der Action → inline-Hinweis, kein Crash (fail-soft).

### Aggregate SQL-seitig

`inventoryAggregates()` (`basePreds` unverändert, Status weiterhin ausgeschlossen):

- **Eine** Query ersetzt `statusRows` + `availRows`:
  ```sql
  SELECT
    count(*)                                                         AS total,
    count(*) FILTER (WHERE status='verfuegbar')                      AS verfuegbar,
    count(*) FILTER (WHERE status='reserviert')                      AS reserviert,
    count(*) FILTER (WHERE status='verkauft')                        AS verkauft,
    count(*) FILTER (WHERE status='verliehen')                       AS verliehen,
    coalesce(sum(target_price) FILTER (WHERE status='verfuegbar'),0) AS value_available,
    count(*) FILTER (WHERE status='verfuegbar' AND format='Vinyl')   AS split_vinyl,
    count(*) FILTER (WHERE status='verfuegbar' AND format='CD')      AS split_cd
  FROM purchases JOIN records ON records.id = purchases.record_id
  WHERE <basePreds>
  ```
  - `byStatus` aus den vier FILTER-Countern; `total` = `count(*)`.
  - `valueAvailable` NULL-safe via `coalesce(... ,0)`.
  - `formatSplit.other = verfuegbar − split_vinyl − split_cd` (NULL-Format zählt zu „other",
    NULL-sicher durch Subtraktion statt `NOT IN`).
- `genreOptions` bleibt die separate `SELECT DISTINCT unnest(genre) … ORDER BY g`-Query.

## Datenbank-Migration

Neue Drizzle-Migration (`pnpm db:generate` aus geänderter `schema.ts`, dann `pnpm db:migrate`):

- `records (tenant_id, artist, title, id)` — **Haupt-Hebel**: Tenant-Filter + Sort + Keyset.
  Drizzle-Name z. B. `records_tenant_artist_title_idx`.
- `records (tenant_id, format)` — Format-Facette (kleiner Zusatznutzen). Name z. B. `records_tenant_format_idx`.
- **Lock-Verhalten:** 12k Rows → plain `CREATE INDEX` lockt < 1 s; für den Prod-Deploy akzeptabel.
  `CREATE INDEX CONCURRENTLY` (nicht in Transaktion möglich, Drizzle wrappt in TX) wäre bei der Größe
  overkill — im Plan als Option notieren, Default = plain via normaler Migration.

## Fehlerbehandlung & Invarianten

- Load-More-Action **fail-closed**: Auth/CSRF/Tenant-Scope wie bestehende Actions; ungültiger/fremder
  Cursor darf keine fremden Daten liefern (Tenant kommt aus Session, Cursor nur Sort-Position + RLS
  erzwingt Tenant zusätzlich).
- **Aggregat-Parität:** neue SQL-Aggregate müssen die alten JS-Ergebnisse exakt reproduzieren
  (Regressionstest über Fixtures).
- Keyset über Zeilen mit identischem `(artist, title)`: `copyId`-Tiebreaker garantiert Stabilität.
- Leere/ungültige Filter, leerer Cursor, letzte Seite (`nextCursor = null`) sauber behandeln.

## Tests

- **Unit (`src/lib/inventory.ts`):**
  - Keyset: über mehrere Seiten keine Duplikate, keine Lücken; deckt gesamten Satz ab; stabile
    Ordnung bei gleichem `artist`/`title`.
  - Aggregat-Parität: neue Einzel-Query == altes Mehr-Query-Ergebnis über repräsentative Fixtures
    (inkl. NULL `target_price`, NULL `format`, alle Status).
  - Cursor Encode/Decode Round-Trip; Robustheit gegen manipulierten Cursor.
- **Action (`actions.ts`):** unauth/kunde → `forbidden`; ungültiger Origin → Reject; Cursor eines
  Tenants leakt keine Zeilen eines anderen (RLS + Session-Tenant).
- **E2E (`e2e/`):** `/inventar` lädt zügig (erste Seite); „Mehr laden" hängt weitere Rows an; Status-
  Zähler/„Wert" bleiben korrekt; Filter-/Status-Wechsel funktioniert weiter.
- **Bestehende Tests** in `tests/inventar` / inventory-Suite anpassen (Rückgabe-Shape
  `{ rows, nextCursor }` statt Array).

## Verifikations-Gate (vor PR)

Per Projekt-Memory `sdd-final-review-build-gate`:
`next build` **und** `docker compose build` grün · volle `vitest run` · E2E gegen frisch
hochgezogenen `down -v`-Stack. tsc/lint/unit sind blind für Layout-Intercepts und cross-task-
Regressionen → E2E ist Pflicht.

## Erwartetes Ergebnis

- `/inventar` erste Seite: **< 1 s** (50 Rows + 1 Aggregat-Query + Genre-Distinct, alle über den
  neuen `records`-Index).
- „Mehr laden": konstant schnell (Keyset, kein Offset-Drift).
- Kein neuer Infrastruktur-Baustein; Cache-Server bleibt eine spätere, optionale Facetten-Optimierung.
