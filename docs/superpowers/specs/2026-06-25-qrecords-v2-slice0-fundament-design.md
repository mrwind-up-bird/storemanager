# Q-Records Storemanager v2 — Slice 0: Fundament (Design-Spec)

**Datum:** 2026-06-25
**Dachdokument:** `2026-06-25-qrecords-v2-architecture-overview.md`
**Status:** Freigegeben (2026-06-27) → Implementierungsplan geschrieben + adversarial reviewed (7 Lenses) + gehärtet: `docs/superpowers/plans/2026-06-27-qrecords-v2-slice0-fundament.md`
**Quelle der Härtung:** adversarielle 4-Lens-Review (Architektur/Security/Red-Team/Design), alle „proceed-with-changes"

---

## 1. Zweck

Das tragfähige Fundament, auf dem die Slices 1–7 ohne Cross-Tenant-Bugs und ohne Design-Drift gebaut werden können. Slice 0 liefert: lauffähiges Next.js-Scaffold, das verbatim portierte **Design-System + eingefrorene Primitive**, die **Multi-Tenant-Datenebene (`withTenant` + RLS)**, eine **Auth-Shell** (Login/Session/Rollen), ein **Worker-Gerüst**, **Tenant-Provisioning + Seed + Dev-Mail** und eine **docker-compose**, die per `up` deployt.

**Sichtbares Ergebnis am Ende von Slice 0:** Auf `demo.localhost` einloggen → leere App-Shell mit Sidebar-Navigation, Theme-Toggle (Light/Dark), Accent-Wechsel, korrektem Tenant-Branding; zweiter Demo-Tenant ist vollständig isoliert.

## 2. In Scope

1. **Projekt-Scaffold** — Next.js 15 App Router, React 19, TS strict, Tailwind v4, pnpm, ESLint/Prettier, `output: 'standalone'`.
2. **Design-System-Fundament** — Tokens verbatim in Tailwind v4 `@theme`, 4-Schicht-Theming-Kaskade, self-hosted Fonts, Focus-System, eingefrorene Primitive (siehe §6).
3. **Multi-Tenant-Datenebene** — Drizzle-Schema (nur Slice-0-Tabellen), `withTenant`/`withSuperadmin`, RLS-Migrationspipeline, Rollen, Boot-Assertions.
4. **Auth-Shell** — Auth.js v5 Credentials + DB-Sessions + Rollen, Session↔Tenant-Invariante, `__Host-`-Cookies.
5. **Tenant-Auflösung** — Edge-Middleware (Subdomain→`x-tenant-slug`), `getCurrentTenant()` in `cache()`, Host-Härtung, Fail-closed.
6. **Worker-Gerüst** — pg-boss als eigener Prozess/Service, leere Queue + ein System-Job (matview-refresh-Skeleton), Tenant-im-Payload-Konvention.
7. **Provisioning & Dev-Env** — atomare `provisionTenant()`, Seed (2 Demo-Tenants + Beispiel-records), `*.localhost`-Strategie + `LOCAL_HOSTS`-Allowlist, `EmailAdapter` + Mailpit-Dev-Driver.
8. **Deploy** — Multi-stage Dockerfile, docker-compose (web + worker + postgres + mailpit), gated migrate-on-boot, CI-Build.
9. **Krypto-Baustein** — AES-256-GCM Helper (für Slice 2 Discogs-Tokens vorbereitet), Boot-Validierung `ENCRYPTION_KEY`.
10. **Fail-closed-Testsuite** als Akzeptanzkriterium (§9).

## 3. Explizit DEFERRED (Anti-Scope-Creep — Ausschlussliste)

