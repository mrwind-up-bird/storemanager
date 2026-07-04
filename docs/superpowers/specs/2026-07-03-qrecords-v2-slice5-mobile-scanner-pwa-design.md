# Q-Records Storemanager v2 — Slice 5: Mobile + Scanner (PWA) (Design/Spec)

**Datum:** 2026-07-03
**Status:** Abgenommen im Brainstorming (Ansatz A + barcode-detector), bereit für writing-plans
**Referenzen:**
- Dachdokument: `docs/superpowers/specs/2026-06-25-qrecords-v2-architecture-overview.md` (§5, Slice 5)
- Design-Handoff Mobile: `.design-handoff/design-system-2026-refresh/project/Q-Records Mobile.dc.html` (392×840-Mockup; Zeilenangaben unten beziehen sich auf diese Datei)
- Vorgänger-Slices: Slice 2 (Discogs/Ankauf), Slice 3 (Verkauf/POS), Slice 4 (Etikettendruck mit QR = Discogs-Release-URL)

---

## 1. Ziel

Die bestehende App wird unterhalb von 768px zur handoff-treuen Mobile-App: Bottom-Tab-Navigation, kompakter Header, Bottom-Sheets für Verkauf/Ankauf — auf **denselben Routen, mit denselben Server-Actions** wie Desktop (Ansatz A, adaptive Shell). Dazu kommt ein Kamera-Scanner mit zwei Kontexten (EAN → Discogs-Ankauf; Etiketten-QR → Artikel finden → Verkauf) und PWA-Installierbarkeit (tenant-gebrandetes Manifest, Service Worker mit Offline-Hinweisseite — **keine** Offline-Daten, **keine** Offline-Buchungen).

**Nicht in diesem Slice:** Cover-Erkennung (Bild-ML), Offline-Lesemodus, Kasse-Screen mobil-optimiert (bleibt Desktop-Territorium), per-Tenant-gefärbte App-Icons, Pull-to-Refresh.

## 2. Global Constraints (bindend für jeden Task & Review)

1. **Desktop unangetastet:** ≥768px rendert die App identisch zu heute. Kein bestehender Desktop-E2E-Test darf sich ändern müssen (Ausnahme: bewusst dokumentierte Selektor-Ergänzungen).
2. **Eine Codebase, eine Route-Wahrheit:** Keine `/m/*`-Routen, keine UA-Weiche. Mobile ist CSS-Breakpoint + wenige Mobile-Varianten-Komponenten auf denselben Routen.
3. **Breakpoint: 768px.** Media-Queries leben in `src/styles/globals.css` (die Screens selbst bleiben beim Inline-Style-Ansatz der Codebase; nur Shell-/Mobile-Klassen kommen in die globale CSS-Schicht).
4. **Designsystem-Treue:** Alle Farben/Radien/Typo aus Tokens (`src/styles/tokens.css`); Handoff-Glyphen werden wie in allen Slices durch lucide-Äquivalente ersetzt; deutsche UI-Texte exakt wie in dieser Spec bzw. dem Handoff.
5. **Sicherheitskette unverändert:** Jede neue mutierende/lesende Server-Action: `requireSession` → kunde-forbidden → `isValidOrigin` (CSRF, nur mutierend) → zod → Delegation an lib mit `withTenant`. Kein roher DB-Zugriff.
6. **Geld:** numeric(10,2)-Strings, `MONEY_STRING_RE`/`isValidMoneyString` aus `src/lib/money.ts` als DIE geteilte Client/Server-Regel. Kein Float.
7. **Schwere Libs nur per dynamic import** (Muster: jsPDF/qrcode in `LabelPrintModal.tsx`). Gilt für `barcode-detector`.
8. **Keine Schema-Migration in diesem Slice.** Der Barcode ist Such-Input, kein persistiertes Datum.
9. **Service Worker cached ausschließlich statische Assets + `/offline`.** Niemals API-Responses, niemals HTML mit Tenant-Daten, niemals POST/non-GET, niemals fremde Origins.
10. **Kamera nur im Secure Context** (HTTPS/localhost); jeder Kamera-Pfad hat einen manuellen Eingabe-Fallback.
11. Commits nur auf dem Feature-Branch `feat/v2-slice5-mobile-scanner-pwa`; Merge nach main nur via PR. Commit-Trailer wie in den Vorslices.

