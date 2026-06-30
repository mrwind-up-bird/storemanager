# Slice 2 — LOCKED CONTRACT APPENDIX (verbatim, do not deviate)

Every task below MUST use these exact names, types, signatures, SQL, labels, and testids.
If your task references something defined here, copy it byte-for-byte. This is the anti-drift spine.

Repo: `/Users/oliverbaer/Projects/storemanager`. Stack: Next.js 15 App Router, React 19, TS strict,
Drizzle ORM ^0.38, PostgreSQL 17, pg-boss ^10, zod ^3.24, Vitest ^2.1 + @testcontainers/postgresql,
Playwright, native global `fetch` (no undici dep), Node 22, pnpm. All new lib modules start with
`import 'server-only';` EXCEPT pure modules safe for the client (explicitly noted: `pricing.ts`,
`src/lib/discogs/format.ts`, `src/lib/discogs/types.ts`).

## Existing surfaces to reuse (already in repo — do NOT redefine)
- `src/db/tenant.ts`: `withTenant(ctx, fn)`, `withSuperadmin(fn)`, `withOwner(fn)`.
  `type TenantCtx = { tenantId: number; userId: number | null }`, `type Tx = …` (drizzle tx handle).
- `src/lib/crypto.ts`: `encryptSecret(plaintext, { tenantId, userId? }) → string`,
  `decryptSecret(payload, { tenantId, userId? }) → string` (AES-256-GCM, AAD-bound). For Discogs tokens
  use AAD `{ tenantId }` ONLY (omit userId, so any admin of the shop can read the shop connection).
- `src/db/hash.ts`: `recordHash({ title, artist, country?, year?, label? }) → string` (sha256 hex).
- `src/db/schema.ts`: `tenants`, `users`, `records`, `purchases`, `permalinks`, enums `roleEnum`
  (`'superadmin'|'admin'|'mitarbeiter'|'kunde'`), `recordStatusEnum`
  (`'verfuegbar'|'reserviert'|'verkauft'|'verliehen'`). `records` already has
  `discogsId integer`, `coverImage text`, `hash varchar(64)` with `unique('records_hash_tenant').on(hash,tenantId)`,
  `label text[]`, `genre text[]`, `country`, `releaseYear`, `format`. `purchases` already has
  `purchasePrice numeric(10,2)`, `targetPrice numeric(10,2)`, `status recordStatusEnum default 'verfuegbar'`,
  `conditionRecord smallint`, `conditionCover smallint` (CHECK 0–7).
- `src/auth/session.ts`: `getSessionUser(): Promise<SessionUser | null>`, `requireSession(): Promise<SessionUser>`
  (auth gate + tenant↔session 403 via forbidden()), `assertSessionTenant(user, resolvedTenantId)`.
  `type SessionUser = { id: number; email: string; tenantId: number; role: Role; isSuperadmin: boolean }`.
- `src/lib/tenant.ts`: `getCurrentTenant()` (React cache) → tenant with at least `{ id: number; slug: string }`.
- `src/env.ts`: `env` (zod-validated) + `tenantUrl(slug) → string`.
- `src/worker/index.ts`: `QUEUE` registry + `startWorker()`. Handler pattern: payload carries `tenantId`,
  per-tenant jobs open own `withTenant`. See `src/worker/jobs/analyticsSummary.ts`.
- `src/db/assertions.ts`: `TENANT_SCOPED_TABLES` array, checked at boot by `assertDatabaseSafety()`.
- Design primitives (Slice 0/1) under `src/components/ui/`: `CoverPlaceholder` (prop `labelColor?`),
  `VinylDisc`, `StatusBadge`, `SearchField`, `Select`, buttons use class `focus-ring-button`, tap targets
  `min-height: var(--tap)`. Disc colour convention (Slice 1): CD → `var(--info)`, Vinyl → `var(--accent)`.

---

## C1. Schema additions (`src/db/schema.ts`) — Task 1

