# Q-Records Storemanager v2 — Slice 3: Verkauf/POS + Wunschlisten (Design-Spec)

**Datum:** 2026-06-30
**Status:** Design abgenommen → bereit für Implementierungsplan
**Vorgänger-Slices:** 0 (Fundament), 1 (Inventar/Dashboard/Schaufenster), 2 (Discogs + Ankauf)
**Dachdokument:** `docs/superpowers/specs/2026-06-25-qrecords-v2-architecture-overview.md`

---

## 1. Ziel

Den kanonischen **Verkaufs-Pfad** und die **Wunschlisten** als schiffbaren vertikalen Slice ergänzen:

- **POS-Kasse** (Warenkorb mit mehreren Positionen) + handoff-treues **Einzel-Verkauf-Modal** aus der Lagerzeile — beide schreiben dasselbe Transaktions-Modell.
- **Zahlarten** Bar / Karte / PayPal / Gutschein (eine Zahlart je Transaktion).
- **Reservierung** als Zeilen-Aktion (Halten/Storno), getrennt vom Cart-Checkout.
- **Staff-managed Wunschlisten** (Künstler Pflicht + Label/Titel/Land optional) mit **automatischem Match beim Ankauf** und **mitarbeiter-bestätigter E-Mail-Benachrichtigung** über ein Benachrichtigen-Modal.

Out of scope (spätere Slices): Verleih-Flow (Status-Wert bleibt sichtbar), Kundenkonten/Self-Service-Wunschlisten, POS-Hardware (SumUp/Square), Split-Tender, Stornierung/Refund einer Transaktion, Discogs-Bestandssync beim Verkauf.

## 2. Handoff-Gap (bewusste Designentscheidung)

Der 2026-Handoff zeichnet **kein** Kassen-/Warenkorb-Layout (das „Kasse" im Markup ist „Kassette", der Format-Filter). Er zeichnet:

- ein **Einzel-Verkauf-Modal**: `Verkaufspreis €`, `Zahlungsart` (⛁ Bar · ▭ Karte · PayPal · ◫ Gutschein), `Gutschein-Code`, `Summe`, `Abbrechen` / `Verkaufen`;
- ein **♡ „Auf Wunschliste"**-Icon auf Lagerzeilen (`onWish`).

**Entscheidung:** Das Einzel-Verkauf-Modal wird **pixelgenau** nach Handoff gebaut (Schnellverkauf eines Exemplars aus der Lagerzeile). Die **POS-Kasse** ist ein **neuer Screen in der Handoff-Bildsprache** — sie wiederverwendet den Zahlart-Cluster, die Tokens und Komponenten des Verkauf-Modals, hat aber bewusst **keine** pixel-Referenz, da der Handoff sie nicht zeichnet. Beide Wege rufen dieselbe `createSale`-Server-Action; das Einzelmodal erzeugt eine 1-Positions-Transaktion.

## 3. Datenmodell

Geld als **`numeric(10,2)`** — konsistent mit den bestehenden `purchases`-Spalten `purchasePrice`/`targetPrice`/`soldPrice` (Drizzle liefert `numeric` als String). Exakte Beträge (Summen, Rabatt, Prozent→Betrag) werden in der Domäne **intern in Integer-Cent** über einen Money-Helper gerechnet und als 2-Dezimal-String gespeichert (kein Float). Alle neuen fachlichen Tabellen sind **tenant-scoped** und müssen die RLS-Invarianten erfüllen (Abschnitt 7).

> **Hinweis (Codebase-Abgleich):** `purchases` hat bereits `soldPrice` (numeric 10,2), `soldDate` (timestamptz) und `paymentMethod` (text). Beim Verkauf eines Inventar-Exemplars schreibt `performSale` diese vorhandenen Spalten mit (denormalisierter Kopf-Snapshot je Exemplar), zusätzlich zur Transaktions-Position. `purchases.paymentMethod` bleibt `text` und speichert den Enum-Wert als String (keine riskante Spaltentyp-Migration auf der bestehenden Tabelle).

### 3.1 Enum `payment_method`

```
payment_method = 'bar' | 'karte' | 'paypal' | 'gutschein'
```

### 3.2 `quick_items` — Per-Tenant-Katalog für Nicht-Inventar-Positionen

