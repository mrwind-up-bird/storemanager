# Q-Records Storemanager v2 — Slice 2: Discogs (Seller-OAuth) + Ankauf — Design-Spec

**Datum:** 2026-06-29
**Status:** Design abgenommen → writing-plans
**Branch:** `feat/v2-slice2-discogs-buy` (von `main`, das nach PR #3 Slice 0+1 enthält)
**Vorgänger-Slices:** 0 Fundament (PR #1), 1 Inventar+Dashboard+Schaufenster (PR #2/#3)
**Roadmap:** `docs/superpowers/specs/2026-06-25-qrecords-v2-architecture-overview.md` §5, Slice 2

---

## 1. Ziel

Slice 2 liefert den **kanonischen Create-Pfad** für Inventar: Plattenhändler suchen auf Discogs, kaufen einen Treffer an (Ankauf) und legen damit `records` (Katalog) + `purchases` (physische Kopie) an — mit echten Marktdaten, Cover und einem zustandsbasierten VK-Vorschlag. Optional wird die Kopie direkt auf dem **eigenen Discogs-Marktplatz** des Shops gelistet.

Slice 1 stellte die **Read**-Seite des Inventars; Slice 2 stellt die **Write**-Seite. Bisher konnte Inventar nur über den Seed entstehen.

### Abgenommene Eckentscheidungen (aus Brainstorming)

| Achse | Entscheidung |
|---|---|
| Discogs-Tiefe | **Volle per-Tenant-Seller-OAuth jetzt** — echter OAuth-1.0a-Connect, verschlüsselte Tokens, echtes Marktplatz-Listing, Suche + Marktdaten |
| Listing-Ausführung | **Async via pg-boss-Worker** — Ankauf schreibt sofort lokal, Listing als Job mit Retry/Backoff + Status-Writeback |
| VK-Pricing | **Price-Suggestions je Zustand**, Verkauf zum Marktpreis (kein Aufschlag), frei editierbar; Fallback `lowest_price × Zustandsfaktor` |
| Connection-Modell | **Eine Seller-Connection je Tenant** (`UNIQUE(tenant_id)`), von einem Admin verbunden |
| Externes Discogs in CI | **Fake/Fixture-Driver**; echter HTTP-Driver nur in Dev hinter env |

---

## 2. Bestehende Bausteine (Slice 0/1), auf denen Slice 2 aufsetzt

Slice 2 fügt **keine** neuen Querschnitts-Patterns hinzu — es nutzt die bestehenden:

- **DB-Oberfläche** `src/db/tenant.ts`: `withTenant(ctx, fn)` / `withSuperadmin(fn)` / `withOwner(fn)`. `TenantCtx = { tenantId: number; userId: number | null }`. Nur `SET LOCAL`/`set_config(...,true)`, NULLIF-Guard, `qr_app` NOBYPASSRLS.
- **Crypto** `src/lib/crypto.ts`: `encryptSecret(plaintext, { tenantId, userId? })` / `decryptSecret(payload, aad)` — AES-256-GCM, KeyId-Präfix, AAD-gebunden. **Das ist die Token-Speicherung für Discogs.**
- **Schema** `src/db/schema.ts`: `records` (hat bereits `discogsId`, `coverImage`, `hash varchar(64)` mit `UNIQUE(hash, tenant_id)`, `label[]`, `genre[]`, `country`, `releaseYear`, `format`), `purchases` (hat `status` recordStatusEnum, `conditionRecord`/`conditionCover` smallint 0–7 CHECK, `purchasePrice` EK, `targetPrice` VK).
- **Dedup-Hash** `src/db/hash.ts`: `recordHash({ title, artist, country?, year?, label? })` → SHA-256 hex (trim+lowercase, `artist|title|country|year|label`).
- **Worker** `src/worker/index.ts`: `QUEUE`-Registry + `startWorker()`; Handler-Pattern (Job-Payload trägt `tenantId`, öffnet eigenes `withTenant`/`withSuperadmin`); Enqueue via `boss.send(QUEUE.x, payload)`.
- **env** `src/env.ts`: Zod-Schema, erweiterbar; `ENCRYPTION_KEY` (base64, 32 Byte) + `ENCRYPTION_KEY_ID` vorhanden.
- **Query-Modul-Pattern** `src/lib/inventory.ts` / `src/lib/storefront.ts`: `server-only`, exportierte Typen + async Funktionen mit `ctx`.
- **Design-Primitive** (Slice 0): Tokens, `CoverPlaceholder` (mit `labelColor`), `VinylDisc`, `StatusBadge`, Buttons mit `focus-ring-button`, `--tap`-Tap-Targets.
- **Design-Handoff:** `.design-handoff/design-system-2026-refresh/project/Q-Records App.dc.html` — Discogs-Suche-Screen (`<!-- ====== DISCOGS SEARCH ====== -->`) + Ankauf-Modal (`<!-- ANKAUF -->`).

---

## 3. Architektur & Units

### 3.1 Discogs-Client (`src/lib/discogs/`) — adapterbasiert

Eine **`DiscogsAdapter`-Schnittstelle** mit zwei Drivern: echter HTTP-Driver (Dev/Prod) + Fake-Driver (CI/Tests). Auswahl per env (`DISCOGS_DRIVER=http|fake`, Default in Test = `fake`).

```ts
// src/lib/discogs/types.ts
export interface DiscogsSearchResult {
  discogsId: number;        // release id
  title: string;
  artist: string;
  country: string | null;
  year: number | null;
  format: string | null;    // primärer Format-String, gemappt auf 'Vinyl'|'CD'|'Kassette'|… (s. §3.6)
  genre: string[];
  label: string[];
  coverImage: string | null;
  community: { want: number; have: number };
  median: number | null;    // Marktpreis-Anhalt (lowest_price / stats), nur Anzeige
}

export interface DiscogsPriceSuggestion {
  // Discogs liefert Preis je Zustandsgrad; Keys = Discogs-Grade-Strings ('Mint (M)', 'Near Mint (NM or M-)', …)
  byGrade: Record<string, number>;
}

export interface DiscogsListingInput {
  releaseId: number;
  conditionRecord: number;  // 0–7 intern
  conditionCover: number;   // 0–7 intern
  price: number;            // VK
  status?: 'For Sale';
}

export interface DiscogsAdapter {
  // OAuth 1.0a (three-legged)
  getRequestToken(callbackUrl: string): Promise<{ token: string; tokenSecret: string; authorizeUrl: string }>;
  getAccessToken(args: { requestToken: string; requestTokenSecret: string; verifier: string })
    : Promise<{ token: string; tokenSecret: string; username: string }>;
  // Authentifizierte Calls (token/tokenSecret pro Tenant)
  search(auth: DiscogsAuth, query: string): Promise<DiscogsSearchResult[]>;
  priceSuggestions(auth: DiscogsAuth, releaseId: number): Promise<DiscogsPriceSuggestion | null>;
  createListing(auth: DiscogsAuth, input: DiscogsListingInput): Promise<{ listingId: string }>;
}

export type DiscogsAuth = { token: string; tokenSecret: string };
```

- **`oauth.ts`** — OAuth-1.0a-Signierung (HMAC-SHA1), Request-/Access-Token-Austausch. Consumer-Key/Secret aus env.
- **`client.ts`** — HTTP-Driver: signierte Requests, **ein prozessweiter Token-Bucket-Limiter 2 req/s** (alle Discogs-Calls laufen serverseitig durch ihn), obligatorischer `User-Agent`-Header, Fehler-Mapping: `401/403` → `DiscogsAuthError` (Reconnect nötig), `429` → Backoff/Retry, `404` → `null`/leer.
- **`fake.ts`** — deterministische Fixture-Antworten (Suche, Price-Suggestions, Listing) für Tests/E2E; kein Netz.
- **`index.ts`** — `getDiscogsAdapter()` wählt Driver per env.

### 3.2 Pricing (`src/lib/pricing.ts`)

```ts
export type ConditionGrade = 0|1|2|3|4|5|6|7; // 0=Poor … 7=Mint (interne Skala, s. Slice-1)
export function suggestSalePrice(args: {
  suggestion: DiscogsPriceSuggestion | null;
  median: number | null;
  conditionRecord: ConditionGrade;
}): number | null;
```

- **Primär:** Mappe internen `conditionRecord` (0–7) → Discogs-Grade-Key → nimm `suggestion.byGrade[grade]` (bereits zustandsspezifisch). **Kein Aufschlag** (Verkauf zum Marktpreis).
- **Fallback** (keine Suggestion / kein Seller / leer): `median × Zustandsfaktor(conditionRecord)` mit der v1-Faktortabelle: 7/Mint=1.00, 6/NM=0.95, 5/VG+=0.80, 4/VG=0.65, 3/G+=0.50, 2/G=0.35, 1/F=0.20, 0/P=0.10.
- Rundung auf 2 Nachkommastellen. Ergebnis ist nur ein **Vorschlag** — im Modal frei editierbar.
- Combined-Condition (0.4·Cover + 0.6·Vinyl) ist hier **nicht** nötig, da Price-Suggestions je (Platten-)Grad kommt; Cover-Zustand wird gespeichert, fließt aber nicht in den VK-Vorschlag (YAGNI für Slice 2).

### 3.3 Schema-Migration 0004

**Neue Tabelle `discogs_connections`** (tenant-scoped, FORCE RLS, Policy wie alle Tenant-Tabellen):

```ts
export const discogsConnections = pgTable('discogs_connections', {
  id: serial('id').primaryKey(),
  tenantId: integer('tenant_id').notNull().references(() => tenants.id),
  discogsUsername: text('discogs_username').notNull(),
  oauthToken: text('oauth_token').notNull(),         // encryptSecret-Payload
  oauthTokenSecret: text('oauth_token_secret').notNull(), // encryptSecret-Payload
  connectedByUserId: integer('connected_by_user_id').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  tenantUnique: unique('discogs_connections_tenant').on(t.tenantId), // eine Connection je Tenant
}));
```

**`purchases`-Erweiterung:**

```ts
export const discogsListingStatusEnum = pgEnum('discogs_listing_status', [
  'not_listed', 'pending', 'listed', 'failed',
]);
// + auf purchases:
discogsListingId: text('discogs_listing_id'),                                   // nullable
discogsListingStatus: discogsListingStatusEnum('discogs_listing_status')
  .notNull().default('not_listed'),
```

- Migration via `drizzle-kit generate` (versioniertes SQL), **kein** `push`. RLS-Enable + FORCE + Policy + GRANTs für `discogs_connections` als geordnete SQL-Schritte (gleiche Vorlage wie Slice-0-Tenant-Tabellen). Boot-Assertion (`src/instrumentation.ts`) erfasst die neue Tabelle automatisch im RLS-Drift-Guard — sicherstellen, dass sie in der erwarteten Tabellenliste steht.

### 3.4 OAuth-Routen & Connection-Lifecycle

- **`GET /api/discogs/connect`** (Route-Handler): erfordert Session + **Admin**-Rolle + Session↔Tenant-Match. Holt Request-Token (`getRequestToken` mit dynamischer, tenant-subdomain-spezifischer Callback-URL — OAuth-1.0a `oauth_callback`-Override), legt **`requestTokenSecret` in ein signiertes, httpOnly, kurzlebiges Cookie** (SameSite=Lax, **protokoll-bewusst wie die Slice-0-Session-Cookie**: `__Host-`/Secure nur über https, Dev-http nutzt Klarnamen), redirectet auf `authorizeUrl`.
- **`GET /api/discogs/callback`**: liest `oauth_token` + `oauth_verifier` aus Query + `requestTokenSecret` aus Cookie, tauscht via `getAccessToken`, **verschlüsselt** Token+Secret mit `encryptSecret({tenantId})`, upsertet `discogs_connections` (eine je Tenant), löscht das Cookie, redirectet zurück auf den Ankauf-Screen mit Erfolgsstatus.
- **`disconnectDiscogs`** (Server-Action, admin-gated): löscht die `discogs_connections`-Zeile.
- **Fail-closed:** State/Verifier-Mismatch, fehlendes Cookie, abgelaufener Request-Token → 400 + Connect-Prompt. Tokens werden **nie** an den Client serialisiert.

### 3.5 Suche & Ankauf

- **Search-Screen `/(app)/ankauf`** (RSC-Shell + Client-Suchform): Server-Action `searchDiscogs(query)` → lädt Tenant-Connection, entschlüsselt Tokens, ruft `adapter.search` (rate-limited). Ohne Connection → „Discogs verbinden"-Leerstand (kein Such-UI). Treffer als Karten/Liste (View-Toggle wie Slice 1), je Karte: Cover, Titel/Artist/Meta, Median, want/have, **„⤓ Ankaufen"**. Wishlist-Herz + Barcode-Button **sichtbar, aber `disabled`** (Slice 3/5).
- **Ankauf-Modal** (Client-Komponente, Design-exakt): Kopfzeile (Titel/Artist/want-have), Cover-Thumb + Meta-Pills (Land/Jahr/Format/Genre), Zwei-Spalten-Form **EK** (`purchasePrice`) + **VK** (`targetPrice`, vorbelegt mit `suggestSalePrice(...)`, Hinweiszeile „◈ Vorschlag aus Discogs-Marktdaten (<Grade>): € X.XX · Zustand angepasst"), Condition-Pills **Platte** (default VG+) + **Cover** (default VG) als Radiogroups (Mappen auf 0–7), Toggle **„Direkt auf Discogs zum Verkauf listen"**, Footer „Abbrechen" / „Zum Bestand hinzufügen".
- **Server-Action `ankaufRecord(input)`** — eine `withTenant`-Transaktion:
  1. `recordHash(...)` berechnen; **record dedup-upserten** auf `UNIQUE(hash, tenant_id)` (existiert → vorhandene `recordId`; sonst INSERT mit `discogsId`/`coverImage`/Meta). Beim Treffer ggf. `coverImage`/Meta auffrischen, aber Hash-Identität bewahren.
  2. **`purchase` IMMER neu einfügen** (neue physische Kopie) mit `purchasePrice`, `targetPrice`, `conditionRecord`, `conditionCover`, `status='verfuegbar'`, `discogsListingStatus='not_listed'`. **Keine** Idempotenz-Dedup auf purchases — eine zweite identische Kopie ist legitim (löst den vorgemerkten `ensurePurchase`-Konflikt).
  3. Wenn `listOnDiscogs`: `discogsListingStatus='pending'` setzen und Worker-Job `discogs.listing.create` mit `{tenantId, purchaseId}` enqueuen.
  4. Inventar-Pfade revalidieren (`/inventar`, Dashboard).
- Eingabevalidierung (Zod): EK/VK ≥ 0, Conditions 0–7, releaseId vorhanden. Bei fehlender Connection → fail-closed.

### 3.6 Format-Mapping

Discogs liefert Format-Deskriptoren (`Vinyl`, `CD`, `Cassette`, `LP`, `12"`, …). Auf das **Slice-1-Vokabular** mappen (`'Vinyl' | 'CD' | 'Kassette'`), damit Filter/Dashboard-Split/Disc-Farbe konsistent bleiben (`'Vinyl'`, NICHT `'LP'`). Mapping zentral in `src/lib/discogs/format.ts` (unit-getestet). Unbekannt → `'Vinyl'`-neutral oder roher Wert per definierter Regel.

### 3.7 Worker-Job `discogs.listing.create`

- Payload `{ tenantId: number; purchaseId: number }`. Handler öffnet `withTenant({tenantId, userId:null})`, lädt purchase ⋈ record + Connection (entschlüsselt Tokens).
- **Idempotent:** wenn `discogsListingStatus==='listed'` und `discogsListingId` gesetzt → no-op.
- Ruft `adapter.createListing(...)`, schreibt `discogsListingId` + `discogsListingStatus='listed'` zurück. Bei `DiscogsAuthError` → `failed` (Reconnect nötig). Bei `429`/transient → pg-boss-Retry mit Backoff; nach erschöpften Retries → `failed`.
- Queue in `QUEUE`-Registry registrieren; Worker-Handler registrieren.

### 3.8 env-Erweiterung

```
DISCOGS_CONSUMER_KEY     z.string().min(1)
DISCOGS_CONSUMER_SECRET  z.string().min(1)
DISCOGS_API_URL          z.string().url().default('https://api.discogs.com')
DISCOGS_USER_AGENT       z.string().min(1)   // Discogs verlangt aussagekräftigen UA
DISCOGS_DRIVER           z.enum(['http','fake']).default(NODE_ENV==='test' ? 'fake' : 'http')
```

docker-compose/`.env.example` ergänzen; CI setzt `DISCOGS_DRIVER=fake`.

---

## 4. Datenfluss (Zusammenfassung)

```
Connect:  Admin → /api/discogs/connect → Discogs Authorize → /callback
          → encryptSecret(token,secret) → upsert discogs_connections (1/Tenant)
Suche:    /ankauf → searchDiscogs(q) → withTenant lädt+entschlüsselt Connection
          → adapter.search (signiert, 2 req/s) → Treffer + priceSuggestions
Ankauf:   Modal submit → ankaufRecord → EINE withTenant-Tx:
          (a) record dedup-upsert per hash  (b) purchase IMMER neu (Kopie)
          (c) optional: status=pending + enqueue discogs.listing.create
          (d) revalidate /inventar + dashboard
Listing:  Worker → withTenant → adapter.createListing → status=listed/failed + listingId
```

---

## 5. Sicherheit / Invarianten (verbindlich)

- **Token-Schutz:** OAuth-Token/Secret nur via `encryptSecret` (AAD=tenantId) at-rest; **nie** an den Client (kein Server-Component-Prop, kein JSON). Entschlüsselung ausschließlich serverseitig in `withTenant`.
- **RLS:** `discogs_connections` ist tenant-scoped mit FORCE RLS + Policy + `tenant_id NOT NULL` + explizitem `tenant_id` beim Insert; Listing-Felder erben die `purchases`-RLS. Boot-Assertion deckt die neue Tabelle ab.
- **AuthZ:** connect/disconnect erfordern Session + **Admin**-Rolle + `session.tenantId === resolvedTenantId` (sonst 403). `searchDiscogs`/`ankaufRecord` erfordern Session + Tenant-Match.
- **Fail-closed:** keine Connection → Suche/Ankauf/Listing blockiert (kein stiller Default, kein Cross-Tenant-Token). OAuth-State/Verifier streng geprüft.
- **Rate-Limit:** ein 2 req/s-Limiter umschließt **alle** Discogs-Calls; UA-Pflichtheader.
- **Worker:** Job trägt `tenantId`, öffnet eigenes `withTenant`; idempotent; keine Token-Leaks in Logs.
- **Kein Roh-Drizzle-Export**, `server-only` auf allen neuen lib-Modulen.

---

## 6. UI / Design-Treue

- Discogs-Suche-Screen + Ankauf-Modal **pixelgenau** nach `Q-Records App.dc.html` (Sektionen `DISCOGS SEARCH` + `ANKAUF`): Karten-Grid (auto-fill 300px), `CoverPlaceholder` + format-farbiger Disc (`labelColor`, CD=`--info`/Vinyl=`--accent` wie Slice 1), `StatusBadge`, Median + want/have (`font-mono`), Genre-Pills (`accent-soft`), EK/VK-Inputs (€-Prefix, VK `accent-soft`-Highlight), Condition-Radiogroups M/NM/VG+/VG/G+/G/F/P, Listing-Toggle (`on-accent` enabled-State), Footer-Buttons (`focus-ring-button`, `--tap`).
- Wiederverwendung der Slice-0/1-Primitive; keine neuen Tokens.
- Leerstände ruhig (analog Slice 1): „Kein Treffer auf Discogs" / „Discogs verbinden".

---

## 7. Verifikation / Akzeptanz

**Unit:** OAuth-1.0a-Signierung (bekannter Vektor), Pricing (Suggestion-Pfad + Fallback-Faktortabelle + Rundung), Format-Mapping (inkl. `'LP'→'Vinyl'`), Rate-Limiter (≤2/s), Condition-0–7↔Discogs-Grade-Mapping, Listing-Status-Writeback.
**Integration (testcontainers):** `discogs_connections`-RLS-Isolation (Tenant A sieht/entschlüsselt Tenant B nicht), Ankauf-Tx schreibt record+purchase, **Record-Dedup per Hash aber zweiter Ankauf = zweite Kopie** (nicht dedupliziert), Token round-trip encrypt/decrypt mit AAD, fail-closed ohne Connection.
**Worker:** Handler mit Fake-Adapter → Status `listed` + `listingId`; Auth-Fehler → `failed`; idempotenter Re-Run.
**E2E (Playwright, Discogs = Fake-Driver):** (1) ohne Connection → Connect-Prompt; (2) Connect-Stub → Suche liefert Fixtures; (3) Ankauf eines Treffers → erscheint in `/inventar` mit EK/VK/Status `verfuegbar`; (4) Ankauf mit Listing-Toggle → Kopie zeigt Listing-Status (pending→listed via Worker); (5) **No-Token-Leak:** kein OAuth-Token im HTML/Netzwerk-Payload des Such-/Ankauf-Screens; (6) zweiter identischer Ankauf → zwei Kopien, ein record.
**Gate:** typecheck + lint sauber; alle Suiten grün gegen frisch geseedeten `docker compose up`.

---

## 8. Bewusst deferred (Anti-Scope-Creep)

- **Wishlist-Herz** in Suchergebnissen (Slice 3) — sichtbar, deaktiviert.
- **Barcode-/Cover-Scanner** (Slice 5, PWA) — sichtbar, deaktiviert.
- **Volle API-Key-Config / Onboarding-Wizard** (Slice 6) — Slice 2 liefert nur den minimalen „Discogs verbinden"-Eintrag + Status/Disconnect.
- **Delisting/Relisting-Management, Bulk-/CSV-Import, Marktplatz-Inventory-Sync, Background-Enrichment-Jobs** — spätere Slices.
- **Plan-Gating** von Discogs (Starter+; Slice 6/Billing) — in Slice 2 für alle Tenants offen.
- **Verkauf/POS** (`status`-Übergänge verkauft/reserviert, transactions) — Slice 3.
- **Marge/Pricing-Konfiguration je Tenant** — Slice 2 verkauft zum Marktpreis (Faktor 1.0); konfigurierbare Marge später.
- Cover-Zustand fließt **nicht** in den VK-Vorschlag (nur gespeichert).

---

## 9. Risiken & offene Punkte

- **OAuth-1.0a-Korrektheit** ist die heikelste Stelle (Signatur-Basisstring, Encoding). Gegen einen bekannten Testvektor verifizieren; echter Connect manuell in Dev einmal durchspielen.
- **Price-Suggestions verlangt Seller-Account** — nicht jeder verbundene User ist Seller; Fallback-Pfad ist Pflicht und muss getestet sein.
- **Größter Slice bisher** (OAuth + Listing + Suche + Pricing + Ankauf). Falls der Plan zu groß wird: Connect-OAuth und Suche/Ankauf sind die natürliche Bruchlinie für eine 2-PR-Stapelung innerhalb des Slice — Entscheidung beim writing-plans.
- **Discogs-Cover-Bilder:** `next/image` `remotePatterns` für die Discogs-CDN-Hosts ergänzen (oder `unoptimized`), sonst lädt kein Cover.

---

## 10. Referenzen

- Roadmap: `docs/superpowers/specs/2026-06-25-qrecords-v2-architecture-overview.md`
- Slice-1-Spec (Datenmodell copy-as-inventory): `docs/superpowers/specs/2026-06-29-qrecords-v2-slice1-inventory-dashboard-storefront-design.md`
- Design-Handoff: `.design-handoff/design-system-2026-refresh/project/Q-Records App.dc.html` (`DISCOGS SEARCH`, `ANKAUF`)
- v1-Referenz (nyxcore): Discogs 2 req/s, `ENCRYPTION_KEY` 64 hex, Condition-Skala 0–7, Pricing `Base × ConditionMultiplier × Rarity` (→ vereinfacht)
