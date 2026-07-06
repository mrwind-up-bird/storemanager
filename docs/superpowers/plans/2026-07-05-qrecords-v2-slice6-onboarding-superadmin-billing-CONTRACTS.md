# Slice 6 — CONTRACTS (C1–C12)

Bindende Schnittstellen zwischen den Tasks des Plans `2026-07-05-qrecords-v2-slice6-onboarding-superadmin-billing.md`. Jeder Task-Implementer hält sich an die hier fixierten Namen, Typen und Semantiken — Abweichungen sind Review-Findings.

## C1 — Platform-Routing (T3)

- `isPlatformHost(host: string | null, rootDomain: string): boolean` (`src/lib/subdomain.ts`) — true gdw. Host (port-gestrippt, case-insensitiv) EXAKT `admin.<rootDomain>`; leerer rootDomain → false.
- Middleware-Reihenfolge (bindend): (1) Header-Strip `x-tenant-slug` + `x-platform-zone` auf JEDEM Pfad → (2) `/platform`/`/platform/*` direkt → 404 auf JEDEM Host → (3) `/api/billing/webhook` exakt → pass-through → (4) Platform-Host → Header `x-platform-zone: '1'` + Rewrite `<pathname>` → `/platform<pathname>` (`/` → `/platform`) → (5) bestehende Tenant-/Reserved-/None-Logik unverändert.
- `src/app/platform/layout.tsx` prüft `headers().get('x-platform-zone') === '1'`, sonst `notFound()`.
- `admin` bleibt in `RESERVED_SUBDOMAINS` (der Platform-Zweig greift vorher).

## C2 — Platform-Session (T3)

- Tabellen `platform_users` / `platform_sessions`: Registry ohne tenant_id, ohne RLS, OHNE qr_app-Grants — jeder Zugriff via `withOwner()`.
- `src/auth/platform.ts`: `platformCookieName(protocol)` → `'__Host-qr.platform'` (https) | `'qr.platform'` (http); `PLATFORM_COOKIE_NAME`; `PLATFORM_SESSION_TTL_MS = 86_400_000` (24 h); `type PlatformUser = { id: number; email: string }`; `verifyPlatformCredentials(email, password)` (bcrypt + `DUMMY_BCRYPT_HASH`-Fallback); `createPlatformSession(platformUserId)` → `{ token: randomUUID, expires }`; `getPlatformSessionByToken(token)` (löscht abgelaufene Row); `getPlatformSession()` (Cookie-Wrapper); `requirePlatformSession()` → sonst `redirect('/login')`; `destroyPlatformSession()`; `platformSessionCookieOptions()` = httpOnly, lax, path=/, secure je Protokoll, maxAge 86400.
- `DUMMY_BCRYPT_HASH` lebt ab T3 in `src/lib/password.ts` (Export), `src/auth/config.ts` importiert ihn.

## C3 — Platform-Action-Kette (T4)

- Jede mutierende Platform-Action: `requirePlatformSession()` → `isValidOrigin()` → zod → Delegation (Spiegel der Tenant-Kette).
- `src/lib/platform/tenants.ts`: `listTenantsWithStats(): Promise<TenantListRow[]>` (`{ id, slug, name, plan, recordCount, userCount, createdAt }`, via `withSuperadmin`, nur Aggregate); `getTenantDetail(id)` → `TenantDetail | null` (inkl. `subscription | null`, `adminEmail | null`, `primaryColor`, `onboardingCompletedAt`).
- Actions (`src/app/platform/(dashboard)/tenants/actions.ts`): `createTenantAction` → `CreateTenantState = { ok, error, temporaryPassword, slug }` (Passwort EINMALIG in der UI + Mail); `setTenantPlanAction` (schreibt NUR `tenants.plan`); `resendCredentialsAction` (neues temp. Passwort, `mustChangePassword=true`, NUR Mail — keine UI-Anzeige).
- `generateTempPassword()` und `HEX_COLOR_REGEX` sind ab T1 Exporte von `src/lib/provisioning.ts`; temp. Passwörter matchen `/^[A-Z2-7]{16}$/`.

## C4 — BillingAdapter + BillingEvent (T5)

```ts
interface BillingAdapter {
  createCheckoutSession(args: { tenantId: number; planSlug: string; successUrl: string; cancelUrl: string }): Promise<{ url: string }>;
  createPortalSession(args: { customerId: string; returnUrl: string }): Promise<{ url: string }>;
  parseWebhookEvent(rawBody: string, signature: string): BillingEvent; // wirft BillingSignatureError
}
```

