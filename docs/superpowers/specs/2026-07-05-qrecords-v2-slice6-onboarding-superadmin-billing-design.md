# Q-Records v2 — Slice 6: Onboarding + Superadmin + Billing (Design/Spec)

**Datum:** 2026-07-05
**Status:** Design abgenommen (Brainstorming 2026-07-04/05), bereit für Implementierungsplan
**Branch:** `feat/v2-slice6-onboarding-superadmin-billing`
**Vorgänger:** Slice 5 (Mobile + Scanner PWA) gemerged via PR #7 (`main` @ 2dffc97)
**Dachdokument:** `2026-06-25-qrecords-v2-architecture-overview.md`

---

## 1. Ziel & Scope

Slice 6 macht aus der Einzel-Shop-App ein betreibbares Multi-Tenant-SaaS:

1. **Platform-Zone** unter `admin.<ROOT_DOMAIN>`: eigener Superadmin-Login, Tenant-Liste, Tenant-Provisioning-UI, Tenant-Detail mit manuellem Plan-Override.
2. **Billing**: echtes Stripe (Test-Mode) hinter einem Billing-Adapter (`BILLING_DRIVER=fake|stripe`), Abo-Verwaltung im Tenant (Checkout + Customer Portal), Webhook-Verarbeitung, `subscriptions`-Tabelle.
3. **Feature-Gating**: Zähl-Limits (`maxRecords`, `maxUsers`) und Modul-Gates (`analytik`, `discogsListing`) je Plan Free/Small/Big, serverseitig an den Actions erzwungen, Upsell-UI statt nackter 403.
4. **Onboarding**: erzwungener Passwortwechsel beim Erst-Login (temporäres Provisioning-Passwort), danach 4-Schritt-Wizard (Info → Discogs → Team → Review) für Admins; alles später unter `/einstellungen` erreichbar.
5. **Einstellungen-Seite** im Tenant mit Tabs Info / Discogs / Team / Abo.