| Spalte | Typ | Notiz |
|---|---|---|
| `id` | serial PK | |
| `tenantId` | integer NOT NULL | RLS-Schlüssel |
| `name` | text NOT NULL | z.B. „Kaffee" |
| `price` | numeric(10,2) NOT NULL | ≥ 0 |
| `active` | boolean NOT NULL default true | inaktive werden nicht als Button gezeigt |
| `createdAt` | timestamptz NOT NULL default now() | |

Ad-hoc-Positionen (Einmaliges) brauchen **keinen** Katalogeintrag — sie werden direkt als Transaktionszeile ohne `quickItemId` erfasst.

### 3.3 `transactions` — abgeschlossener Verkauf (ein Checkout)

| Spalte | Typ | Notiz |
|---|---|---|
| `id` | serial PK | |
| `tenantId` | integer NOT NULL | RLS-Schlüssel |
| `soldByUserId` | integer NOT NULL | Mitarbeiter/Inhaber, der kassiert hat |
| `paymentMethod` | `payment_method` NOT NULL | |
| `subtotal` | numeric(10,2) NOT NULL | Summe der Positionen vor Rabatt |
| `discount` | numeric(10,2) NOT NULL default 0 | Rabatt auf die Transaktion (≥ 0, ≤ subtotal) |
| `total` | numeric(10,2) NOT NULL | = subtotal − discount, serverseitig berechnet |
| `voucherCode` | text NULL | nur bei `paymentMethod='gutschein'` |
| `createdAt` | timestamptz NOT NULL default now() | |

Index: `(tenantId, createdAt)` für Analytik/Listen.

### 3.4 `transaction_items` — Positionen

| Spalte | Typ | Notiz |
|---|---|---|
| `id` | serial PK | |
| `tenantId` | integer NOT NULL | RLS-Schlüssel |
| `transactionId` | integer NOT NULL | FK → `transactions.id` |
| `purchaseId` | integer NULL | FK → `purchases.id` (Inventar-Exemplar) |
| `quickItemId` | integer NULL | FK → `quick_items.id` (Katalog) |
| `label` | text NOT NULL | Snapshot der Bezeichnung (Record-Titel / Quick-Name / Ad-hoc-Text) |
| `unitPrice` | numeric(10,2) NOT NULL | Snapshot des Einzelpreises zum Verkaufszeitpunkt |
| `quantity` | integer NOT NULL default 1 | Inventar immer 1; Quick/Ad-hoc ≥ 1 |

**Positions-Typ** (abgeleitet, in Code als Union geführt):
- `inventory`: `purchaseId` gesetzt, `quickItemId` null, `quantity = 1`.
- `quick`: `quickItemId` gesetzt, `purchaseId` null.
- `adhoc`: beide null.

Index: `(tenantId, transactionId)`, plus `(tenantId, purchaseId)` (Rückverweis Exemplar→Verkauf).

### 3.5 `wishlists` — staff-managed Kundenwünsche

| Spalte | Typ | Notiz |
|---|---|---|
| `id` | serial PK | |
| `tenantId` | integer NOT NULL | RLS-Schlüssel |
| `createdByUserId` | integer NOT NULL | erfassender Mitarbeiter |
| `customerName` | text NOT NULL | Kundenname (frei) |
| `customerEmail` | text NOT NULL | Ziel der Benachrichtigung, Format-validiert |
| `artist` | text NOT NULL | **Pflicht-Match-Kriterium** |
| `label` | text NULL | optionales Zusatzkriterium |
| `title` | text NULL | optionales Zusatzkriterium |
| `country` | text NULL | optionales Zusatzkriterium |
| `status` | `wishlist_status` NOT NULL default `'open'` | `open \| notified \| closed` |
| `createdAt` | timestamptz NOT NULL default now() | |

Enum `wishlist_status = 'open' | 'notified' | 'closed'`.

### 3.6 `wishlist_matches` — erkannter Treffer Wunsch ↔ eingetroffenes Exemplar