- `BillingEvent`-Varianten (alle mit `eventId: string` + `type: string` = roher Provider-Event-Typ):
  - `checkout_completed`: `tenantId: number; planSlug: string; customerId: string; subscriptionId: string`
  - `subscription_updated`: `customerId; subscriptionId; status: string; priceId: string | null; currentPeriodEnd: Date | null; cancelAtPeriodEnd: boolean` — **priceId, NICHT planSlug** (Auflösung im Apply-Handler; Spec-§7-Amendment)
  - `subscription_deleted`: `customerId; subscriptionId`
  - `ignored`: nur `eventId` + `type`
- `BillingSignatureError` (→ HTTP 400), `BillingConfigError` (→ 500er-Klasse).
- `getBillingAdapter()` Singleton nach `env.BILLING_DRIVER` (`'fake'` Default).
- `mapStripeEvent(event)` ist pure + exportiert; gemappt werden exakt `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`; alles andere → `ignored`. `currentPeriodEnd` wird versionstolerant gelesen (Subscription-Item zuerst, Subscription-Level als Fallback).
- Env: `BILLING_DRIVER: 'fake' | 'stripe'` Default `'fake'`; `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` optional, Pflicht bei stripe (geprüft in exportiertem `parseEnv`).

## C5 — Fake-Driver-Semantik (T5)

- `fakeCustomerId(tenantId) = 'fake_cus_<id>'`, `fakeSubscriptionId(tenantId) = 'fake_sub_<id>'`, `FAKE_SIGNATURE = 'fake'`.
- `createCheckoutSession` schließt SOFORT ab: `upsertSubscriptionAndPlan` (status `'active'`, currentPeriodEnd = now+30d, cancelAtPeriodEnd false) und gibt `{ url: successUrl }` zurück.
- `createPortalSession` → `{ url: returnUrl }`.
- `parseWebhookEvent`: Signatur muss exakt `'fake'` sein, Body = BillingEvent-JSON (kind/eventId Pflicht, `type` fällt auf `kind` zurück, `currentPeriodEnd` ISO-String → Date); alles andere → `BillingSignatureError`.

## C6 — Webhook-Verarbeitung (T6)

- `processBillingEvent(event): Promise<'applied' | 'duplicate' | 'ignored' | 'unknown_target'>` — Dedup-INSERT in `webhook_events` (`id = eventId`, `ON CONFLICT DO NOTHING`) UND alle Effekte in EINER `withOwner`-Transaktion; Fehler rollt beides zurück (Retry-sicher).
- Effekte: `checkout_completed` → Tenant+Plan existieren? sonst `unknown_target`; `upsertSubscriptionAndPlanTx` (status active, periodEnd null). `subscription_updated` → Zeile per `stripeSubscriptionId`; `priceId` → `plans.stripePriceId`-Lookup; unbekannte priceId → Update ohne Plan-Wechsel + Warn-Log; Plan-Wechsel flippt auch `tenants.plan`. `subscription_deleted` → Zeile löschen + `tenants.plan = 'free'`. `ignored` → nur Dedup-Insert.
- Route `POST /api/billing/webhook`: Raw-Body via `request.text()` VOR jedem Parse; Signatur-Header `stripe-signature`; 400 bei `BillingSignatureError`; 500 bei Verarbeitungsfehler; sonst IMMER `200 {"received":true}` ohne interne Details.
- Gating-Autorität bleibt ausschließlich `tenants.plan` — nur Webhook-Handler, Fake-Checkout und Superadmin-Override schreiben es.

## C7 — Entitlements (T2)

```ts
type PlanLimits = { maxRecords: number | null; maxUsers: number | null }; // null = unbegrenzt
type PlanFeatures = { analytik: boolean; discogsListing: boolean };
type Entitlements = { plan: string; planName: string; priceMonthlyCents: number; limits: PlanLimits; features: PlanFeatures };
```