**Nicht-Ziele (bewusst raus, teils Follow-up):**
- Cross-Tenant-Impersonation („als Tenant einloggen") aus v1.
- Plans-Editor in der Platform-Zone — Pläne bleiben Seed-Konfiguration.
- LLM-API-Key-Konfiguration — kein Konsument vor Slice 7 (KI-Suche); der Discogs-Tab etabliert das Muster, ein weiteres Feld ist dann trivial.
- Jahres-Abos, Trials, Rabatte, Steuer-/Rechnungslogik — Stripe Checkout/Portal decken Zahlungsmittel & Kündigung ab, mehr nicht.
- Billing-Reconcile-Job (nächtlicher Stripe-Abgleich) — Follow-up; der manuelle Plan-Override im Tenant-Detail ist der Fallback.
- Zweiten `admin`-Rollen-User anlegen über Team-Tab (nur `mitarbeiter`/`kunde`) — Admin-Anlage bleibt Provisioning-Sache.

## 2. Ausgangslage (bereits vorhanden, wird benutzt statt neu gebaut)

| Baustein | Fundort | Status |
|---|---|---|
| `plans`-Tabelle (slug PK, name, priceMonthlyCents, limits/features JSONB) | `src/db/schema.ts:60–67` | existiert, ungenutzt |
| `tenants.plan` (default `'free'`) + `tenants.limits` (JSONB-Override) | `src/db/schema.ts:54–55` | existiert, ungenutzt |
| `provisionTenant()` (Slug-/Farb-Validierung, atomar, temp. Passwort, Credentials-Mail) | `src/lib/provisioning.ts:88–180` | komplett |
| `withSuperadmin()` / GUC `app.is_superadmin` | `src/db/tenant.ts:27–49` | komplett |
| Reserved-Subdomain-Denylist inkl. `admin` | `src/lib/subdomain.ts:4–15` | 404 heute |
| AES-256-GCM `encryptSecret()` mit Tenant-AAD | `src/lib/crypto.ts:33–92` | komplett |
| `discogsConnections` (oauthToken/-Secret verschlüsselt) | `src/db/schema.ts:224–243` | komplett |
| Dummy-Bcrypt-Timing-Schutz, `__Host-`-Cookie-Schema | `src/auth/config.ts` | Muster übernehmen |
| pg-boss-Queue-Registry | `src/worker/index.ts:26–31` | kein neuer Job nötig |

**Fehlt:** Superadmin-UI, Platform-Identität, Einstellungen-Seite, Wizard, Stripe, jegliches Gating-Enforcement, `mustChangePassword`.

## 3. Architektur-Entscheidung: getrennte Platform-Identität (Ansatz A)

Tenant-Auth ist vollständig tenant-gebunden (`users.tenantId NOT NULL`, `sessions.tenantId NOT NULL`, `authorize()` löst Tenant aus Subdomain, `jwt.encode` mintet Tenant-Sessions). Die Platform-Zone bekommt deshalb eine **eigene Identität**, die diese Pfade nicht anfasst:

- Neue **Registry-Tabellen** (ohne Tenant-RLS, wie `tenants`/`plans`): `platform_users`, `platform_sessions`.
- **Eigener, schlanker Session-Mechanismus** (kein Auth.js): bcrypt + opakes Token + Cookie. Auth.js bleibt exklusiv für Tenants.
- Alle Datenzugriffe der Zone über vorhandenes `withSuperadmin()` (Cross-Tenant-Lesen) bzw. `withOwner()` (Provisioning, Webhook-Schreibpfad).
- `users.isSuperadmin` / Rolle `'superadmin'` bleiben im Schema (kein Migrations-Rückbau), werden aber von der Platform-Zone **nicht** verwendet; kein Codepfad dieses Slices setzt sie.

Verworfene Alternativen: Auth.js platform-aware verzweigen (Platform-Logik in den kritischsten Bestands-Codepfaden, `sessions.tenantId` würde doppeldeutig); zweite NextAuth-Instanz (Credentials+DB-Sessions-Workaround doppelt, trotzdem neue Tabellen nötig).

## 4. Middleware & Routing (Platform-Zone)

`src/middleware.ts` bekommt einen dritten Zweig (Edge-safe, weiterhin ohne DB):

1. Header-Hygiene zuerst, wie gehabt: client-gelieferte `x-tenant-slug` **und neu `x-platform-zone`** werden auf jedem Pfad gestrippt, bevor verzweigt wird.
2. Host ist **exakt** `admin.<ROOT_DOMAIN>` → `x-platform-zone: 1` setzen und **Rewrite** von `<pathname>` auf `/platform<pathname>`.
3. Auf Tenant-Hosts und allen übrigen Hosts wird ein direkter Request auf `/platform` oder `/platform/*` **explizit mit 404** beantwortet (die Zone ist nur via Admin-Host erreichbar; kein Cookie-/Origin-Verwischen zwischen Zonen).
4. `POST /api/billing/webhook` kommt als **exakter Pfad** in die Allowlist für Nicht-Tenant-Hosts (Signaturprüfung schützt ihn, §9). Alle anderen reservierten/unbekannten Hosts bleiben fail-closed 404.
5. `parseTenantSlug` bleibt unverändert; `admin` bleibt in der Denylist (der neue Zweig greift **vor** dem reserved-404).

Routen der Zone liegen unter `src/app/platform/`:

| Route (Zone) | Sichtbar als | Zweck |
|---|---|---|
| `/platform/login` | `admin.<host>/login` | Platform-Login |
| `/platform` | `admin.<host>/` | Tenant-Liste |
| `/platform/tenants/neu` | `admin.<host>/tenants/neu` | Tenant anlegen |
| `/platform/tenants/[id]` | `admin.<host>/tenants/<id>` | Tenant-Detail |

Das Platform-Layout rendert eine eigene, minimale Chrome (Design-System-Tokens, Desktop-only, kein Bottom-Tab/PWA); es prüft `requirePlatformSession()` und redirectet unauthentifiziert auf `/login` (Zone). Die Zone verwendet **nicht** das `(app)`-Layout.

## 5. Platform-Auth

**Schema (Registry, ohne Tenant-RLS):**

```
platform_users:    id serial PK · email text UNIQUE NOT NULL · password text NOT NULL (bcrypt)
                   · createdAt/updatedAt timestamptz
platform_sessions: token text PK · platformUserId int NOT NULL → platform_users.id
                   · expires timestamptz NOT NULL · createdAt timestamptz
```

**Login-Flow** (`/platform/login`, Server Action):
- zod (E-Mail, Passwort nicht leer), CSRF via vorhandener Origin-Prüfung (erwarteter Origin = Admin-Host).
- bcrypt-Vergleich mit Dummy-Hash-Fallback (identisches Muster wie `verifyCredentials` — kein User-Enumeration-Timing-Orakel).
- Erfolg: `randomUUID()`-Token, Insert in `platform_sessions`, Cookie host-only, HttpOnly, SameSite=Lax; Name/Secure protokoll-abhängig wie `SESSION_COOKIE_NAME` (`__Host-qr.platform` unter https, `qr.platform` unter http-Dev). **Laufzeit 24 h** (bewusst kürzer als die 30-Tage-Tenant-Session).
- `requirePlatformSession()` (Node, `server-only`): liest Cookie → Session-Row (nicht abgelaufen) → `PlatformUser`; sonst Redirect auf Zone-Login. Abgelaufene Rows werden beim Lookup opportunistisch gelöscht.
- Logout-Action: Session-Row löschen + Cookie clearen.
- **Jede mutierende Platform-Action**: `requirePlatformSession()` → Origin-Check → zod → Delegation, spiegelbildlich zur Tenant-Action-Kette.

**Seed:** legt einen Platform-User `platform@qrecords.test` an (Passwort aus `SEED_ADMIN_PASSWORD`, idempotent wie `ensureTenant()`).

## 6. Superadmin-Screens (3 Stück)

1. **Tenant-Liste** (`admin.<host>/`): Tabelle Name · Slug (als Link `https?://<slug>.<ROOT_DOMAIN>`) · Plan · Platten-Anzahl · User-Anzahl · angelegt am. Daten via `withSuperadmin()`-Aggregatquery. Kein Suchfeld/Paging (Tenant-Zahl ist klein; Follow-up ab Bedarf).
2. **Tenant anlegen** (`/tenants/neu`): Formular über `provisionTenant()` — Slug, Name, Primärfarbe (vorhandener WCAG-AA-Check `assertAccessibleAccent()`), Plan (Select aus `plans`), Admin-E-Mail. Erfolg: temporäres Passwort **einmalig** anzeigen + Credentials-Mail (mailpit) — beides existierendes Verhalten von `provisionTenant()`. Validierungsfehler (Slug belegt/reserviert, Kontrast) als Feldfehler.
3. **Tenant-Detail** (`/tenants/[id]`): Branding-/Plan-/Subscription-Status (read-only Anzeige der `subscriptions`-Zeile, falls vorhanden), **Plan manuell setzen** (Select + Speichern; schreibt `tenants.plan` direkt — Sonderkonditionen & Webhook-Fallback; ändert keine Stripe-Objekte, Hinweis-Text dazu), **Credentials-Mail erneut senden** — an den `admin`-User des Tenants: neues temporäres Passwort generieren, `mustChangePassword=true` setzen, Mail schicken.

Alle Screens deutsch, Design-System-Tokens/Primitives, keine Kundendaten-Anzeige über Aggregatzahlen hinaus (kein PII-Dump in der Platform-Zone).

## 7. Billing-Adapter

Spiegel des Discogs-Musters: `src/lib/billing/{types,fake,stripe,index}.ts`, Auswahl via `BILLING_DRIVER` (`'fake'` Default, `'stripe'`).

```ts
interface BillingAdapter {
  createCheckoutSession(args: {
    tenantId: number; planSlug: string;
    successUrl: string; cancelUrl: string;
  }): Promise<{ url: string }>;
  createPortalSession(args: {
    customerId: string; returnUrl: string;
  }): Promise<{ url: string }>;
  parseWebhookEvent(rawBody: string, signature: string): BillingEvent; // wirft bei ungültiger Signatur
}

type BillingEvent =
  | { kind: 'checkout_completed'; eventId: string; tenantId: number; planSlug: string;
      customerId: string; subscriptionId: string }
  | { kind: 'subscription_updated'; eventId: string; customerId: string; subscriptionId: string;
      status: string; planSlug: string | null; currentPeriodEnd: Date; cancelAtPeriodEnd: boolean }
  | { kind: 'subscription_deleted'; eventId: string; customerId: string; subscriptionId: string }
  | { kind: 'ignored'; eventId: string };
```

- **Stripe-Driver:** offizielles `stripe`-npm-Paket, Server-only. Checkout-Session `mode: 'subscription'`, `line_items` aus `plans.stripePriceId` (Server ist Preisautorität — der Client liefert nur den Plan-Slug), `metadata: { tenantId, planSlug }` + `client_reference_id = tenantId`. Portal-Session via `billingPortal.sessions.create`. Webhook-Parse via `stripe.webhooks.constructEvent` mit `STRIPE_WEBHOOK_SECRET`; gemappt werden `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, alles andere → `ignored`. `planSlug` bei `subscription_updated` wird über die Price-ID → `plans.stripePriceId` rückaufgelöst (unbekannte Price-ID → `null`, Zeile wird dann ohne Plan-Wechsel aktualisiert + Warn-Log).
- **Fake-Driver:** `createCheckoutSession` schließt den Kauf **sofort** ab (Upsert `subscriptions` + `tenants.plan` im Owner-Kontext, deterministische Fake-IDs `fake_cus_<tenantId>` / `fake_sub_<tenantId>`) und gibt direkt `successUrl` zurück — der komplette Upgrade-Flow ist damit ohne Stripe-Keys E2E-testbar. `createPortalSession` gibt `returnUrl` zurück. `parseWebhookEvent` akzeptiert JSON-Body mit Signatur `fake` (für Integrationstests des Webhook-Handlers).
- **Env** (`src/env.ts`): `BILLING_DRIVER` (`'fake' | 'stripe'`, Default `'fake'`), `STRIPE_SECRET_KEY` und `STRIPE_WEBHOOK_SECRET` (beide optional; zod-Refinement: Pflicht, wenn `BILLING_DRIVER === 'stripe'`). `.env.example` + Compose-Doku ergänzen; keine neuen Services.

## 8. Datenmodell-Änderungen (eine Migration + RLS-Migration)

```
subscriptions (tenant-scoped, volle RLS wie alle Tenant-Tabellen):
  id serial PK · tenantId int NOT NULL UNIQUE → tenants.id   -- genau ein Abo pro Tenant
  · stripeCustomerId text NOT NULL · stripeSubscriptionId text NOT NULL
  · planSlug text NOT NULL → plans.slug · status text NOT NULL
  · currentPeriodEnd timestamptz · cancelAtPeriodEnd boolean NOT NULL DEFAULT false
  · createdAt/updatedAt timestamptz

webhook_events (Registry, ohne Tenant-RLS):
  id text PK (Stripe event.id) · type text NOT NULL · receivedAt timestamptz DEFAULT now()

plans   += stripePriceId text NULL                 -- Fake-Driver ignoriert es
users   += mustChangePassword boolean NOT NULL DEFAULT false
tenants += onboardingCompletedAt timestamptz NULL
platform_users / platform_sessions                 -- §5
```

- `status` speichert den Stripe-Status als Text (informativ fürs UI); **Gating-Autorität ist ausschließlich `tenants.plan`** — nur Webhook-Handler, Fake-Checkout und der manuelle Superadmin-Override schreiben dieses Feld.
- **Boot-Assertion** (Slice 0: jede Tenant-Tabelle braucht rowsecurity+force+policy): `platform_users`, `platform_sessions`, `webhook_events` kommen explizit auf die Registry-Ausnahmeliste; `subscriptions` bekommt Policies nach dem Muster von `0001_rls.sql`.
- `subscriptions`-RLS-Test wie gehabt **nicht-vakuos**: beide Tenants besitzen je eine Zeile, A sieht exakt seine, B exakt seine.
- Free-Plan = keine `subscriptions`-Zeile. Downgrade löscht **keine Daten**: Bestände über dem Limit bleiben, nur neue Anlagen werden blockiert (§10).
- **Migration backfillt `onboardingCompletedAt = now()` für alle bestehenden Tenants** — Bestands-Tenants sind längst konfiguriert und dürfen beim nächsten Login nicht in den Wizard laufen. Nur neu provisionierte Tenants starten mit `NULL`.

**Seed-Anpassungen (Bestandstests dürfen nicht brechen):**
- `demo` wechselt auf `plan='big'` (alle Features + unbegrenzt → die bestehenden 59 E2E laufen unverändert), `vinylcave` bleibt `'small'`.
- Neuer dritter Tenant **`freeshop`** (`admin@freeshop.test`): `plan='free'`, `tenants.limits`-Override `{ "maxRecords": 2 }` — deterministisches Ziel für die Gating-E2E (§14). Re-Seed setzt `freeshop` auf `free` zurück und löscht dessen `subscriptions`-Zeile (Reset-Muster wie die Wunschlisten in Slice 3).
- Alle Seed-Tenants bekommen `onboardingCompletedAt` gesetzt, alle Seed-User `mustChangePassword=false` — sonst laufen bestehende E2E-Logins in Passwort-/Wizard-Redirects.

## 9. Abo-Flows im Tenant

**Einstellungen → Abo-Tab** (nur Rolle `admin`; `mitarbeiter`/`kunde` → `forbidden()`):
- Anzeige: aktueller Plan (aus `tenants.plan`), Preis (aus `plans.priceMonthlyCents`, Integer-Cents formatiert), Subscription-Status/`currentPeriodEnd`/Kündigungsvermerk (falls Zeile vorhanden), Hinweis „Zahlung ausstehend — wird nach Bestätigung aktiv", wenn `?checkout=success` aber Plan noch nicht geflippt ist.
- **Upgrade/Wechsel:** Buttons je verfügbarem Plan → Server Action (`requireSession` → admin-only → Origin-Check → zod Plan-Slug ∈ {small, big}) → `createCheckoutSession` mit `successUrl=/einstellungen?tab=abo&checkout=success`, `cancelUrl=/einstellungen?tab=abo` → Redirect auf `url`.
- **„Abo verwalten":** nur wenn Subscription-Zeile existiert → `createPortalSession(customerId)` → Redirect (Zahlungsmittel, Rechnungen, Kündigung laufen im Stripe-Portal).

**Webhook** `src/app/api/billing/webhook/route.ts` (POST, Node-Runtime, Raw-Body lesen bevor JSON-Parse):
1. Signaturprüfung via Adapter — ungültig → 400.
2. Dedup: `INSERT INTO webhook_events ... ON CONFLICT DO NOTHING`; Konflikt → 200 ohne Verarbeitung (Stripe-Retries).
3. Verarbeitung im **Owner-Kontext** (Request ist tenant-los): `checkout_completed` → Upsert `subscriptions` (Konfliktziel `tenantId`) + `tenants.plan = planSlug`; `subscription_updated` → Zeile per `stripeSubscriptionId` aktualisieren (+ Plan-Wechsel nur bei aufgelöstem `planSlug`); `subscription_deleted` → Zeile löschen + `tenants.plan = 'free'`; `ignored` → nichts.
4. Unbekannter Customer/Subscription → 200 + Warn-Log (kein Retry-Sturm für verwaiste Test-Events).
5. Antwort immer ohne Body-Details (keine internen IDs zurückspiegeln).

## 10. Feature-Gating

**Quelle:** `plans.limits` = `{ maxRecords: number|null, maxUsers: number|null }` (`null` = unbegrenzt), `plans.features` = `{ analytik: boolean, discogsListing: boolean }`. `tenants.limits` ist ein partieller **Override** derselben Limit-Struktur und gewinnt feldweise (Sonderkonditionen; E2E dreht damit Limits klein).

**Seed-Matrix** (Anzeigepreise; der abgerechnete Preis hängt am `stripePriceId`):

| Plan | Preis/Monat | maxRecords | maxUsers | analytik | discogsListing |
|---|---|---|---|---|---|
| free | 0 € | 100 | 2 | ✗ | ✗ |
| small | 19 € | 5.000 | 10 | ✓ | ✓ |
| big | 49 € | unbegrenzt | unbegrenzt | ✓ | ✓ |

**Helper** (`src/lib/gating.ts`, server-only):
- `getEntitlements(tenantId)` → `{ plan, limits, features }` (Plan-Zeile laden, `tenants.limits` feldweise drübermergen), in React `cache()` — einmal pro Request. Unbekannter/verwaister `tenants.plan`-Wert fällt fail-closed auf die Free-Matrix zurück (+ Warn-Log).
- `requireFeature(entitlements, feature)` → wirft bei fehlendem Feature (Action-Kontext: Formularfehler; Page-Kontext: Upsell-Render, §unten).
- `checkRecordLimit(tx, entitlements, addCount)` → zählt vorhandene Platten des Tenants und prüft `count + addCount ≤ maxRecords` → `{ allowed, current, max }`.

**Enforcement (serverseitig, an den Actions — die Seite ist keine Sicherheitsgrenze):**
- Alle Platten-anlegenden Pfade: Einzel-Ankauf, Batch-/Sammlungs-Ankauf (prüft `aktuell + Batchgröße`), inkl. Barcode-Scan-Ankauf (läuft durch dieselben Actions). Fehlermeldung als Formularfehler: „Plan-Limit erreicht: max. {max} Platten im {Plan}-Plan. Upgrade unter Einstellungen → Abo."
- User-Anlage (Wizard Schritt 3 + Team-Tab): `maxUsers` analog. **`maxUsers` zählt nur Staff (`admin` + `mitarbeiter`)** — `kunde`-Konten zählen nicht gegen das Limit.
- „Bei Discogs listen" (Listing-Action → `enqueueDiscogsListing`): `requireFeature('discogsListing')`. Die Discogs-**Suche** im Ankauf bleibt ungated (Produktkern).
- Analytik: Page prüft Entitlements → ohne Feature **Upsell-Karte** („Verfügbar ab Small", Link zum Abo-Tab für Admins) statt Charts; die zugrundeliegenden Read-Queries werden gar nicht erst ausgeführt.
- Nav (Desktop-Sidebar + Mobile): gated Module bleiben sichtbar mit Schloss-Indikator (a11y: `aria-label` erweitert), Klick führt zur Upsell-Karte. Kein Layout-Shift zwischen Plänen.
- Kasse, Wunschlisten, Verkauf, Schaufenster bleiben in allen Plänen ungated.

## 11. Erst-Login & Onboarding-Wizard

**Passwortzwang:**
- `provisionTenant()` und jede Anlage mit generiertem Passwort (Wizard Schritt 3, Team-Tab, „Credentials neu senden") setzen `mustChangePassword = true`.
- `SessionUser` wird um `mustChangePassword` erweitert (Adapter/Session-Callback liefern es mit; DB-Session-Strategie liest die User-Zeile pro Request → Flag ist nach Änderung sofort aktuell, kein Session-Rebuild nötig).
- Das `(app)`-Layout redirectet User mit gesetztem Flag hart auf `/passwort`. Ausgenommen: `/passwort` selbst, Logout, `/api/auth/*` (keine Redirect-Loop). `kunde` unterliegt demselben Zwang.
- `/passwort`: aktuelles Passwort + neues Passwort (zod: min. 12 Zeichen) + Wiederholung; Action: `requireSession` → Origin → bcrypt-Verify altes → Hash neues → `mustChangePassword = false`. Danach: Admin ohne abgeschlossenes Onboarding → `/onboarding`, sonst Dashboard.

**Wizard** (`/onboarding`, nur Rolle `admin`; andere Rollen → Dashboard-Redirect):
- Trigger: `(app)`-Layout redirectet Admins auf `/onboarding`, solange `tenants.onboardingCompletedAt IS NULL`. „Überspringen" (global sichtbar) setzt den Timestamp ebenfalls — der Wizard erscheint nie zweimal; alle Inhalte sind unter `/einstellungen` erreichbar.
- 4 Schritte nach Design-Handoff (Stepper „Info → Discogs → Admin → Review", Buttons „Zurück"/„Weiter"):
  1. **Info:** Shop-Name (`tenants.name`), Primärfarbe (`tenants.config.branding.primaryColor`, WCAG-Check wie Provisioning). Speichern pro Schritt (kein Big-Bang-Submit am Ende).
  2. **Discogs:** OAuth-Token + Token-Secret (Passwort-Felder), verschlüsselt via `encryptSecret` (AAD = Tenant) in `discogsConnections`; „Verbindung testen"-Button (Identity-Call über den aktiven Discogs-Driver; Fake-Driver: immer ok). Überspringbar („Später").
  3. **Team:** weitere User anlegen — E-Mail + Rolle (`mitarbeiter`|`kunde`), generiertes temporäres Passwort per Mail (mailpit), `mustChangePassword=true`, `maxUsers`-Gate. Liste bereits angelegter User. Überspringbar.
  4. **Review:** Zusammenfassung (Name, Farbe als Swatch, Discogs verbunden ja/nein, Team-Anzahl); „Los geht's" setzt `onboardingCompletedAt` → Dashboard.
- Alle Schritt-Submits sind normale Server Actions mit voller Kette (`requireSession` → admin-only → Origin → zod → Delegation).

## 12. Einstellungen (`/einstellungen`, nur Rolle `admin`)

Tab-Struktur aus dem Design (Tabs via `?tab=` — Deep-Links aus Upsell/Checkout möglich):
- **Info:** Shop-Name + Primärfarbe (identische Actions wie Wizard Schritt 1).
- **Discogs:** Verbindungsstatus (verbunden seit / nicht verbunden), Token+Secret neu setzen (überschreibt verschlüsselt; vorhandene Secrets werden **nie** angezeigt, nur „gesetzt"-Status), „Verbindung testen".
- **Team:** User-Liste (E-Mail, Rolle, angelegt am), neuen User anlegen (wie Wizard Schritt 3), „Passwort zurücksetzen" (neues temp. Passwort + Mail + `mustChangePassword=true`). Kein Löschen von Usern in diesem Slice (Follow-up; Verkaufs-/Audit-Bezüge).
- **Abo:** §9.

Zugriff: `mitarbeiter`/`kunde` → `forbidden()`. Responsive über die bestehenden Slice-5-Klassen (`qr-page-header`, Karten <768px); **kein** neuer Bottom-Tab — Einstieg über Desktop-Sidebar-Eintrag + Mobile-Header-Menü. Wizard und Einstellungen wiederverwenden dieselben Formular-Komponenten je Themenblock (ein Formular, zwei Einbettungen — kein Copy-Paste-Drift).

## 13. Sicherheit & Invarianten (bindend)

1. RLS-Isolation ausschließlich via `withTenant`/`withSuperadmin`/`withOwner`; `subscriptions` voll tenant-RLS-geschützt; neue Registry-Tabellen explizit in der Boot-Assertion-Ausnahmeliste.
2. Jede mutierende Action (Tenant **und** Platform): Session-Pflicht → Rollen-Gate → Origin-CSRF → zod → Delegation. `kunde` bleibt von allen neuen Mutationen ausgeschlossen (`forbidden()`).
3. Platform-Zone nur über `admin.<ROOT_DOMAIN>` erreichbar; `/platform/*` auf jedem anderen Host 404; `x-platform-zone` wird wie `x-tenant-slug` gegen Client-Spoofing gestrippt. Fail-closed bleibt: unbekannte Hosts 404, kein Default-Tenant.
4. Server ist Preisautorität: Checkout entsteht aus `plans.stripePriceId`; Client liefert nur Plan-Slugs. Geldbeträge bleiben Integer-Cents.
5. Webhook: Signaturprüfung vor jeder Verarbeitung, Event-Dedup, Owner-Kontext nur innerhalb des Handlers, keine internen Details in Responses.
6. Secrets: Discogs-Token weiterhin AES-256-GCM mit Tenant-AAD; nie im Klartext angezeigt oder geloggt; `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` nur serverseitig (`src/env.ts`, `server-only`).
7. Gating wird an den Actions erzwungen, nie nur in der UI; `getEntitlements` fällt bei unbekanntem Plan fail-closed auf Free zurück.
8. Kein Kunden-PII in der Platform-Zone über Aggregatzahlen hinaus; EK/`purchasePrice` bleibt server-intern.
9. Temporäre Passwörter: einmalige Anzeige (Provisioning-UI) bzw. nur per Mail; `mustChangePassword`-Zwang für jeden Empfänger.

## 14. Tests & Gates

**Unit (Vitest):** Gating-Merge/Limit-Mathematik (Override feldweise, `null` = unbegrenzt, Batch-Grenzfälle `count+add == max`), Fake-Billing-Driver (Sofort-Upsert, deterministische IDs), Stripe-Event-Mapping (aufgezeichnete Test-Payloads → `BillingEvent`, Price-ID-Rückauflösung, unbekannte Events → `ignored`), Webhook-Dedup-Logik, Platform-Session-Lebenszyklus (Create/Expire/Cleanup/Cookie-Name je Protokoll), zod-Schemata (Passwort-Policy, Plan-Slugs), Wizard-Schritt-Actions (jsdom/RTL für Stepper-Navigation und Formularfehler).

**Integration (Testcontainers):** RLS auf `subscriptions` nicht-vakuos (beide Tenants je eine Zeile, exakte Sichtbarkeit); Boot-Assertion grün mit neuen Registry-Tabellen; Webhook-Handler idempotent (gleiches Event zweimal → ein Effekt) und Statusübergänge (completed → updated → deleted → Plan `free`); `provisionTenant`-Action über die Platform-UI-Action; `mustChangePassword`-Flow (Flag setzen, Passwort ändern, Flag weg); `checkRecordLimit` gegen echte Zählung inkl. Batch.

**E2E (Playwright, Stack mit `BILLING_DRIVER=fake`, serial wie gehabt):**
1. Platform-Login auf `admin.localhost:3000` → Tenant anlegen → temp. Passwort sichtbar → neuer Tenant lädt unter `<slug>.localhost:3000` (Login-Seite mit Branding-Farbe).
2. Erst-Login im neuen Tenant → Passwortzwang-Redirect → Passwort ändern → Wizard: alle 4 Schritte ausfüllen (Discogs überspringen) → Dashboard; erneuter Login zeigt keinen Wizard mehr.
3. Seed-Tenant `freeshop` (free, `maxRecords`-Override 2): Analytik zeigt Upsell-Karte statt Charts; Ankauf über dem Limit zeigt den Limit-Formularfehler (positive Kontrolle: unter dem Limit klappt er).
4. Upgrade auf `freeshop`: Einstellungen → Abo → „Upgrade auf Small" (Fake-Checkout) → zurück mit `checkout=success` → Plan „Small" sichtbar, Analytik rendert Charts. (Re-Seed setzt `freeshop` danach wieder auf `free`, §8.)
5. Zonen-Isolation: `/platform` auf `demo.localhost` → 404; `admin.localhost` ohne Session → Login-Redirect (Request-Fixture: `127.0.0.1` + explizitem `Host`-Header, bekanntes Muster aus Slice 5).

**Gates (wie alle Slices):** `pnpm lint` + `pnpm typecheck` grün, alle bestehenden 643 Unit/Integration + 59 E2E bleiben grün, neue Tests grün. Desktop-≥768px-Verhalten bestehender Screens unverändert.

## 15. Referenzen

- Dachdokument: `docs/superpowers/specs/2026-06-25-qrecords-v2-architecture-overview.md` (§4 Querschnitt, §5 Roadmap Slice 6)
- Design-Handoff: `.design-handoff/design-system-2026-refresh/` — 4-Schritt-Wizard + Einstellungs-Tabs in `Design System 2026.dc.html`
- Muster: Discogs-Adapter (`src/lib/discogs/`), Provisioning (`src/lib/provisioning.ts`), Crypto (`src/lib/crypto.ts`), Tenant-Kontext (`src/db/tenant.ts`), Auth (`src/auth/config.ts`)
- v1-Referenz (nyxcore `q-records`): Superadmin-Dashboard + Plan-Gating existierten; Stripe-Billing war in v1 nie fertig — kein Vorbild, Neuentwurf hier.