```ts
export const discogsListingStatusEnum = pgEnum('discogs_listing_status', [
  'not_listed',
  'pending',
  'listed',
  'failed',
]);
export type DiscogsListingStatus = (typeof discogsListingStatusEnum.enumValues)[number];

export const discogsConnections = pgTable(
  'discogs_connections',
  {
    id: serial('id').primaryKey(),
    tenantId: integer('tenant_id')
      .notNull()
      .references(() => tenants.id),
    discogsUsername: text('discogs_username').notNull(),
    /** encryptSecret payload, AAD={tenantId} */
    oauthToken: text('oauth_token').notNull(),
    /** encryptSecret payload, AAD={tenantId} */
    oauthTokenSecret: text('oauth_token_secret').notNull(),
    connectedByUserId: integer('connected_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    tenantUnique: unique('discogs_connections_tenant').on(t.tenantId),
  }),
);
```
Add to `purchases` columns (after `conditionCover`):
```ts
    discogsListingId: text('discogs_listing_id'),
    discogsListingStatus: discogsListingStatusEnum('discogs_listing_status')
      .notNull()
      .default('not_listed'),
```
`src/db/assertions.ts`: append `'discogs_connections'` to `TENANT_SCOPED_TABLES`.

### Migration wiring (Task 1) — SHARP EDGE
`pnpm db:generate` produces the table/enum/column DDL migration. RLS is NOT generated — it is a hand-edited
SQL file, exactly like `drizzle/0001_rls.sql`. The implementer MUST:
1. Read `drizzle/0001_rls.sql` AND `drizzle/meta/_journal.json` to see how the hand-written RLS migration is
   registered in the journal, then mirror that registration for a new `drizzle/<NNNN>_discogs_rls.sql`.
2. The RLS SQL for the new table, byte-for-byte in the 0001 style:
```sql
ALTER TABLE "discogs_connections" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "discogs_connections" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "discogs_connections" ALTER COLUMN "tenant_id" SET DEFAULT NULLIF(current_setting('app.current_tenant', true), '')::int;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "discogs_connections"
  USING ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.current_tenant', true), '')::int);
--> statement-breakpoint
CREATE POLICY "superadmin_bypass" ON "discogs_connections"
  USING (current_setting('app.is_superadmin', true) = 'true')
  WITH CHECK (current_setting('app.is_superadmin', true) = 'true');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "discogs_connections" TO qr_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE "discogs_connections_id_seq" TO qr_app;
```
(The new `purchases` columns inherit the existing `purchases` RLS — no policy change needed there.)

---

## C2. env + config (`src/env.ts`, `next.config.ts`) — Task 2

Add to `envSchema` (in the existing zod object):
```ts
  // ── Discogs ───────────────────────────────────────────────
  DISCOGS_CONSUMER_KEY: z.string().min(1),
  DISCOGS_CONSUMER_SECRET: z.string().min(1),
  DISCOGS_API_URL: z.string().url().default('https://api.discogs.com'),
  DISCOGS_USER_AGENT: z.string().min(1).default('QRecordsStoremanager/2.0 +https://q-records.example'),
  DISCOGS_DRIVER: z.enum(['http', 'fake']).default('http'),
```
- Test/CI select the fake driver by SETTING `process.env.DISCOGS_DRIVER = 'fake'` in the test bootstrap
  (`tests/helpers/db.ts` setup + vitest setup + Playwright/docker-compose e2e env), NOT via a conditional
  default. Add `DISCOGS_CONSUMER_KEY`/`_SECRET` dummy values to the test env too (required strings).
- `.env.example` + `docker-compose.yml` (web + worker services): add the 5 keys. For the local/e2e stack set
  `DISCOGS_DRIVER=fake`, `DISCOGS_CONSUMER_KEY=dev-key`, `DISCOGS_CONSUMER_SECRET=dev-secret`.
- `next.config.ts`: add `images.remotePatterns` for Discogs covers:
```ts
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'i.discogs.com' },
      { protocol: 'https', hostname: 'img.discogs.com' },
    ],
  },
```

---

## C3. Discogs types + adapter + errors (`src/lib/discogs/types.ts`) — Task 4 (pure, client-safe, NO server-only)

