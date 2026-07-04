# Slice 5 — Mobile + Scanner (PWA): Eingefrorene Contracts (C1–C14)

> Diese Datei friert die Schnittstellen zwischen den Plan-Tasks ein. Jeder Task-Implementer
> und jeder Reviewer bekommt sie. Abweichungen von diesen Werten sind Spec-Verstöße —
> erst fragen, dann ändern. Spec: `docs/superpowers/specs/2026-07-03-qrecords-v2-slice5-mobile-scanner-pwa-design.md`

## C1 — Breakpoint & CSS-Schicht

- Breakpoint: **`@media (max-width: 767.98px)`** = mobil, **`@media (min-width: 768px)`** = Desktop.
- ALLE Slice-5-Media-Queries leben in `src/styles/globals.css` (Abschnitt `/* ── Slice 5: Mobile Shell ── */`). Screens behalten Inline-Styles.
- Klassen (exakte Namen):
  - `.app-sidebar` (auf der bestehenden `<aside>`) — mobil `display: none !important`
  - `.app-topbar-desktop` (auf dem bestehenden Topbar-`<header>`) — mobil `display: none !important`
  - `.app-header-mobile` (MobileHeader-Wrapper) — desktop `display: none !important`
  - `.app-tabbar` (BottomTabBar-`<nav>`) — desktop `display: none !important`
  - `.app-main` (auf dem bestehenden `<main>`) — mobil `padding: 16px 16px calc(96px + env(safe-area-inset-bottom)) !important`
  - `.qr-page-header` (auf den `<header>`-Blöcken der Pages) — mobil `display: none !important`
  - `.qr-mobile-only` — desktop `display: none !important`
  - `.qr-desktop-only` — mobil `display: none !important`
  - `.qr-chips-scroll` — mobil `flex-wrap: nowrap !important; overflow-x: auto; margin: 0 -16px; padding: 0 16px; scrollbar-width: none;`
  - `.qr-modal-backdrop` / `.qr-modal-card` — mobil: Backdrop `place-items: end center !important; padding: 0 !important`; Card `width: 100% !important; border-radius: var(--r-xl) var(--r-xl) 0 0 !important; max-height: 88vh; overflow-y: auto;`
  - `.qr-analytik-grid` — mobil `grid-template-columns: 1fr !important`
- `!important` ist hier LEGITIM und NÖTIG: die bestehenden Komponenten stylen inline; die Shell-Klassen müssen Inline-Styles nur im Mobile-Zweig überstimmen. Kein `!important` außerhalb dieses globals.css-Abschnitts.

## C2 — BottomTabBar

Datei: `src/app/(app)/_components/BottomTabBar.tsx` (Client). Props: `{ role: Role }`.

| Label | Route | lucide-Icon | staffOnly |
|---|---|---|---|
| Start | `/` | LayoutDashboard | nein |
| Suche | `/ankauf` | Search | **ja** |
| Bestand | `/inventar` | Package | nein |
| Wunsch | `/wunschlisten` | Heart | **ja** |
| Analytik | `/analytik` | BarChart3 | nein |

- Aktiv: exakt `/` für Start, sonst `pathname.startsWith(href)` (identisch SidebarNav); aktiv = `color: var(--accent-ink)`, fontWeight 700, `aria-current="page"`; inaktiv = `var(--text-3)`, 600.
- Container: `<nav aria-label="Mobile Navigation" className="app-tabbar" data-testid="bottom-tabbar">`, `position: fixed; bottom: 0; left: 0; right: 0; zIndex: 35; padding: '8px 8px calc(8px + env(safe-area-inset-bottom))'; background: color-mix(in srgb, var(--surface) 82%, transparent); backdropFilter: blur(16px); borderTop: '1px solid var(--border)'; display: flex;` Tabs je `flex: 1`.
- `staffOnly`-Filter identisch SidebarNav: `role !== 'kunde'`.

## C3 — MobileHeader