## 3. Datenmodell-Änderungen

**Keine.** Begründung: EAN/UPC wird nur als Suchparameter an Discogs durchgereicht; der Etiketten-Scan löst über die bestehende `records.discogsId` auf. Damit entfallen Migration, Backfill und RLS-Erweiterungen komplett.

**Dokumentierte Grenze:** Manuell erfasste Artikel ohne `discogsId` sind per Etiketten-Scan nicht auffindbar (ihr Etikett trägt keinen Discogs-QR). Für sie gilt weiterhin die manuelle Suche. Diese Grenze wird nicht durch neue Datenfelder „repariert" (YAGNI).

## 4. Responsive App-Shell & Navigation

### 4.1 CSS-Schicht (`src/styles/globals.css`)

Neue Klassen mit `@media (max-width: 767.98px)` / `@media (min-width: 768px)`:

- `.app-sidebar` — auf der bestehenden Sidebar in `src/app/(app)/layout.tsx`: mobil `display: none`.
- `.app-topbar-desktop` — bestehende Topbar: mobil `display: none` (der Mobile-Header ersetzt sie).
- `.app-header-mobile`, `.app-tabbar` — desktop `display: none`.
- `.app-main` — mobil `padding: 16px 16px 96px` (96px Bottom-Freiraum für die Tab-Bar, Handoff Z. 70) zzgl. `padding-bottom: calc(96px + env(safe-area-inset-bottom))`.

Das `(app)`-Layout erhält diese Klassen additiv; die Inline-Styles der Desktop-Darstellung bleiben byte-gleich wirksam (Klassen greifen nur mobil).

### 4.2 Bottom-Tab-Bar (`src/app/(app)/_components/BottomTabBar.tsx`, Client)

| Tab (Label exakt) | Route | lucide-Icon (identisch zur SidebarNav-Belegung derselben Route) |
|---|---|---|
| Start | `/` | LayoutDashboard |
| Suche | `/ankauf` | Search |
| Bestand | `/inventar` | Package |
| Wunsch | `/wunschlisten` | Heart |
| Analytik | `/analytik` | BarChart3 |

- Aktiv-Erkennung via `usePathname()` (exakt `/` für Start, sonst Präfix-Match); aktiver Tab: `color: var(--accent-ink)`, `font-weight: 700`, `aria-current="page"`; inaktiv: `var(--text-3)`, 600 (Handoff Z. 400).
- Container: `position: fixed; bottom: 0; left: 0; right: 0; z-index: 35; padding: 8px 8px calc(8px + env(safe-area-inset-bottom))`, Frosted-Glass (`backdrop-filter: blur(16px)` + halbtransparente `--surface`-Fläche), `border-top: 1px solid var(--border)` (Handoff Z. 325–333).
- **Kein Kasse-Tab** (handoff-treu): mobiler Verkauf läuft über €-FAB, Bestand-Zeilen und Etiketten-Scan. `/kasse` bleibt per URL erreichbar.

### 4.3 Mobile-Header (`src/app/(app)/_components/MobileHeader.tsx`, Client)

Sticky top, `backdrop-filter: blur(14px)`, z-index 30 (Handoff Z. 57–68). Inhalt: Screen-Titel (22px Bricolage, 800) + Untertitel (11.5px, `--text-3`), rechts `ThemeToggle` (bestehende Komponente `src/components/theme/ThemeToggle.tsx`) und der **€-FAB** (38×38px, rund, `background: var(--accent)`, `color: var(--on-accent)`, `aria-label="Schnellverkauf"`). Titel/Untertitel werden aus der Route abgeleitet (gleiche Titel wie die Desktop-Topbar).