```ts
export type DiscogsAuth = { token: string; tokenSecret: string };

export interface DiscogsSearchResult {
  discogsId: number;            // Discogs release id
  title: string;
  artist: string;
  country: string | null;
  year: number | null;
  format: string | null;        // already mapped via mapFormat() → 'Vinyl' | 'CD' | 'Kassette' | string
  genre: string[];
  label: string[];
  coverImage: string | null;
  community: { want: number; have: number };
  median: number | null;        // marketplace anchor (lowest_price / stats), display + pricing fallback
}

export interface DiscogsPriceSuggestion {
  /** keys = Discogs grade strings, e.g. 'Very Good Plus (VG+)' → suggested price */
  byGrade: Record<string, number>;
}

export interface DiscogsListingInput {
  releaseId: number;
  conditionRecord: number;      // 0–7 internal scale
  conditionCover: number;       // 0–7 internal scale
  price: number;                // VK
}

export interface DiscogsAdapter {
  getRequestToken(callbackUrl: string): Promise<{ token: string; tokenSecret: string; authorizeUrl: string }>;
  getAccessToken(args: { requestToken: string; requestTokenSecret: string; verifier: string }):
    Promise<{ token: string; tokenSecret: string; username: string }>;
  search(auth: DiscogsAuth, query: string): Promise<DiscogsSearchResult[]>;
  priceSuggestions(auth: DiscogsAuth, releaseId: number): Promise<DiscogsPriceSuggestion | null>;
  createListing(auth: DiscogsAuth, input: DiscogsListingInput): Promise<{ listingId: string }>;
}

export class DiscogsAuthError extends Error {}       // 401/403 → reconnect required
export class DiscogsRateLimitError extends Error {}  // 429 → transient, retryable
export class DiscogsError extends Error {}           // other non-OK
```

### Rate limiter (`src/lib/discogs/ratelimit.ts`) — Task 4 (server-only)
```ts
export interface RateLimiter { acquire(): Promise<void>; }
export function createRateLimiter(opts: { ratePerSec: number }): RateLimiter;
/** process-wide singleton, 2 req/s, used by the http client for ALL Discogs calls */
export const discogsLimiter: RateLimiter;
```
Token-bucket / spacing impl: ensures successive `acquire()` resolutions are ≥ `1000/ratePerSec` ms apart.

### `getDiscogsAdapter()` (`src/lib/discogs/index.ts`) — Task 6 (server-only)
```ts
export function getDiscogsAdapter(): DiscogsAdapter; // returns http driver or fake per env.DISCOGS_DRIVER
```

---

## C4. OAuth 1.0a signing (`src/lib/discogs/oauth.ts`) — Task 3 (server-only)

OAuth 1.0a, HMAC-SHA1. Consumer key/secret from `env.DISCOGS_CONSUMER_KEY/_SECRET`. Discogs endpoints:
- request token: `GET {DISCOGS_API_URL}/oauth/request_token` (pass `oauth_callback`)
- authorize URL: `https://www.discogs.com/oauth/authorize?oauth_token=<token>`
- access token: `POST {DISCOGS_API_URL}/oauth/access_token` (pass `oauth_verifier`)
Pure helpers to unit-test against a known vector:
```ts
export function percentEncode(s: string): string;            // RFC3986
// params accept multi-valued keys (real OAuth/query params can repeat, e.g. RFC 5849 §3.4.1.1's
// duplicate `a3`). Array values are expanded to repeated key=value pairs before sort+encode.
// Single-valued callers pass a plain Record<string,string> (assignable, backward-compatible).
export function signatureBaseString(method: string, url: string, params: Record<string, string | string[]>): string;
export function hmacSha1Base64(baseString: string, signingKey: string): string;
/** Builds the `Authorization: OAuth …` header value for a request. */
export function buildOAuthHeader(args: {
  method: string; url: string; consumerKey: string; consumerSecret: string;
  token?: string; tokenSecret?: string; oauthCallback?: string; oauthVerifier?: string;
  nonce: string; timestamp: string;
  extraParams?: Record<string, string>;
}): string;
```
`oauth.ts` also exposes the two token-exchange flows (these live in the HTTP client/driver, calling the
helpers). Signing key = `percentEncode(consumerSecret) + '&' + percentEncode(tokenSecret ?? '')`.

---

## C5. Format mapping (`src/lib/discogs/format.ts`) — Task 5 (pure, client-safe)
```ts
/** Maps raw Discogs format descriptors to the Slice-1 vocabulary. 'LP'→'Vinyl' (Slice-1 lesson). */
export function mapFormat(input: string[] | string | null | undefined): string | null;
```
Rules (case-insensitive, first match wins): any of Vinyl/LP/12"/7"/10"/EP-on-vinyl → `'Vinyl'`;
CD/CDr → `'CD'`; Cassette/Cass → `'Kassette'`; else the first non-empty descriptor; empty/nullish → `null`.

