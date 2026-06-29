# Q-Records Storemanager v2 — Slice 1: Inventar + Dashboard + Schaufenster (Design-Spec)

**Datum:** 2026-06-29
**Dachdokument:** `2026-06-25-qrecords-v2-architecture-overview.md`
**Vorgänger-Slice:** Slice 0 (Fundament) — ausgeliefert, PR #1 (`feat/v2-foundation`)
**Status:** Design — wartet auf Nutzer-Review vor `writing-plans`
**Quellen:** 2026-Design-Handoff (`Q-Records App.dc.html` Screens Übersicht/Lagerbestand/Schaufenster), v1-Datenmodell (records/purchases/conditions), Slice-0-Capability-Map.

---

## 1. Zweck

Das erste **fachliche** Slice auf dem Fundament: das **Datenmodell für Bestand** (records/purchases/conditions) ausmodellieren und die drei **Lese-Screens** pixelgenau bauen, die diesen Bestand zeigen — **Lagerbestand**, **Übersicht (Dashboard)** und das öffentliche **Schaufenster**. Slice 1 ist bewusst **read-only auf einem reichen Seed**: der kanonische Schreibpfad (Platte anlegen) kommt mit **Ankauf/Discogs in Slice 2**, Verkauf/Wunschlisten in Slice 3. Die Mutations-CTAs (Verkaufen/Vormerken/Benachrichtigen) rendern als deaktivierte „folgt"-Platzhalter.

**Sichtbares Ergebnis:** Login auf `demo.localhost` → `/inventar` zeigt den geseedeten Bestand als Liste **und** Kacheln mit Suche, Filtern (Format/Genre/Zustand) und Status-Tabs; `/` zeigt das volle Dashboard mit echten Bestands-KPIs und eleganten Leerständen für Verkaufs-/Ankauf-/Wunsch-Daten; `s/<permalink>` zeigt eine öffentliche, tenant-eigene Schaufenster-Ansicht (ohne Preis/Zustand). Ein zweiter Tenant ist vollständig isoliert.

## 2. In Scope

1. **Datenmodell-Erweiterung** (Migration 0003): `records` als Katalog/Release, `purchases` als **Inventar-Kopie** mit Status + Zustand (record+cover) + EK/VK.
2. **Lagerbestand** (`/inventar`): Liste + Kacheln, Suche, Filter, Status-Tabs, Wert-Summe, Empty-State.
3. **Übersicht** (`/`): volles Dashboard-Layout — echte Bestands-KPIs + Leerstände für spätere Slices.
4. **Schaufenster** (public `s/[permalink]`): gefilterte, öffentliche Bestandsansicht aus einem geseedeten Permalink, mit Verfügbarkeits-Badges.
5. **Seed-Anreicherung**: realistischer Bestand (records + Kopien + Permalinks) je Tenant, deterministisch + idempotent.
6. **Tests**: RLS-Isolation der neuen Lese-Pfade, Filter/Suche/Counts/Wert-Korrektheit, kein Public-Leak, Pixel-Treue, E2E.

## 3. Explizit DEFERRED (Anti-Scope-Creep)