- `mergeEntitlements(planRow, tenantOverrides)`: feldweiser Override aus `tenants.limits` (fehlender Key → Plan-Wert; JSON null → unbegrenzt; defekter Wert → ignoriert+Warn); Features strikt `=== true`; alte Slice-0-Keys fallen auf Free-Werte.
- `getEntitlements(tenantId)`: React `cache()`, EIN `withSuperadmin`-Join tenants↔plans; Tenant fehlt → `FREE_FALLBACK_ENTITLEMENTS`; unbekannter Plan → Free-Basis + Overrides bleiben wirksam (Warn-Log). Fail-closed, wirft nie.
- `UNLIMITED_ENTITLEMENTS` nur für vertrauenswürdige Fixture-Pfade (Seed/Tests) — Request-Pfade laden IMMER `getEntitlements`.
- Seed-Matrix: free 0¢/100/2/beides false · small 1900¢/5000/10/beides true · big 4900¢/null/null/beides true (Migration 0012).

## C8 — Enforcement-Punkte + exakte Meldungstexte (T2/T12)

- `checkRecordCapacity(tx, ent, addCount)` / `checkUserCapacity(tx, ent, addCount)`: laufen IN der withTenant-Tx des Aufrufers; `current + addCount > max` wirft `LimitExceededError`; `== max` ist ERLAUBT; `max === null` → kein Query. `checkUserCapacity` zählt NUR `role IN ('admin','mitarbeiter')`.
- Signaturen ab T12: `performAnkauf(ctx, input, ent)` (addCount 1) · `createCollection(ctx, input, ent)` (addCount = items.length, VOR dem Collection-Insert).
- Exakte Texte (bindend, E2E asserted darauf):
  - Platten: `Plan-Limit erreicht: max. ${max} Platten im ${planName}-Plan. Upgrade unter Einstellungen → Abo.`
  - Nutzer: `Plan-Limit erreicht: max. ${max} Nutzer im ${planName}-Plan. Upgrade unter Einstellungen → Abo.`
  - Listing-Feature: `Discogs-Listing ist im ${planName}-Plan nicht verfügbar. Upgrade unter Einstellungen → Abo.`
- Actions mappen `LimitExceededError` → `{ ok: false, reason: 'validation', message: err.message }`; Listing-Gate feuert VOR der Tx. Analytik: Page/CSV-Route prüfen `ent.features.analytik` — ohne Feature Upsell-Karte (`data-testid="analytik-upsell"`) bzw. `forbidden()`, Queries laufen nicht. Nav: `lockedHrefs?: string[]` auf `SidebarNav`/`BottomTabBar`, Schloss-Icon + aria-label `“${label} (gesperrt im aktuellen Plan)”`, kein Layout-Shift. Kasse/Wunschlisten/Verkauf/Schaufenster/Discogs-SUCHE bleiben ungated.

## C9 — mustChangePassword-Fluss (T1/T10)

- `users.mustChangePassword boolean NOT NULL DEFAULT false`; gesetzt von: `provisionTenant` (nur bei generiertem Passwort), `createTeamUser` (immer), `resetTeamUserPassword` (immer), `resendCredentialsAction` (immer). Seed setzt alle Seed-User auf false (`markTenantOnboarded`).
- `SessionUser.mustChangePassword: boolean` durch alle Schichten (adapter select/mapping, toAdapterUser, verifyCredentials, session-Callback, getSessionUser) — DB-Session liest die User-Zeile pro Request, Flag ist sofort aktuell.
- `(app)`-Layout: `mustChangePassword` → `redirect('/passwort')` VOR dem Onboarding-Redirect. `/passwort` + `/onboarding` liegen AUSSERHALB der `(app)`-Gruppe. `kunde` unterliegt demselben Zwang.
- `/passwort`-Action: requireSession → Origin → zod (`newPassword` min 12, confirm-refine) → `verifyAndChangePassword` (bcrypt-Verify alt mit Dummy-Fallback, Hash neu, Flag false, EINE Tx) → Admin && !onboardingCompletedAt → `/onboarding`, sonst `/`.

## C10 — Onboarding-Semantik (T11)