| Spalte | Typ | Notiz |
|---|---|---|
| `id` | serial PK | |
| `tenantId` | integer NOT NULL | RLS-Schlüssel |
| `wishlistId` | integer NOT NULL | FK → `wishlists.id` |
| `purchaseId` | integer NOT NULL | FK → `purchases.id` (das eingetroffene Exemplar) |
| `recordId` | integer NOT NULL | FK → `records.id` (Match-Bezug) |
| `status` | `wishlist_match_status` NOT NULL default `'pending'` | `pending \| notified \| dismissed` |
| `notifiedAt` | timestamptz NULL | gesetzt bei Versand |
| `createdAt` | timestamptz NOT NULL default now() | |

Enum `wishlist_match_status = 'pending' | 'notified' | 'dismissed'`.
Unique-Constraint: `(wishlistId, purchaseId)` — verhindert doppelte Treffer bei Re-Runs des Match-Jobs (Idempotenz).

### 3.7 Migrationen

- `drizzle/0006_*.sql` (Drizzle-generiert): Enums + Tabellen + FKs + Indizes.
- `drizzle/0007_slice3_rls.sql` (hand-authored, Slice-2-Muster): pro neuer Tabelle `ENABLE` + `FORCE ROW LEVEL SECURITY`, `tenant_isolation`-Policy, **und** `GRANT USAGE, SELECT ON SEQUENCE <table>_id_seq TO qr_app` (load-bearing — Insert schlägt sonst fehl).
- `src/db/assertions.ts`: `TENANT_SCOPED_TABLES += quick_items, transactions, transaction_items, wishlists, wishlist_matches`.
- `tests/db/assertions.test.ts`: Mock-Baseline `SOUND_TENANT_ID_TABLES` mit denselben 5 Tabellen synchronisieren (**Slice-2-Lektion**: per-Task-Reviewer fangen Mock-Drift nicht; volle Suite vor Final-Review).

## 4. Status-Übergänge (`record_status` auf `purchases`, bestehender Enum)

Gültige Übergänge, die dieser Slice verdrahtet:

```
verfügbar  → verkauft     (POS/Einzelmodal: Exemplar als Inventar-Position verkauft)
verfügbar  → reserviert   (Reservieren-Aktion)
reserviert → verkauft     (POS/Einzelmodal)
reserviert → verfügbar    (Reservierung-Storno)
```

`verliehen` bleibt als sichtbarer Status-Wert, der Übergang wird **nicht** in diesem Slice gebaut. Ein Verkauf eines Exemplars, das nicht (mehr) `verfügbar` oder `reserviert` ist, schlägt fail-closed fehl (kein Doppelverkauf, Abschnitt 6.1).

## 5. Komponenten / Screens

### 5.1 POS-Kasse — `src/app/(app)/kasse/page.tsx` (neu)

Zwei-Spalten-Layout in der Handoff-Bildsprache:

- **Links (Auswahl):** Inventar-Suche (nur `verfügbar`/`reserviert`), Treffer als hinzufügbare Zeilen; Quick-Item-Buttons (aktive `quick_items`); Ad-hoc-Position (Name + Preis) hinzufügen.
- **Rechts (Warenkorb):** Positionsliste (Label, Menge, Einzelpreis, Entfernen), Transaktions-Rabatt (€ oder %, intern in Cent aufgelöst), Zahlart-Cluster (⛁ Bar · ▭ Karte · PayPal · ◫ Gutschein) + `Gutschein-Code`-Feld (nur bei Gutschein), `Summe`, Button „Verkaufen".

Testids: `kasse-screen`, `kasse-inventory-search`, `kasse-quick-item-<id>`, `kasse-adhoc-add`, `kasse-cart`, `kasse-cart-item-<key>`, `kasse-discount-input`, `kasse-pay-<bar|karte|paypal|gutschein>`, `voucher-code-input`, `kasse-total`, `kasse-submit`.

### 5.2 Einzel-Verkauf-Modal (handoff-treu) — aus Lagerzeile

Der bereits vorhandene, in Slice 1 **deaktivierte** „Verkaufen"-Button in `InventoryList.tsx` wird aktiviert (nur für `verfügbar`/`reserviert`) und öffnet das pixel-genaue Verkauf-Modal: `Verkaufspreis €` (VK-Vorschlag via `suggestSalePrice`), Zahlart-Cluster + Gutschein-Code, `Summe`, `Verkaufen`. Erzeugt eine 1-Positions-Transaktion über `createSale`.

Testids: `sell-modal`, `sell-price-input`, `sell-pay-<method>`, `voucher-code-input`, `sell-submit`, `sell-cancel`.

