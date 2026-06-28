x# Q-Records Storemanager v2 — Architektur-Übersicht (Programm-Dachdokument)

**Datum:** 2026-06-25
**Status:** In Brainstorming/Design — bestätigte Eckentscheidungen, Slice-0-Spec separat
**Vorgänger:** v1 = `mrwind-up-bird/q-records-storemanager` (Node/Express + TypeORM + React/Vite SPA, 42 Tabellen, Python-ML, Redis/Bull, pgvector)

---

## 1. Ziel

Eine **leichtgewichtige Neuauflage von v1 in einer einzigen Next.js-App**, die den 2026-Design-Handoff (`Q-Records App.dc.html`, `Q-Records Mobile.dc.html`, `Design System 2026.dc.html`) pixelgenau umsetzt. v1 funktioniert, ist aber überfrachtet (drei „memory-optimized" Dockerfiles, 1 GB-Caps, separater Python-ML-Service). v2 behält den bewährten Kern, wirft die Schwergewichte raus, konsolidiert Front-/Backend → **Deploy < 5 Min, wenige Abhängigkeiten, einfachere Wartung**.

Endziel ist das **vollständige v2** (Multi-Tenant-SaaS), gebaut als Folge **schiffbarer vertikaler Slices** auf einer Codebase — nicht als eine Riesen-Spec.

## 2. Bestätigte Eckentscheidungen (vom Nutzer abgenommen)

| Achse | Entscheidung | Begründung |
|---|---|---|
| Framework | **Next.js 15 (App Router) + React 19 + TypeScript** | Front+Backend in einer App, SSR für Schaufenster, API-Routes, Server Actions |
| Styling | **Tailwind CSS v4** (CSS-first `@theme`) | Token-System des Designs sind CSS-Vars → 1:1 Mapping |
| ORM | **Drizzle ORM** über PostgreSQL 17 | SQL-nah, leicht, top TS-Typen, sauber mit RLS, schnelle Cold-Starts |
| Hosting | **Self-host via docker-compose** | Datenhoheit (DSGVO), wenige Services, eine Compose-Datei |
| Multi-Tenancy | **Shared DB + Postgres RLS**, Subdomain-Routing | Bewährt aus v1, „vollständig isoliert" ist harte Anforderung |
| Integrationen | **Discogs echt jetzt**, Rest hinter Adapter-Interfaces gestubbt | Discogs ist Produktkern; Stripe/POS/Social/KI/ELSTER in eigenen Slices |

### Daraus abgeleitete Detail-Entscheidungen (mit Veto-Möglichkeit beim Spec-Review)
- **Auth: Auth.js v5** (next-auth@beta) — Credentials-Provider + DB-Sessions + Rollen. (Spec: generierte Zugangsdaten per E-Mail → Credentials-Flow.)
- **Background-Jobs: pg-boss** statt Redis+Bull → ein Service weniger. **Aber**: läuft als **eigener Worker-Prozess** (siehe Review), nicht im Web-Prozess.
- **Node 22 LTS, pnpm, Postgres 17.** Crypto: **AES-256-GCM** für Discogs-Tokens.
- **Worker + Web sind zwei Services** in docker-compose (das „single container" wird web + worker + db + mailpit).

## 3. Lightweight-Cut (Definition von „leichtgewichtig")

**Behalten (Kern):** records (+meta, SHA-256-Dedup-Hash über `artist|title|country|year|label`), purchases (EK/VK/Status), conditions (record+cover, Discogs 0–7), transactions/POS (bar/karte/paypal/gutschein), tenants + RLS + per-Tenant-Branding, users + leichtes RBAC, wishlist (+E-Mail-Benachrichtigung bei Eingang), Discogs (Such-API + Seller-OAuth, 2 req/s, verschlüsselte Tokens), Discogs-Marktdaten-Cache, permalinks (Schaufenster), plans (3 Tiers Free/Small/Big), collection batch-Ankauf, analytics_summary (pro Tenant).

**Vereinfachen:** Pricing (Multi-Signal 1115 LOC → `Discogs-Median × Zustandsfaktor × Marge`), KI-NL-Suche (pgvector+ML → 1 LLM-Call → strukturierte Filter), RBAC (volle Permission-Matrix → schlanke Rollen + Capabilities), Auth (Express-session+JWT+ACL → Auth.js v5), Verleih (leichte Variante; Status „Verliehen" ist im Design).

**Streichen/später:** Waxmind Python-ML (Siamese-NN), pgvector recommendation-Pipeline, 3D-Genre-Graph (three.js), Spotify, DeepL, events/community, Social-Publishing (IG/FB/TikTok), SerpAPI google_price_data, demo_requests-CRM, llm_usage_log (nur wenn KI aktiv).

## 4. Querschnitts-Architektur (gilt für alle Slices)

### 4.1 Multi-Tenancy & Datenzugriff — **die kritischste Entscheidung**
v1 bekam Tenant-Isolation „gratis" über einen gepatchten `pg.Pool.connect()`-Interceptor + AsyncLocalStorage. **Next.js + Drizzle hat das nicht.** Daher:
- **Einzige DB-Oberfläche = `withTenant(ctx, fn)`** — öffnet **eine Transaktion**, setzt `SET LOCAL app.current_tenant / app.current_user_id / app.is_superadmin`, führt alle Queries auf dem Tx-Handle aus, committet. **`SET LOCAL` (nie `SET`)** — connection-scoped `SET` leakt Tenant-Kontext über gepoolte Verbindungen → stiller Cross-Tenant-Breach.
- **Roher Drizzle-Client wird NICHT exportiert** (`server-only` + ESLint `no-restricted-import`). Defense-in-depth: `FORCE ROW LEVEL SECURITY` + `tenant_id NOT NULL` + expliziter `tenant_id` beim Insert.
- **Dedizierte Non-Superuser-App-Rolle** (kein `BYPASSRLS`); separate Owner/Migrations-Rolle. **Boot-Assertion** schlägt fehl, wenn App-Rolle Superuser ist oder eine Tenant-Tabelle keine `rowsecurity+force+policy` hat.
- **Tenant-Auflösung:** Edge-Middleware liest Subdomain → setzt `x-tenant-slug`-Header (Edge berührt **nie** die DB); Node-Helper `getCurrentTenant()` in React `cache()` löst Slug→ID **einmal/Request** auf. tenants-Registry **außerhalb** Tenant-RLS (oder via `SECURITY DEFINER`).
- **Fail-closed:** unbekannte/fehlende/reservierte Subdomain → 404/Redirect, **kein Default-Tenant**. Reserved-Denylist (`www/app/api/admin/auth/static/_next/cdn/mail`), Slugs lowercase, **kein** `X-Tenant-ID`-Override-Pfad in irgendeinem Build.

### 4.2 Auth ↔ Tenant-Bindung
- Harte Invariante: jeder authentifizierte Request + jede Server Action prüft `session.user.tenantId === resolvedTenantId` (sonst 403). Tenant für authentifizierte Requests wird **aus dem User** abgeleitet, nicht blind aus der Subdomain (Confused-Deputy).
- **Composite `UNIQUE(email, tenant_id)`** (v1-Lektion: globales unique email blockt gleiche Mail über Tenants). Credentials-`authorize()` keyed auf `(email, tenant-from-subdomain)`. Custom Drizzle-Adapter.
- **Cookies:** `__Host-`-Präfix, host-only (kein `Domain`), Secure, HttpOnly, SameSite=Lax → **Auth ist pro Subdomain/Tenant** (korrekte Isolation). `serverActions.allowedOrigins` auf bekanntes Host-Muster gepinnt.

### 4.3 Theming-Kaskade (4 Schichten, beide auf `<html>`)
1. **Primitive Ramps** `--coral-* / --indigo-* / --forest-*` (theme-unabhängig).
2. **Semantische Surfaces** `--bg/--surface/--text/--border` — nur via `[data-theme]` (light/dark).
3. **Accent-Familie** via `[data-accent="coral|indigo|forest"]` mit **separaten Werten je light/dark** (der Prototyp beweist: Dark-Accent ist nicht die light-Ramp verschoben).
4. **Tenant-Override** als Inline-`style` auf `:root` — **nur** die Accent-Familie, nie semantische/Feedback-Ramps.
- Tenant-Brand **serverseitig** aus Subdomain auflösen und im SSR-`<head>` als `<style>` inlinen (kein FOUC). `--on-accent` aus Luminanz **berechnen**; Tenant-`primaryColor` bei Provisionierung auf **4.5:1** clampen/validieren.

### 4.4 Deploy-Disziplin (<5 Min)
- **Image in CI prebuilden** (multi-stage, `output: 'standalone'`) → Deploy = `docker compose up`, kein Build auf dem Server.
- **Fonts self-hosten** via `next/font/local` (Bricolage variable `opsz 12..96` + Gewichte 500/600/700/800, Hanken 400–700, Geist Mono 400/500) — keine CDN-Laufzeitabhängigkeit, kein CLS.
- **Migrate-on-boot gated** (one-shot Step/Healthcheck-Reihenfolge); `CREATE INDEX CONCURRENTLY` + `REFRESH ... CONCURRENTLY` **außerhalb** transaktionaler Migrationen.
- `next/image` `remotePatterns` für Discogs-Cover + persistenter Cache-Volume (oder `unoptimized` fürs Schaufenster).

## 5. Slice-Roadmap

| Slice | Inhalt | Status |
|---|---|---|
| **0 Fundament** | Scaffold, Design-System/Tokens/Primitives, Multi-Tenant-DB (`withTenant`+RLS), Auth-Shell, Worker-Gerüst, Tenant-Provisioning, Seed, Dev-Mail, docker-compose | **Plan geschrieben + reviewed** → Implementierung |
| 1 Inventar+Dashboard+Schaufenster | records/purchases/conditions + Seed, Lagerbestand (Liste/Kacheln/Filter/Status), Dashboard-KPIs, öffentliches Schaufenster (permalink) | geplant |
| 2 Discogs+Ankauf | Discogs Such-API (OAuth, Rate-Limit), Discogs-Suche-Screen, Ankauf-Modal, Hash-Dedup, Marktdaten-Cache, vereinfachtes Pricing | geplant |
| 3 Verkauf/POS+Wunschlisten | Verkauf-Modal + transactions, Zahlarten, Wunschlisten-CRUD (Künstler/Label/Titel/Land), E-Mail-Benachrichtigung bei Eingang, Benachrichtigen-Modal | geplant |
| 4 Analytik+Batch+Etiketten | Analytik-Screen (Woche/Monat/Quartal, Charts, Top), collection batch-Ankauf + Etikettendruck (jsPDF), CSV-Export | geplant |
| 5 Mobile+Scanner (PWA) | Mobile-Screens, Bottom-Tab, Bottom-Sheets, Barcode/Cover-Scanner (html5-qrcode/Kamera), PWA | geplant |
| 6 Onboarding+Superadmin+Billing | First-Login-Wizard, API-Key-Config (Discogs/LLM), Superadmin (Tenant-Provisioning, plans), Stripe-Abrechnung, Feature-Gating je Tier | geplant |
| 7 KI-Suche+GDPR/ELSTER+Social+POS | LLM-NL-Suche, DSGVO/ELSTER-Export, Social-Publishing, POS-Integrationen (SumUp/Square) | geplant |

Jeder Slice durchläuft den Zyklus **Spec → Plan → Implementierung**.

## 6. Referenzen
- Slice-0-Spec: `2026-06-25-qrecords-v2-slice0-fundament-design.md`
- Design-Handoff: `.design-handoff/design-system-2026-refresh/` (README + 3× `.dc.html` + `support.js`)
- nyxcore: Projekte `q-records` (`d703516b…`), `storemanager` (`2a08de33…`); v1-Doku `MULTI_TENANT_ARCHITECTURE.md`, `CLAUDE.md`