€-FAB öffnet das Verkauf-Sheet im Zustand **„Schnellverkauf"** ohne vorausgewählten Artikel (§6.1).

## 5. Mobile Screen-Anpassungen (gleiche Routen, nur Präsentation)

### 5.1 Start (`/`)
Mobile Quick-Actions-Reihe (nur <768px sichtbar) mit exakt den Handoff-Aktionen (Z. 468–470):
- **Scannen** → öffnet ScannerSheet im EAN-Modus
- **Verkauf** → öffnet Verkauf-Sheet „Schnellverkauf" (wie €-FAB)
- **Wünsche** → navigiert zu `/wunschlisten`

KPI-Karten und Panels (Wunschlisten-Treffer, letzte Verkäufe) existieren bereits und sind auto-fit-responsive; sie erhalten nur ggf. mobile Abstands-Korrekturen.

### 5.2 Suche (`/ankauf`)
- Der bestehende deaktivierte Scanner-Button in `src/app/(app)/ankauf/_components/SearchForm.tsx` wird aktiviert → öffnet ScannerSheet im EAN-Modus. Ein erkannter/manuell eingegebener EAN feuert die Barcode-Suche (§8) und rendert die Treffer in der **bestehenden** Ergebnisliste.
- Ergebnis-Cards: das bestehende `ResultCard`-Design ist bereits handoff-treu und das Grid (`auto-fill minmax`) stapelt bei 390px automatisch einspaltig — **kein Umbau** (Plan-Entscheidung: das Handoff-Detail „Cover links neben Text" entfällt bewusst, YAGNI). Desktop-Darstellung unverändert.

### 5.3 Bestand (`/inventar`)
- Filter-Chips (StatusTabs/FilterBar) mobil horizontal scrollbar mit Edge-Bleed: `overflow-x: auto; margin: 0 -16px; padding: 0 16px`, Scrollbar versteckt (Handoff Z. 171–176).
- Listenzeilen erhalten eine kompakte Mobile-Karten-Variante (Titel/Künstler, Zustand-Pill, Format, VK-Preis, Button **„Verkaufen"** — identischer Text wie der bestehende Desktop-Zeilen-Button — → SellModal mit diesem Artikel). Umsetzung als CSS-Variante in `InventoryList.tsx` — keine zweite Datenbeschaffung.
- Der Scanner-Platzhalter in `FilterBar.tsx` wird aktiviert → ScannerSheet im **Etiketten-Modus** (§7).

### 5.4 Wunsch (`/wunschlisten`)
Bestehende Funktionalität; das vorhandene Stack-Layout (Flex-Spalten) stapelt mobil bereits sauber — **keine geplante Code-Änderung**, Sichtprüfung im E2E-Task. Status-Pills und Aktions-Buttons (Benachrichtigen/Ankauf) existieren bereits handoff-gemäß (Z. 206–228). Keine neuen Konzepte (das Handoff-Segment „Meine · Alle" wird NICHT übernommen — es gibt im Datenmodell keine per-User-Wunschlisten; dokumentierte, bewusste Abweichung).

### 5.5 Analytik (`/analytik`)
Die hartkodierten Grids `1.55fr 1fr` und `1fr 1fr` (`src/app/(app)/analytik/page.tsx`) stapeln mobil auf eine Spalte (`qr-analytik-grid`). Die KPI-Karten nutzen bereits ein auto-fit-Grid und stapeln mobil selbständig — das Handoff-2er-Grid (Z. 240–242) wird **nicht** erzwungen (Plan-Entscheidung, YAGNI). Reine Präsentation, keine Query-Änderungen.

## 6. Bottom-Sheets (Verkauf/Ankauf)

Beide nutzen das bestehende Primitive `Sheet` (`src/components/ui/Sheet.tsx`) mit `side='bottom'` (max-height 85vh, Drag-Handle-Optik 40×4px als statisches Element, `role="dialog" aria-modal="true"` — bereits vorhanden). Kein Swipe-to-dismiss (YAGNI; Schließen via Backdrop/Escape/X).

### 6.1 Verkauf-Sheet (`src/app/(app)/_components/VerkaufSheet.tsx`, Client)

Titel: **„Schnellverkauf"**. Das Sheet ist der **Artikel-Wähler**, nicht der Abschluss: Button **„Etikett scannen"** (→ ScannerSheet Etiketten-Modus) + Artikel-Suchfeld über verfügbare Artikel (Server-Action `searchAvailableCopies`, §8.2 — das Dashboard hat keine vorgeladenen Bestandszeilen). Nach Artikelwahl (per Suche, Scan-Einzeltreffer oder Auswahl-Liste bei mehreren) öffnet das **bestehende `SellModal`** (Slice 3) und führt den Abschluss: read-only-Preis (Server ist Preisautorität), Zahlarten Bar/Karte/PayPal/Gutschein, CTA „Verkaufen", `createSale` mit 1-Zeilen-Cart `{ kind: 'inventory', purchaseId }`.

*(Plan-Abweichung vom ursprünglichen Spec-Entwurf, der Preis-Input + Zahlarten IM Sheet vorsah — der Abschluss läuft stattdessen über das bestehende SellModal: null Logik-Duplikation, und ein clientseitiger Preis-Input hätte der Slice-3-Entscheidung „Server ist alleinige Preisautorität" widersprochen. Mobil erscheint das SellModal ohnehin als Bottom-Sheet (§6.2-Klassen), das Handoff-Bild bleibt gewahrt.)*

### 6.2 Ankauf mobil — Sheet-Präsentation des bestehenden AnkaufModal

Das bestehende `AnkaufModal` (Slice 2) enthält bereits den kompletten Flow inklusive **beider** Zustands-Reihen (Platte + Cover) und ruft `ankaufRecord` auf. Statt einer neuen Komponente wird es mobil als Bottom-Sheet **präsentiert**: Backdrop und Dialog-Container erhalten CSS-Klassen (`qr-modal-backdrop`/`qr-modal-card`), die nur unterhalb 768px greifen (unten angedockt, volle Breite, obere Eckenradien, max-height 88vh). Desktop rendert byte-gleich; null Logik-Duplikation. *(Plan-Abweichung vom ursprünglichen Spec-Entwurf, der ein separates `AnkaufSheet` vorsah — beim Plan-Schreiben stellte sich heraus, dass das Modal die Handoff-Felder bereits vollständig führt.)*

## 7. Scanner (`src/components/scanner/ScannerSheet.tsx`, Client)

Ein Bottom-Sheet mit Kamera-Viewfinder, zwei Modi über Prop `mode: 'ean' | 'label'`:

- **Technik:** `navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })` in ein `<video>`-Element; Dekodierung mit dem `barcode-detector`-Ponyfill (zxing-wasm; nutzt native `BarcodeDetector`-API wo vorhanden), **dynamic import** erst beim Öffnen des Sheets. Formate: `ean_13`, `ean_8`, `upc_a`, `upc_e`, `qr_code`. Erkennungs-Loop via `requestAnimationFrame`-Intervall (~4 Scans/s reichen); Stream wird bei Sheet-Close **immer** gestoppt (`track.stop()`), auch bei Fehlerpfaden.
- **Modus `ean`:** erster Treffer eines EAN/UPC-Formats → `onDetect(barcode)` an den Aufrufer (Suche-Screen), Sheet schließt, Barcode-Suche läuft (§8).
- **Modus `label`:** erster QR-Treffer → `parseDiscogsReleaseUrl(text)` (§7.1); bei `null` bleibt der Scanner aktiv und zeigt dezent „Kein Q-Records-Etikett erkannt". Bei gültiger Release-ID → `findAvailableCopiesByRelease` (§8): 0 Treffer → Meldung **„Kein verfügbares Exemplar zu diesem Release im Bestand."**; 1 Treffer → direkt SellModal mit Artikel; >1 → Auswahl-Liste (Titel, Zustand, VK), Auswahl → SellModal. *(Arbeitsteilung: das ScannerSheet liefert NUR die geparste Release-ID; Lookup, 0-Treffer-Meldung und Auswahl-Liste liegen beim Aufrufer — FilterBar bzw. VerkaufSheet.)*
- **Fallback (immer sichtbar unter dem Viewfinder bzw. statt ihm):** manuelles Eingabefeld. `mode='ean'`: Label **„EAN/UPC manuell eingeben"**, numerisch, 8–14 Ziffern. `mode='label'`: kein manueller Pfad (QR-URLs tippt niemand) — stattdessen Hinweis auf die Artikel-Suche im Verkauf-Sheet.
- **Fehlerpfade (deutsche Texte exakt):**
  - Berechtigung verweigert: **„Kamera-Zugriff verweigert — bitte in den Browser-Einstellungen erlauben."**
  - Keine Kamera/kein Secure Context: **„Keine Kamera verfügbar — Code unten manuell eingeben."**
  - In beiden Fällen bleibt das Sheet mit Fallback-Eingabe (ean) bzw. Hinweis (label) nutzbar.

### 7.1 `parseDiscogsReleaseUrl` (`src/lib/discogs/parse.ts`, pure)

`parseDiscogsReleaseUrl(text: string): number | null` — akzeptiert `https://www.discogs.com/release/{id}` und `https://www.discogs.com/release/{id}-{slug}` (auch ohne `www.`, http/https), extrahiert die numerische Release-ID; alles andere (fremde URLs, Text, EANs) → `null`. Muss mit dem Format aus `discogsReleaseUrl()` (Etikettendruck, Slice 4) roundtrip-kompatibel sein.

## 8. Discogs-Adapter & Server-Actions

### 8.1 Adapter-Erweiterung (`src/lib/discogs/types.ts` + Treiber)

```ts
// DiscogsAdapter — neue Methode:
searchByBarcode(auth: DiscogsAuth, barcode: string): Promise<DiscogsSearchResult[]>;
```
- **Echter Client** (`src/lib/discogs/client.ts`): `GET /database/search?barcode={barcode}&type=release`, gleiche Rate-Limit-/Auth-Pfade wie `search`. Ergebnis-Mapping identisch zu `search` (gleiches `DiscogsSearchResult`-Shape — die UI unterscheidet nicht, woher Treffer kommen).
- **Fake-Treiber:** deterministisch — der feste Test-EAN `4988031234567` (im Fake-Treiber als exportierte Konstante `FAKE_BARCODE_HIT`) liefert 2 Fixture-Releases (einer davon der Seed-„Kind of Blue"-Release), jeder andere Barcode liefert `[]`. Damit sind Integration- und E2E-Tests nicht-vakuos (positiv UND negativ testbar).

### 8.2 Neue Server-Actions

In `src/app/(app)/ankauf/actions.ts`:
```ts
export async function searchDiscogsByBarcode(barcode: string): Promise<SearchResponse>
```
Guards: requireSession → kunde-forbidden (bewusst **strenger** als das bestehende `searchDiscogs`, das nur über die Connection gated) → zod `z.string().trim().regex(/^\d{8,14}$/)` → Delegation an den Adapter. Lesend → kein CSRF-Check nötig (Konvention wie `searchDiscogs`).

In `src/app/(app)/kasse/actions.ts` (beide staff-only via kunde→forbidden, lesend):
```ts
export async function findAvailableCopiesByRelease(releaseId: number): Promise<
  { ok: true; copies: CopyHit[] } | { ok: false; reason: 'validation' | 'error' }
>
export async function searchAvailableCopies(query: string): Promise<
  { ok: true; copies: CopyHit[] } | { ok: false; reason: 'validation' | 'error' }
>
// CopyHit = { purchaseId; title; artist; targetPrice; conditionRecord; conditionCover }
```
`findAvailableCopiesByRelease` (zod: positive int) delegiert an die gleichnamige lib-Funktion in `src/lib/inventory.ts`: `withTenant`-Query auf purchases⋈records mit `records.discogsId = releaseId AND purchases.status = 'verfuegbar'`. `searchAvailableCopies` (zod: string 1..80, max. 8 Treffer) delegiert an das bestehende `listInventory` mit `{ q, status: 'verfuegbar' }` — der Schnellverkauf (§6.1) braucht eine Server-Suche, weil das Dashboard keine vorgeladenen Bestandszeilen hat. Beide liefern **keine** EK-Preise (purchasePrice bleibt server-intern, Zahlen sparsam halten).

## 9. PWA

### 9.1 Manifest (`src/app/manifest.ts`, dynamische Route)

Next-`MetadataRoute.Manifest`, pro Request via `getCurrentTenant()`:
- `name`: `"{tenant.name} — Q-Records"`, `short_name`: `tenant.name` (max 12 Zeichen, sonst gekürzt)
- `start_url: '/'`, `display: 'standalone'`, `scope: '/'`
- `theme_color`: Tenant-`primaryColor`; `background_color: '#FAF6F1'` (Light-`--bg` = `--n-50` aus tokens.css)
- `icons`: `/icons/icon-192.png` (192², `purpose: 'any'`), `/icons/icon-512.png` (512², `any`), `/icons/icon-maskable-512.png` (512², `maskable`) — statische, neutrale Q-Records-Icons (VinylDisc-Motiv auf `--n-950`), einmalig erzeugt und eingecheckt.

Da jede Tenant-Subdomain eine eigene Origin ist, ist das Manifest automatisch tenant-rein — keine Cross-Tenant-Leaks möglich. Unbekannte Subdomain → `getCurrentTenant()` schlägt fehl → 404 (fail-closed wie überall).

### 9.2 Viewport & Meta (`src/app/layout.tsx`)

- `export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#FF5A5F' }` — heute fehlt Viewport-Meta komplett; das ist Voraussetzung für alles Mobile. `themeColor` bewusst **statisch**: der Export läuft auch auf tenant-losen Infrastruktur-Routen (kein DB-Zugriff dort); die tenant-genaue Farbe liefert das Manifest (§9.1).
- `metadata.appleWebApp = { capable: true, statusBarStyle: 'default' }` (KEIN `title: tenant.name` — das Root-Layout-Metadata ist tenant-los, gleiche Begründung wie beim statischen `themeColor`); `apple-touch-icon` (180², `/icons/apple-touch-icon.png`).

### 9.3 Service Worker (`public/sw.js`, handgeschrieben — kein next-pwa)

- Cache-Name `qr-static-v1` (Versionsbump = Invalidierung).
- `install`: precache `['/offline']` + `skipWaiting()`; `activate`: alte Caches löschen + `clients.claim()`.
- `fetch`: nur GET, nur eigene Origin. Navigations-Requests (`request.mode === 'navigate'`): network-first, bei Netzwerkfehler `caches.match('/offline')`. `/_next/static/` und `/icons/`: cache-first (immutable Hashes). **Alles andere geht ungecacht durch** (insb. Server-Actions, API, HTML).
- Registrierung: `src/components/pwa/SwRegistration.tsx` (Client, `useEffect`), nur wenn `'serviceWorker' in navigator` und `process.env.NODE_ENV === 'production'`.

### 9.4 Offline-Seite (`src/app/offline/page.tsx`)

Statische, DB-freie Seite im Designsystem (Surface-Card, VinylDisc-Icon, Text **„Du bist offline"** + **„Sobald die Verbindung zurück ist, kann es weitergehen."**, Button **„Erneut versuchen"** mit `location.reload()`). Kein Auth-Redirect (liegt außerhalb `(app)`), keine Tenant-Daten.

## 10. Sicherheit & Isolation (Zusammenfassung)

- Neue Actions folgen der vollen Wächter-Kette; `findAvailableCopiesByRelease` läuft ausschließlich in `withTenant` (RLS) und gibt keine EK-Preise heraus.
- SW cached nie tenant-spezifische Antworten (nur statische Assets + `/offline`); pro Subdomain eigener SW/Cache (Origin-Isolation).
- Kamera-Streams werden bei Sheet-Close deterministisch gestoppt; kein Frame verlässt je den Client (Dekodierung ist rein lokal).
- Manifest/Icons enthalten keine Tenant-Geheimnisse (Name + Farbe sind ohnehin öffentlich im Schaufenster).
- Storefront (`/s/*`) bleibt von allem unberührt — kein Scanner, keine neuen Felder, PII-Scans der bestehenden E2E gelten weiter.

## 11. Testing

### 11.1 Unit (Vitest)
- `parseDiscogsReleaseUrl`: gültige URLs (mit/ohne www, mit/ohne Slug, http/https), Roundtrip mit `discogsReleaseUrl()`, Negativfälle (fremde URL, Text, EAN, leere Eingabe).
- Fake-Treiber `searchByBarcode`: Test-EAN → 2 Treffer, fremder EAN → `[]`.

### 11.2 Integration (Testcontainers, bestehendes Harness-Muster: kein statischer `@/db`-Import, `setupTestDatabase` → `vi.resetModules()` → dynamic import)
- `findAvailableCopiesByRelease`: findet nur `verfuegbar`-Exemplare des Releases; Tenant-B sieht Tenant-A-Exemplare nicht (RLS-Positiv- und Negativtest); Response enthält keinen `purchasePrice`.
- `searchDiscogsByBarcode`-Action: zod-Ablehnung ungültiger Barcodes (Buchstaben, 7 Ziffern, 15 Ziffern), kunde-Rolle → Fehler.

### 11.3 E2E (Playwright, seriell im bestehenden chromium-Projekt)
Neue Spec `e2e/mobile-pwa.spec.ts` mit `test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })` — **kein** zweites Playwright-Projekt. RUN-Suffix-Fixtures, Assertions gegen Live-DB-Wahrheit (Lektionen aus Slice 4):
1. **Shell:** mobil sind Tab-Bar (5 Tabs, `aria-current` auf aktivem) und Mobile-Header sichtbar, Sidebar nicht; Navigation über Tabs wechselt Screens.
2. **Desktop-Guard (Positiv-Kontrolle):** mit Desktop-Viewport im selben Spec-File: Sidebar sichtbar, Tab-Bar nicht.
3. **Scanner-Fallback-Flow:** Suche → Scanner-Button → Sheet zeigt Fallback-Eingabe (headless: keine Kamera → Fehlertext „Keine Kamera verfügbar…") → Test-EAN des Fake-Treibers eintippen → 2 Treffer erscheinen → Ankauf-Sheet → Artikel landet im Bestand (DB-Assert `purchases`-Count +1).
4. **Verkauf mobil:** Bestand → Mobile-Karte, Button „Verkaufen" → SellModal (Bottom-Sheet) → Zahlart „Bar" → „Verkaufen" → DB-Assert: purchase `verkauft`, transaction angelegt.
5. **PWA:** `GET /manifest.webmanifest` liefert `name` mit Tenant-Name und `theme_color` = Seed-primaryColor (beide Tenants unterschiedlich → Isolation nachgewiesen); `/offline` rendert „Du bist offline"; `sw.js` wird mit Status 200 ausgeliefert.

Hinweis: der echte Kamera-Dekodier-Pfad wird bewusst NICHT E2E-getestet (headless keine Kamera; Fake-Video-Dekodierung flaky). Der Dekodier-Wrapper bleibt dünn; die Logik dahinter (Parser, Suche, Lookup) ist vollständig unit-/integration-/E2E-abgedeckt.

## 12. Neue Dependencies

| Paket | Zweck | Bedingung |
|---|---|---|
| `barcode-detector` (3.x) | EAN/UPC/QR-Dekodierung (zxing-wasm, nutzt native API wo vorhanden) | nur dynamic import im ScannerSheet |
| `sharp` (devDependency) | einmalige App-Icon-Generierung (`scripts/generate-icons.mjs`); PNGs werden eingecheckt | nie zur Laufzeit |

Bewusst NICHT: `html5-qrcode` (unmaintained, eigene nicht-anpassbare UI — Abweichung von der Roadmap-Skizze, im Brainstorming abgenommen), `next-pwa` (SW ist 40 Zeilen Handarbeit), keine Icon-Generierungs-Lib zur Laufzeit.

## 13. Offene Entscheidungen — abgenommen

| Entscheidung | Ergebnis |
|---|---|
| Scanner-Scope | Nur Barcode (EAN/UPC + Etiketten-QR); keine Cover-Erkennung |
| PWA-Tiefe | Installierbar + Offline-Hinweisseite; keine Offline-Daten/-Buchungen |
| Scan-Fälle | Ankauf (EAN → Discogs) UND Verkauf (Etiketten-QR → Exemplar) |
| Architektur | Ansatz A: adaptive Shell, gleiche Routen, Breakpoint 768px |
| Scan-Bibliothek | `barcode-detector`-Ponyfill statt `html5-qrcode` (Roadmap-Abweichung) |
| Kasse mobil | Kein Tab; Verkauf via FAB/Bestand/Scan; `/kasse` bleibt erreichbar |
| App-Icons | Statisch, neutral (kein per-Tenant-Rendering) |
| Schema | Keine Migration; Barcode wird nicht persistiert |
| Zustands-Chips im Ankauf-Sheet | Zwei Reihen (Platte/Cover) statt Handoff-Einzelreihe — Datenmodell-Treue |
| Wunsch-Segment „Meine · Alle" | Nicht übernommen (kein per-User-Wunschlisten-Konzept im Datenmodell) |

## 14. Datei-Übersicht (neu/geändert)

**Neu:**
- `src/app/(app)/_components/BottomTabBar.tsx` — mobile Tab-Navigation
- `src/app/(app)/_components/MobileHeader.tsx` — mobiler Header + €-FAB
- `src/app/(app)/_components/VerkaufSheet.tsx` — Verkauf-Bottom-Sheet (beide Zustände)
- `src/app/(app)/_components/QuickActions.tsx` — Start-Screen Quick-Actions (mobil)
- `src/components/scanner/ScannerSheet.tsx` — Kamera-Viewfinder + Fallback
- `src/lib/discogs/parse.ts` — `parseDiscogsReleaseUrl`
- `src/app/manifest.ts`, `public/sw.js`, `src/components/pwa/SwRegistration.tsx`, `src/app/offline/page.tsx`
- `public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`
- `e2e/mobile-pwa.spec.ts`, Unit-/Integration-Specs gem. §11

**Geändert:**
- `src/styles/globals.css` — Shell-Media-Queries (§4.1)
- `src/app/(app)/layout.tsx` — Klassen + BottomTabBar/MobileHeader einhängen
- `src/app/layout.tsx` — viewport/themeColor/appleWebApp + SwRegistration
- `src/lib/discogs/types.ts`, `client.ts`, Fake-Treiber — `searchByBarcode`
- `src/app/(app)/ankauf/actions.ts` — `searchDiscogsByBarcode`
- `src/app/(app)/kasse/actions.ts` — `findAvailableCopiesByRelease`
- `src/lib/inventory.ts` — lib-Funktion für Exemplar-Lookup
- `src/app/(app)/ankauf/_components/SearchForm.tsx`, `src/app/(app)/inventar/_components/FilterBar.tsx` — Scanner-Buttons aktivieren
- `src/app/(app)/inventar/_components/InventoryList.tsx` — mobile Karten-Variante + „Verkaufen"-Button
- `src/app/(app)/analytik/page.tsx` — Grid-Stapelung mobil
- `src/app/(app)/page.tsx` — Quick-Actions-Reihe mobil