---

## C6. Pricing + condition mapping (`src/lib/pricing.ts`) — Task 7 (pure, client-safe, NO server-only)

Internal grade scale 0–7 (ascending quality), matching Slice-1 (`0 Poor … 7 Mint`):
```ts
export type ConditionGrade = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

// index = internal grade
const CONDITION = [
  { label: 'P',   grade: 'Poor (P)',                 factor: 0.10 }, // 0
  { label: 'F',   grade: 'Fair (F)',                 factor: 0.20 }, // 1
  { label: 'G',   grade: 'Good (G)',                 factor: 0.35 }, // 2
  { label: 'G+',  grade: 'Good Plus (G+)',           factor: 0.50 }, // 3
  { label: 'VG',  grade: 'Very Good (VG)',           factor: 0.65 }, // 4
  { label: 'VG+', grade: 'Very Good Plus (VG+)',     factor: 0.80 }, // 5
  { label: 'NM',  grade: 'Near Mint (NM or M-)',     factor: 0.95 }, // 6
  { label: 'M',   grade: 'Mint (M)',                 factor: 1.00 }, // 7
] as const;

/** UI pill order (descending), per design handoff. */
export const CONDITION_PILLS = ['M', 'NM', 'VG+', 'VG', 'G+', 'G', 'F', 'P'] as const;
export const DEFAULT_CONDITION_RECORD: ConditionGrade = 5; // VG+
export const DEFAULT_CONDITION_COVER: ConditionGrade = 4;  // VG

export function conditionLabel(g: ConditionGrade): string;          // 5 → 'VG+'
export function discogsGradeKey(g: ConditionGrade): string;         // 5 → 'Very Good Plus (VG+)'
export function conditionFromLabel(label: string): ConditionGrade;  // 'VG+' → 5 (throws on unknown)
export function conditionFactor(g: ConditionGrade): number;         // 5 → 0.80

/**
 * VK suggestion. Primary: exact Discogs price-suggestion for the record's grade.
 * Fallback: median × conditionFactor. Returns null if neither available. Rounded to 2dp.
 */
export function suggestSalePrice(args: {
  suggestion: DiscogsPriceSuggestion | null;
  median: number | null;
  conditionRecord: ConditionGrade;
}): number | null;
```
`suggestSalePrice`: if `suggestion?.byGrade[discogsGradeKey(conditionRecord)]` is a finite number → round2 it;
else if `median` is a finite number → round2(`median * conditionFactor(conditionRecord)`); else `null`.
round2 = `Math.round(x * 100) / 100`. (Cover condition is stored but does NOT affect the VK suggestion in Slice 2.)

---

## C7. Connection data module (`src/lib/discogs-connection.ts`) — Task 8 (server-only)
```ts
export type DiscogsConnection = {
  discogsUsername: string;
  auth: DiscogsAuth;                 // decrypted
  connectedByUserId: number | null;
};
/** decrypts tokens; null if no connection for this tenant */
export async function getConnection(ctx: TenantCtx): Promise<DiscogsConnection | null>;
/** encrypts tokens (AAD={tenantId}); upserts on unique(tenant_id) */
export async function upsertConnection(ctx: TenantCtx, input: {
  discogsUsername: string; auth: DiscogsAuth; connectedByUserId: number | null;
}): Promise<void>;
export async function deleteConnection(ctx: TenantCtx): Promise<void>;
```
All three wrap `withTenant(ctx, …)`. Insert sets explicit `tenant_id`. Upsert via
`.onConflictDoUpdate({ target: discogsConnections.tenantId, set: { … updatedAt: new Date() } })`.

---

## C8. OAuth routes + cookie (`src/app/api/discogs/connect/route.ts`, `…/callback/route.ts`) — Task 9

- Cookie name: protocol-aware like Slice-0 session cookie → `__Host-discogs_oauth` when
  `env.APP_PROTOCOL === 'https'` else `discogs_oauth`. httpOnly, SameSite=Lax, Path=/, Secure iff https,
  short Max-Age (e.g. 600s). Value = `encryptSecret(JSON.stringify({ token, tokenSecret }), { tenantId })`.