Datei: `src/app/(app)/_components/MobileHeader.tsx` (Client). Props: `{ role: Role; tenantName: string; onSchnellverkauf?: () => void }` — der €-FAB rendert NUR wenn `onSchnellverkauf` gesetzt UND `role !== 'kunde'` (Task 3 baut den Header ohne Callback → kein toter Button; Task 7 verdrahtet ihn über MobileChrome).

- Wrapper: `<header className="app-header-mobile" data-testid="mobile-header">`, `position: sticky; top: 0; zIndex: 30; display: flex; alignItems: center; gap: 10px; padding: '12px 16px'; background: color-mix(in srgb, var(--surface) 88%, transparent); backdropFilter: blur(14px); borderBottom: '1px solid var(--border)'`.
- Titel-Map (`usePathname()`, Match-Regel wie C2; Fallback letzte Zeile):

| Route-Match | Titel | Untertitel |
|---|---|---|
| `/` (exakt) | `Moin!` | `{Wochentag, D. Monat} · {tenantName}` (Intl.DateTimeFormat 'de-DE', `{ weekday: 'long', day: 'numeric', month: 'long' }`) |
| `/ankauf` | `Discogs-Suche` | `Releases finden & ankaufen` |
| `/inventar` | `Lagerbestand` | `Artikel & Status` |
| `/wunschlisten` | `Wunschlisten` | `Kundenwünsche & Treffer` |
| `/analytik` | `Analytik` | `Auswertungen · {tenantName}` |
| sonst | `q·records` | `{tenantName}` |

- Titel: 22px, `var(--font-display)`, 800, letterSpacing -.02em. Untertitel: 11.5px, `var(--text-3)`, 500.
- Rechts: `<ThemeToggle />` + €-FAB (nur `role !== 'kunde'`): `<button aria-label="Schnellverkauf" data-testid="fab-schnellverkauf">`, 38×38, rund, `background: var(--accent); color: var(--on-accent)`, Inhalt `€` (19px, 700). onClick → öffnet VerkaufSheet (C9) via Context/State im Layout-Client-Wrapper (siehe Task 7).

## C4 — Discogs-Adapter `searchByBarcode`

`src/lib/discogs/types.ts` — DiscogsAdapter erhält EXAKT:
```ts
searchByBarcode(auth: DiscogsAuth, barcode: string): Promise<DiscogsSearchResult[]>;
```
- HTTP-Client: `GET /database/search?barcode={encodeURIComponent(barcode)}&type=release&per_page=25`, Mapping via bestehendem `mapSearchResult` — Rückgabe-Shape identisch zu `search`.
- Fake-Treiber exportiert:
```ts
export const FAKE_BARCODE_HIT = '4988031234567';
```
`searchByBarcode`: `barcode.trim() === FAKE_BARCODE_HIT` → `[FIXTURES[0], FIXTURES[1]]` (Kind of Blue 11111 + Abbey Road 22222), sonst `[]`.

## C5 — `parseDiscogsReleaseUrl`

Datei: `src/lib/discogs/parse.ts` — **pure, OHNE `'server-only'`** (wird im Client/ScannerSheet gebraucht):
```ts
export function parseDiscogsReleaseUrl(text: string): number | null;
```
Akzeptiert `http(s)://(www.)discogs.com/release/{id}` und `.../release/{id}-{slug}` (Query/Fragment egal); liefert die positive Integer-ID, sonst `null`. Roundtrip-Pflicht: `parseDiscogsReleaseUrl(discogsReleaseUrl(n)) === n` (discogsReleaseUrl aus `src/lib/labels.ts`).

## C6 — Neue Server-Actions