- **Kein** Anlegen/Bearbeiten/Löschen von Platten (manueller CRUD) — Create-Pfad ist Ankauf (Slice 2).
- **Keine** Verkaufs-Aktion, kein Ankauf-Modal, keine Wunschlisten, keine Discogs-Suche, kein Pricing-Engine (Slices 2–4). Entsprechende CTAs sind deaktivierte Platzhalter.
- **Keine** Permalink-Verwaltung (App-`/schaufenster` bleibt Platzhalter „Slice 3") und **keine** Multi-Collection-Tabs im Schaufenster (Slice 1 = eine Permalink-Ansicht).
- **Keine** echten Cover-Bilder (Discogs liefert sie in Slice 2) — `CoverPlaceholder` wird verwendet; `coverImage` darf geseedet sein, ist aber optional.
- **Keine** Mehr-Filialen-Logik, kein POS, kein Verleih-Workflow (nur der Status „verliehen" wird angezeigt).

## 4. Datenmodell (Migration 0003)

**Leitsatz:** Die **Inventar-Einheit ist die Kopie** (`purchases`). Ein `record` ist der Release/Katalog-Eintrag (geteilte Metadaten, dedupliziert per Hash); eine Platte kann **1..n** physische Kopien haben, jede Kopie ist eine Inventarzeile mit eigenem Status, Zustand und EK/VK.

### 4.1 `records` (Katalog/Release) — Änderung
- **Bleibt:** `id, tenantId, title, artist, label text[], country, releaseYear, format, genre text[], coverImage, discogsId, hash varchar(64), createdAt, updatedAt`; `UNIQUE(hash, tenantId)`; RLS (unverändert aus Slice 0).
- **Entfällt:** `recordStatus` (Status ist jetzt pro Kopie). Spaltenabwurf in der Migration; der Status-Enum-Typ bleibt bestehen und wird von `purchases.status` weiterverwendet (kein Enum-Rename nötig).

### 4.2 `purchases` (= Inventar-Kopie) — Erweiterung
- **Bleibt:** `id, tenantId, recordId → records, purchasePrice numeric(10,2) (EK), targetPrice numeric(10,2) (VK), soldPrice numeric(10,2), soldDate timestamptz, paymentMethod, createdAt, updatedAt`; RLS (unverändert).
- **Neu:**
  - `status` (Enum `verfuegbar | reserviert | verkauft | verliehen`, NOT NULL, default `'verfuegbar'`) — der **kanonische Kopie-Status**. (Das 4-Werte-Enum aus Slice 0 wird hier wiederverwendet.)
  - `conditionRecord smallint` (0–7, nullable) — Platten-Zustand (Discogs-Skala).
  - `conditionCover smallint` (0–7, nullable) — Cover-/Sleeve-Zustand.
  - CHECK `conditionRecord BETWEEN 0 AND 7` / `conditionCover BETWEEN 0 AND 7` (jeweils wenn NOT NULL).
- Index auf `(tenantId, status)` und `(recordId)` für die Inventar-Aggregate.

### 4.3 Discogs-Zustandsskala (0–7, verbatim)
`0 Poor (P) · 1 Fair (F) · 2 Good (G) · 3 Good Plus (G+) · 4 Very Good (VG) · 5 Very Good Plus (VG+) · 6 Near Mint (NM) · 7 Mint (M)`. Die `ConditionPill`-Primitive (Slice 0) bildet diese 8 Stufen bereits ab; sie konsumiert `conditionRecord`.

### 4.4 Inventar-Item & Migration
- **Inventar-Item = `purchases ⋈ records`** (jede Kopie eine Zeile/Kachel).
- Migration via `drizzle-kit generate` (reiner Spalten-Add/Drop; die RLS-Policies/FORCE/Grants liegen auf der Tabelle und sind von Spaltenänderungen unberührt). Die Slice-0-**Drift-Assertion** (`assertDatabaseSafety`) validiert weiter, dass die Tenant-Tabellen-Menge unverändert ist (keine neue Tenant-Tabelle).
- **EK = `purchases.purchasePrice`**, **VK = `purchases.targetPrice`**. Kein `records.price` (vermeidet das v1-Doppelpreis-Problem).

## 5. Lagerbestand (`/inventar`)

Server Component; alle Daten über `withTenant({ tenantId, userId })`; Such-/Filter-/Status-State in **URL-Query-Params** (SSR + teilbar). Die Liste/Kachel-Umschaltung ist Client-State (SegmentedControl).

### 5.1 Datenabfrage
`purchases p JOIN records r ON r.id = p.record_id`, tenant-scoped. Eine Zeile = eine Kopie. Felder fürs UI: `r.title, r.artist, r.label, r.releaseYear, r.format, r.genre, p.purchasePrice (EK), p.targetPrice (VK), p.status, p.conditionRecord, p.conditionCover`.

### 5.2 Such-/Filter-/Steuerleiste (eine Surface-Card)
- **SearchField** (pill): Volltext über `r.title`, `r.artist`, `r.label` (ILIKE, case-insensitiv). Placeholder „Im Sortiment suchen — Titel, Artist, Label, Katalog-Nr…".
- **Barcode-Button** (▥, 44×44, r-md): deaktivierter Platzhalter (Scanner = Slice 5).
- **SegmentedControl** „☰ Liste / ▦ Kacheln" (Client-Toggle).
- **Filter-Dropdowns** (Select): Format (`Alle Formate | Vinyl | CD | Kassette`) · Genre (dynamisch aus den vorkommenden `r.genre`-Werten des Tenants, plus „Alle Genres") · Zustand (`Jeder Zustand | Mint – NM (≥6) | VG+ und besser (≥5) | VG und besser (≥4)` — Band auf `p.conditionRecord`).
- **„Zurücksetzen"** (Ghost) leert alle Query-Params.
- Rechts: `„{n} Treffer"` + `„Wert € {Σ}"` (font-mono) — Wert = `SUM(p.targetPrice)` der **verfügbaren** Kopien in der aktuellen Filtermenge.

### 5.3 Status-Tabs (Pill-Buttons mit Counts)
`Alle · im Lager (verfuegbar) · Verliehen · Verkauft` — Counts je Status in der aktuellen Such-/Filtermenge. Aktiv: `--accent`/`--on-accent`. (Reserviert wird in „Alle" mitgezählt und über StatusBadge angezeigt, hat aber Slice-1 keinen eigenen Tab — wie im Handoff.)

### 5.4 Liste (Tabelle) — Spalten (verbatim Handoff)
`Artikel` (Cover-Thumb 36×36 + Titel bold + Artist) · `Jahr · Label` (font-mono, z. B. „1990 · Mute") · `Zustand` (**ConditionPill** aus `conditionRecord`) · `EK / VK` (rechtsbündig, EK text-3 · VK bold) · `Status` (**StatusBadge** mit Dot+Label) · `Aktion` („Verkaufen"-Pill **deaktiviert/Platzhalter**, bei `verkauft` „Verkauft" disabled). Verkaufte Zeilen `opacity .62`. Footer „{n} von {total}".

### 5.5 Kacheln — Karte (verbatim Handoff)
`aspect-ratio 1.9`-Header mit **CoverPlaceholder** (62 %) + **VinylDisc** (right −26 %, width 64 %; Disc-Farbe: Vinyl=`--accent`, CD=`--info`) + **StatusBadge**-Overlay (top-left, backdrop-blur). Body: Titel (display 700) + Artist, **ConditionPill** (top-right), Meta-Zeile `„{Jahr} · {Label} · {Format}"` (font-mono), unten `„EK {ek} · {vk}"` + deaktivierter Aktions-Button.

### 5.6 Empty-State
Gestrichelte Card, ⌕-Icon, „Kein Treffer im Sortiment" + Hinweistext + „Filter zurücksetzen" (Secondary). (Der Discogs-Ankauf-Hinweis aus dem Handoff darf stehen, verlinkt aber Slice 1 noch nicht.)

## 6. Übersicht / Dashboard (`/`) — volles Layout

`max-width 1200`, Reihen wie Handoff.

### 6.1 KPI-Cards (Row 1) — echt wo berechenbar
1. **Tagesumsatz** (+Sparkline): **Leerstand** — „€ 0" / „noch keine Verkäufe" bis Slice 3 (Sparkline leer/flach). 
2. **Artikel im Lager**: **echt** = `COUNT(purchases WHERE status='verfuegbar')`; Segmented-Progress + Caption aus **Format-Split** der verfügbaren Kopien (Vinyl/CD/Andere %). 
3. **Ankäufe heute** (Accent-Card): **Leerstand** — „0" / „Ankauf folgt (Slice 2)". 
4. **Offene Wunschtreffer**: **Leerstand** — „0" / CTA deaktiviert (Slice 3).

### 6.2 Panels (Row 2)
- **Letzte Verkäufe** (breit): **Leerstand** — „Noch keine Verkäufe" (Slice 3), Layout steht.
- **Wunschlisten-Treffer** (schmal): **Leerstand** — „Noch keine Treffer" (Slice 3).

**Zusätzliche echte KPI** (ergänzt, ohne Layout zu sprengen): Inventarwert = `SUM(targetPrice WHERE status='verfuegbar')` und Status-Verteilung dürfen in der „Artikel im Lager"-Card bzw. als dezente Zusatzzeile erscheinen. Leerstände sind als ruhige, nicht-fehlerhafte Zustände gestaltet (kein „Error", sondern „— / folgt").

## 7. Schaufenster (public `s/[permalink]`)

Öffentlich (keine Auth), tenant-scoped über die Edge-Subdomain → `getCurrentTenant()`; Permalink wird **innerhalb** des Tenants aufgelöst (`withTenant({tenantId, userId:null})`), unbekannt → `notFound()` (kein Fremd-Bestand).

### 7.1 Permalink-Filtermodell
`permalinks.filter` jsonb, dokumentierte Form: `{ title?: string, genre?: string[], format?: string[] }` (alle optional, AND-verknüpft; leeres Objekt = ganzer in-stock-Bestand). Die öffentliche In-Results-Suche verfeinert über `title`/`artist`.

### 7.2 Sichtbare Menge & Verfügbarkeit
- Gezeigt werden **records**, die zum Filter passen und **mindestens eine verfügbare Kopie** haben (Live-Bestand). Aggregation über die Kopien je record.
- **Verfügbarkeits-Badge** (aus Anzahl `verfuegbar`-Kopien des records): `≥2 → „Verfügbar im Store" (in, --ok)` · `1 → „Nur noch 1×" (low, --honey-ink)`. Der `out`-Zustand („Aktuell vergriffen", opacity .66) ist von der Primitive unterstützt, wird in Slice 1 aber nicht gelistet (nur Live-Bestand) — Detail später.

### 7.3 Öffentliche Felder (Datensparsamkeit)
Nur `title`, `artist`, Meta-String `„{Jahr} · {Label} · {Land} · {Format}"`, Verfügbarkeits-Label. **Kein** Preis (EK/VK), **kein** Zustand, **keine** internen Felder. CTAs („Im Laden vormerken" / „Benachrichtigen") = deaktivierte Platzhalter (Slice 3). Branding-Footer aus dem Tenant (Name; Adresse/Öffnungszeiten als statische Platzhalter erlaubt). Eyebrow „q·records · Live-Bestand", H2 = Permalink-Titel (aus `filter`/Slug abgeleitet), Empty-State „Nichts gefunden".

## 8. Seed-Anreicherung

`scripts/seed.ts` erweitern (idempotent: `ensureRecord` per Hash, neue `ensurePurchase`/`ensurePermalink`):
- Pro Tenant **~15 records** mit realistischer Metadata (Mischung Vinyl/CD/Kassette, mehrere Genres, Jahr/Land/Label, `coverImage` optional/null).
- Pro record **1–2 Kopien** (`purchases`) mit `purchasePrice` (EK), `targetPrice` (VK), `conditionRecord`/`conditionCover` (0–7, gestreut) und `status`-Mix: Mehrheit `verfuegbar`, einige `verkauft` (mit `soldPrice`/`soldDate`), 1–2 `verliehen`, vereinzelt 2 Kopien einer Platte (eine verkauft, eine verfügbar — zeigt das Mehr-Kopien-Modell).
- Pro Tenant **2 öffentliche Permalinks** mit `filter`-jsonb (z. B. `jazz` → `{genre:['Jazz']}`, `neu` → `{}`/neueste). Der bestehende `lager`-Permalink aus dem Provisioning bleibt.
- Deterministisch (stabile Werte, kein `Math.random` zur Laufzeit ohne Seed-Index) und re-run-sicher.

## 9. Design-Treue

Wiederverwendung der Slice-0-Tokens + Primitive **verbatim**; jede Slice-1-Fläche bildet den Handoff exakt ab (Spaltenreihenfolge der Liste, Kartenaufbau, Badge-Farben, font-mono für Preise/Meta). Statusfarben: `im Lager=--ok`, `Verliehen=--info`, `Verkauft=text-3/surface-3`, `reserviert`-Behandlung via StatusBadge. ConditionPill-Farbpaare aus dem Design System (Mint…Poor). Keine neuen Roh-Hex-Werte; keine Inline-Focus/Hover (Utilities). A11y: text+icon+Farbe (nie nur Farbe), `:focus-visible`, `--tap`-Minimum.

## 10. Akzeptanzkriterien

Slice 1 gilt als fertig, wenn alle grün sind:
1. **RLS-Isolation:** Inventar- und Storefront-Queries liefern nur Tenant-eigene Zeilen; eine Kopie/record von Tenant A ist nie unter B sichtbar (Integrationstest gegen echtes Postgres, Zwei-Tenant-Interleave wie Slice-0-Harness).
2. **Filter/Suche/Status:** Such-, Format-, Genre-, Zustands-Filter und Status-Tabs erzeugen die korrekten Teilmengen; `{n} Treffer`, Tab-Counts und `Wert €` stimmen mit dem Seed überein.
3. **Dashboard:** „Artikel im Lager", Format-Split und Inventarwert == Seed; die deferred Panels zeigen ruhige Leerstände (kein Fehler, keine Fake-Zahlen).
4. **Schaufenster:** Nur in-stock records des aufgelösten Tenants; Verfügbarkeits-Badge korrekt aus Kopien-Count; **kein** Preis/Zustand/EK im öffentlichen HTML; unbekannter Permalink → 404; Fremd-Tenant-Permalink nie sichtbar.
5. **Datenmodell:** Migration 0003 sauber auf frischem Postgres 17; `records.recordStatus` entfernt, `purchases.status/conditionRecord/conditionCover` vorhanden; Boot-Assertion (inkl. Tabellen-Drift-Guard) weiter grün.
6. **Design-Treue:** Liste + Kacheln + Dashboard + Schaufenster entsprechen dem Handoff (Spalten/Karten/Badges/Tokens); A11y-Baseline hält.
7. **E2E (`docker compose up`, demo.localhost):** Login → `/inventar` Liste↔Kacheln, Suche, ein Filter, ein Status-Tab; `/` Dashboard mit echten KPIs + Leerständen; `s/<seed-permalink>` Grid + Verfügbarkeit + In-Results-Suche; zweiter Tenant (`vinylcave.localhost`) zeigt eigenen Bestand, nie Demo-Daten.

## 11. Risiken & Mitigationen
| Risiko | Mitigation |
|---|---|
| Status-Umzug records→purchases bricht Slice-0-Referenzen (StatusBadge-Quelle, Storefront-Stub) | Migration + Anpassung der Konsumenten in einem Task; StatusBadge-Prop-Typ (4 Werte) bleibt, nur die Datenquelle wechselt; Slice-0-RLS/Tests laufen weiter |
| Aggregate (Counts/Wert/Verfügbarkeit) driften von der gefilterten Menge ab | Counts/Wert in **derselben** tenant-scoped Query/Transaktion wie die Liste berechnen; Tests prüfen Übereinstimmung mit dem Seed |
| Public-Leak (Preis/Zustand im öffentlichen HTML) | Storefront-Query selektiert nur public-Felder; Test grept das gerenderte HTML auf Abwesenheit von Preis/Zustand |
| URL-Filter als Injection/teure Query | Query-Params strikt validieren/whitelisten (Format/Genre/Zustands-Enum, Suchstring-Länge); parametrisierte Drizzle-Queries |
| „Mehr-Kopien" verkompliziert Dashboard-Counts | KPI zählt **Kopien** (purchases), nicht records; klar dokumentiert in den Aggregaten |
| Genre-Filter über `text[]` | Array-Containment (`&&`/`= ANY`) korrekt + indexierbar; Genre-Optionen aus tatsächlich vorkommenden Werten |

## 12. Offene Vetos / Notizen (beim Review bestätigen)
- `records.recordStatus` wird **entfernt** (Status pro Kopie). · Enum-Typ `record_status` bleibt bestehen und wird von `purchases.status` genutzt. · Inventar-Wert nur über **verfügbare** Kopien. · Storefront listet Slice 1 **nur** in-stock (kein `out`-Listing). · Genre-Filter-Optionen dynamisch aus dem Tenant-Bestand. · Mitgetragene Slice-0-Härtungen (tenant-composite FKs, ROOT_DOMAIN-Build-ARG) bleiben weiter zurückgestellt — Slice 1 fügt keine neuen Tenant-Tabellen hinzu.
