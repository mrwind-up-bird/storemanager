# Q-Records Storemanager v2 — Slice 4: Analytik + Batch-Ankauf + Etiketten (Design/Spec)

**Datum:** 2026-07-01
**Status:** Design abgenommen (Nutzer: „ja, das passt") → Spec-Review ausstehend
**Slice:** 4 von 8 (siehe `2026-06-25-qrecords-v2-architecture-overview.md`, Abschnitt 5)
**Vorgänger:** Slice 3 (Verkauf/POS + Wunschlisten) — merged (PR #5)
**Branch:** `feat/v2-slice4-analytics-batch-labels`

---

## 1. Ziel

Drei entkoppelte Back-Office-Power-Tools als ein schiffbarer Slice auf der bestehenden
Codebase, pixelgenau zum 2026-Design-Handoff (`Q-Records App.dc.html`, Analytik-Screen
Zeilen 428–553):

1. **Analytik** — Auswertungs-Screen (Woche/Monat/Quartal) mit KPIs, handgerollten Charts,
   Top-Platten und **CSV-Export**.
2. **Batch-Ankauf** — Ankauf ganzer Sammlungen (erstklassige `collections`-Entität), teilt
   sich die Ankauf-Kernlogik mit Slice 2.
3. **Etikettendruck** — client-seitiges jsPDF, A4-Etikettenbogen (Preisschilder).

**Leichtgewichtig-Prinzip:** keine Chart-Library (Charts = Token-`div`s), keine Server-PDF-
Abhängigkeit (jsPDF im Browser), kein CSV-Lib (hand-rolled). Einzige neue Dependencies:
**jsPDF** und **qrcode** (QR auf dem Etikett).

## 2. Global Constraints (bindend für jeden Task & Review)

- **Geld:** Speicherung `numeric(10,2)` (Drizzle liefert String); exakte Arithmetik INTERN in
  Integer-Cent via `src/lib/money.ts` (`toCents`/`fromCents`/`percentToCents`/`clamp`/`sumLineCents`);
  NIE JS-Float. Anzeige-Strings erst am Rand via `fromCents`. Die vorformatierten Handoff-Strings
  (`€ 8.940`, `Ø € 28,70`) sind Display-only.
- **RLS:** einzige Runtime-DB-Oberfläche ist `withTenant(ctx, fn)` (eine Tx,
  `set_config('app.current_tenant'/'app.current_user_id', …, true)`). Neue Tabelle `collections`:
  ENABLE+FORCE RLS, `tenant_id`-Default aus NULLIF-GUC, `tenant_isolation`+`superadmin_bypass`-
  Policies (exakt wie `drizzle/0007_slice3_rls.sql`), `GRANT SELECT,INSERT,UPDATE,DELETE` +
  load-bearing `GRANT USAGE,SELECT ON SEQUENCE collections_id_seq TO qr_app`. `qr_app` NOBYPASSRLS.
  `TENANT_SCOPED_TABLES += 'collections'` UND `tests/db/assertions.test.ts`
  `SOUND_TENANT_ID_TABLES`-Mock-Baseline im Gleichschritt.
- **RBAC + CSRF:** jede mutierende Server-Action: `const user = await requireSession();` →
  `if (user.role === 'kunde') forbidden();` (erlaubt: mitarbeiter/admin/superadmin) →
  `if (!(await isValidOrigin())) return { ok:false, reason:'error', … };` → zod `safeParse` →
  `ctx = { tenantId: user.tenantId, userId: user.id }` → Delegation an `@/lib/*`-Service (der die
  einzige `withTenant`-Tx besitzt) → `revalidatePath(...)`. Discriminated Union als Rückgabe
  (`{ ok:true, … } | { ok:false, reason:'validation'|'conflict'|'not_found'|'error', message? }`),
  nie throw zum Client.
- **Jobs:** idempotent; `boss.send(QUEUE.x, payload, { retryLimit:5, retryBackoff:true })`; Worker
  läuft AUSSERHALB RLS (BYPASSRLS) → jeder Payload trägt explizit `tenantId`. Post-Commit-Enqueue in
  eigenem try/catch isoliert (nie committeten State verwaisen lassen). Neue Queue nur falls nötig
  (Slice 4 braucht **keine** neue Queue — reuse `enqueueWishlistMatch`/`enqueueDiscogsListing`).
- **Design:** nur semantische CSS-Vars (`var(--surface|--surface-2|--surface-3|--border|--border-strong|
  --text|--text-2|--text-3|--accent|--accent-soft|--accent-ink|--info|--honey|--ok|--bad)`), kein Raw-Hex.
  Dark-Mode kommt gratis über `[data-theme=dark]`. Charts handgerollt (Bar = `div` mit inline
  `height/width:'NN%'` + `background:var(--…)`), **keine** Chart-Lib.
- **Kein Leak:** keine Kundendaten/Verkaufsinterna auf dem öffentlichen Storefront (`/s/[slug]`).
  Analytik/Ankauf/Etiketten sind staff-only (kunde-forbidden).
- **Commits:** nur auf `feat/v2-slice4-analytics-batch-labels`, nie `main`. `.superpowers/` bleibt
  gitignored und darf NIE committet werden. Jede Commit-Message endet mit
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## 3. Datenmodell-Änderungen

### 3.1 Neue Tabelle `collections` (tenant-scoped)
```
id                 serial PK
tenant_id          integer NOT NULL → tenants.id
seller_name        text NOT NULL
seller_contact     text NULL              -- E-Mail/Telefon, frei
acquired_at        timestamptz NOT NULL DEFAULT now()
note               text NULL
created_by_user_id integer NULL → users.id
created_at         timestamptz DEFAULT now()
```
Index: `collections_tenant_acquired_idx` on `(tenant_id, acquired_at)`.
**Gesamt-EK wird abgeleitet** (`SUM(purchases.purchase_price WHERE collection_id = …)`), nicht gespeichert.

### 3.2 Spaltenerweiterungen
- **`purchases.collection_id`** — `integer NULL → collections.id`. Einzel-Ankauf lässt NULL; Batch setzt es.
  Index `purchases_collection_idx` on `(tenant_id, collection_id)`.
- **`quick_items.category`** — `text NULL` (z. B. `'Getränke'`, `'Sonstiges'`). Ohne Wert → Fallback
  `'Sonstiges'` in der Analytik.

### 3.3 Migrationen
- `drizzle/0008_slice4_collections.sql` (drizzle-kit generiert: `collections`-DDL + `purchases.collection_id`
  + `quick_items.category` + Indizes + FKs).
- `drizzle/0009_slice4_rls.sql` (hand-authored): RLS-Block für `collections` — 1:1 zum `0007`-Template.
  `purchases`/`quick_items` haben bereits RLS; neue Spalten brauchen keine neue Policy.
- Registrierung in `drizzle/meta/_journal.json` als idx 8 (`0008_slice4_collections`) und idx 9
  (`0009_slice4_rls`), mit Snapshots.
- **Boot-Assertion** (`src/db/assertions.ts`): `'collections'` in `TENANT_SCOPED_TABLES`; Mock-Baseline in
  `tests/db/assertions.test.ts` (`SOUND_TENANT_ID_TABLES`) im Gleichschritt aktualisieren.

## 4. Analytik

### 4.1 Domänen-Modul `src/lib/analytics.ts`
```ts
export type AnalyticsPeriod = 'week' | 'month' | 'quarter';

export interface Kpi { label: string; valueCents?: number; value?: string; sub: string; up: boolean; deltaLabel: string; }
export interface BarPoint { label: string; valueCents: number; }          // Umsatzverlauf
export interface CategorySlice { label: string; valueCents: number; color: string; } // color = semantic var name
export interface WeekdayBar { day: string; pct: number; }                 // 0..100 (peak=100)
export interface TimeBucket { label: string; pct: number; }               // relativ zum Max
export interface TopRecord { artist: string; title: string; genre: string | null; sales: number; revenueCents: number; marginPct: number; }

export interface AnalyticsData {
  period: AnalyticsPeriod;
  rangeLabel: string;        // z. B. "16.–22. Juni 2026"
  storeName: string;         // tenants.name (ersetzt "Filiale Mitte")
  kpis: { umsatz: Kpi; transaktionen: Kpi; ankaeufe: Kpi; rohmarge: Kpi };
  umsatzverlauf: { bars: BarPoint[]; totalCents: number; subLabel: string };
  kategorie: CategorySlice[];
  wochentag: { bars: WeekdayBar[]; bestDay: string };
  tageszeit: { buckets: TimeBucket[]; bestTime: string; consistency: string };
  topRecords: TopRecord[];
}

export async function getAnalytics(ctx: TenantCtx, period: AnalyticsPeriod): Promise<AnalyticsData>;
```
- **Eine `withTenant`-Read-Tx** für alle Aggregationen.
- **Perioden-Logik** (pure, testbar) in `src/lib/analytics-period.ts`: `periodRange(period, now)` →
  `{ start, end, prevStart, prevEnd, rangeLabel }`. Woche = aktuelle ISO-Woche (Mo–So), Monat =
  Kalendermonat, Quartal = Kalenderquartal. Vorperiode für Trend-Deltas.
- **Zeitzone:** alle Tages-/Stunden-Bucketing via `created_at AT TIME ZONE 'Europe/Berlin'`.
- **KPIs:** Umsatz `SUM(transactions.total)`; Transaktionen `COUNT` + ø-Bon (`total/count`); Ankäufe
  `COUNT(purchases WHERE created_at ∈ range)` + Sammlungen (`COUNT(collections ∈ range)`) als Sub;
  Rohmarge `SUM(soldPrice−purchasePrice)/SUM(soldPrice)` (nur `status='verkauft'`, `sold_date ∈ range`),
  Wareneinsatz = 100−Marge als Sub. Trend `up` = Wert ≥ Vorperiode.
- **Umsatzverlauf-Granularität:** Woche → 7 Tagesbalken (Mo–So); Monat → Wochenbalken (KW im Monat);
  Quartal → 3 Monatsbalken. Bar-Höhe pure: `Math.round(v/max*100)+'%'`; peak-Bar `var(--accent)`, sonst
  `var(--accent-soft)`.
- **Umsatz nach Kategorie:** `SUM(transaction_items.unit_price*quantity)` gruppiert nach Kategorie.
  Ableitung: Zeilen mit `purchase_id` → join `purchases`→`records.format`
  (`'Vinyl'→Vinyl`, `'CD'→CD`, sonst `Sonstiges`); Zeilen mit `quick_item_id` → `quick_items.category`
  (Fallback `Sonstiges`). Feste Farben: Vinyl `var(--accent)`, CD `var(--info)`, Getränke `var(--honey)`,
  Sonstiges `var(--text-3)`; weitere Kategorien fallen auf `var(--text-3)`.
- **Verkaufsmuster·Wochentag:** `COUNT`/`SUM(total)` je `EXTRACT(dow …)`, auf peak=100 normiert; `bestDay`.
- **Tageszeit-Buckets:** feste Buckets Vormittag 11–14, Mittag 14–16, Nachmittag 16–18, Abend 18–20
  (`EXTRACT(hour …)`), relativ zum Max; peak `var(--accent)` sonst `var(--honey)`. `bestTime`,
  `consistency` (Streuung über die Buckets, Textlabel).
- **Top-Platten:** Top-N (N=5) Records nach Verkaufszahl/Umsatz in der Periode
  (`transaction_items`→`purchases`→`records`), mit Genre-Pill + Marge.

### 4.2 Screen `src/app/(app)/analytik/page.tsx` (Server-Component)
- Ersetzt den Placeholder. Periode als **`searchParams.period`** (`'week'` default). Toggle
  (`PeriodToggle`, Client-Component) setzt den Param → Server rechnet neu (kein Client-Fetch).
- Komponenten (`_components/`): `PeriodToggle`, `AnalyticsKpis` (nutzt `Card` aus `@/components/ui`;
  Header-Row Label + Trend-Span mit `color = up?var(--ok):var(--bad)`, Value `var(--font-mono)`),
  `RevenueBars`, `CategoryBar`, `WeekdayBars`, `TimeBuckets`, `TopRecordsTable`, `CsvExportButton`.
- Alle Charts token-getrieben (siehe Handoff-Markup Z. 441–550). Layout: `max-width:1200px`, KPI-Grid
  `repeat(auto-fit,minmax(min(100%,228px),1fr))`, danach zwei 2-Spalten-Grids, dann Top-Tabelle.
- **CSV-Export-Button** (⤓ „CSV exportieren", `border-strong`-Pill) → linkt auf den Route-Handler (§6).

## 5. Batch-Ankauf

### 5.1 Refactor der Ankauf-Kernlogik
- Aus `performAnkauf` (src/lib/ankauf.ts:34) die Kern-Sequenz „Hash-Dedup Record + Insert Purchase"
  in **`acquireOne(tx, ctx, item: AnkaufItem, collectionId: number | null): Promise<{ recordId, purchaseId }>`**
  extrahieren. `performAnkauf` ruft `acquireOne(tx, ctx, item, null)` in seiner Tx auf → keine
  Verhaltensänderung für Einzel-Ankauf (Regressionstest bleibt grün).

### 5.2 Service `createCollection` (src/lib/collections.ts)
```ts
export interface CollectionItemInput { /* wie AnkaufItem: record-Felder + condition + purchasePrice + targetPrice */ }
export interface CreateCollectionInput { sellerName: string; sellerContact?: string; note?: string; acquiredAt?: Date; items: CollectionItemInput[]; }
export async function createCollection(ctx: TenantCtx, input: CreateCollectionInput): Promise<{ collectionId: number; purchaseIds: number[]; recordIds: number[] }>;
export async function listCollections(ctx: TenantCtx): Promise<CollectionSummary[]>;   // seller/date/count/totalEkCents
export async function getCollection(ctx: TenantCtx, id: number): Promise<CollectionDetail | null>;
```
- `createCollection`: **eine** `withTenant`-Tx — Insert `collections`, dann `for` item `acquireOne(tx, ctx, item, collectionId)`. Fail-closed: schlägt ein Item fehl, rollbackt die ganze Sammlung.
- **Post-Commit** (isoliertes try/catch, außerhalb der Tx): pro neuem `recordId` `enqueueWishlistMatch({ tenantId, recordId })` (Ankauf→Wunschlisten-Invariante aus Slice 3), optional `enqueueDiscogsListing({ tenantId, purchaseId })`.

### 5.3 UI
- **Wizard** `src/app/(app)/ankauf/sammlung/page.tsx` + `_components/*`: Kopf (Verkäufer/Kontakt/Datum/Notiz)
  → Positionsliste (je Discogs-Suche via bestehende `searchDiscogs`/`getPriceSuggestion`-Actions ODER
  manuell; Condition-Pills aus `pricing.ts`, EK/VK-Vorschlag via `suggestSalePrice`) → Review → „Sammlung anlegen".
- **Action** `src/app/(app)/ankauf/sammlung/actions.ts` (`createCollectionAction`) nach Standard-Boilerplate;
  `revalidatePath('/inventar','/','/analytik','/ankauf/sammlungen')`.
- **Sammlungen-Liste** `src/app/(app)/ankauf/sammlungen/page.tsx` (Verkäufer/Datum/Anzahl/Gesamt-EK) +
  **Detail** `[id]/page.tsx` (Positionen + „Etiketten für Sammlung drucken").
- **Navigation:** „Ankauf → Sammlung" bzw. „Sammlungen" staff-gated in `SidebarNav`.

## 6. CSV-Export
- **Route-Handler** `src/app/(app)/analytik/export/route.ts` — `GET ?period=week|month|quarter`.
- `requireSession()` + `if (user.role==='kunde') forbidden()`; Daten via `withTenant` (tenant-scoped).
- Antwort `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="analytik-<period>-<range>.csv"`.
- Eine Zeile je Transaktion der Periode: `Datum, Bon-Nr, Zahlart, Zwischensumme, Rabatt, Summe`
  (Beträge als `fromCents`-Dezimalstring, Semikolon-getrennt für DE-Excel). Server-seitig als String
  gebaut. Bei sehr großer Range: Cap (z. B. 10 000 Zeilen) + Hinweiszeile (kein stiller Truncate).

## 7. Etikettendruck
- **Client-seitig, jsPDF, A4-Etikettenbogen** (Avery-Raster 3×8 = 24/Bogen, konfigurierbar). Keine Server-PDF.
- **Modul** `src/lib/labels.ts` (pure Layout-Mathematik: `labelGridLayout(count, template)` → Positionen;
  testbar ohne jsPDF) + `src/app/(app)/inventar/_components/LabelPrintModal.tsx` (jsPDF-Render, dynamic import).
- **Etikett-Inhalt:** Artist — Titel, Format · Zustand (`conditionLabel` aus `pricing.ts`), **Preis groß**
  (`purchases.target_price` via `fromCents`), **QR → Discogs-Release** `https://www.discogs.com/release/<discogsId>`
  wenn `records.discogs_id` vorhanden, sonst kein QR (Barcode/Scan folgt in Slice 5). QR via `qrcode`
  (dataURL, in jsPDF eingebettet).
- **Einstiegspunkte:** (a) Lagerbestand Multi-Select → „Etiketten drucken"; (b) Sammlungs-Detail → „Alle Etiketten".
- Datenübergabe: die zu druckenden Records/Preise werden server-seitig (staff-authorisiert) an die
  Client-Component gereicht; jsPDF baut das PDF im Browser (`doc.save(...)`).

## 8. Sicherheit & Isolation (Zusammenfassung)
- Alle neuen Reads/Writes ausschließlich über `withTenant`; `collections` mit vollem RLS-Block + Sequence-GRANT.
- Alle mutierenden Actions (`createCollectionAction`) mit kunde-forbidden + isValidOrigin + zod.
- Analytik/Export lesen nur tenant-eigene Daten; kein Kunden-PII im Storefront.
- Worker-Payloads (`wishlist.match`, `discogs.listing`) tragen `tenantId`.
- Geld überall Integer-Cent; DB numeric(10,2).

## 9. Testing
- **Pure Unit (Vitest, keine DB):** `analytics-period` (Range/Label je Periode + Grenzfälle Jahres-/
  Quartalswechsel), Bar-Normierung, Kategorie-Mapping (format→Kategorie, quick.category-Fallback),
  `labelGridLayout` (Positionen/Overflow auf mehrere Seiten), CSV-Serialisierung (Escaping, Cap).
- **Integration (Testcontainers):** `getAnalytics` gegen geseedete Transaktionen (KPIs, Kategorie, Wochentag,
  Tageszeit, Top-N; tz-Korrektheit); `createCollection` (eine Tx, collection_id gesetzt, Fail-closed-Rollback,
  Gesamt-EK-Ableitung); **RLS-Isolation** für `collections` (Cross-Tenant-Read/Insert schlägt fehl);
  `assertDatabaseSafety` erkennt `collections`. Idempotenz Post-Commit-Match non-vacuous.
- **E2E (Playwright, `docker compose up`):** Analytik rendert Kennzahlen + Charts + Periodenwechsel;
  Batch-Ankauf legt Sammlung an → erscheint in Liste + Ankäufe/Sammlungen-KPI steigt + Wunschlisten-Match feuert;
  CSV-Download liefert Datei mit Header; kein Kunden-PII auf `/s/[slug]`.
- **Voller Gate:** `pnpm test` grün (vitest-Fork-Cap aus Slice 3 bleibt), `pnpm typecheck`, `pnpm lint` 0 Errors,
  E2E grün. Whole-Branch-Review (Opus) 0 Critical/0 Important vor Merge.

## 10. Neue Dependencies
- **jspdf** (A4-Etiketten-PDF, client-seitig, dynamic import).
- **qrcode** (QR-DataURL fürs Etikett).
- Keine Chart-Lib, kein CSV-Lib, keine Server-PDF-Lib.

## 11. Offene Entscheidungen — abgenommen
1. **QR** → Discogs-Release-Seite bei vorhandener `discogsId`, sonst kein QR. ✔
2. **Umsatzverlauf** Woche=7 Tage / Monat=Wochen / Quartal=Monate. ✔
3. **Sammlungen-Liste + Detail** in diesem Slice enthalten. ✔
4. **„Filiale Mitte"** = Store-Name (`tenants.name`); Multi-Standort späterer Slice. ✔

## 12. Datei-Übersicht (neu/geändert)
**Neu:** `src/lib/analytics.ts`, `src/lib/analytics-period.ts`, `src/lib/collections.ts`,
`src/lib/labels.ts`, `drizzle/0008_slice4_collections.sql`, `drizzle/0009_slice4_rls.sql`,
`src/app/(app)/analytik/page.tsx` (ersetzt Placeholder) + `_components/*`,
`src/app/(app)/analytik/export/route.ts`, `src/app/(app)/ankauf/sammlung/{page.tsx,actions.ts,_components/*}`,
`src/app/(app)/ankauf/sammlungen/{page.tsx,[id]/page.tsx}`,
`src/app/(app)/inventar/_components/LabelPrintModal.tsx`, Tests dazu.
**Geändert:** `src/db/schema.ts` (collections + 2 Spalten), `src/db/assertions.ts`,
`tests/db/assertions.test.ts`, `src/lib/ankauf.ts` (acquireOne-Extraktion),
`src/app/(app)/_components/SidebarNav.tsx`, `src/app/(app)/inventar/_components/InventoryList.tsx`
(Multi-Select + Etiketten-Einstieg), `scripts/seed.ts` (Demo-Sammlung + quick_items.category),
`drizzle/meta/_journal.json`, `package.json` (jspdf, qrcode).