`src/app/(app)/ankauf/actions.ts`:
```ts
const barcodeSchema = z.string().trim().regex(/^\d{8,14}$/);
export async function searchDiscogsByBarcode(
  barcode: string,
): Promise<
  { ok: true; results: SearchResultDTO[] } | { ok: false; reason: 'not_connected' | 'auth' | 'validation' | 'error' }
>;
```
Guards: `requireSession()` → `if (user.role === 'kunde') forbidden()` (Spec §8.2, bewusst strenger als `searchDiscogs`) → `getConnection` (null → not_connected) → zod (fail → validation) → `getDiscogsAdapter().searchByBarcode` (DiscogsAuthError → auth, sonst error). Lesend → kein isValidOrigin (Konvention `searchDiscogs`).

`src/app/(app)/kasse/actions.ts`:
```ts
export type CopyHit = {
  purchaseId: number; title: string; artist: string;
  targetPrice: string | null; conditionRecord: number | null; conditionCover: number | null;
};
export async function findAvailableCopiesByRelease(
  releaseId: number,
): Promise<{ ok: true; copies: CopyHit[] } | { ok: false; reason: 'validation' | 'error' }>;
export async function searchAvailableCopies(
  query: string,
): Promise<{ ok: true; copies: CopyHit[] } | { ok: false; reason: 'validation' | 'error' }>;
```
Beide: `requireSession()` → `if (user.role === 'kunde') forbidden()` → zod (`releaseId`: positive int; `query`: string trim 1..80) → Delegation lib (lesend, kein CSRF). `searchAvailableCopies` liefert max. 8 Treffer.

## C7 — lib-Funktion Exemplar-Lookup

`src/lib/inventory.ts`:
```ts
export async function findAvailableCopiesByRelease(
  ctx: { tenantId: number; userId: number | null },
  discogsReleaseId: number,
): Promise<CopyHit[]>;  // CopyHit re-export/Definition hier, kasse/actions importiert ihn
```
Join-Regel (KRITISCH): `innerJoin(records, eq(records.id, purchases.recordId))` + `eq(records.discogsId, discogsReleaseId)` + `eq(purchases.status, 'verfuegbar')` + beide `tenantId`-Prädikate (defence-in-depth wie `basePreds`). **NIEMALS `purchases.recordId = releaseId`** (Release-ID ≠ interne record.id). Kein `purchasePrice` im Rückgabetyp.

## C8 — ScannerSheet

Datei: `src/components/scanner/ScannerSheet.tsx` (Client). Props EXAKT:
```ts
export interface ScannerSheetProps {
  open: boolean;
  onClose: () => void;
  mode: 'ean' | 'label';
  /** mode='ean': erkannter/manuell eingegebener EAN/UPC (8–14 Ziffern, getrimmt). */
  onDetectEan?: (ean: string) => void;
  /** mode='label': via QR aufgelöste Release-ID (bereits geparst, > 0). */
  onDetectRelease?: (releaseId: number) => void;
}
```
- Rendert im bestehenden `Sheet` (`side='bottom'`), `title`: `mode === 'ean' ? 'Barcode scannen' : 'Etikett scannen'`.
- Kamera: `navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })`; Dekodier-Loop ~250ms-Intervall; Formate `['ean_13','ean_8','upc_a','upc_e','qr_code']`; Lib `barcode-detector/ponyfill` NUR per dynamic import nach Sheet-Open. Stream-Stop (`track.stop()`) in JEDEM Pfad (Close, Unmount, Fehler) — via einer einzigen `stopStream()`-Ref.
- Fehlertexte EXAKT: Berechtigung verweigert → `Kamera-Zugriff verweigert — bitte in den Browser-Einstellungen erlauben.`; sonst kein Stream → `Keine Kamera verfügbar — Code unten manuell eingeben.`
- `mode='ean'`: Fallback-Feld IMMER sichtbar: Label `EAN/UPC manuell eingeben`, `inputMode="numeric"`, Submit-Button `Suchen`, Client-Validierung `/^\d{8,14}$/` auf getrimmtem Wert. `data-testid="scanner-manual-input"` / `"scanner-manual-submit"`.
- `mode='label'`: kein manuelles Feld; QR ≠ Discogs-Release-URL → Inline-Hinweis `Kein Q-Records-Etikett erkannt.` (Scanner läuft weiter). Zusatztext bei Kamera-Fehler: `Nutze stattdessen die Artikel-Suche im Schnellverkauf.`
- Wrapper `data-testid="scanner-sheet"`.