- `tenants.onboardingCompletedAt timestamptz NULL`; Migration 0012 backfillt Bestands-Tenants mit now(); Seed setzt alle Seed-Tenants; nur frisch provisionierte Tenants starten NULL.
- `(app)`-Layout redirectet Admins (admin/superadmin-Rolle) mit `onboardingCompletedAt IS NULL` auf `/onboarding`. Nicht-Admins werden NIE in den Wizard geleitet.
- `/onboarding?step=1..4` (ungültig → 1): Schritt-Guards in DIESER Reihenfolge: mustChangePassword → `/passwort`; nicht-Admin → `/`; abgeschlossen → `/`.
- Stepper-Labels EXAKT `Info · Discogs · Admin · Review`; Schritt-Persistenz pro Schritt (ShopInfoForm `next='wizard'` → `/onboarding?step=2`); Schritte 2/3 „Später"-Link; `completeOnboardingAction` (volle Kette) von „Los geht's" UND global sichtbarem „Überspringen".
- Wiederverwendung (kein Copy-Paste-Drift): `ShopInfoForm`, `DiscogsTab` (`from='onboarding'`), `TeamTab`/`CreateUserForm` — identische Komponenten wie `/einstellungen`.
- Discogs-Connect-returnTo (`src/app/api/discogs/_shared.ts`): `DiscogsReturnTarget = 'ankauf' | 'einstellungen' | 'onboarding'` (geschlossene Whitelist, Default ankauf); `RETURN_PATHS` exakt: ankauf `/ankauf?connected=1|error=connect`, einstellungen `/einstellungen?tab=discogs&connected=1|…error=connect`, onboarding `/onboarding?step=2&connected=1|…error=connect`.

## C11 — Seed-Verträge (T2)

- `demo` → `plan='big'` (bestehende 59 E2E laufen ungegated) · `vinylcave` bleibt `'small'` · NEU `freeshop` (`admin@freeshop.test`, DEFAULT_PRIMARY_COLOR, `plan='free'`, `tenants.limits = {"maxRecords": 2}`), Baseline GENAU 1 Platte (Nevermind/Nirvana, 1 Purchase verfuegbar).
- `resetFreeshopGatingState(ownerPool, tenantId)`: plan→free, limits→{maxRecords:2}, subscriptions-Zeile löschen, Nicht-Seed-purchases/collections/records löschen (FK-Reihenfolge purchases → collections → records). Läuft bei JEDEM Seed vor `seedTenantInventory`.
- `markTenantOnboarded(ownerPool, tenantId)`: onboardingCompletedAt (nur wenn NULL) + `mustChangePassword=false` für ALLE User des Tenants — für demo, vinylcave, freeshop.
- `ensurePlatformUser(ownerPool, PLATFORM_ADMIN_EMAIL, SEED_ADMIN_PASSWORD)` mit `PLATFORM_ADMIN_EMAIL = 'platform@qrecords.test'`; Re-Seed aktualisiert das Passwort, wenn SEED_ADMIN_PASSWORD gesetzt.
- E2E-Credentials: `.env.compose` `SEED_ADMIN_PASSWORD=E2eDevPassword1!` gilt auch für den Platform-User und freeshop.

## C12 — E2E-Szenarien (T13)

1. Platform-Login (`admin.localhost:3000`) → Tenant anlegen (Slug `e2e<Date.now()>`) → `data-testid="temp-password"` sichtbar (`/^[A-Z2-7]{16}$/`) → `<slug>.localhost:3000/login` rendert.
2. Erst-Login mit temp. Passwort → `/passwort`-Redirect → Wechsel (12+ Zeichen) → `/onboarding` → Schritt 1 speichern, 2+3 „Später", 4 „Los geht's" → `/`; Cookies löschen + erneuter Login → direkt `/` (kein Wizard).
3. freeshop: `/analytik` zeigt `analytik-upsell`; Sammlungs-Ankauf (manuelle Erfassung — freeshop hat KEINE Discogs-Verbindung) 1 Item ok (→ 2/2), nächster Ankauf zeigt `Plan-Limit erreicht: max. 2 Platten im Free-Plan…`.
4. freeshop `/einstellungen?tab=abo`: `upgrade-small` → Fake-Checkout → zurück mit `checkout=success`, Plan „Small", `abo-subscription` active; `/analytik` rendert `analytik-screen`, kein Upsell.
5. Request-Fixture (127.0.0.1 + Host-Header): `/platform` auf `demo.localhost` → 404; `/platform` auf `admin.localhost` → 404; `/` auf `admin.localhost` ohne Session → Redirect (302/303/307/308) mit `location` ⊇ `/login`.
- Serial-Mode; Szenario 2 konsumiert den Tenant aus Szenario 1 (Modul-Variable `tempPassword`). Keine Cleanups nötig: Szenario-1/2-Tenant bleibt liegen (unique Slug), freeshop wird vom Re-Seed zurückgesetzt.