- `GET /api/discogs/connect`: `const user = await requireSession();` then require
  `user.role === 'admin' || user.isSuperadmin` (else `forbidden()`); `const tenant = await getCurrentTenant();`
  `const cb = `${tenantUrl(tenant.slug)}/api/discogs/callback`;`
  `const { token, tokenSecret, authorizeUrl } = await getDiscogsAdapter().getRequestToken(cb);`
  set cookie (encrypted token+secret); `return NextResponse.redirect(authorizeUrl)`.
- `GET /api/discogs/callback`: read `oauth_token`, `oauth_verifier` from `request.nextUrl.searchParams`;
  read + decrypt cookie → `{ token: requestToken, tokenSecret: requestTokenSecret }`; verify
  `requestToken === oauth_token` (else 400); `getAccessToken({ requestToken, requestTokenSecret, verifier })`;
  `upsertConnection({tenantId: user.tenantId, userId: user.id}, { discogsUsername: username, auth, connectedByUserId: user.id })`;
  clear cookie; `return NextResponse.redirect(`${tenantUrl(tenant.slug)}/ankauf?connected=1`)`.
  Fail-closed: missing cookie / token mismatch / adapter error → redirect `…/ankauf?error=connect`.
- `disconnectDiscogs()` (in `src/app/(app)/ankauf/actions.ts`): `'use server'`, requireSession + admin,
  `deleteConnection({tenantId, userId})`, `revalidatePath('/ankauf')`.

---

## C9. Job enqueue + worker (`src/lib/jobs.ts`, `src/worker/index.ts`, `src/worker/jobs/discogsListing.ts`) — Tasks 10/11

`QUEUE` add: `discogsListingCreate: 'tenant.discogs.listing.create'`.

`src/worker/jobs/discogsListing.ts`:
```ts
export type DiscogsListingPayload = { tenantId: number; purchaseId: number };
export async function handleDiscogsListingCreate(job: PgBoss.Job<DiscogsListingPayload>): Promise<void>;
```
Handler: `withTenant({ tenantId, userId: null }, …)`:
load purchase ⋈ record by `purchaseId`. If missing → return. If `discogsListingStatus === 'listed'` and
`discogsListingId` set → return (idempotent). If `record.discogsId` is null → set `failed`, return.
`getConnection({tenantId,userId:null})`; if null → set `failed`, return.
`getDiscogsAdapter().createListing(conn.auth, { releaseId: record.discogsId, conditionRecord, conditionCover, price: Number(targetPrice) })`.
On success → update purchase `discogsListingId`, `discogsListingStatus='listed'`.
`catch`: `DiscogsAuthError` or `DiscogsError` → set `failed`; `DiscogsRateLimitError` → `throw` (pg-boss retry).
Register in `startWorker()`: `await boss.createQueue(QUEUE.discogsListingCreate);` + `boss.work<DiscogsListingPayload>(…)`
mirroring the analyticsSummary registration (array-of-jobs wrapper).

`src/lib/jobs.ts` (server-only): lazy module-scoped PgBoss singleton on `env.PGBOSS_DATABASE_URL`:
```ts
export async function enqueueDiscogsListing(payload: { tenantId: number; purchaseId: number }): Promise<void>;
```
Internally: start boss once, `createQueue(QUEUE.discogsListingCreate)` once, then
`boss.send(QUEUE.discogsListingCreate, payload, { retryLimit: 5, retryBackoff: true })`.

---

## C10. Server actions (`src/app/(app)/ankauf/actions.ts` + core in `src/lib/ankauf.ts`) — Task 10