## C9 — VerkaufSheet (Schnellverkauf)

Datei: `src/app/(app)/_components/VerkaufSheet.tsx` (Client). Props: `{ open: boolean; onClose: () => void }`.
- `Sheet side='bottom'`, `title='Schnellverkauf'`, `data-testid="verkauf-sheet"`.
- Inhalt: Button `Etikett scannen` (öffnet ScannerSheet `mode='label'`) + Suchfeld (`aria-label="Artikel suchen"`, ab 2 Zeichen `searchAvailableCopies`, max. 8 Treffer als Buttons `{artist} – {title} · {vk ?? '—'} €`).
- Treffer-Auswahl bzw. `onDetectRelease` → `findAvailableCopiesByRelease`: 0 Treffer → `Kein verfügbares Exemplar zu diesem Release im Bestand.` (role=alert); 1 → direkt SellModal; >1 → Auswahl-Liste im Sheet.
- Finaler Verkauf IMMER über das bestehende `SellModal` (purchaseId/title/artist/targetPrice aus CopyHit). KEINE eigene createSale-Logik im Sheet.

## C10 — Mobile-Sheet-Präsentation bestehender Modals

`SellModal.tsx` + `AnkaufModal.tsx`: Backdrop-`<div>` erhält zusätzlich `className="qr-modal-backdrop"`, Dialog-`<div>` `className="qr-modal-card"` — SONST BYTE-GLEICH (Desktop-Rendering unverändert; C1-Regeln greifen nur mobil).

## C11 — PWA

- `src/app/manifest.ts`: `export default async function manifest(): Promise<MetadataRoute.Manifest>` via `getCurrentTenant()`:
  `{ name: `${tenant.name} — Q-Records`, short_name: tenant.name.slice(0, 12), start_url: '/', scope: '/', display: 'standalone', background_color: '#FAF6F1', theme_color: tenant.branding.primaryColor, icons: [ {src:'/icons/icon-192.png',sizes:'192x192',type:'image/png',purpose:'any'}, {src:'/icons/icon-512.png',sizes:'512x512',type:'image/png',purpose:'any'}, {src:'/icons/icon-maskable-512.png',sizes:'512x512',type:'image/png',purpose:'maskable'} ] }`
- Icons: `public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png` (180²) — erzeugt durch `scripts/generate-icons.mjs` (sharp, devDependency), Motiv: Vinyl-Disc auf `#120F0B`, Akzent `#FF5A5F`. PNGs werden EINGECHECKT; das Script bleibt im Repo.
- Root-Layout: `export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#FF5A5F' }` (statisch; tenant-genaues theme_color kommt aus dem Manifest — der Export läuft auch auf tenant-losen Routen, DB-Zugriff dort verboten). `metadata.appleWebApp = { capable: true, statusBarStyle: 'default' }`; `metadata.icons = { apple: '/icons/apple-touch-icon.png' }`.
- `public/sw.js`: Cache `qr-static-v1`; install → precache `['/offline']` + skipWaiting; activate → alte `qr-*`-Caches löschen + clients.claim; fetch → nur GET + same-origin; `request.mode === 'navigate'` → network-first mit Fallback `caches.match('/offline')`; Pfad beginnt mit `/_next/static/` oder `/icons/` → cache-first; alles andere → durchreichen (KEIN Caching).
- `src/components/pwa/SwRegistration.tsx` (Client): `useEffect`-Registrierung `navigator.serviceWorker.register('/sw.js')` NUR wenn `'serviceWorker' in navigator && process.env.NODE_ENV === 'production'`. Eingebunden im Root-Layout-`<body>`.
- `src/app/offline/page.tsx`: statisch (kein DB/Auth), Texte EXAKT: `Du bist offline` (h1) / `Sobald die Verbindung zurück ist, kann es weitergehen.` / Button `Erneut versuchen` (location.reload, Client-Subkomponente).