- **Keine** vollständige Komponenten-Galerie über das hinaus, was die App-Shell + Slice-1-Screens brauchen.
- **Keine** Mobile-PWA-Shell (→ Slice 5).
- **Keine** echte Job-Logik (Worker ist „verdrahtet aber leer" + 1 Skeleton-System-Job).
- **Stripe/POS/Social/KI/ELSTER** nur als **leere Adapter-Interfaces** (keine Implementierung).
- **Keine** Discogs-Implementierung (Krypto-Helper ja, OAuth-Flow → Slice 2).
- **Keine** Business-Screens (Inventar/Discogs/Verkauf/Analytik) — nur die navigierbare leere Shell.
- RLS **nur** auf den Slice-0-Tabellen (tenants, users, sessions, records, purchases, plans, permalinks-Stub); restliche Tabellen in ihren Slices.

## 4. Datenebene & Multi-Tenancy (Detail)

### 4.1 `withTenant` — die einzige DB-Oberfläche
```ts
// db/tenant.ts  (server-only)
export async function withTenant<T>(ctx: TenantCtx, fn: (tx: Tx) => Promise<T>): Promise<T>
export async function withSuperadmin<T>(fn: (tx: Tx) => Promise<T>): Promise<T>
// ctx = { tenantId: number, userId: number | null, isSuperadmin: false }
```
- Implementierung: `BEGIN; SET LOCAL app.current_tenant = $1; SET LOCAL app.current_user_id = $2; SET LOCAL app.is_superadmin = $3;` → `fn(tx)` → `COMMIT` (Rollback bei Throw).
- **Nur `SET LOCAL`.** Niemals connection-scoped `SET`. `is_superadmin` default `'false'` in **jeder** Tx (nie aus Connection-State).
- **GUC-Namen:** `app.current_tenant`, `app.current_user_id`, `app.is_superadmin`. **Nicht** `app.current_user` (reserviert).
- Roher Pool/Client: in `db/client.ts` mit `import 'server-only'` + **nicht** re-exportiert; ESLint `no-restricted-imports` verbietet Import außerhalb `db/`.
- **Eine Transaktion pro Request** (Page-Reads bündeln, Tx durchreichen), nicht eine pro Query. React `cache()` für Read-Dedupe. `statement_timeout` + `idle_in_transaction_session_timeout` gesetzt. Pool `max` bewusst dimensioniert; pgbouncer-Hinweis: transaction-mode kompatibel mit `SET LOCAL`, aber keine session-level prepared statements.

### 4.2 Request-Propagation
- **Edge-Middleware:** liest Host → extrahiert Subdomain → validiert gegen Allowlist + Reserved-Denylist → setzt `x-tenant-slug` (Rewrite-Header). **Berührt nie die DB.**
- **`getCurrentTenant()`** (Node, in React `cache()`): liest `x-tenant-slug` via `headers()`, löst Slug→Tenant-Row **einmal/Request** in `withSuperadmin`/Registry-Read auf.
- **tenants-Registry:** nicht unter Tenant-RLS (es ist das Tenant-Verzeichnis) — geschützt per Rollen/Grants, ODER `SECURITY DEFINER`-Lookup-Funktion.

### 4.3 RLS & Migrationspipeline
- **`drizzle-kit generate`** (versionierte SQL-Migrationen). **Nie `push`** in shared/prod.
- RLS-Schritte (ENABLE + **FORCE** ROW LEVEL SECURITY, `CREATE POLICY tenant_isolation`, `CREATE POLICY superadmin_bypass`, App-Rolle, GRANTs, GUC-Defaults, `tenant_id DEFAULT current_setting('app.current_tenant', true)::int`) als **explizite, geordnete SQL-Migrationsschritte** in derselben Pipeline wie Tabellen-DDL.
- Policies: `tenant_isolation USING (tenant_id = current_setting('app.current_tenant', true)::int)`; `superadmin_bypass USING (current_setting('app.is_superadmin', true) = 'true')`.
- `CONCURRENTLY`-Operationen als **nicht-transaktionale** Schritte markiert.
- **Boot-Assertion** (vor Traffic): für jede tenant-scoped Tabelle `rowsecurity='t' AND relforcerowsecurity AND tenant_isolation-Policy existiert`; App-Rolle ist **kein** Superuser/`bypassrls`; Query ohne Kontext liefert 0 Zeilen.

### 4.4 Rollen
- `qr_app` (Runtime): Non-Superuser, kein `BYPASSRLS`, nur DML-Grants. `qr_owner` (Migrationen/Owner). Connection-Strings getrennt in `.env`.

## 5. Auth-Shell (Detail)

- **Auth.js v5** mit **Custom Drizzle-Adapter**; Credentials-Provider; DB-Sessions.
- `authorize({ email, password }, tenantId)` → Lookup `(email, tenantId-from-subdomain)`, bcrypt-Verify.
- **Session↔Tenant-Invariante:** zentraler `auth()`-Wrapper + Middleware → 403 wenn `session.user.tenantId !== resolvedTenantId`. Superadmin = einziger Ausnahmepfad, explizit + auditierbar.
- **Cookies:** `__Host-`-Präfix, host-only, Secure, HttpOnly, SameSite=Lax. → Auth pro Tenant/Subdomain.
- `next.config` `serverActions.allowedOrigins` = exaktes Apex-/Subdomain-Muster; Origin-Check auf jeder mutierenden Action.
- **Rollen Slice 0:** `superadmin`, `admin`, `mitarbeiter`, `kunde` (Enum + simple Capability-Checks; volle RBAC-Matrix bewusst nicht).
- Schema-Gotchas: **`UNIQUE(email, tenant_id)`**, `tenant_id NOT NULL` ohne Literal-Default; passwort bcrypt.

## 6. Design-System & Primitive (Detail)

### 6.1 Tokens → Tailwind v4 `@theme` (verbatim)
Alle `:root`-Tokens aus `Q-Records App.dc.html`/`Design System 2026.dc.html` 1:1: Farb-Ramps (coral/amber/neutral 0–950, green/red/blue, disc-*), Spacing `--s1..--s8`, Radien `--r-xs..--r-pill`, Shadows 1/2/3 (light **und** dark), Motion `--ease/--dur-1..3`, `--tap:44px`, Font-Vars. **Eine Single-Source-of-Truth-Datei** (`tokens.css`) — keine Neuerfindung in späteren Slices.

### 6.2 Theming-Kaskade
`[data-theme]` + `[data-accent]` **beide auf `<html>`** (nicht auf einem Wrapper-Div — sonst entkommen Modals/Portals dem Scope). Vollständige 7-Token-Accent-Familie (`accent, hover, press, soft, soft-border, ink, on-accent`) für **Coral, Indigo, Forest × light/dark** vor dem ersten Screen autoren. Tenant-Override nur Accent-Familie, inline im SSR-`<head>`, kein FOUC. `--on-accent` aus Luminanz berechnen; Tenant-Farbe auf 4.5:1 clampen.

### 6.3 Fonts
`next/font/local`: Bricolage Grotesque (variable `opsz 12..96`, 500/600/700/800), Hanken Grotesk (400–700), Geist Mono (400/500). `font-display: swap`, `size-adjust`-Fallback gegen CLS. → `--font-display/-body/-mono`.

### 6.4 Focus/Hover-System
Tailwind v4 `@utility`/`@variant` mit **`:focus-visible`** (nicht `:focus`), exakt die zwei Prototyp-Muster: Buttons `outline:3px solid var(--focus); outline-offset:2px`; Felder `outline:none; border-color:var(--accent); box-shadow:0 0 0 3px var(--accent-soft)`. Inline-Hover/Focus in späteren Slices verboten.

### 6.5 Eingefrorene Primitive (nur was Shell + Slice 1 braucht, Rest in Slices)
`Button` (variant primary/secondary/ghost/danger/honey × size sm36/md44/lg52 + loading-Spinner + Icon-Slot), `Input/Select/Textarea` (zwei Focus-Muster), `StatusBadge` (Status-Enum → {soft-bg, ink, dot}), `ConditionPill` (Discogs 0–7 **mit Textlabel**, nie nur Farbe), `Toggle`, `Checkbox`, `SegmentedControl` (echtes radio/tablist), `SearchField`, `Spinner`, `Card/Surface` (shadow-1/2/3), `Sheet/Modal`, **`VinylDisc`** + **`CoverPlaceholder`** als reviewte Primitive mit exakten Gradient-Stops. **Entscheidung:** Disc-Label = dedizierter `--disc-label`-Token (Default Coral), **nicht** automatisch accent-getrackt (iconische Brand-Art bleibt stabil; optional brandbar später).

### 6.6 A11y-Baseline
Echte SVG-Icons (lucide) statt Unicode-Glyphen, mit `aria-label`/`title` auf jedem Icon-only-Control; Status/Condition immer Text+Icon+Farbe (nie nur Farbe); sichtbare Focus-Rings überall; `@media (prefers-reduced-motion:reduce)`-Block verbatim erhalten, Disc-Spin daran gaten.

## 7. Worker (pg-boss) & Jobs

- **Eigener Prozess** (`worker.ts` → eigener compose-Service), **nicht** im `next start`-Prozess.
- pg-boss-Schema (`pgboss`) **außerhalb** Tenant-RLS / von einer nicht-policed Rolle besessen; eigener Pool-Budget getrennt vom Web-Pool.
- **Konvention:** jedes Job-Payload trägt `tenant_id` (+`user_id` wo nötig); Handler öffnet eigenes `withTenant(payload.tenant_id)` auf frischer Verbindung. **System-Jobs** (matview-refresh, Fan-out) laufen `withSuperadmin`, außerhalb `SET LOCAL`-Tx (autocommit für `REFRESH ... CONCURRENTLY`).
- Slice 0 liefert: pg-boss-Bootstrap/Migration, leere Queue-Registry, **ein** Skeleton-System-Job (`analytics_summary`-Refresh, no-op bis Slice 1/4).

## 8. Datenmodell Slice 0 (Drizzle)

Nur diese Tabellen (mit `tenant_id` + RLS, außer wo vermerkt):
- **tenants** *(keine Tenant-RLS — Registry)*: `id, slug UNIQUE, name, domain, config jsonb (branding: primaryColor/logo), plan, limits jsonb`.
- **plans** *(global)*: `slug, price_monthly_cents, limits jsonb, features jsonb` (Seed: free/small/big).
- **users**: `id, tenant_id, email, password (bcrypt), role enum, UNIQUE(email, tenant_id), is_superadmin`.
- **user_detail**: `user_id, name, surname, …`.
- **sessions** (Auth.js-Adapter-Form, tenant-aware).
- **records** *(minimal für Seed/Smoke)*: `id, tenant_id, title, artist, label text[], country, release_year, format, genre text[], cover_image, discogs_id, hash varchar(64), record_status, UNIQUE(hash, tenant_id)`.
- **purchases** *(minimal)*: `id, tenant_id, record_id, purchase_price, target_price, sold_date, payment_method`.
- **permalinks** *(Stub für Schaufenster-Routing-Test)*: `id, tenant_id, slug, filter jsonb`.

Dedup-Hash-Util (`SHA-256(title|artist|country|year|label)`, lowercased) als Baustein (volle Nutzung in Slice 2).

## 9. Akzeptanzkriterien (Fail-closed-Testsuite)

Slice 0 gilt als fertig, wenn **alle** grün sind:
1. **Kein Tenant-Kontext → 0 Zeilen** (Query außerhalb `withTenant`).
2. **Zwei-Tenant-Interleaving** (parallele Requests Tenant A/B) → **kein Leak**.
3. **User A auf B-Subdomain → 403** (Session↔Tenant-Invariante).
4. **Unbekannte/reservierte Subdomain → 404** (kein Default-Tenant), unbekannter permalink → 404 (nicht fremder Bestand).
5. **App-Rolle ist kein Superuser**; Boot-Assertion failt bei fehlender RLS/Force/Policy.
6. **`is_superadmin` leakt nicht** über gepoolte Verbindungen.
7. **Branding** ohne FOUC (SSR-inline), Theme+Accent-Wechsel korrekt, beide auf `<html>`.
8. **Deploy:** frisches `docker compose up` → migrierter, geseedeter, lauffähiger Stack < 5 Min; Login auf `demo.localhost` erfolgreich.
9. **Provisioning:** `provisionTenant()` atomar (Rollback bei Teilfehler).
10. **Dev-Mail:** First-Login-Credential-Mail landet in Mailpit.

## 10. Risiken & Mitigationen (aus der Review)

| Risiko | Mitigation (in Slice 0 verankert) |
|---|---|
| `SET LOCAL`-Wrapper vergessen → Leak | `withTenant` als einzige Oberfläche, `server-only` + ESLint-Bann, Interleaving-Test |
| Edge↔Node teilen kein AsyncLocalStorage | Header-Propagation + `cache()`-Resolver, Edge ohne DB |
| Session nicht an Tenant gebunden | Harte Invariante 403, Tenant aus User abgeleitet, `__Host-`-Cookies |
| Host-Header-Spoofing/Reserved-Subdomain | Host-Allowlist, Proxy überschreibt `X-Forwarded-Host`, Denylist, fail-closed |
| drizzle-kit managed kein RLS | RLS als SQL-Migrationsschritte, `generate` nie `push`, Boot-Assertion |
| pg-boss ohne Tenant-Kontext | eigener Prozess, `tenant_id` im Payload, eigenes `withTenant`, pgboss-Schema außerhalb RLS |
| matview-Refresh vs RLS/CONCURRENTLY | pro Tenant gekeyt + eigene Policy, Refresh als Superadmin-Job außerhalb Tx |
| Pool-Erschöpfung | eine Tx/Request, Timeouts, bewusste Pool-Größe, `cache()` |
| AES-GCM IV-Reuse | random 12-Byte-IV/Verschlüsselung, `iv\|\|tag\|\|ciphertext`, AAD=tenant+user, key_id |
| <5-Min-Deploy gefährdet | CI-prebuilt standalone-Image, self-hosted Fonts, gated Migration |
| FOUC / Theming-Specificity-Wars | SSR-inline Brand, 4-Schicht-Kaskade auf `<html>`, Tenant nur Accent |
| Slice-0 balloont | Ausschlussliste §3 |

## 11. Offene Vetos (bitte beim Review bestätigen/ändern)
- Auth.js v5 (statt Lucia/custom) · pg-boss als eigener Service · `__Host-`/per-Tenant-Auth (Login pro Shop) · Disc-Label = pinned `--disc-label` (nicht accent-getrackt) · `*.localhost` für lokale Subdomains · Mailpit als Dev-Mail · Node 22/Postgres 17.