`src/lib/ankauf.ts` (server-only):
```ts
export type AnkaufRelease = {
  discogsId: number; title: string; artist: string;
  country: string | null; year: number | null; format: string | null;
  genre: string[]; label: string[]; coverImage: string | null;
};
export type AnkaufInput = {
  release: AnkaufRelease;
  purchasePrice: string;   // EK decimal string, e.g. '3.00'
  targetPrice: string;     // VK decimal string
  conditionRecord: number; // 0–7
  conditionCover: number;  // 0–7
  listOnDiscogs: boolean;
};
/** ONE withTenant tx: dedup-upsert record by hash, ALWAYS insert a new purchase (copy). */
export async function performAnkauf(ctx: TenantCtx, input: AnkaufInput):
  Promise<{ recordId: number; purchaseId: number }>;
```
`performAnkauf`: `hash = recordHash({ title, artist, country, year: year ?? undefined, label })`;
inside `withTenant(ctx, async (tx) => { … })`:
- record upsert: `insert(records).values({ tenantId: ctx.tenantId, title, artist, label, country, releaseYear: year, format, genre, coverImage, discogsId, hash }).onConflictDoUpdate({ target: [records.hash, records.tenantId], set: { coverImage, discogsId, updatedAt: new Date() } }).returning({ id: records.id })`.
- purchase insert (ALWAYS new): `insert(purchases).values({ tenantId: ctx.tenantId, recordId, purchasePrice, targetPrice, conditionRecord, conditionCover, status: 'verfuegbar', discogsListingStatus: input.listOnDiscogs ? 'pending' : 'not_listed' }).returning({ id: purchases.id })`.
- return `{ recordId, purchaseId }`.
NO idempotency/dedup on purchases — a second identical Ankauf = a second copy (one record).

`src/app/(app)/ankauf/actions.ts` (`'use server'`):
```ts
export type SearchResultDTO = DiscogsSearchResult;
export async function searchDiscogs(query: string):
  Promise<{ ok: true; results: SearchResultDTO[] } | { ok: false; reason: 'not_connected' | 'auth' | 'error' }>;
export async function getPriceSuggestion(releaseId: number):
  Promise<{ ok: true; suggestion: DiscogsPriceSuggestion | null; median: number | null }
        | { ok: false; reason: 'not_connected' | 'auth' | 'error' }>;
export async function ankaufRecord(input: AnkaufInput):
  Promise<{ ok: true; recordId: number; purchaseId: number; listingSkipped?: boolean }
        | { ok: false; reason: 'not_connected' | 'validation' | 'error'; message?: string }>;
export async function disconnectDiscogs(): Promise<void>;
```
- All: `requireSession()` first. `searchDiscogs`/`getPriceSuggestion`/`ankaufRecord` need a connection
  (`getConnection`); null → `{ ok:false, reason:'not_connected' }`. Map `DiscogsAuthError` → `reason:'auth'`.
- `searchDiscogs`: empty/whitespace query → `{ ok:true, results: [] }`. Else `adapter.search(conn.auth, q)`.
- `getPriceSuggestion`: `adapter.priceSuggestions(conn.auth, releaseId)`; `median` is NOT re-fetched here
  (the client already holds it from the search result) → return `median: null` is acceptable; the modal passes
  the search-result median into `suggestSalePrice`. (Keep `median` in the return type for forward-compat; set null.)
- `ankaufRecord`: zod-validate (EK/VK match `/^\d+(\.\d{1,2})?$/` and ≥ 0; conditionRecord/Cover int 0–7;
  release.discogsId int). On invalid → `{ ok:false, reason:'validation', message }`. Then
  `const { recordId, purchaseId } = await performAnkauf({tenantId,userId}, input);`. If `input.listOnDiscogs`:
  connection exists (already checked) → `await enqueueDiscogsListing({ tenantId, purchaseId });`
  `revalidatePath('/inventar'); revalidatePath('/');` return `{ ok:true, recordId, purchaseId }`.
  CSRF: mirror `src/app/login/actions.ts` origin check at the top of mutating actions.

---

## C11. UI (`src/app/(app)/ankauf/`) — Tasks 12/13

`page.tsx` (RSC): `requireSession()` (any role may view/search); `getCurrentTenant()`;
`const conn = await getConnection({tenantId, userId});` pass `connected={!!conn}` + `username={conn?.discogsUsername ?? null}`.
If not connected → render `<ConnectPrompt />`. Else render `<SearchForm />`. Read `searchParams` for
`?connected=1` / `?error=connect` to show a banner.