### 5.3 Reservieren / Storno — Zeilen-Aktion

Auf `verfügbar` → Aktion „Reservieren" setzt `reserviert`; auf `reserviert` → „Reservierung aufheben" setzt `verfügbar`. Reservierung ist in diesem Slice ein **reiner Statuswechsel** (keine zusätzliche Persistenz von Kundendaten an der Reservierung). Testids: `reserve-action`, `reserve-cancel-action`.

### 5.4 Wunschlisten — `src/app/(app)/wunschlisten/page.tsx` (neu)

- **Erfassen-Formular:** `customerName`, `customerEmail`, `artist` (Pflicht), `label`, `title`, `country`.
- **Liste:** offene/benachrichtigte/geschlossene Wünsche mit Status-Badge.
- **Sektion „Offene Treffer":** alle `wishlist_matches` mit `status='pending'`, je mit Button „Benachrichtigen" und „Verwerfen" (`dismissed`).

Testids: `wishlist-screen`, `wishlist-form`, `wl-customer-name`, `wl-customer-email`, `wl-artist`, `wl-label`, `wl-title`, `wl-country`, `wishlist-submit`, `wishlist-matches`, `wl-match-<id>`, `wl-notify-<id>`, `wl-dismiss-<id>`.

### 5.5 Benachrichtigen-Modal

Zeigt Wunsch ↔ eingetroffenes Exemplar (Artist/Titel/Cover), Ziel-`customerEmail`, eine editierbare Nachrichtvorschau, Button „Senden". Bestätigung enqueued den Notify-Job. Testids: `notify-modal`, `notify-preview`, `notify-send`, `notify-cancel`.

### 5.6 ♡ „Auf Wunschliste" auf Lagerzeile

Der `onWish`-Button öffnet das Wunschlisten-Formular mit `artist`/`title` aus dem Record vorbefüllt. Testid: `add-to-wishlist`.

### 5.7 Navigation

`Kasse` und `Wunschlisten` als App-Navigationseinträge ergänzen (Sichtbarkeit nur für `mitarbeiter`/`admin`/`superadmin`).

## 6. Datenfluss

### 6.1 Verkauf — `createSale`

Server-Action (`src/app/(app)/kasse/actions.ts`), gated auf Nicht-`kunde`:

1. `requireSession()`; Rollen-Gate `if (user.role === 'kunde') forbidden();`; CSRF-Origin-Check.
2. Input zod-validiert: Positionen (jeweils inventory/quick/adhoc), Zahlart, Rabatt, optional Gutschein-Code.
3. **Eine** `withTenant({tenantId, userId})`-Transaktion:
   - Für jede Inventar-Position: `purchases`-Zeile mit `FOR UPDATE` lesen; **fail-closed**, wenn Status ∉ {`verfügbar`,`reserviert`} → ganze Transaktion bricht ab (kein Doppelverkauf).
   - `subtotal` und `total` **serverseitig** aus DB-/Katalog-Preisen berechnen (Money-Helper, intern Cent); Client-Preise nur für Ad-hoc/Vorschlag, nie als Autorität für Inventar/Quick.
   - `transactions` + `transaction_items` einfügen; referenzierte `purchases` → `verkauft` **und** deren vorhandene Spalten `soldPrice` (= Positions-`unitPrice`), `soldDate` (= jetzt), `paymentMethod` (= Transaktions-Zahlart als String) mitschreiben.
4. Rückgabe: Transaktions-ID; UI leert den Warenkorb / schließt das Modal.

### 6.2 Reservierung

Server-Action setzt `verfügbar↔reserviert` in einer `withTenant`-Transaktion mit demselben `FOR UPDATE`-Guard und Rollen-/CSRF-Gate.

### 6.3 Wunschlisten-Match beim Ankauf

- `performAnkauf` (Slice 2, `src/lib/ankauf.ts`) enqueued **nach** Commit zusätzlich `enqueueWishlistMatch({ tenantId, purchaseId, recordId })`.
- Neue QUEUE: `wishlistMatch: 'tenant.wishlist.match'`. Handler `src/worker/jobs/wishlistMatch.ts`:
  - lädt das Record (artist/title/country/label), sucht offene `wishlists` desselben Tenants, bei denen `artist` als case-insensitive Teilstring matcht **und** alle gesetzten Optionalfelder (`label`/`title`/`country`) ebenfalls als Teilstring matchen;
  - legt je Treffer ein `wishlist_matches` (`pending`) an — idempotent über Unique `(wishlistId, purchaseId)` (`onConflictDoNothing`).