## C12 — Start-Screen Quick-Actions

`src/app/(app)/page.tsx` (Server) rendert mobil-only (`className="qr-mobile-only"`, `data-testid="quick-actions"`) eine 3er-Grid-Reihe (`gridTemplateColumns: '1fr 1fr 1fr'`, gap 11) — NUR für `role !== 'kunde'`. Buttons (Handoff Z. 88–95): Kreis-Icon 40px (`var(--accent-soft)` bg, `var(--accent-ink)` Farbe, lucide 19px) + Label 12px/700; Border `1.5px solid var(--border-strong)`, `var(--r-lg)`:
| Label | Icon (lucide) | Aktion |
|---|---|---|
| Scannen | ScanLine | öffnet ScannerSheet `mode='ean'`; erkannter EAN → `router.push('/ankauf?barcode=' + ean)` |
| Verkauf | Euro | öffnet VerkaufSheet (C9) |
| Wünsche | Heart | `router.push('/wunschlisten')` |
(Client-Subkomponente `src/app/(app)/_components/QuickActions.tsx`.)

## C13 — Suche-Screen Barcode-Flow

`SearchForm.tsx`: Der Platzhalter-Button wird ersetzt durch aktiven Button (`aria-label="Barcode scannen"`, lucide `ScanLine`) → ScannerSheet `mode='ean'`. `onDetectEan` → `startTransition(searchDiscogsByBarcode(ean))` → Ergebnisse in denselben `searchState`/`ResultsGrid`-Pfad; `validation` → bestehende Fehlerdarstellung mit Text `Ungültiger Barcode — 8 bis 14 Ziffern.` (neuer Key im ERROR_MESSAGES-Objekt). Zusätzlich: `useSearchParams()`-Init — Param `?barcode=` (aus C12) feuert die Barcode-Suche einmalig beim Mount.

## C14 — E2E

`e2e/mobile-pwa.spec.ts`, im bestehenden chromium-Projekt, Datei-weit `test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })`; Desktop-Positiv-Kontrolle im selben File über `test.describe` + `test.use({ viewport: { width: 1280, height: 800 } })`. Szenarien (Namen exakt):
1. `1. Mobile Shell: Tab-Bar sichtbar, Sidebar versteckt, Navigation via Tabs` — 5 Tabs, aria-current wandert, `[data-testid="bottom-tabbar"]` sichtbar, `.app-sidebar` nicht sichtbar.
2. `2. Desktop-Guard: Sidebar sichtbar, Tab-Bar/Mobile-Header versteckt` (Positiv-Kontrolle im Desktop-describe).
3. `3. Scanner-Fallback: manueller EAN → Discogs-Treffer → Ankauf` — Suche → Scanner-Button → `scanner-manual-input` + Fehlertext sichtbar (headless: keine Kamera) → FAKE_BARCODE_HIT eintippen → 2 Treffer-Cards → AnkaufModal → EK `3` / VK bleibt Vorschlag → Ankauf → DB-Assert purchases-Count +1 (Live-Query, RUN-unabhängig via count-Delta).
4. `4. Mobiler Verkauf: Bestand-Karte → SellModal (Bottom-Sheet) → bar` — DB-Assert: status='verkauft', neue transactions-Zeile (count-Delta).
5. `5. PWA: Manifest tenant-gebrandet, /offline rendert, sw.js ausgeliefert` — `GET /manifest.webmanifest` (demo UND vinylcave: name enthält jeweiligen Tenant-Namen, theme_color = jeweilige Seed-primaryColor, Isolation!), `/offline` zeigt `Du bist offline`, `GET /sw.js` → 200 + `Content-Type` enthält `javascript`.