Components under `src/app/(app)/ankauf/_components/`, all design-faithful to the handoff markup
(see contract file's design section — card + modal). LOCKED testids:
- `SearchForm.tsx` ('use client'): wraps search input + disabled barcode button + submit; uses
  `useActionState`/`useTransition` to call `searchDiscogs`; holds results; renders `ResultsGrid` + view toggle.
  root `data-testid="discogs-search-form"`; input placeholder `"Auf Discogs suchen…"`.
- `ResultsGrid.tsx` / `ResultCard.tsx`: grid `data-testid="discogs-results"`; each card
  `data-testid="discogs-result-card"` as `<article>`; "Ankaufen" button `data-testid="ankauf-open"`;
  disabled wishlist heart (`disabled`, `aria-disabled="true"`); Median + want/have in `font-mono`.
- `AnkaufModal.tsx` ('use client'): `data-testid="ankauf-modal"`; on mount calls `getPriceSuggestion(release.discogsId)`;
  EK input `data-testid="ek-input"`; VK input `data-testid="vk-input"` (prefilled via `suggestSalePrice`
  with the search-result median + current record condition, recomputed when record condition changes, but
  never overwriting a user edit); condition record pills `data-testid="cond-record-<LABEL>"`
  (LABEL ∈ CONDITION_PILLS), cover pills `data-testid="cond-cover-<LABEL>"`, both `role="radiogroup"`,
  selected pill `aria-checked="true"` + accent style; listing toggle `data-testid="list-on-discogs-toggle"`
  (`role="switch"` `aria-checked`); submit button `data-testid="ankauf-submit"` label "Zum Bestand hinzufügen";
  cancel "Abbrechen". On submit calls `ankaufRecord`; on `ok` close modal + success toast/banner.
- `ConnectPrompt.tsx`: `data-testid="connect-discogs-prompt"`; calm empty state "Discogs verbinden";
  primary action is an anchor `<a href="/api/discogs/connect">` styled as accent button.
German labels verbatim: "Einkaufspreis", "Zielpreis (VK)", "Zustand · Platte", "Zustand · Cover",
"Direkt auf Discogs zum Verkauf listen", "Zum Bestand hinzufügen", "Abbrechen". VK hint line:
"◈ Vorschlag aus Discogs-Marktdaten (<grade>): € X.XX · Zustand angepasst".

---

## C12. Seed + E2E — Task 14

`scripts/seed.ts`: add (idempotent on tenant):
```ts
export async function ensureDiscogsConnection(ownerPool: Pool, input: {
  tenantId: number; discogsUsername: string; token: string; tokenSecret: string;
}): Promise<void>;
```
Encrypt token/tokenSecret via `encryptSecret(x, { tenantId })`, insert into `discogs_connections`
(skip if a row for tenant exists). Seed a fake connection for the **demo** tenant ONLY (leave the second seeded
tenant — slug `vinylcave`, confirm in scripts/seed.ts — WITHOUT one) so E2E can assert both the connected and the connect-prompt states.

`e2e/discogs.spec.ts` (env `DISCOGS_DRIVER=fake`):
1. tenant without connection → `/ankauf` shows `connect-discogs-prompt`.
2. demo (connected) → search "blue"/fixture term → `discogs-results` shows ≥1 `discogs-result-card`.
3. Open Ankauf (no listing) → submit → go to `/inventar` → the new copy is present (EK/VK, status verfügbar).
4. Ankauf with `list-on-discogs-toggle` on → copy listing status becomes `pending`, then `listed` after the
   worker runs (poll inventory/listing-status; allow generous timeout; if worker not running in the e2e stack,
   assert `pending` and cover `listed` in the worker integration test instead).
5. No-token-leak: neither the `/ankauf` HTML nor any search/suggestion network payload contains the seeded
   fake token plaintext.
6. Double Ankauf of the same release → two purchases, one record.

Fake driver fixtures (`src/lib/discogs/fake.ts`) must include at least one release whose title matches the
search term used in E2E, with a non-null `discogsId`, `median`, `community`, and a `priceSuggestions.byGrade`
map containing the 'Very Good Plus (VG+)' key.

---

## Cross-cutting invariants (every task)
- Only `withTenant`/`withSuperadmin`/`withOwner` touch the DB; explicit `tenant_id` on every insert.
- OAuth tokens NEVER leave the server (no token in any client component prop, RSC payload, or JSON response).
- Fail-closed: no connection → no search/suggestion/listing; OAuth state strictly verified.
- All Discogs HTTP goes through the 2 req/s `discogsLimiter` + sends `User-Agent: env.DISCOGS_USER_AGENT`.
- TDD: failing test → run (fail) → minimal impl → run (pass) → commit. Frequent small commits.
- typecheck (`pnpm typecheck`) + lint (`pnpm lint`) must stay green.