- Match löst **keine** automatische Mail aus (mitarbeiter-bestätigter Flow).

### 6.4 Benachrichtigung — mitarbeiter-bestätigt

- „Benachrichtigen" im Modal ruft `notifyWishlistMatch(matchId)` (Server-Action, Rollen-/CSRF-Gate) → enqueued `enqueueWishlistNotification({ tenantId, matchId })`.
- Neue QUEUE: `wishlistNotify: 'tenant.wishlist.notify'`. Handler `src/worker/jobs/wishlistNotify.ts`:
  - lädt Match + Wishlist + Record; idempotent (verarbeitet nur `pending`);
  - sendet via `getEmailAdapter().send(...)` mit neuem Template `sendWishlistNotificationEmail(adapter, { to, customerName, artist, title, tenantName, permalinkUrl? })`;
  - setzt Match → `notified` (`notifiedAt`), Wishlist → `notified`.
- „Verwerfen" setzt Match → `dismissed` (keine Mail).

## 7. Sicherheit & Invarianten

- **RLS:** Alle 5 neuen Tabellen tenant-scoped: `SET LOCAL`/`set_config(...,true)`-Kontext via `withTenant`, FORCE RLS, `tenant_isolation`-Policy, Sequence-Grants; Boot-Assertion (`assertDatabaseSafety`) + Mock-Baseline aktuell halten. `qr_app` bleibt NOBYPASSRLS.
- **Kein Cross-Tenant-Leak** von `customerName`/`customerEmail`/Transaktionsdaten.
- **RBAC:** Verkauf, Reservierung, Wunschlisten-CRUD und Benachrichtigung erfordern Session und Rolle ∈ {`mitarbeiter`,`admin`,`superadmin`} (`kunde` → `forbidden()`).
- **CSRF:** Origin-Check (`isValidOrigin`, Slice-2-Muster) auf allen mutierenden Server-Actions.
- **Geld:** Speicherung `numeric(10,2)` (kein Float); exakte Rechnung intern in Integer-Cent via Money-Helper; Summen/Rabatt serverseitig nachgerechnet; `discount ≤ subtotal`.
- **Jobs:** idempotent, `{ retryLimit: 5, retryBackoff: true }`; transiente Fehler (z.B. SMTP) rethrow → Retry, permanente Fehler enden ohne Retry.
- **Doppelverkauf:** `FOR UPDATE` + Status-Guard in der Verkaufs-Transaktion.

## 8. Tests

- **Unit:** Match-Logik (artist-Pflicht, optionale Teilstring-Filter, case-insensitive, Nicht-Treffer); Summen-/Rabatt-Berechnung (inkl. `discount ≤ subtotal`, %→Cent); VK-Vorschlag-Wiederverwendung.
- **Integration (Testcontainers):** `createSale` setzt referenzierte `purchases` auf `verkauft` und legt Transaction+Items an; Doppelverkauf-Guard; Reservieren/Storno; RLS-Isolation aller neuen Tabellen; Match-Job legt idempotent `pending` an; Notify-Job sendet Mail (console/mailpit-Adapter) und setzt `notified`.
- **E2E (Playwright, fake-Treiber):** Verkauf aus Lagerzeile → Status `verkauft` + Transaktion sichtbar; POS-Cart mit Inventar+Quick+Ad-hoc+Rabatt → korrekte Summe; Reservieren→Storno; Wunschliste anlegen → passender Ankauf erzeugt `pending`-Treffer → „Benachrichtigen" → mailpit-Assertion (E-Mail an `customerEmail`); No-Leak-Check (Kundendaten erscheinen nicht im öffentlichen Schaufenster).
- **Seed:** Demo-Tenant erhält Beispiel-`quick_items` und mindestens eine offene Wunschliste, deren Kriterium auf einen Seed-Record matcht (für E2E).

## 9. Roadmap-Eintrag

Nach Abschluss: Dachdokument Slice 3 → „Implementiert + reviewed (N unit/integration + M E2E)".
