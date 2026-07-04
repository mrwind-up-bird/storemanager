# Slice 5 — Mobile + Scanner (PWA) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die App wird unterhalb von 768px zur handoff-treuen Mobile-App (Bottom-Tabs, Mobile-Header, Bottom-Sheets), bekommt einen Kamera-Barcode-Scanner (EAN → Discogs-Ankauf; Etiketten-QR → Verkauf) und PWA-Installierbarkeit mit Offline-Hinweisseite.

**Architecture:** Ansatz A (adaptive Shell): gleiche Routen, gleiche Server-Actions; Mobile ist eine CSS-Schicht (`src/styles/globals.css`) plus wenige Client-Komponenten (BottomTabBar, MobileHeader, ScannerSheet, VerkaufSheet). Bestehende Modals (SellModal, AnkaufModal) werden mobil per CSS-Klasse als Bottom-Sheets präsentiert — keine Logik-Duplikation. Scanner: `getUserMedia` + `barcode-detector`-Ponyfill (dynamic import). PWA: dynamisches `manifest.ts` pro Tenant, handgeschriebener `public/sw.js`.

**Tech Stack:** Next.js 15 App Router · React 19 · TS strict · Drizzle · Vitest (+ jsdom/RTL für UI) · Testcontainers · Playwright · barcode-detector (NEU) · sharp (NEU, nur devDependency fürs Icon-Script)

## Global Constraints

Spec: `docs/superpowers/specs/2026-07-03-qrecords-v2-slice5-mobile-scanner-pwa-design.md` · **Contracts (Pflichtlektüre für JEDEN Task): `docs/superpowers/plans/2026-07-03-qrecords-v2-slice5-mobile-scanner-pwa-CONTRACTS.md`**

1. **Desktop ≥768px rendert byte-identisch zu heute.** Additive `className`-Attribute auf bestehenden Elementen sind erlaubt (Klassen greifen nur mobil); jede andere Änderung an Desktop-Darstellung ist ein Defekt.
2. **Keine `/m/*`-Routen, keine UA-Weiche.** Breakpoint exakt 768px; ALLE Slice-5-Media-Queries im Abschnitt `/* ── Slice 5: Mobile Shell ── */` von `src/styles/globals.css` (C1). `!important` NUR dort.
3. **Sicherheitskette:** neue Server-Actions: `requireSession()` → bei mutierend/staff `if (user.role === 'kunde') forbidden()` → `isValidOrigin()` nur bei Mutationen → zod → Delegation an lib mit `withTenant`. Lesende Suche-Actions folgen der `searchDiscogs`-Konvention (kein CSRF-Check).
4. **Geld:** numeric(10,2)-Strings; Preise werden in diesem Slice NIE clientseitig gesetzt (SellModal ist read-only-Preis; AnkaufModal unverändert).
5. **Keine Schema-Migration.** Barcode wird nicht persistiert.
6. **Schwere Libs (`barcode-detector`) nur per dynamic import** nach User-Interaktion (Muster jsPDF in `LabelPrintModal.tsx`).
7. **Service Worker cached ausschließlich `/_next/static/`, `/icons/` und `/offline`** — nie API/HTML/Server-Actions/fremde Origins/non-GET (C11).
8. **Kamera:** jeder Kamera-Pfad hat einen Fallback; MediaStream-Tracks werden in JEDEM Pfad gestoppt (C8).
9. **Deutsche UI-Texte exakt wie in den Contracts** (Fehlertexte C8, Titel C3, Szenario-Texte C14).
10. **Test-Harness-Regeln:** Integration-Specs ohne statischen `@/db`- oder `@/app`-Import — `setupTestDatabase()` → `vi.doMock(...)` → `vi.resetModules()` → dynamic import (Muster `tests/ankauf-actions.integration.test.ts`). UI-Tests unter `tests/ui/**` (jsdom + RTL). E2E: Live-DB-Asserts (Count-Deltas), keine Seed-Konstanten.
11. **Git:** Branch `feat/v2-slice5-mobile-scanner-pwa`; nie auf main committen; `.superpowers/` und `.memory/` nie stagen. Jede Commit-Message endet mit:
    `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
12. Lint/Typecheck müssen nach jedem Task grün sein: `pnpm lint && pnpm typecheck`.

## File Structure (Verantwortlichkeiten)

**Neu:**
| Datei | Verantwortung |
|---|---|
| `src/lib/discogs/parse.ts` | pure: Discogs-Release-URL → ID (client-tauglich, KEIN server-only) |
| `src/app/(app)/_components/BottomTabBar.tsx` | mobile Tab-Navigation (C2) |
| `src/app/(app)/_components/MobileHeader.tsx` | mobiler Sticky-Header: Titel-Map, ThemeToggle, optional €-FAB (C3) |
| `src/app/(app)/_components/MobileChrome.tsx` | Client-Klammer: MobileHeader + (ab Task 7) VerkaufSheet-State |
| `src/app/(app)/_components/QuickActions.tsx` | Start-Screen Quick-Actions mobil (C12) |
| `src/app/(app)/_components/VerkaufSheet.tsx` | Schnellverkauf-Sheet: Suche/Scan → SellModal (C9) |
| `src/components/scanner/ScannerSheet.tsx` | Kamera-Viewfinder + Dekodier-Loop + Fallback (C8) |
| `src/app/manifest.ts`, `public/sw.js`, `src/components/pwa/SwRegistration.tsx`, `src/app/offline/page.tsx`, `src/app/offline/ReloadButton.tsx` | PWA (C11) |
| `scripts/generate-icons.mjs`, `public/icons/*.png` | App-Icons (einmalig generiert, eingecheckt) |
| Tests: `tests/discogs-parse.test.ts`, `tests/discogs-barcode-adapter.test.ts`, `tests/slice5-actions.integration.test.ts`, `tests/manifest.test.ts`, `tests/ui/bottom-tabbar.test.tsx`, `tests/ui/mobile-header.test.tsx`, `tests/ui/scanner-sheet.test.tsx`, `tests/ui/search-form-barcode.test.tsx`, `tests/ui/filterbar-labelscan.test.tsx`, `tests/ui/verkauf-sheet.test.tsx`, `e2e/mobile-pwa.spec.ts` | siehe Tasks |

**Geändert:** `src/styles/globals.css` (C1-Block) · `src/app/(app)/layout.tsx` (Klassen + MobileChrome/BottomTabBar) · `src/app/layout.tsx` (Viewport/PWA-Meta + SwRegistration) · `src/lib/discogs/{types,client,fake}.ts` (C4) · `src/app/(app)/ankauf/actions.ts` (C6) · `src/app/(app)/kasse/actions.ts` (C6) · `src/lib/inventory.ts` (C7) · `src/app/(app)/ankauf/_components/{SearchForm,AnkaufModal}.tsx` (C13, C10) · `src/app/(app)/inventar/_components/{FilterBar,InventoryList,SellModal,StatusTabs}.tsx` (Task 6) · `src/app/(app)/{page,analytik/page,wunschlisten/page}.tsx` (Task 3/7) · `package.json` (barcode-detector, sharp devDep)

---

### Task 1: Discogs-URL-Parser + Adapter `searchByBarcode`

**Files:**
- Create: `src/lib/discogs/parse.ts`
- Modify: `src/lib/discogs/types.ts` (Interface), `src/lib/discogs/client.ts` (HTTP), `src/lib/discogs/fake.ts` (Fake + `FAKE_BARCODE_HIT`)
- Test: `tests/discogs-parse.test.ts`, `tests/discogs-barcode-adapter.test.ts`

**Interfaces:**
- Consumes: `discogsReleaseUrl(discogsId)` aus `src/lib/labels.ts` (existiert); `mapSearchResult`/`requestJson` in client.ts (existieren); `FIXTURES` in fake.ts (existiert).
- Produces: `parseDiscogsReleaseUrl(text: string): number | null` (C5); `DiscogsAdapter.searchByBarcode(auth, barcode): Promise<DiscogsSearchResult[]>` (C4); `export const FAKE_BARCODE_HIT = '4988031234567'` aus `@/lib/discogs/fake`.

- [ ] **Step 1: Failing Tests schreiben**

`tests/discogs-parse.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseDiscogsReleaseUrl } from '@/lib/discogs/parse';
import { discogsReleaseUrl } from '@/lib/labels';

describe('parseDiscogsReleaseUrl', () => {
  it.each([
    ['https://www.discogs.com/release/11111', 11111],
    ['https://discogs.com/release/22222', 22222],
    ['http://www.discogs.com/release/33333', 33333],
    ['https://www.discogs.com/release/249504-Rick-Astley-Never-Gonna-Give-You-Up', 249504],
    ['https://www.discogs.com/release/11111?ev=rr', 11111],
    ['https://www.discogs.com/release/11111#anchor', 11111],
    ['  https://www.discogs.com/release/11111  ', 11111],
  ])('parst %s → %d', (input, expected) => {
    expect(parseDiscogsReleaseUrl(input)).toBe(expected);
  });

  it('Roundtrip mit discogsReleaseUrl (Etiketten-QR, Slice 4)', () => {
    expect(parseDiscogsReleaseUrl(discogsReleaseUrl(12345))).toBe(12345);
  });

  it.each([
    'kein link',
    '4988031234567',
    '',
    'https://example.com/release/5',
    'https://www.discogs.com/master/1234',
    'https://www.discogs.com/release/',
    'https://www.discogs.com/release/0',
    'discogs.com/release/5',
  ])('lehnt %s ab (null)', (input) => {
    expect(parseDiscogsReleaseUrl(input)).toBeNull();
  });
});
```

`tests/discogs-barcode-adapter.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createFakeDiscogsAdapter, FAKE_BARCODE_HIT } from '@/lib/discogs/fake';

const auth = { token: 't', tokenSecret: 's' };

describe('fake adapter searchByBarcode', () => {
  it('Treffer-EAN liefert exakt die 2 Fixtures (Kind of Blue + Abbey Road)', async () => {
    const results = await createFakeDiscogsAdapter().searchByBarcode(auth, FAKE_BARCODE_HIT);
    expect(results.map((r) => r.discogsId)).toEqual([11111, 22222]);
    expect(results[0]!.title).toBe('Kind of Blue');
  });

  it('Treffer ist trim-tolerant', async () => {
    const results = await createFakeDiscogsAdapter().searchByBarcode(auth, `  ${FAKE_BARCODE_HIT} `);
    expect(results).toHaveLength(2);
  });

  it('fremder EAN liefert []', async () => {
    const results = await createFakeDiscogsAdapter().searchByBarcode(auth, '0000000000000');
    expect(results).toEqual([]);
  });
});
```

- [ ] **Step 2: Tests laufen lassen — müssen FAILEN**

Run: `pnpm vitest run tests/discogs-parse.test.ts tests/discogs-barcode-adapter.test.ts`
Expected: FAIL — `Cannot find module '@/lib/discogs/parse'` bzw. `searchByBarcode is not a function` / kein Export `FAKE_BARCODE_HIT`.

- [ ] **Step 3: Parser implementieren**

`src/lib/discogs/parse.ts` (KOMPLETT — bewusst OHNE `'server-only'`, wird im Client gebraucht):
```ts
// Pure helper: extracts the numeric release id from a Discogs release URL.
// Round-trips with discogsReleaseUrl() (src/lib/labels.ts) — the Slice-4 label QR content.
const RELEASE_URL_RE = /^https?:\/\/(?:www\.)?discogs\.com\/release\/(\d+)(?:[-/?#]|$)/i;

export function parseDiscogsReleaseUrl(text: string): number | null {
  const m = RELEASE_URL_RE.exec(text.trim());
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
```

- [ ] **Step 4: Adapter-Interface + beide Treiber erweitern**

`src/lib/discogs/types.ts` — im `DiscogsAdapter`-Interface direkt NACH `search(...)` einfügen:
```ts
  /** Discogs /database/search by EAN/UPC barcode — same result shape as search(). */
  searchByBarcode(auth: DiscogsAuth, barcode: string): Promise<DiscogsSearchResult[]>;
```

`src/lib/discogs/client.ts` — im Objekt von `createHttpDiscogsAdapter()` direkt NACH der `search`-Methode einfügen:
```ts
    async searchByBarcode(auth: DiscogsAuth, barcode: string) {
      const encoded = encodeURIComponent(barcode);
      const body = (await requestJson(
        'GET',
        `/database/search?barcode=${encoded}&type=release&per_page=25`,
        auth,
      )) as { results: RawResult[] };
      return (body.results ?? []).map(mapSearchResult);
    },
```

`src/lib/discogs/fake.ts` — nach den `FIXTURES` als Top-Level-Export:
```ts
/** The ONE fake barcode that hits — E2E + integration tests type this EAN (C4). */
export const FAKE_BARCODE_HIT = '4988031234567';
```
und im Objekt von `createFakeDiscogsAdapter()` direkt NACH `search`:
```ts
    async searchByBarcode(_auth: DiscogsAuth, barcode: string): Promise<DiscogsSearchResult[]> {
      if (barcode.trim() === FAKE_BARCODE_HIT) return [FIXTURES[0]!, FIXTURES[1]!];
      return [];
    },
```

- [ ] **Step 5: Tests laufen lassen — müssen PASSEN**

Run: `pnpm vitest run tests/discogs-parse.test.ts tests/discogs-barcode-adapter.test.ts`
Expected: PASS (alle). Dann: `pnpm typecheck && pnpm lint` — grün (der TS-Compiler erzwingt, dass BEIDE Treiber die neue Interface-Methode haben).

- [ ] **Step 6: Commit**

```bash
git add src/lib/discogs/parse.ts src/lib/discogs/types.ts src/lib/discogs/client.ts src/lib/discogs/fake.ts tests/discogs-parse.test.ts tests/discogs-barcode-adapter.test.ts
git commit -m "feat(slice5): Discogs-Barcode-Suche im Adapter + Release-URL-Parser

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Server-Actions + Exemplar-Lookup (lib)

**Files:**
- Modify: `src/lib/inventory.ts` (CopyHit + findAvailableCopiesByRelease), `src/app/(app)/kasse/actions.ts` (2 Actions), `src/app/(app)/ankauf/actions.ts` (searchDiscogsByBarcode)
- Test: `tests/slice5-actions.integration.test.ts`

**Interfaces:**
- Consumes: `searchByBarcode`/`FAKE_BARCODE_HIT` (Task 1); `withTenant`, `records`, `purchases`, `listInventory`, `basePreds`-Stil (existieren); `performAnkauf` aus `@/lib/ankauf`; `upsertConnection` aus `@/lib/discogs-connection`; Guard-Muster aus `createSale` (kasse/actions.ts:73ff).
- Produces (C6/C7):
  - `src/lib/inventory.ts`: `export type CopyHit = { purchaseId: number; title: string; artist: string; targetPrice: string | null; conditionRecord: number | null; conditionCover: number | null }` und `findAvailableCopiesByRelease(ctx, discogsReleaseId): Promise<CopyHit[]>`
  - `kasse/actions.ts`: `findAvailableCopiesByRelease(releaseId: number)` und `searchAvailableCopies(query: string)` → je `{ ok: true; copies: CopyHit[] } | { ok: false; reason: 'validation' | 'error' }`
  - `ankauf/actions.ts`: `searchDiscogsByBarcode(barcode: string)` → `{ ok: true; results: SearchResultDTO[] } | { ok: false; reason: 'not_connected' | 'auth' | 'validation' | 'error' }`

- [ ] **Step 1: Failing Integration-Test schreiben**

`tests/slice5-actions.integration.test.ts` (Muster = `tests/ankauf-actions.integration.test.ts`; mutabler `currentUser` für Rollen-/Tenant-Wechsel):
```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { setupTestDatabase, seedTenant } from './helpers/db';

vi.mock('@/lib/jobs', () => ({
  enqueueDiscogsListing: vi.fn(async () => undefined),
  enqueueWishlistMatch: vi.fn(async () => undefined),
}));

type MockUser = {
  id: number; email: string; tenantId: number;
  role: 'admin' | 'mitarbeiter' | 'kunde' | 'superadmin'; isSuperadmin: boolean;
};

let kasseActions: typeof import('@/app/(app)/kasse/actions');
let ankaufActions: typeof import('@/app/(app)/ankauf/actions');
let teardown: (() => Promise<void>) | undefined;
let tenantA: number;
let tenantB: number;
let currentUser: MockUser;

const asAdmin = (tenantId: number): MockUser => ({
  id: 1, email: 'a@test', tenantId, role: 'admin', isSuperadmin: false,
});

beforeAll(async () => {
  const db = await setupTestDatabase();
  teardown = db.teardown;
  process.env.DATABASE_URL = db.appUrl;
  process.env.DATABASE_OWNER_URL = db.ownerUrl;
  process.env.DISCOGS_DRIVER = 'fake';
  vi.doMock('@/auth/session', () => ({
    requireSession: async () => currentUser,
  }));
  vi.doMock('next/headers', () => ({
    headers: async () => new Headers(),
    cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
  }));
  vi.doMock('next/cache', () => ({ revalidatePath: () => undefined }));
  vi.resetModules();

  ({ tenantId: tenantA } = await seedTenant({ slug: 'test-a', name: 'Test A' }));
  ({ tenantId: tenantB } = await seedTenant({ slug: 'test-b', name: 'Test B' }));
  currentUser = asAdmin(tenantA);

  kasseActions = await import('@/app/(app)/kasse/actions');
  ankaufActions = await import('@/app/(app)/ankauf/actions');

  // Fixture: Tenant A bekommt 2 verfügbare + 1 verkauftes Exemplar von Release 11111
  // sowie eine Discogs-Fake-Connection für die Barcode-Suche.
  const { performAnkauf } = await import('@/lib/ankauf');
  const { upsertConnection } = await import('@/lib/discogs-connection');
  const { withTenant } = await import('@/db/tenant');
  const { purchases } = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');

  await upsertConnection(
    { tenantId: tenantA, userId: null },
    { discogsUsername: 'a', auth: { token: 't', tokenSecret: 's' }, connectedByUserId: null },
  );

  const release = {
    discogsId: 11111, title: 'Kind of Blue', artist: 'Miles Davis', country: 'US',
    year: 1959, format: 'Vinyl', genre: ['Jazz'], label: ['Columbia'], coverImage: null,
  };
  const base = {
    release, purchasePrice: '3', targetPrice: '22.50',
    conditionRecord: 5, conditionCover: 4, listOnDiscogs: false,
  };
  const ctxA = { tenantId: tenantA, userId: null };
  await performAnkauf(ctxA, base);
  await performAnkauf(ctxA, base);
  const { purchaseId: soldId } = await performAnkauf(ctxA, base);
  await withTenant(ctxA, (tx) =>
    tx.update(purchases).set({ status: 'verkauft' }).where(eq(purchases.id, soldId)),
  );
}, 120_000);

afterAll(async () => {
  await teardown?.();
});

describe('findAvailableCopiesByRelease (Action, C6/C7)', () => {
  it('liefert nur verfuegbare Exemplare des Releases, ohne EK-Preis', async () => {
    currentUser = asAdmin(tenantA);
    const res = await kasseActions.findAvailableCopiesByRelease(11111);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.copies).toHaveLength(2); // das verkaufte Exemplar fehlt
    for (const c of res.copies) {
      expect(c.title).toBe('Kind of Blue');
      expect(c.targetPrice).toBe('22.50');
      expect('purchasePrice' in c).toBe(false); // EK bleibt server-intern
      expect('ek' in c).toBe(false);
    }
  });

  it('RLS/Isolation: Tenant B sieht 0 Exemplare', async () => {
    currentUser = asAdmin(tenantB);
    const res = await kasseActions.findAvailableCopiesByRelease(11111);
    expect(res).toEqual({ ok: true, copies: [] });
  });

  it('validation: releaseId 0 → validation', async () => {
    currentUser = asAdmin(tenantA);
    expect(await kasseActions.findAvailableCopiesByRelease(0)).toEqual({
      ok: false, reason: 'validation',
    });
  });

  it('kunde → forbidden() wirft', async () => {
    currentUser = { ...asAdmin(tenantA), role: 'kunde' };
    await expect(kasseActions.findAvailableCopiesByRelease(11111)).rejects.toThrow();
  });
});

describe('searchAvailableCopies (Action, C6)', () => {
  it('findet per Substring, max. 8, nur verfuegbar', async () => {
    currentUser = asAdmin(tenantA);
    const res = await kasseActions.searchAvailableCopies('kind of');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.copies.length).toBe(2);
    expect(res.copies[0]!.artist).toBe('Miles Davis');
  });

  it('leerer Query → validation', async () => {
    currentUser = asAdmin(tenantA);
    expect(await kasseActions.searchAvailableCopies('   ')).toEqual({
      ok: false, reason: 'validation',
    });
  });
});

describe('searchDiscogsByBarcode (Action, C6)', () => {
  it('FAKE_BARCODE_HIT → 2 Treffer über den Fake-Treiber', async () => {
    currentUser = asAdmin(tenantA);
    const { FAKE_BARCODE_HIT } = await import('@/lib/discogs/fake');
    const res = await ankaufActions.searchDiscogsByBarcode(FAKE_BARCODE_HIT);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.results.map((r) => r.discogsId)).toEqual([11111, 22222]);
  });

  it('ungültiger Barcode (Buchstaben / 7 / 15 Ziffern) → validation', async () => {
    currentUser = asAdmin(tenantA);
    for (const bad of ['abcdefgh', '1234567', '123456789012345']) {
      expect(await ankaufActions.searchDiscogsByBarcode(bad)).toEqual({
        ok: false, reason: 'validation',
      });
    }
  });

  it('ohne Connection → not_connected (Tenant B hat keine)', async () => {
    currentUser = asAdmin(tenantB);
    expect(await ankaufActions.searchDiscogsByBarcode('12345678')).toEqual({
      ok: false, reason: 'not_connected',
    });
  });

  it('kunde → forbidden() wirft (Spec §11.2)', async () => {
    currentUser = { ...asAdmin(tenantA), role: 'kunde' };
    await expect(ankaufActions.searchDiscogsByBarcode('12345678')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss FAILEN**

Run: `pnpm vitest run tests/slice5-actions.integration.test.ts`
Expected: FAIL — `findAvailableCopiesByRelease is not a function` (bzw. fehlende Exporte).

- [ ] **Step 3: lib-Funktion implementieren**

`src/lib/inventory.ts` — am Dateiende anfügen (Imports `and, asc, eq` + `withTenant` + `records, purchases` existieren bereits am Kopf):
```ts
/** Minimal row for the mobile sell flows — deliberately WITHOUT purchase price (EK stays server-side). */
export type CopyHit = {
  purchaseId: number;
  title: string;
  artist: string;
  targetPrice: string | null;
  conditionRecord: number | null;
  conditionCover: number | null;
};

/** All verfuegbar copies of a Discogs release (label-QR sell flow, C7).
 *  KRITISCH: matcht über records.discogsId — NIEMALS purchases.recordId (interne ID ≠ Release-ID). */
export async function findAvailableCopiesByRelease(
  ctx: { tenantId: number; userId: number | null },
  discogsReleaseId: number,
): Promise<CopyHit[]> {
  return withTenant({ tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) =>
    tx
      .select({
        purchaseId: purchases.id,
        title: records.title,
        artist: records.artist,
        targetPrice: purchases.targetPrice,
        conditionRecord: purchases.conditionRecord,
        conditionCover: purchases.conditionCover,
      })
      .from(purchases)
      .innerJoin(records, eq(records.id, purchases.recordId))
      .where(
        and(
          eq(purchases.tenantId, ctx.tenantId),
          eq(records.tenantId, ctx.tenantId),
          eq(records.discogsId, discogsReleaseId),
          eq(purchases.status, 'verfuegbar'),
        ),
      )
      .orderBy(asc(purchases.id)),
  );
}
```

- [ ] **Step 4: kasse-Actions implementieren**

`src/app/(app)/kasse/actions.ts` — Import-Block ergänzen:
```ts
import {
  findAvailableCopiesByRelease as findCopiesSvc,
  listInventory,
  type CopyHit,
} from '@/lib/inventory';

export type { CopyHit };
```
Am Dateiende anfügen:
```ts
const releaseIdSchema = z.number().int().positive();

/** Etiketten-QR → verfügbare Exemplare dieses Releases (C6). Lesend, staff-only. */
export async function findAvailableCopiesByRelease(
  releaseId: number,
): Promise<{ ok: true; copies: CopyHit[] } | { ok: false; reason: 'validation' | 'error' }> {
  const user = await requireSession();
  if (user.role === 'kunde') forbidden();
  const parsed = releaseIdSchema.safeParse(releaseId);
  if (!parsed.success) return { ok: false, reason: 'validation' };
  try {
    const copies = await findCopiesSvc({ tenantId: user.tenantId, userId: user.id }, parsed.data);
    return { ok: true, copies };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

const copyQuerySchema = z.string().trim().min(1).max(80);

/** Textsuche über verfügbare Exemplare für den Schnellverkauf (C6/C9). Max. 8 Treffer. */
export async function searchAvailableCopies(
  query: string,
): Promise<{ ok: true; copies: CopyHit[] } | { ok: false; reason: 'validation' | 'error' }> {
  const user = await requireSession();
  if (user.role === 'kunde') forbidden();
  const parsed = copyQuerySchema.safeParse(query);
  if (!parsed.success) return { ok: false, reason: 'validation' };
  try {
    const rows = await listInventory(
      { tenantId: user.tenantId, userId: user.id },
      { q: parsed.data, status: 'verfuegbar' },
    );
    const copies: CopyHit[] = rows.slice(0, 8).map((r) => ({
      purchaseId: r.copyId,
      title: r.title,
      artist: r.artist,
      targetPrice: r.vk,
      conditionRecord: r.conditionRecord,
      conditionCover: r.conditionCover,
    }));
    return { ok: true, copies };
  } catch {
    return { ok: false, reason: 'error' };
  }
}
```

- [ ] **Step 5: ankauf-Action implementieren**

`src/app/(app)/ankauf/actions.ts` — am Dateiende anfügen (Imports existieren alle):
```ts
const barcodeSchema = z.string().trim().regex(/^\d{8,14}$/);

/** EAN/UPC → Discogs-Treffer (C6). Lesend — Konvention wie searchDiscogs (kein CSRF-Check). */
export async function searchDiscogsByBarcode(
  barcode: string,
): Promise<
  | { ok: true; results: SearchResultDTO[] }
  | { ok: false; reason: 'not_connected' | 'auth' | 'validation' | 'error' }
> {
  const user = await requireSession();
  if (user.role === 'kunde') forbidden(); // Spec §8.2: staff-only (strenger als searchDiscogs)
  const conn = await getConnection({ tenantId: user.tenantId, userId: user.id });
  if (!conn) return { ok: false, reason: 'not_connected' };

  const parsed = barcodeSchema.safeParse(barcode);
  if (!parsed.success) return { ok: false, reason: 'validation' };

  try {
    const results = await getDiscogsAdapter().searchByBarcode(conn.auth, parsed.data);
    return { ok: true, results };
  } catch (e) {
    if (e instanceof DiscogsAuthError) return { ok: false, reason: 'auth' };
    return { ok: false, reason: 'error' };
  }
}
```

- [ ] **Step 6: Tests laufen lassen — müssen PASSEN**

Run: `pnpm vitest run tests/slice5-actions.integration.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS (alle Szenarien inkl. RLS-Isolation), Typecheck/Lint grün.

- [ ] **Step 7: Commit**

```bash
git add src/lib/inventory.ts "src/app/(app)/kasse/actions.ts" "src/app/(app)/ankauf/actions.ts" tests/slice5-actions.integration.test.ts
git commit -m "feat(slice5): Actions für Barcode-Suche + Exemplar-Lookup (Etiketten-Scan, Schnellverkauf)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Responsive Shell (CSS + BottomTabBar + MobileHeader + Layout)

**Files:**
- Create: `src/app/(app)/_components/BottomTabBar.tsx`, `src/app/(app)/_components/MobileHeader.tsx`, `src/app/(app)/_components/MobileChrome.tsx`
- Modify: `src/styles/globals.css` (C1-Block ans Dateiende), `src/app/(app)/layout.tsx`, `src/app/(app)/analytik/page.tsx` + `src/app/(app)/wunschlisten/page.tsx` (nur `className="qr-page-header"`)
- Test: `tests/ui/bottom-tabbar.test.tsx`, `tests/ui/mobile-header.test.tsx`

**Interfaces:**
- Consumes: `Role`-Typ (gleiche Import-Quelle wie in `SidebarNav.tsx` — Import-Zeile dort nachschlagen und exakt übernehmen); `ThemeToggle` (props-los); `user.role` + `tenant.name` im Layout (existieren).
- Produces: `BottomTabBar({ role }: { role: Role })`; `MobileHeader({ role, tenantName, onSchnellverkauf }: MobileHeaderProps)` — FAB rendert NUR wenn `onSchnellverkauf` gesetzt UND `role !== 'kunde'` (Task 7 verdrahtet ihn; bis dahin gibt es keinen toten Button); `MobileChrome({ role, tenantName })` (Client-Klammer, Task 7 erweitert sie um VerkaufSheet-State). CSS-Klassen exakt nach C1.

- [ ] **Step 1: Failing RTL-Tests schreiben**

`tests/ui/bottom-tabbar.test.tsx`:
```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { BottomTabBar } from '@/app/(app)/_components/BottomTabBar';

let currentPath = '/';
vi.mock('next/navigation', () => ({ usePathname: () => currentPath }));

afterEach(() => { cleanup(); currentPath = '/'; });

describe('BottomTabBar (C2)', () => {
  it('admin sieht 5 Tabs in Handoff-Reihenfolge', () => {
    render(<BottomTabBar role="admin" />);
    expect(screen.getAllByRole('link').map((l) => l.textContent)).toEqual([
      'Start', 'Suche', 'Bestand', 'Wunsch', 'Analytik',
    ]);
  });

  it('kunde sieht Suche + Wunsch nicht (staffOnly wie SidebarNav)', () => {
    render(<BottomTabBar role="kunde" />);
    expect(screen.getAllByRole('link').map((l) => l.textContent)).toEqual([
      'Start', 'Bestand', 'Analytik',
    ]);
  });

  it('aria-current="page" sitzt auf dem aktiven Tab (Prefix-Match)', () => {
    currentPath = '/inventar';
    render(<BottomTabBar role="admin" />);
    expect(screen.getByRole('link', { name: /bestand/i })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /start/i })).not.toHaveAttribute('aria-current');
  });

  it('Start matcht nur exakt / (nicht z. B. /inventar)', () => {
    currentPath = '/';
    render(<BottomTabBar role="admin" />);
    expect(screen.getByRole('link', { name: /start/i })).toHaveAttribute('aria-current', 'page');
  });
});
```

`tests/ui/mobile-header.test.tsx`:
```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MobileHeader } from '@/app/(app)/_components/MobileHeader';

let currentPath = '/';
vi.mock('next/navigation', () => ({ usePathname: () => currentPath }));
vi.mock('@/components/theme/ThemeToggle', () => ({
  ThemeToggle: () => <button type="button" aria-label="Theme" />,
}));

afterEach(() => { cleanup(); currentPath = '/'; });

describe('MobileHeader (C3)', () => {
  it('Titel-Map: /ankauf → Discogs-Suche + fester Untertitel', () => {
    currentPath = '/ankauf';
    render(<MobileHeader role="admin" tenantName="Demo Records" />);
    expect(screen.getByText('Discogs-Suche')).toBeInTheDocument();
    expect(screen.getByText('Releases finden & ankaufen')).toBeInTheDocument();
  });

  it('Titel-Map: /analytik → Untertitel enthält Tenant-Namen', () => {
    currentPath = '/analytik';
    render(<MobileHeader role="admin" tenantName="Demo Records" />);
    expect(screen.getByText('Analytik')).toBeInTheDocument();
    expect(screen.getByText('Auswertungen · Demo Records')).toBeInTheDocument();
  });

  it('ohne onSchnellverkauf KEIN FAB (kein toter Button vor Task 7)', () => {
    render(<MobileHeader role="admin" tenantName="Demo" />);
    expect(screen.queryByRole('button', { name: 'Schnellverkauf' })).toBeNull();
  });

  it('mit onSchnellverkauf: FAB für admin, NICHT für kunde', () => {
    const fn = vi.fn();
    render(<MobileHeader role="admin" tenantName="Demo" onSchnellverkauf={fn} />);
    screen.getByRole('button', { name: 'Schnellverkauf' }).click();
    expect(fn).toHaveBeenCalledOnce();
    cleanup();
    render(<MobileHeader role="kunde" tenantName="Demo" onSchnellverkauf={fn} />);
    expect(screen.queryByRole('button', { name: 'Schnellverkauf' })).toBeNull();
  });
});
```

- [ ] **Step 2: Tests laufen lassen — müssen FAILEN**

Run: `pnpm vitest run tests/ui/bottom-tabbar.test.tsx tests/ui/mobile-header.test.tsx`
Expected: FAIL — Module nicht gefunden.

- [ ] **Step 3: CSS-Block anfügen**

`src/styles/globals.css` — ans Dateiende:
```css
/* ── Slice 5: Mobile Shell (C1) ──
   ALLE Slice-5-Media-Queries leben HIER. !important ist NUR in diesem Abschnitt
   legitim: die Komponenten stylen inline (Desktop-Pfad), die Klassen überstimmen
   den Inline-Style ausschließlich im Mobile-Zweig. */
@media (max-width: 767.98px) {
  .app-sidebar { display: none !important; }
  .app-topbar-desktop { display: none !important; }
  .app-main { padding: 16px 16px calc(96px + env(safe-area-inset-bottom)) !important; }
  .qr-page-header { display: none !important; }
  .qr-desktop-only { display: none !important; }
  .qr-chips-scroll {
    flex-wrap: nowrap !important;
    overflow-x: auto;
    margin: 0 -16px;
    padding: 0 16px;
    scrollbar-width: none;
  }
  .qr-chips-scroll::-webkit-scrollbar { width: 0; height: 0; }
  .qr-modal-backdrop { place-items: end center !important; padding: 0 !important; }
  .qr-modal-card {
    width: 100% !important;
    border-radius: var(--r-xl) var(--r-xl) 0 0 !important;
    max-height: 88vh;
    overflow-y: auto;
  }
  .qr-analytik-grid { grid-template-columns: 1fr !important; }
}
@media (min-width: 768px) {
  .app-header-mobile { display: none !important; }
  .app-tabbar { display: none !important; }
  .qr-mobile-only { display: none !important; }
}
```

- [ ] **Step 4: BottomTabBar implementieren**

`src/app/(app)/_components/BottomTabBar.tsx` (KOMPLETT):
```tsx
'use client';

// Mobile bottom-tab navigation (C2) — sichtbar nur <768px via .app-tabbar (C1).
// Tab-Set, Active-Match und staffOnly-Filter spiegeln SidebarNav.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Search,
  Package,
  Heart,
  BarChart3,
  type LucideIcon,
} from 'lucide-react';
import type { Role } from '@/auth/schema-types';

type Tab = { href: string; label: string; Icon: LucideIcon; staffOnly?: boolean };

const TABS: Tab[] = [
  { href: '/',             label: 'Start',    Icon: LayoutDashboard },
  { href: '/ankauf',       label: 'Suche',    Icon: Search,    staffOnly: true },
  { href: '/inventar',     label: 'Bestand',  Icon: Package },
  { href: '/wunschlisten', label: 'Wunsch',   Icon: Heart,     staffOnly: true },
  { href: '/analytik',     label: 'Analytik', Icon: BarChart3 },
];

export function BottomTabBar({ role }: { role: Role }) {
  const pathname = usePathname();
  const isStaff = role !== 'kunde';
  const tabs = TABS.filter((t) => !t.staffOnly || isStaff);

  return (
    <nav
      aria-label="Mobile Navigation"
      className="app-tabbar"
      data-testid="bottom-tabbar"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 35,
        display: 'flex',
        padding: '8px 8px calc(8px + env(safe-area-inset-bottom))',
        background: 'color-mix(in srgb, var(--surface) 82%, transparent)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderTop: '1px solid var(--border)',
      }}
    >
      {tabs.map(({ href, label, Icon }) => {
        const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={isActive ? 'page' : undefined}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 3,
              padding: '6px 0',
              textDecoration: 'none',
              color: isActive ? 'var(--accent-ink)' : 'var(--text-3)',
              fontWeight: isActive ? 700 : 600,
              fontSize: '10.5px',
            }}
          >
            <Icon size={20} aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
```
Hinweis: Stimmt der `Role`-Importpfad nicht (`@/auth/schema-types`), die Import-Zeile aus `SidebarNav.tsx` übernehmen — NICHT den Typ neu definieren.

- [ ] **Step 5: MobileHeader + MobileChrome implementieren**

`src/app/(app)/_components/MobileHeader.tsx` (KOMPLETT):
```tsx
'use client';

// Mobiler Sticky-Header (C3): Route-Titel-Map + ThemeToggle + optionaler €-FAB.
// Der FAB erscheint erst, wenn MobileChrome onSchnellverkauf übergibt (Task 7).

import { usePathname } from 'next/navigation';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import type { Role } from '@/auth/schema-types';

type TitleEntry = {
  match: (pathname: string) => boolean;
  title: string;
  subtitle: (tenantName: string) => string;
};

const dateDE = () =>
  new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }).format(
    new Date(),
  );

const TITLES: TitleEntry[] = [
  { match: (p) => p === '/', title: 'Moin!', subtitle: (t) => `${dateDE()} · ${t}` },
  { match: (p) => p.startsWith('/ankauf'), title: 'Discogs-Suche', subtitle: () => 'Releases finden & ankaufen' },
  { match: (p) => p.startsWith('/inventar'), title: 'Lagerbestand', subtitle: () => 'Artikel & Status' },
  { match: (p) => p.startsWith('/wunschlisten'), title: 'Wunschlisten', subtitle: () => 'Kundenwünsche & Treffer' },
  { match: (p) => p.startsWith('/analytik'), title: 'Analytik', subtitle: (t) => `Auswertungen · ${t}` },
];

export interface MobileHeaderProps {
  role: Role;
  tenantName: string;
  /** FAB rendert nur, wenn gesetzt UND role !== 'kunde' (C3; Task 7 verdrahtet ihn). */
  onSchnellverkauf?: () => void;
}

export function MobileHeader({ role, tenantName, onSchnellverkauf }: MobileHeaderProps) {
  const pathname = usePathname();
  const entry = TITLES.find((t) => t.match(pathname));
  const title = entry?.title ?? 'q·records';
  const subtitle = entry ? entry.subtitle(tenantName) : tenantName;
  const showFab = onSchnellverkauf !== undefined && role !== 'kunde';

  return (
    <header
      className="app-header-mobile"
      data-testid="mobile-header"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 30,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '12px 16px',
        background: 'color-mix(in srgb, var(--surface) 88%, transparent)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0, lineHeight: 1.15 }}>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            fontSize: 22,
            letterSpacing: '-.02em',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {title}
        </div>
        {/* suppressHydrationWarning: dateDE() kann über Mitternacht SSR/CSR divergieren */}
        <div
          suppressHydrationWarning
          style={{ fontSize: '11.5px', color: 'var(--text-3)', fontWeight: 500 }}
        >
          {subtitle}
        </div>
      </div>
      <ThemeToggle />
      {showFab && (
        <button
          type="button"
          aria-label="Schnellverkauf"
          data-testid="fab-schnellverkauf"
          onClick={onSchnellverkauf}
          className="focus-ring-button"
          style={{
            width: 38,
            height: 38,
            borderRadius: '50%',
            border: 'none',
            background: 'var(--accent)',
            color: 'var(--on-accent)',
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: 19,
            cursor: 'pointer',
            display: 'grid',
            placeItems: 'center',
            flexShrink: 0,
          }}
        >
          €
        </button>
      )}
    </header>
  );
}
```

`src/app/(app)/_components/MobileChrome.tsx` (KOMPLETT — Task 7 erweitert diese Datei):
```tsx
'use client';

// Client-Klammer für die mobilen Shell-Teile mit State.
// Task 3: nur MobileHeader. Task 7: + VerkaufSheet-State und onSchnellverkauf.

import { MobileHeader } from './MobileHeader';
import type { Role } from '@/auth/schema-types';

export function MobileChrome({ role, tenantName }: { role: Role; tenantName: string }) {
  return <MobileHeader role={role} tenantName={tenantName} />;
}
```

- [ ] **Step 6: Layout verdrahten (4 additive Edits)**

`src/app/(app)/layout.tsx`:
1. Imports ergänzen:
```tsx
import { BottomTabBar } from './_components/BottomTabBar';
import { MobileChrome } from './_components/MobileChrome';
```
2. `<aside style={{ …` → `<aside className="app-sidebar" style={{ …` (Inline-Styles unverändert).
3. Topbar-`<header style={{ …` → `<header className="app-topbar-desktop" style={{ …`.
4. `<main style={{ flex: 1, padding: 'clamp(18px,3vw,32px)' }}>` → `<main className="app-main" style={{ flex: 1, padding: 'clamp(18px,3vw,32px)' }}>`.
5. In der Main-Spalte (`<div style={{ flex: 1, minWidth: 0, … }}>`) als ERSTES Kind vor dem Topbar-`<header>`:
```tsx
        <MobileChrome role={user.role} tenantName={tenant.name} />
```
6. Direkt vor dem schließenden Tag des Root-Flex-`<div>` (nach der Main-Spalte):
```tsx
      <BottomTabBar role={user.role} />
```

- [ ] **Step 7: Page-Header mobil ausblenden (exakt 2 Dateien)**

In `analytik/page.tsx` und `wunschlisten/page.tsx`: `<header style={{ …` → `<header className="qr-page-header" style={{ …`. (Der MobileHeader übernimmt mobil Titel + Untertitel; Desktop unverändert.) Hinweis: `ankauf/sammlung/page.tsx` und `ankauf/sammlungen/page.tsx` haben EBENFALLS `<header>`-Blöcke — die behalten sie ABSICHTLICH (Unterseiten ohne eigenen MobileHeader-Titel; dort wäre das Ausblenden ein Informationsverlust). NUR die zwei genannten Dateien anfassen.

- [ ] **Step 8: Tests laufen lassen — müssen PASSEN**

Run: `pnpm vitest run tests/ui/bottom-tabbar.test.tsx tests/ui/mobile-header.test.tsx && pnpm typecheck && pnpm lint`
Expected: PASS + grün. Schnelle Sichtprüfung (Stack läuft): `curl -s http://demo.localhost:3000/login | grep -c app-tabbar` → `0` ist OK (Login liegt außerhalb `(app)`).

- [ ] **Step 9: Commit**

```bash
git add src/styles/globals.css "src/app/(app)/layout.tsx" "src/app/(app)/_components/BottomTabBar.tsx" "src/app/(app)/_components/MobileHeader.tsx" "src/app/(app)/_components/MobileChrome.tsx" "src/app/(app)/analytik/page.tsx" "src/app/(app)/wunschlisten/page.tsx" tests/ui/bottom-tabbar.test.tsx tests/ui/mobile-header.test.tsx
git commit -m "feat(slice5): responsive Shell — Bottom-Tab-Bar, Mobile-Header, CSS-Breakpoint 768px

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: ScannerSheet (Kamera + Dekodierung + Fallback)

**Files:**
- Create: `src/components/scanner/ScannerSheet.tsx`
- Modify: `package.json` (dependency `barcode-detector`)
- Test: `tests/ui/scanner-sheet.test.tsx`

**Interfaces:**
- Consumes: `Sheet` (`@/components/ui/Sheet`, `side='bottom'`); `parseDiscogsReleaseUrl` (Task 1).
- Produces (C8): `ScannerSheet({ open, onClose, mode, onDetectEan?, onDetectRelease? })` — Fehlertexte, Testids und Formate EXAKT nach C8. `barcode-detector/ponyfill` wird NUR nach erfolgreichem Kamera-Start dynamisch importiert (in jsdom/Headless nie erreicht — Tests treffen den Fallback).

- [ ] **Step 1: Dependency installieren**

Run: `pnpm add barcode-detector@^3`
Expected: `package.json` dependencies enthalten `"barcode-detector": "^3.x"`.

Dann den Import-Pfad VERIFIZIEREN (Plan-Annahme absichern):
Run: `node -e "import('barcode-detector/ponyfill').then((m) => console.log(typeof m.BarcodeDetector))"`
Expected: `function`. Weicht das ab: `exports`-Feld in `node_modules/barcode-detector/package.json` nachschlagen und den dortigen Ponyfill-Subpfad in Step 4 verwenden.

- [ ] **Step 2: Failing RTL-Test schreiben**

`tests/ui/scanner-sheet.test.tsx`:
```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScannerSheet } from '@/components/scanner/ScannerSheet';

afterEach(cleanup);

// jsdom hat kein navigator.mediaDevices → der Kein-Kamera-Pfad ist der Default.
describe('ScannerSheet (C8) — Fallback-Pfade', () => {
  it('ohne Kamera: exakter Fehlertext + manuelles Feld (mode=ean)', async () => {
    render(<ScannerSheet open mode="ean" onClose={() => {}} onDetectEan={() => {}} />);
    expect(
      await screen.findByText('Keine Kamera verfügbar — Code unten manuell eingeben.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('EAN/UPC manuell eingeben')).toBeInTheDocument();
  });

  it('manueller EAN wird getrimmt an onDetectEan gereicht', async () => {
    const user = userEvent.setup();
    const onDetect = vi.fn();
    render(<ScannerSheet open mode="ean" onClose={() => {}} onDetectEan={onDetect} />);
    await user.type(screen.getByLabelText('EAN/UPC manuell eingeben'), ' 4988031234567 ');
    await user.click(screen.getByRole('button', { name: 'Suchen' }));
    // Vitest 2.x: toHaveBeenCalledExactlyOnceWith gibt es erst ab v3 — Paar-Muster nutzen.
    expect(onDetect).toHaveBeenCalledOnce();
    expect(onDetect).toHaveBeenCalledWith('4988031234567');
  });

  it('ungültiger EAN → Inline-Fehler, kein Callback', async () => {
    const user = userEvent.setup();
    const onDetect = vi.fn();
    render(<ScannerSheet open mode="ean" onClose={() => {}} onDetectEan={onDetect} />);
    await user.type(screen.getByLabelText('EAN/UPC manuell eingeben'), '123');
    await user.click(screen.getByRole('button', { name: 'Suchen' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Ungültiger Barcode — 8 bis 14 Ziffern.');
    expect(onDetect).not.toHaveBeenCalled();
  });

  it('mode=label: KEIN manuelles Feld, stattdessen Hinweis auf Artikel-Suche', async () => {
    render(<ScannerSheet open mode="label" onClose={() => {}} onDetectRelease={() => {}} />);
    expect(
      await screen.findByText('Nutze stattdessen die Artikel-Suche im Schnellverkauf.'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('EAN/UPC manuell eingeben')).toBeNull();
  });

  it('open=false rendert nichts', () => {
    render(<ScannerSheet open={false} mode="ean" onClose={() => {}} />);
    expect(screen.queryByTestId('scanner-sheet')).toBeNull();
  });
});
```

- [ ] **Step 3: Test laufen lassen — muss FAILEN**

Run: `pnpm vitest run tests/ui/scanner-sheet.test.tsx`
Expected: FAIL — Modul nicht gefunden.

- [ ] **Step 4: ScannerSheet implementieren**

`src/components/scanner/ScannerSheet.tsx` (KOMPLETT):
```tsx
'use client';

// Kamera-Scanner-Bottom-Sheet (C8). Zwei Modi:
//   'ean'   → EAN/UPC erkennen (oder manuell eingeben) → onDetectEan(ean)
//   'label' → Etiketten-QR (Discogs-Release-URL, Slice 4) → onDetectRelease(releaseId)
// barcode-detector (zxing-wasm) ist schwer → dynamic import NUR nach Kamera-Start
// (Global Constraint 6). Der Stream wird über stopStream() in JEDEM Pfad beendet.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Sheet } from '@/components/ui/Sheet';
import { parseDiscogsReleaseUrl } from '@/lib/discogs/parse';

const EAN_RE = /^\d{8,14}$/;
const EAN_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'] as const;

export interface ScannerSheetProps {
  open: boolean;
  onClose: () => void;
  mode: 'ean' | 'label';
  /** mode='ean': erkannter/manuell eingegebener EAN/UPC (8–14 Ziffern, getrimmt). */
  onDetectEan?: (ean: string) => void;
  /** mode='label': via QR aufgelöste Discogs-Release-ID (> 0). */
  onDetectRelease?: (releaseId: number) => void;
}

export function ScannerSheet({ open, onClose, mode, onDetectEan, onDetectRelease }: ScannerSheetProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanHint, setScanHint] = useState<string | null>(null);
  const [manualValue, setManualValue] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (!open) return;
    setCameraError(null);
    setScanHint(null);
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | undefined;

    void (async () => {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setCameraError('Keine Kamera verfügbar — Code unten manuell eingeben.');
        return;
      }
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
      } catch (err) {
        setCameraError(
          err instanceof DOMException && err.name === 'NotAllowedError'
            ? 'Kamera-Zugriff verweigert — bitte in den Browser-Einstellungen erlauben.'
            : 'Keine Kamera verfügbar — Code unten manuell eingeben.',
        );
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => undefined);
      }

      const { BarcodeDetector } = await import('barcode-detector/ponyfill');
      const detector = new BarcodeDetector({ formats: [...EAN_FORMATS, 'qr_code'] });
      intervalId = setInterval(() => {
        void (async () => {
          const v = videoRef.current;
          if (!v || v.readyState < 2) return;
          let codes: Awaited<ReturnType<typeof detector.detect>>;
          try {
            codes = await detector.detect(v);
          } catch {
            return;
          }
          for (const code of codes) {
            if (mode === 'ean' && (EAN_FORMATS as readonly string[]).includes(code.format)) {
              const value = code.rawValue.trim();
              if (EAN_RE.test(value)) {
                stopStream();
                onDetectEan?.(value);
                return;
              }
            }
            if (mode === 'label' && code.format === 'qr_code') {
              const releaseId = parseDiscogsReleaseUrl(code.rawValue);
              if (releaseId !== null) {
                stopStream();
                onDetectRelease?.(releaseId);
                return;
              }
              setScanHint('Kein Q-Records-Etikett erkannt.');
            }
          }
        })();
      }, 250);
    })();

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
      stopStream();
    };
  }, [open, mode, onDetectEan, onDetectRelease, stopStream]);

  const handleManualSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const value = manualValue.trim();
    if (!EAN_RE.test(value)) {
      setManualError('Ungültiger Barcode — 8 bis 14 Ziffern.');
      return;
    }
    setManualError(null);
    stopStream();
    onDetectEan?.(value);
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      side="bottom"
      title={mode === 'ean' ? 'Barcode scannen' : 'Etikett scannen'}
    >
      <div data-testid="scanner-sheet" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Drag-Handle-Optik (statisch, Handoff Z. 335ff) */}
        <div
          aria-hidden="true"
          style={{
            width: 40, height: 4, borderRadius: 'var(--r-pill)',
            background: 'var(--border-strong)', margin: '0 auto',
          }}
        />
        {/* Viewfinder */}
        {cameraError === null && (
          <video
            ref={videoRef}
            muted
            playsInline
            style={{
              width: '100%', aspectRatio: '4 / 3', objectFit: 'cover',
              borderRadius: 'var(--r-lg)', background: 'var(--n-950)',
            }}
          />
        )}
        {cameraError !== null && (
          <p
            role="alert"
            style={{
              margin: 0, padding: '10px 14px', borderRadius: 'var(--r-md)',
              background: 'var(--warn-soft)', color: 'var(--warn)',
              border: '1px solid color-mix(in srgb, var(--warn) 30%, transparent)',
              fontSize: 13.5,
            }}
          >
            {cameraError}
          </p>
        )}
        {scanHint !== null && (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-3)' }}>{scanHint}</p>
        )}

        {mode === 'ean' ? (
          <form onSubmit={handleManualSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <span style={{ fontWeight: 600, fontSize: 13.5 }}>EAN/UPC manuell eingeben</span>
              <input
                type="text"
                inputMode="numeric"
                data-testid="scanner-manual-input"
                value={manualValue}
                onChange={(e) => setManualValue(e.target.value)}
                placeholder="z. B. 4988031234567"
                style={{
                  width: '100%', minHeight: 'var(--tap)', padding: '0 14px',
                  border: '1.5px solid var(--border-strong)', borderRadius: 'var(--r-md)',
                  background: 'var(--surface-2)', color: 'var(--text)',
                  fontFamily: 'var(--font-mono)', fontSize: 15,
                }}
              />
            </label>
            {manualError !== null && (
              <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--bad)' }}>
                {manualError}
              </p>
            )}
            <button
              type="submit"
              data-testid="scanner-manual-submit"
              className="focus-ring-button"
              style={{
                minHeight: 'var(--tap)', border: 'none', borderRadius: 'var(--r-pill)',
                background: 'var(--accent)', color: 'var(--on-accent)',
                fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14.5, cursor: 'pointer',
              }}
            >
              Suchen
            </button>
          </form>
        ) : (
          cameraError !== null && (
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-2)' }}>
              Nutze stattdessen die Artikel-Suche im Schnellverkauf.
            </p>
          )
        )}
      </div>
    </Sheet>
  );
}
```

- [ ] **Step 5: Tests laufen lassen — müssen PASSEN**

Run: `pnpm vitest run tests/ui/scanner-sheet.test.tsx && pnpm typecheck && pnpm lint`
Expected: PASS + grün.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/components/scanner/ScannerSheet.tsx tests/ui/scanner-sheet.test.tsx
git commit -m "feat(slice5): ScannerSheet — Kamera-Viewfinder, barcode-detector (dynamic import), Fallback-Pfade

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Suche-Screen — Barcode-Flow + AnkaufModal-Sheet-Präsentation

**Files:**
- Modify: `src/app/(app)/ankauf/_components/SearchForm.tsx` (C13), `src/app/(app)/ankauf/_components/AnkaufModal.tsx` (nur C10-Klassen)
- Test: `tests/ui/search-form-barcode.test.tsx`

**Interfaces:**
- Consumes: `ScannerSheet` (Task 4); `searchDiscogsByBarcode` (Task 2); bestehende `searchState`/`ResultsGrid`-Pfade in SearchForm.
- Produces: aktiver Scanner-Button (`aria-label="Barcode scannen"`) im Suchformular; `?barcode=`-Query-Param feuert die Barcode-Suche einmalig beim Mount (Konsument: QuickActions, Task 7).

- [ ] **Step 1: Failing RTL-Test schreiben**

`tests/ui/search-form-barcode.test.tsx`:
```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DiscogsSearchResult } from '@/lib/discogs/types';

const fixture = (id: number, title: string): DiscogsSearchResult => ({
  discogsId: id, title, artist: 'Miles Davis', country: 'US', year: 1959,
  format: 'Vinyl', genre: ['Jazz'], label: ['Columbia'], coverImage: null,
  community: { want: 1, have: 1 }, median: 24.99,
});

const searchByBarcodeMock = vi.fn();
vi.mock('@/app/(app)/ankauf/actions', () => ({
  searchDiscogs: vi.fn(async () => ({ ok: true, results: [] })),
  searchDiscogsByBarcode: (b: string) => searchByBarcodeMock(b),
  getPriceSuggestion: vi.fn(async () => ({ ok: true, suggestion: null, median: null })),
  ankaufRecord: vi.fn(async () => ({ ok: true, recordId: 1, purchaseId: 1 })),
  disconnectDiscogs: vi.fn(async () => undefined),
}));

// ScannerSheet-Stub: Button feuert onDetectEan mit dem Fake-Treffer-EAN.
vi.mock('@/components/scanner/ScannerSheet', () => ({
  ScannerSheet: ({ open, onDetectEan }: { open: boolean; onDetectEan?: (e: string) => void }) =>
    open ? (
      <button type="button" onClick={() => onDetectEan?.('4988031234567')}>
        stub-detect
      </button>
    ) : null,
}));

let searchParams = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParams,
}));

import { SearchForm } from '@/app/(app)/ankauf/_components/SearchForm';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  searchParams = new URLSearchParams();
});

describe('SearchForm Barcode-Flow (C13)', () => {
  it('Scanner-Button öffnet Sheet; Detect → Barcode-Suche → Treffer gerendert', async () => {
    const user = userEvent.setup();
    searchByBarcodeMock.mockResolvedValue({
      ok: true,
      results: [fixture(11111, 'Kind of Blue'), fixture(22222, 'Abbey Road')],
    });
    render(<SearchForm connected username="demo" />);
    await user.click(screen.getByRole('button', { name: 'Barcode scannen' }));
    await user.click(await screen.findByRole('button', { name: 'stub-detect' }));
    expect(searchByBarcodeMock).toHaveBeenCalledOnce();
    expect(searchByBarcodeMock).toHaveBeenCalledWith('4988031234567');
    expect(await screen.findByText('Kind of Blue')).toBeInTheDocument();
    expect(screen.getAllByTestId('discogs-result-card')).toHaveLength(2);
  });

  it('validation-Fehler → exakter deutscher Fehlertext', async () => {
    const user = userEvent.setup();
    searchByBarcodeMock.mockResolvedValue({ ok: false, reason: 'validation' });
    render(<SearchForm connected username="demo" />);
    await user.click(screen.getByRole('button', { name: 'Barcode scannen' }));
    await user.click(await screen.findByRole('button', { name: 'stub-detect' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ungültiger Barcode — 8 bis 14 Ziffern.',
    );
  });

  it('?barcode=-Param feuert die Suche genau einmal beim Mount (C12→C13)', async () => {
    searchByBarcodeMock.mockResolvedValue({ ok: true, results: [fixture(11111, 'Kind of Blue')] });
    searchParams = new URLSearchParams('barcode=4988031234567');
    render(<SearchForm connected username="demo" />);
    expect(await screen.findByText('Kind of Blue')).toBeInTheDocument();
    expect(searchByBarcodeMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss FAILEN**

Run: `pnpm vitest run tests/ui/search-form-barcode.test.tsx`
Expected: FAIL — Button `Barcode scannen` ist disabled/nicht klickbar, `searchDiscogsByBarcode` wird nie gerufen.

- [ ] **Step 3: SearchForm umbauen**

`src/app/(app)/ankauf/_components/SearchForm.tsx` — Änderungen:

1. Imports ergänzen/ändern:
```tsx
import { useEffect, useRef, useState, useTransition } from 'react';
import { useSearchParams } from 'next/navigation';
import { ScanLine } from 'lucide-react';
import { searchDiscogs, searchDiscogsByBarcode } from '../actions';
import { ScannerSheet } from '@/components/scanner/ScannerSheet';
```
2. `SearchState`-Error-Union + Meldung erweitern:
```tsx
type SearchState =
  | { status: 'idle' }
  | { status: 'results'; results: DiscogsSearchResult[] }
  | { status: 'error'; reason: 'not_connected' | 'auth' | 'validation' | 'error' };

const ERROR_MESSAGES: Record<'not_connected' | 'auth' | 'validation' | 'error', string> = {
  not_connected: 'Discogs nicht verbunden. Bitte verbinde zuerst dein Konto.',
  auth: 'Discogs-Verbindung abgelaufen. Bitte erneut verbinden.',
  validation: 'Ungültiger Barcode — 8 bis 14 Ziffern.',
  error: 'Fehler bei der Discogs-Suche. Bitte später erneut versuchen.',
};
```
3. Im Komponenten-Body ergänzen:
```tsx
  const [scannerOpen, setScannerOpen] = useState(false);
  const searchParams = useSearchParams();
  const bootBarcodeFired = useRef(false);

  const runBarcodeSearch = (ean: string) => {
    startTransition(async () => {
      const res = await searchDiscogsByBarcode(ean);
      if (res.ok) {
        setSearchState({ status: 'results', results: res.results });
      } else {
        setSearchState({ status: 'error', reason: res.reason });
      }
    });
  };

  // C12→C13: Quick-Action "Scannen" landet auf /ankauf?barcode=… → einmalig suchen.
  useEffect(() => {
    if (bootBarcodeFired.current) return;
    bootBarcodeFired.current = true;
    const b = searchParams.get('barcode');
    if (b) runBarcodeSearch(b);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```
4. Den kompletten Platzhalter-Button (`{/* Barcode scanner — disabled placeholder (future feature) */}` bis `</button>`) ERSETZEN durch:
```tsx
          {/* Barcode scanner (Slice 5, C13) */}
          <button
            type="button"
            aria-label="Barcode scannen"
            onClick={() => setScannerOpen(true)}
            className="focus-ring-button"
            style={{
              flexShrink: 0,
              width: 'var(--tap)',
              height: 'var(--tap)',
              border: 'none',
              borderRadius: 'var(--r-md)',
              background: 'var(--surface-3)',
              color: 'var(--text-2)',
              display: 'grid',
              placeItems: 'center',
              cursor: 'pointer',
            }}
          >
            <ScanLine size={20} aria-hidden="true" />
          </button>
```
5. Vor dem `{/* ── Ankauf modal … ── */}`-Block einfügen:
```tsx
      <ScannerSheet
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        mode="ean"
        onDetectEan={(ean) => {
          setScannerOpen(false);
          runBarcodeSearch(ean);
        }}
      />
```

- [ ] **Step 4: AnkaufModal C10-Klassen setzen**

`src/app/(app)/ankauf/_components/AnkaufModal.tsx`: das Backdrop-`<div>` (Portal-Wurzel, `position: fixed; inset: 0`) erhält zusätzlich `className="qr-modal-backdrop"`, das Dialog-`<div>` (`role="dialog"`) `className="qr-modal-card"`. KEINE weiteren Änderungen (C10 — Desktop byte-gleich).

- [ ] **Step 5: Tests laufen lassen — müssen PASSEN**

Run: `pnpm vitest run tests/ui/search-form-barcode.test.tsx tests/ui/scanner-sheet.test.tsx && pnpm typecheck && pnpm lint`
Expected: PASS + grün (scanner-sheet.test erneut, um Regressionen durch den Stub auszuschließen).

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/ankauf/_components/SearchForm.tsx" "src/app/(app)/ankauf/_components/AnkaufModal.tsx" tests/ui/search-form-barcode.test.tsx
git commit -m "feat(slice5): Barcode-Scan in der Discogs-Suche + Ankauf-Modal als Mobile-Sheet

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Bestand mobil — Etiketten-Scan, Mobile-Karten, SellModal-Sheet

**Files:**
- Modify: `src/app/(app)/inventar/_components/FilterBar.tsx` (Etiketten-Scan-Flow), `src/app/(app)/inventar/_components/InventoryList.tsx` (Mobile-Karten), `src/app/(app)/inventar/_components/SellModal.tsx` (nur C10-Klassen), `src/app/(app)/inventar/_components/StatusTabs.tsx` (nur `qr-chips-scroll`)
- Test: `tests/ui/filterbar-labelscan.test.tsx`

**Interfaces:**
- Consumes: `ScannerSheet` (Task 4); `findAvailableCopiesByRelease` + `CopyHit` aus `@/app/(app)/kasse/actions` (Task 2); `SellModal` (existiert); `setSellRow`-Muster in InventoryList (existiert).
- Produces: aktiver Etiketten-Scan-Button (`aria-label="Etikett scannen"`) in der FilterBar; Mobile-Karten mit `data-testid="inventory-mobile-card"` und je einem `Verkaufen`-Button (Konsument: E2E Szenario 4).

- [ ] **Step 1: Failing RTL-Test schreiben**

`tests/ui/filterbar-labelscan.test.tsx`:
```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const findCopiesMock = vi.fn();
vi.mock('@/app/(app)/kasse/actions', () => ({
  findAvailableCopiesByRelease: (id: number) => findCopiesMock(id),
  searchAvailableCopies: vi.fn(async () => ({ ok: true, copies: [] })),
  createSale: vi.fn(),
}));
vi.mock('@/components/scanner/ScannerSheet', () => ({
  ScannerSheet: ({ open, onDetectRelease }: { open: boolean; onDetectRelease?: (id: number) => void }) =>
    open ? (
      <button type="button" onClick={() => onDetectRelease?.(11111)}>stub-scan</button>
    ) : null,
}));
vi.mock('@/app/(app)/inventar/_components/SellModal', () => ({
  SellModal: ({ purchaseId }: { purchaseId: number }) => (
    <div data-testid="sell-modal-stub">{purchaseId}</div>
  ),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/inventar',
  useSearchParams: () => new URLSearchParams(),
}));

import { FilterBar } from '@/app/(app)/inventar/_components/FilterBar';

const copy = (purchaseId: number) => ({
  purchaseId, title: 'Kind of Blue', artist: 'Miles Davis',
  targetPrice: '22.50', conditionRecord: 5, conditionCover: 4,
});
const props = { genreOptions: [], resultCount: 0, valueAvailable: 0 };

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('FilterBar Etiketten-Scan (Bestand → Verkauf)', () => {
  it('genau 1 Exemplar → SellModal direkt', async () => {
    const user = userEvent.setup();
    findCopiesMock.mockResolvedValue({ ok: true, copies: [copy(7)] });
    render(<FilterBar {...props} />);
    await user.click(screen.getByRole('button', { name: 'Etikett scannen' }));
    await user.click(await screen.findByRole('button', { name: 'stub-scan' }));
    expect(await screen.findByTestId('sell-modal-stub')).toHaveTextContent('7');
    expect(findCopiesMock).toHaveBeenCalledOnce();
    expect(findCopiesMock).toHaveBeenCalledWith(11111);
  });

  it('mehrere Exemplare → Picker → Auswahl → SellModal', async () => {
    const user = userEvent.setup();
    findCopiesMock.mockResolvedValue({ ok: true, copies: [copy(7), copy(8)] });
    render(<FilterBar {...props} />);
    await user.click(screen.getByRole('button', { name: 'Etikett scannen' }));
    await user.click(await screen.findByRole('button', { name: 'stub-scan' }));
    const picker = await screen.findByTestId('labelscan-picker');
    expect(picker).toHaveTextContent('Mehrere Exemplare — welches verkaufen?');
    const entries = screen.getAllByRole('button', { name: /Miles Davis – Kind of Blue/ });
    expect(entries).toHaveLength(2);
    await user.click(entries[1]!);
    expect(await screen.findByTestId('sell-modal-stub')).toBeInTheDocument();
  });

  it('0 Exemplare → exakte Meldung', async () => {
    const user = userEvent.setup();
    findCopiesMock.mockResolvedValue({ ok: true, copies: [] });
    render(<FilterBar {...props} />);
    await user.click(screen.getByRole('button', { name: 'Etikett scannen' }));
    await user.click(await screen.findByRole('button', { name: 'stub-scan' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Kein verfügbares Exemplar zu diesem Release im Bestand.',
    );
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss FAILEN**

Run: `pnpm vitest run tests/ui/filterbar-labelscan.test.tsx`
Expected: FAIL — Button `Etikett scannen` existiert nicht (Platzhalter ist disabled + heißt „Barcode scannen").

- [ ] **Step 3: FilterBar umbauen**

`src/app/(app)/inventar/_components/FilterBar.tsx`:

1. Imports ergänzen:
```tsx
import { ScanLine } from 'lucide-react';
import { ScannerSheet } from '@/components/scanner/ScannerSheet';
import { SellModal } from './SellModal';
import { findAvailableCopiesByRelease, type CopyHit } from '@/app/(app)/kasse/actions';
```
2. Im Komponenten-Body:
```tsx
  const [labelScanOpen, setLabelScanOpen] = useState(false);
  const [scanCopies, setScanCopies] = useState<CopyHit[] | null>(null);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [sellCopy, setSellCopy] = useState<CopyHit | null>(null);

  const handleRelease = async (releaseId: number) => {
    setLabelScanOpen(false);
    setScanMessage(null);
    setScanCopies(null);
    const res = await findAvailableCopiesByRelease(releaseId);
    if (!res.ok) {
      setScanMessage('Fehler beim Nachschlagen. Bitte erneut versuchen.');
      return;
    }
    if (res.copies.length === 0) {
      setScanMessage('Kein verfügbares Exemplar zu diesem Release im Bestand.');
      return;
    }
    if (res.copies.length === 1) {
      setSellCopy(res.copies[0]!);
      return;
    }
    setScanCopies(res.copies);
  };
```
3. Den kompletten disabled-Platzhalter-Button (`{/* Barcode scanner — disabled placeholder (Slice 5) */}` bis `</button>`) ERSETZEN durch:
```tsx
        {/* Etiketten-Scan (Slice 5): QR auf dem Preisetikett → Exemplar → SellModal */}
        <button
          type="button"
          aria-label="Etikett scannen"
          onClick={() => setLabelScanOpen(true)}
          className="focus-ring-button"
          style={{
            flexShrink: 0,
            width: 'var(--tap)',
            height: 'var(--tap)',
            border: 'none',
            borderRadius: 'var(--r-md)',
            background: 'var(--surface-3)',
            color: 'var(--text-2)',
            display: 'grid',
            placeItems: 'center',
            cursor: 'pointer',
          }}
        >
          <ScanLine size={20} aria-hidden="true" />
        </button>
```
4. Direkt VOR dem schließenden Wurzel-`</div>` der Komponente einfügen:
```tsx
      {scanMessage !== null && (
        <p
          role="alert"
          style={{
            margin: 0, padding: '10px 14px', borderRadius: 'var(--r-md)',
            background: 'var(--warn-soft)', color: 'var(--warn)',
            border: '1px solid color-mix(in srgb, var(--warn) 30%, transparent)', fontSize: 13.5,
          }}
        >
          {scanMessage}
        </p>
      )}
      {scanCopies !== null && (
        <div data-testid="labelscan-picker" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>Mehrere Exemplare — welches verkaufen?</span>
          {scanCopies.map((c) => (
            <button
              key={c.purchaseId}
              type="button"
              onClick={() => { setScanCopies(null); setSellCopy(c); }}
              style={{
                width: '100%', textAlign: 'left', padding: '8px 10px',
                border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
                background: 'var(--surface)', cursor: 'pointer',
              }}
            >
              {c.artist} – {c.title} · {c.targetPrice ?? '—'} €
            </button>
          ))}
        </div>
      )}
      {sellCopy !== null && (
        <SellModal
          purchaseId={sellCopy.purchaseId}
          title={sellCopy.title}
          artist={sellCopy.artist}
          targetPrice={sellCopy.targetPrice}
          onClose={() => setSellCopy(null)}
        />
      )}
      <ScannerSheet
        open={labelScanOpen}
        onClose={() => setLabelScanOpen(false)}
        mode="label"
        onDetectRelease={(id) => { void handleRelease(id); }}
      />
```

- [ ] **Step 4: InventoryList Mobile-Karten + SellModal/StatusTabs-Klassen**

`src/app/(app)/inventar/_components/InventoryList.tsx`:
1. Das Element, das die `<table>` direkt umschließt, erhält zusätzlich `className="qr-desktop-only"` (umgibt kein Element die Tabelle, die `<table>` in ein `<div className="qr-desktop-only">` wrappen — Desktop rendert identisch, die Klasse greift nur mobil).
2. Direkt VOR diesem Tabellen-Wrapper einfügen (nutzt vorhandene Imports `StatusBadge`, `ConditionPill`, `Condition`, `setSellRow`):
```tsx
      {/* Mobile Karten-Liste (Slice 5) — Desktop-Tabelle unverändert daneben (qr-desktop-only) */}
      <div className="qr-mobile-only" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map((row) => {
          const sellable = row.status === 'verfuegbar' || row.status === 'reserviert';
          return (
            <div
              key={row.copyId}
              data-testid="inventory-mobile-card"
              style={{
                border: '1px solid var(--border)', borderRadius: 'var(--r-lg)',
                background: 'var(--surface)', boxShadow: 'var(--shadow-1)',
                padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <span style={{ minWidth: 0 }}>
                  <strong style={{ fontWeight: 700 }}>{row.title}</strong>
                  <br />
                  <span style={{ color: 'var(--text-2)', fontSize: 13 }}>{row.artist}</span>
                </span>
                <StatusBadge status={row.status} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {row.conditionRecord !== null && (
                  <ConditionPill condition={row.conditionRecord as Condition} />
                )}
                {row.format && (
                  <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{row.format}</span>
                )}
                <span
                  style={{
                    marginLeft: 'auto', fontFamily: 'var(--font-mono)',
                    fontWeight: 700, fontSize: 14,
                  }}
                >
                  {row.vk ?? '—'}
                </span>
                <button
                  type="button"
                  disabled={!sellable}
                  onClick={() => sellable && setSellRow(row)}
                  style={{
                    minHeight: 34, padding: '0 14px', border: 'none',
                    borderRadius: 'var(--r-pill)',
                    background: sellable ? 'var(--accent)' : 'var(--surface-3)',
                    color: sellable ? 'var(--on-accent)' : 'var(--text-3)',
                    fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: '12.5px',
                    cursor: sellable ? 'pointer' : 'not-allowed',
                  }}
                >
                  {row.status === 'verkauft' ? 'Verkauft' : 'Verkaufen'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
```
(Etikettendruck-Checkboxen bleiben bewusst Desktop-only — A4-PDF-Druck ist ein Desktop-Workflow; Spec §5.3.)

**ACHTUNG Bestandstest:** jsdom wertet keine Media-Queries aus — nach dieser Änderung existieren Titel/VK/Status/`Verkaufen`-Button jeder Zeile DOPPELT im DOM (Tabelle + Mobile-Karte). Die bestehende `tests/inventar/lagerbestand.test.tsx` bricht dadurch mit „multiple elements"-Fehlern. Das ist ERWARTET und wird dort gefixt (nicht die Mobile-Karten abschwächen): mehrdeutige Queries auf die Tabelle scopen — `within(screen.getByRole('table')).getByText(…)` bzw. `getAllBy*`-Varianten mit Längen-Assertion. `within` kommt aus `@testing-library/react`.

`src/app/(app)/inventar/_components/SellModal.tsx`: Backdrop-`<div>` (`position: 'fixed', inset: 0`) → zusätzlich `className="qr-modal-backdrop"`; Dialog-`<div>` (`role="dialog"`) → `className="qr-modal-card"`. Sonst nichts (C10).

`src/app/(app)/inventar/_components/StatusTabs.tsx`: das äußerste Container-Element der Tab-Buttons erhält zusätzlich `className="qr-chips-scroll"` (horizontales Scrollen mit Edge-Bleed mobil; Desktop unverändert).

- [ ] **Step 5: Tests laufen lassen — müssen PASSEN**

Run: `pnpm vitest run tests/ui/filterbar-labelscan.test.tsx tests/inventar/lagerbestand.test.tsx && pnpm typecheck && pnpm lint`
Expected: PASS + grün — inklusive der auf die Tabelle gescopten Bestandstests (Step 4, „ACHTUNG Bestandstest").

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/inventar/_components/FilterBar.tsx" "src/app/(app)/inventar/_components/InventoryList.tsx" "src/app/(app)/inventar/_components/SellModal.tsx" "src/app/(app)/inventar/_components/StatusTabs.tsx" tests/ui/filterbar-labelscan.test.tsx tests/inventar/lagerbestand.test.tsx
git commit -m "feat(slice5): Bestand mobil — Etiketten-Scan → Verkauf, Mobile-Karten, Sheet-Präsentation

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Schnellverkauf (VerkaufSheet) + Start-Quick-Actions + Analytik-Stacking

**Files:**
- Create: `src/app/(app)/_components/VerkaufSheet.tsx`, `src/app/(app)/_components/QuickActions.tsx`
- Modify: `src/app/(app)/_components/MobileChrome.tsx` (VerkaufSheet-State + FAB-Verdrahtung), `src/app/(app)/page.tsx` (QuickActions), `src/app/(app)/analytik/page.tsx` (`qr-analytik-grid`)
- Test: `tests/ui/verkauf-sheet.test.tsx`

**Interfaces:**
- Consumes: `Sheet`, `ScannerSheet`, `SellModal`; `searchAvailableCopies`/`findAvailableCopiesByRelease`/`CopyHit` (Task 2); `MobileHeader.onSchnellverkauf` (Task 3); `?barcode=`-Param der Suche (Task 5).
- Produces (C9/C12): `VerkaufSheet({ open, onClose })`; `QuickActions()` (mobil-only, staff-gated durch den Aufrufer); FAB im MobileHeader ist ab jetzt LIVE.

- [ ] **Step 1: Failing RTL-Test schreiben**

`tests/ui/verkauf-sheet.test.tsx`:
```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const searchMock = vi.fn();
const findMock = vi.fn();
vi.mock('@/app/(app)/kasse/actions', () => ({
  searchAvailableCopies: (q: string) => searchMock(q),
  findAvailableCopiesByRelease: (id: number) => findMock(id),
}));
vi.mock('@/components/scanner/ScannerSheet', () => ({
  ScannerSheet: ({ open, onDetectRelease }: { open: boolean; onDetectRelease?: (id: number) => void }) =>
    open ? (
      <button type="button" onClick={() => onDetectRelease?.(11111)}>stub-scan</button>
    ) : null,
}));
vi.mock('@/app/(app)/inventar/_components/SellModal', () => ({
  SellModal: ({ purchaseId }: { purchaseId: number }) => (
    <div data-testid="sell-modal-stub">{purchaseId}</div>
  ),
}));

import { VerkaufSheet } from '@/app/(app)/_components/VerkaufSheet';

const copy = (purchaseId: number) => ({
  purchaseId, title: 'Kind of Blue', artist: 'Miles Davis',
  targetPrice: '22.50', conditionRecord: 5, conditionCover: 4,
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('VerkaufSheet (C9)', () => {
  it('Suche ab 2 Zeichen listet Treffer; Auswahl öffnet SellModal', async () => {
    const user = userEvent.setup();
    searchMock.mockResolvedValue({ ok: true, copies: [copy(7), copy(8)] });
    render(<VerkaufSheet open onClose={() => {}} />);
    await user.type(screen.getByLabelText('Artikel suchen'), 'kind');
    const entries = await screen.findAllByRole('button', { name: /Miles Davis – Kind of Blue/ });
    expect(entries).toHaveLength(2);
    await user.click(entries[0]!);
    expect(await screen.findByTestId('sell-modal-stub')).toHaveTextContent('7');
  });

  it('Etiketten-Scan mit 0 Treffern → exakte Meldung', async () => {
    const user = userEvent.setup();
    findMock.mockResolvedValue({ ok: true, copies: [] });
    render(<VerkaufSheet open onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Etikett scannen' }));
    await user.click(await screen.findByRole('button', { name: 'stub-scan' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Kein verfügbares Exemplar zu diesem Release im Bestand.',
    );
  });

  it('Etiketten-Scan mit 1 Treffer → SellModal direkt', async () => {
    const user = userEvent.setup();
    findMock.mockResolvedValue({ ok: true, copies: [copy(9)] });
    render(<VerkaufSheet open onClose={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Etikett scannen' }));
    await user.click(await screen.findByRole('button', { name: 'stub-scan' }));
    expect(await screen.findByTestId('sell-modal-stub')).toHaveTextContent('9');
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss FAILEN**

Run: `pnpm vitest run tests/ui/verkauf-sheet.test.tsx`
Expected: FAIL — Modul nicht gefunden.

- [ ] **Step 3: VerkaufSheet implementieren**

`src/app/(app)/_components/VerkaufSheet.tsx` (KOMPLETT):
```tsx
'use client';

// Schnellverkauf-Bottom-Sheet (C9): Artikel via Textsuche ODER Etiketten-Scan wählen.
// Der eigentliche Verkauf läuft IMMER über das bestehende SellModal — hier gibt es
// keine eigene createSale-Logik (Preisautorität bleibt der Server, C10/Slice 3).

import { useEffect, useState } from 'react';
import { Sheet } from '@/components/ui/Sheet';
import { ScannerSheet } from '@/components/scanner/ScannerSheet';
import { SellModal } from '@/app/(app)/inventar/_components/SellModal';
import {
  findAvailableCopiesByRelease,
  searchAvailableCopies,
  type CopyHit,
} from '@/app/(app)/kasse/actions';

export function VerkaufSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<CopyHit[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [sellCopy, setSellCopy] = useState<CopyHit | null>(null);

  // Debounced Suche über verfügbare Exemplare (Muster FilterBar, 300 ms)
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    const tid = setTimeout(() => {
      void searchAvailableCopies(q).then((res) => {
        if (res.ok) setHits(res.copies);
      });
    }, 300);
    return () => clearTimeout(tid);
  }, [query]);

  const handleRelease = async (releaseId: number) => {
    setScanOpen(false);
    setMessage(null);
    const res = await findAvailableCopiesByRelease(releaseId);
    if (!res.ok) {
      setMessage('Fehler beim Nachschlagen. Bitte erneut versuchen.');
      return;
    }
    if (res.copies.length === 0) {
      setMessage('Kein verfügbares Exemplar zu diesem Release im Bestand.');
      return;
    }
    if (res.copies.length === 1) {
      setSellCopy(res.copies[0]!);
      return;
    }
    setHits(res.copies); // mehrere: dieselbe Trefferliste wie die Suche
  };

  return (
    <>
      <Sheet open={open} onClose={onClose} side="bottom" title="Schnellverkauf">
        <div
          data-testid="verkauf-sheet"
          style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
        >
          <button
            type="button"
            onClick={() => setScanOpen(true)}
            className="focus-ring-button"
            style={{
              minHeight: 'var(--tap)', border: 'none', borderRadius: 'var(--r-pill)',
              background: 'var(--accent)', color: 'var(--on-accent)',
              fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14.5, cursor: 'pointer',
            }}
          >
            Etikett scannen
          </button>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <span style={{ fontWeight: 600, fontSize: 13.5 }}>Artikel suchen</span>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Titel oder Künstler…"
              style={{
                width: '100%', minHeight: 'var(--tap)', padding: '0 14px',
                border: '1.5px solid var(--border-strong)', borderRadius: 'var(--r-md)',
                background: 'var(--surface-2)', color: 'var(--text)', fontSize: 15,
              }}
            />
          </label>
          {message !== null && (
            <p
              role="alert"
              style={{
                margin: 0, padding: '10px 14px', borderRadius: 'var(--r-md)',
                background: 'var(--warn-soft)', color: 'var(--warn)',
                border: '1px solid color-mix(in srgb, var(--warn) 30%, transparent)',
                fontSize: 13.5,
              }}
            >
              {message}
            </p>
          )}
          <ul
            style={{
              listStyle: 'none', margin: 0, padding: 0,
              display: 'flex', flexDirection: 'column', gap: 4,
            }}
          >
            {hits.map((c) => (
              <li key={c.purchaseId}>
                <button
                  type="button"
                  onClick={() => setSellCopy(c)}
                  style={{
                    width: '100%', textAlign: 'left', padding: '8px 10px',
                    border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
                    background: 'var(--surface)', cursor: 'pointer',
                  }}
                >
                  {c.artist} – {c.title} · {c.targetPrice ?? '—'} €
                </button>
              </li>
            ))}
          </ul>
        </div>
      </Sheet>
      <ScannerSheet
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        mode="label"
        onDetectRelease={(id) => { void handleRelease(id); }}
      />
      {sellCopy !== null && (
        <SellModal
          purchaseId={sellCopy.purchaseId}
          title={sellCopy.title}
          artist={sellCopy.artist}
          targetPrice={sellCopy.targetPrice}
          onClose={() => setSellCopy(null)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 4: MobileChrome verdrahten + QuickActions + Seiten-Edits**

`src/app/(app)/_components/MobileChrome.tsx` — KOMPLETT ersetzen durch:
```tsx
'use client';

// Client-Klammer der mobilen Shell: MobileHeader + Schnellverkauf-State (C3/C9).

import { useState } from 'react';
import { MobileHeader } from './MobileHeader';
import { VerkaufSheet } from './VerkaufSheet';
import type { Role } from '@/auth/schema-types';

export function MobileChrome({ role, tenantName }: { role: Role; tenantName: string }) {
  const [verkaufOpen, setVerkaufOpen] = useState(false);
  const isStaff = role !== 'kunde';
  return (
    <>
      <MobileHeader
        role={role}
        tenantName={tenantName}
        onSchnellverkauf={isStaff ? () => setVerkaufOpen(true) : undefined}
      />
      {isStaff && <VerkaufSheet open={verkaufOpen} onClose={() => setVerkaufOpen(false)} />}
    </>
  );
}
```

`src/app/(app)/_components/QuickActions.tsx` (KOMPLETT — Design Handoff Z. 88–95, C12):
```tsx
'use client';

// Start-Screen Quick-Actions (C12) — nur mobil (.qr-mobile-only), nur Staff (Gate im Aufrufer).

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Euro, Heart, ScanLine, type LucideIcon } from 'lucide-react';
import { ScannerSheet } from '@/components/scanner/ScannerSheet';
import { VerkaufSheet } from './VerkaufSheet';

export function QuickActions() {
  const router = useRouter();
  const [scanOpen, setScanOpen] = useState(false);
  const [sellOpen, setSellOpen] = useState(false);

  const actions: Array<{ label: string; Icon: LucideIcon; onClick: () => void }> = [
    { label: 'Scannen', Icon: ScanLine, onClick: () => setScanOpen(true) },
    { label: 'Verkauf', Icon: Euro, onClick: () => setSellOpen(true) },
    { label: 'Wünsche', Icon: Heart, onClick: () => router.push('/wunschlisten') },
  ];

  return (
    <div
      className="qr-mobile-only"
      data-testid="quick-actions"
      style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 11 }}
    >
      {actions.map(({ label, Icon, onClick }) => (
        <button
          key={label}
          type="button"
          onClick={onClick}
          className="focus-ring-button"
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7,
            padding: '15px 8px', border: '1.5px solid var(--border-strong)',
            borderRadius: 'var(--r-lg)', background: 'var(--surface)',
            color: 'var(--text)', cursor: 'pointer',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 40, height: 40, borderRadius: '50%',
              background: 'var(--accent-soft)', color: 'var(--accent-ink)',
              display: 'grid', placeItems: 'center',
            }}
          >
            <Icon size={19} />
          </span>
          <span style={{ fontSize: 12, fontWeight: 700 }}>{label}</span>
        </button>
      ))}
      <ScannerSheet
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        mode="ean"
        onDetectEan={(ean) => {
          setScanOpen(false);
          router.push(`/ankauf?barcode=${encodeURIComponent(ean)}`);
        }}
      />
      <VerkaufSheet open={sellOpen} onClose={() => setSellOpen(false)} />
    </div>
  );
}
```

`src/app/(app)/page.tsx`: Import `import { QuickActions } from './_components/QuickActions';` ergänzen; direkt nach dem öffnenden Container-Element des Seiteninhalts (erste `<div …>` im `return`) einfügen — `user` existiert bereits (Zeile 21):
```tsx
      {user.role !== 'kunde' && <QuickActions />}
```

`src/app/(app)/analytik/page.tsx`: die beiden Grid-`<div>`s mit `gridTemplateColumns: '1.55fr 1fr'` (≈ Zeile 66) und `'1fr 1fr'` (≈ Zeile 72) erhalten je zusätzlich `className="qr-analytik-grid"` (Inline-Styles unverändert; mobil stapeln sie auf 1 Spalte via C1).

- [ ] **Step 5: Tests laufen lassen — müssen PASSEN**

Run: `pnpm vitest run tests/ui/verkauf-sheet.test.tsx tests/ui/mobile-header.test.tsx && pnpm typecheck && pnpm lint`
Expected: PASS + grün (mobile-header erneut: FAB-Kontrakt unverändert).

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/_components/VerkaufSheet.tsx" "src/app/(app)/_components/QuickActions.tsx" "src/app/(app)/_components/MobileChrome.tsx" "src/app/(app)/page.tsx" "src/app/(app)/analytik/page.tsx" tests/ui/verkauf-sheet.test.tsx
git commit -m "feat(slice5): Schnellverkauf-Sheet + Start-Quick-Actions + Analytik-Stacking mobil

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: PWA — Manifest, Icons, Viewport, Service Worker, Offline-Seite

**Files:**
- Create: `src/app/manifest.ts`, `scripts/generate-icons.mjs`, `public/icons/icon-192.png` + `icon-512.png` + `icon-maskable-512.png` + `apple-touch-icon.png` (generiert + eingecheckt), `public/sw.js`, `src/components/pwa/SwRegistration.tsx`, `src/app/offline/page.tsx`, `src/app/offline/ReloadButton.tsx`
- Modify: `src/app/layout.tsx` (Viewport + Metadata + SwRegistration), `package.json` (devDep sharp)
- Test: `tests/manifest.test.ts`

**Interfaces:**
- Consumes: `getCurrentTenant()` (`Tenant.branding.primaryColor`, `Tenant.name`); `VinylDisc` (UI).
- Produces (C11): `/manifest.webmanifest` (dynamisch, tenant-gebrandet), `/sw.js`, `/offline`, `/icons/*` — Konsument: E2E Szenario 5.

- [ ] **Step 1: Failing Manifest-Test schreiben**

`tests/manifest.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/tenant', () => ({
  getCurrentTenant: async () => ({
    id: 1, slug: 'demo', name: 'Demo Records', domain: null, plan: 'free',
    branding: { primaryColor: '#1D4ED8', logo: null }, limits: {},
  }),
}));

import manifest from '@/app/manifest';

describe('manifest (C11) — tenant-gebrandet', () => {
  it('name/short_name/theme_color kommen aus dem Tenant', async () => {
    const m = await manifest();
    expect(m.name).toBe('Demo Records — Q-Records');
    expect(m.short_name).toBe('Demo Records');
    expect(m.short_name!.length).toBeLessThanOrEqual(12);
    expect(m.theme_color).toBe('#1D4ED8');
  });

  it('PWA-Grundfelder + 3 Icons (any/any/maskable)', async () => {
    const m = await manifest();
    expect(m).toMatchObject({
      start_url: '/', scope: '/', display: 'standalone', background_color: '#FAF6F1',
    });
    expect(m.icons).toHaveLength(3);
    expect(m.icons![2]).toMatchObject({ purpose: 'maskable', sizes: '512x512' });
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss FAILEN**

Run: `pnpm vitest run tests/manifest.test.ts`
Expected: FAIL — `@/app/manifest` existiert nicht.

- [ ] **Step 3: Manifest implementieren**

`src/app/manifest.ts` (KOMPLETT):
```ts
import type { MetadataRoute } from 'next';
import { getCurrentTenant } from '@/lib/tenant';

// Dynamisch pro Request: jede Tenant-Subdomain ist eine eigene Origin → das Manifest
// ist automatisch tenant-rein (C11). Unbekannte Subdomain → getCurrentTenant() → 404.
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const tenant = await getCurrentTenant();
  return {
    name: `${tenant.name} — Q-Records`,
    short_name: tenant.name.slice(0, 12),
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#FAF6F1', // Light --bg (= --n-50, tokens.css)
    theme_color: tenant.branding.primaryColor,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
```

- [ ] **Step 4: Icons generieren (einmalig) + einchecken**

Run: `pnpm add -D sharp`

`scripts/generate-icons.mjs` (KOMPLETT):
```js
// One-shot App-Icon-Generierung (C11). PNGs werden EINGECHECKT — dieses Script
// läuft nur erneut, wenn sich das Motiv ändert:  node scripts/generate-icons.mjs
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';

const disc = (size, pad) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <rect width="${size}" height="${size}" fill="#120F0B"/>
  <circle cx="${size / 2}" cy="${size / 2}" r="${size * (0.5 - pad)}" fill="#1B1712"
    stroke="#FF5A5F" stroke-width="${Math.max(2, size * 0.015)}"/>
  <circle cx="${size / 2}" cy="${size / 2}" r="${size * 0.16}" fill="#FF5A5F"/>
  <circle cx="${size / 2}" cy="${size / 2}" r="${size * 0.05}" fill="#120F0B"/>
</svg>`);

await mkdir('public/icons', { recursive: true });
await sharp(disc(192, 0.06)).png().toFile('public/icons/icon-192.png');
await sharp(disc(512, 0.06)).png().toFile('public/icons/icon-512.png');
// maskable: größere Safe-Zone (Motiv in den inneren 80 %)
await sharp(disc(512, 0.18)).png().toFile('public/icons/icon-maskable-512.png');
await sharp(disc(180, 0.06)).png().toFile('public/icons/apple-touch-icon.png');
console.log('icons written to public/icons/');
```

Run: `node scripts/generate-icons.mjs && ls -la public/icons/`
Expected: 4 PNGs (icon-192, icon-512, icon-maskable-512, apple-touch-icon).

- [ ] **Step 5: Root-Layout — Viewport, PWA-Meta, SW-Registrierung**

`src/components/pwa/SwRegistration.tsx` (KOMPLETT):
```tsx
'use client';

// Registriert den Service Worker NUR in Production (C11) — im Dev-Modus würde
// ein SW HMR/Turbopack-Assets cachen und Entwickler in Cache-Hölle schicken.

import { useEffect } from 'react';

export function SwRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }, []);
  return null;
}
```

`src/app/layout.tsx` — drei Änderungen:
1. Import-Zeile `import type { Metadata } from 'next';` → `import type { Metadata, Viewport } from 'next';` und `import { SwRegistration } from '@/components/pwa/SwRegistration';` ergänzen.
2. Nach dem bestehenden `metadata`-Export ergänzen bzw. `metadata` erweitern:
```ts
export const metadata: Metadata = {
  title: { default: 'q·records storemanager', template: '%s · q·records' },
  appleWebApp: { capable: true, statusBarStyle: 'default' },
  icons: { apple: '/icons/apple-touch-icon.png' },
};

// Statisch (KEIN Tenant-Zugriff): generateViewport liefe auch auf tenant-losen
// Infrastruktur-Routen — tenant-genaues theme_color liefert das Manifest (C11).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#FF5A5F',
};
```
3. Im `<body>` nach `<ThemeProvider …>{children}</ThemeProvider>`:
```tsx
        <SwRegistration />
```

- [ ] **Step 6: Service Worker + Offline-Seite**

`public/sw.js` (KOMPLETT):
```js
/* q-records Service Worker (C11): cached AUSSCHLIESSLICH statische Assets + /offline.
   NIE: API-Responses, HTML mit Tenant-Daten, non-GET, fremde Origins. */
const CACHE = 'qr-static-v1';
const OFFLINE_URL = '/offline';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(OFFLINE_URL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith('qr-') && k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigationen: network-first, offline → Hinweisseite (NIE gecachte App-HTML)
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }
  // Immutable statics: cache-first
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((res) => {
            if (res.ok) {
              const clone = res.clone();
              caches.open(CACHE).then((cache) => cache.put(request, clone));
            }
            return res;
          }),
      ),
    );
  }
  // Alles andere: unangefasst zum Netzwerk (kein respondWith).
});
```

`src/app/offline/ReloadButton.tsx` (KOMPLETT):
```tsx
'use client';

export function ReloadButton() {
  return (
    <button
      type="button"
      onClick={() => location.reload()}
      className="focus-ring-button"
      style={{
        minHeight: 'var(--tap)', padding: '0 22px', border: 'none',
        borderRadius: 'var(--r-pill)', background: 'var(--accent)',
        color: 'var(--on-accent)', fontFamily: 'var(--font-body)',
        fontWeight: 700, fontSize: 14.5, cursor: 'pointer',
      }}
    >
      Erneut versuchen
    </button>
  );
}
```

`src/app/offline/page.tsx` (KOMPLETT — DB-frei; wird beim SW-install im Online-Zustand precached):
```tsx
import { VinylDisc } from '@/components/ui/VinylDisc';
import { ReloadButton } from './ReloadButton';

export const metadata = { title: 'Offline' };

export default function OfflinePage() {
  return (
    <main
      style={{
        minHeight: '100vh', display: 'grid', placeItems: 'center',
        background: 'var(--bg)', color: 'var(--text)',
        fontFamily: 'var(--font-body)', padding: 24,
      }}
    >
      <div
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
          textAlign: 'center', border: '1px solid var(--border)',
          borderRadius: 'var(--r-xl)', background: 'var(--surface)',
          boxShadow: 'var(--shadow-2)', padding: '40px 32px', maxWidth: 380,
        }}
      >
        <VinylDisc size={56} />
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 24 }}>
          Du bist offline
        </h1>
        <p style={{ margin: 0, color: 'var(--text-2)', fontSize: 14.5, lineHeight: 1.6 }}>
          Sobald die Verbindung zurück ist, kann es weitergehen.
        </p>
        <ReloadButton />
      </div>
    </main>
  );
}
```

- [ ] **Step 7: Tests + Build laufen lassen — müssen PASSEN**

Run: `pnpm vitest run tests/manifest.test.ts && pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS; Build grün (Build verifiziert manifest.ts/viewport-Exports — deshalb hier ausnahmsweise `pnpm build`).

- [ ] **Step 8: Commit**

```bash
git add src/app/manifest.ts src/app/layout.tsx src/app/offline scripts/generate-icons.mjs public/icons public/sw.js src/components/pwa/SwRegistration.tsx package.json pnpm-lock.yaml tests/manifest.test.ts
git commit -m "feat(slice5): PWA — tenant-gebrandetes Manifest, Icons, Service Worker, Offline-Seite

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: E2E Mobile+PWA + Full Gate

**Files:**
- Create: `e2e/mobile-pwa.spec.ts`
- Test: die komplette Suite (unit/integration + alle E2E)

**Interfaces:**
- Consumes: alles aus Task 1–8; `login`, `dbQuery`, `demoTenantId`, `DEMO_URL`, `VINYLCAVE_URL` aus `e2e/helpers.ts`; die AnkaufModal-E2E-Interaktion aus `e2e/discogs.spec.ts` (Selektoren dort nachschlagen und wörtlich übernehmen).
- Produces: C14-Abdeckung; grüner Full-Gate.

- [ ] **Step 1: E2E-Spec schreiben**

`e2e/mobile-pwa.spec.ts` (Gerüst KOMPLETT — für die AnkaufModal-Interaktion in Szenario 3 die Selektoren aus `e2e/discogs.spec.ts` übernehmen, sie sind dort etabliert und getestet):
```ts
/**
 * E2E acceptance — Slice 5: Mobile Shell + Scanner + PWA (C14).
 *
 * Mobile-Viewport via test.use auf describe-Ebene; Desktop-Positiv-Kontrolle
 * im zweiten describe. Alle Bestands-Asserts gegen die LIVE-DB (Count-Deltas),
 * keine Seed-Konstanten (Slice-4-Lektion).
 */
import { test, expect } from '@playwright/test';
import {
  DEMO_URL,
  VINYLCAVE_URL,
  DEMO_EMAIL,
  DEMO_PASSWORD,
  login,
  dbQuery,
  demoTenantId,
} from './helpers';

test.describe.configure({ mode: 'serial' });

// MUSS mit src/lib/discogs/fake.ts FAKE_BARCODE_HIT übereinstimmen (C4).
const FAKE_BARCODE_HIT = '4988031234567';

const purchasesCount = async (tenantId: number) =>
  Number(
    (await dbQuery<{ n: string }>(
      `SELECT COUNT(*) AS n FROM purchases WHERE tenant_id = $1`,
      [tenantId],
    ))[0]!.n,
  );
const transactionsCount = async (tenantId: number) =>
  Number(
    (await dbQuery<{ n: string }>(
      `SELECT COUNT(*) AS n FROM transactions WHERE tenant_id = $1`,
      [tenantId],
    ))[0]!.n,
  );

test.describe('Slice 5 — Mobile Shell + Scanner + PWA (390×844)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('1. Mobile Shell: Tab-Bar sichtbar, Sidebar versteckt, Navigation via Tabs', async ({ page }) => {
    await login(page, DEMO_URL, DEMO_EMAIL, DEMO_PASSWORD);
    const tabbar = page.getByTestId('bottom-tabbar');
    await expect(tabbar).toBeVisible();
    await expect(tabbar.getByRole('link')).toHaveCount(5);
    await expect(page.getByRole('navigation', { name: 'Hauptnavigation' })).toBeHidden();
    await expect(page.getByTestId('mobile-header')).toBeVisible();
    await expect(tabbar.getByRole('link', { name: 'Start' })).toHaveAttribute('aria-current', 'page');
    await tabbar.getByRole('link', { name: 'Bestand' }).click();
    await expect(page).toHaveURL(`${DEMO_URL}/inventar`);
    await expect(tabbar.getByRole('link', { name: 'Bestand' })).toHaveAttribute('aria-current', 'page');
  });

  test('3. Scanner-Fallback: manueller EAN → Discogs-Treffer → Ankauf', async ({ page }) => {
    const tenantId = await demoTenantId();
    const before = await purchasesCount(tenantId);

    await login(page, DEMO_URL, DEMO_EMAIL, DEMO_PASSWORD);
    await page.goto(`${DEMO_URL}/ankauf`);
    await page.getByRole('button', { name: 'Barcode scannen' }).click();
    await expect(page.getByTestId('scanner-sheet')).toBeVisible();
    // Headless hat keine Kamera → einer der beiden C8-Fehlertexte MUSS erscheinen.
    await expect(page.getByRole('alert').filter({ hasText: /Kamera/ })).toBeVisible();
    await page.getByTestId('scanner-manual-input').fill(FAKE_BARCODE_HIT);
    await page.getByTestId('scanner-manual-submit').click();
    await expect(page.getByTestId('discogs-result-card')).toHaveCount(2);

    // Ankauf des ersten Treffers (Kind of Blue) — AnkaufModal-Interaktion
    // WÖRTLICH aus e2e/discogs.spec.ts übernehmen (EK ausfüllen, VK-Vorschlag
    // stehen lassen, Zustand default, Submit) …

    await expect
      .poll(() => purchasesCount(tenantId), { timeout: 15_000 })
      .toBe(before + 1);
  });

  test('4. Mobiler Verkauf: Bestand-Karte → SellModal (Bottom-Sheet) → bar', async ({ page }) => {
    const tenantId = await demoTenantId();
    const txBefore = await transactionsCount(tenantId);

    await login(page, DEMO_URL, DEMO_EMAIL, DEMO_PASSWORD);
    // Das in Szenario 3 angekaufte Exemplar ist verfügbar + hat einen VK-Preis.
    await page.goto(`${DEMO_URL}/inventar?q=Kind%20of%20Blue&status=verfuegbar`);
    const card = page.getByTestId('inventory-mobile-card').first();
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Verkaufen' }).click();
    await expect(page.getByTestId('sell-modal')).toBeVisible();
    await page.getByTestId('sell-pay-bar').click();
    await page.getByTestId('sell-submit').click();
    await expect(page.getByTestId('sell-modal')).toBeHidden();

    await expect
      .poll(() => transactionsCount(tenantId), { timeout: 15_000 })
      .toBe(txBefore + 1);
  });

  test('5. PWA: Manifest tenant-gebrandet, /offline rendert, sw.js ausgeliefert', async ({ page, request }) => {
    // Live-DB-Wahrheit: Namen + Farben beider Tenants aus der Registry.
    const tenants = await dbQuery<{
      slug: string;
      name: string;
      config: { branding?: { primaryColor?: string } } | null;
    }>(`SELECT slug, name, config FROM tenants WHERE slug IN ('demo','vinylcave') ORDER BY slug`);
    expect(tenants).toHaveLength(2);

    for (const t of tenants) {
      const base = t.slug === 'demo' ? DEMO_URL : VINYLCAVE_URL;
      const res = await request.get(`${base}/manifest.webmanifest`);
      expect(res.ok()).toBeTruthy();
      const m = (await res.json()) as {
        name: string; theme_color: string; display: string; icons: unknown[];
      };
      expect(m.name).toBe(`${t.name} — Q-Records`);
      expect(m.display).toBe('standalone');
      expect(m.icons).toHaveLength(3);
      const seeded = t.config?.branding?.primaryColor;
      if (seeded) {
        expect(m.theme_color).toBe(seeded); // Tenant-Isolation: jede Origin ihre Farbe
      } else {
        expect(m.theme_color).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }

    const sw = await request.get(`${DEMO_URL}/sw.js`);
    expect(sw.status()).toBe(200);
    expect(sw.headers()['content-type'] ?? '').toContain('javascript');

    await page.goto(`${DEMO_URL}/offline`);
    await expect(page.getByRole('heading', { name: 'Du bist offline' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Erneut versuchen' })).toBeVisible();
  });
});

test.describe('Slice 5 — Desktop-Positiv-Kontrolle (1280×800)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('2. Desktop-Guard: Sidebar sichtbar, Tab-Bar/Mobile-Header versteckt', async ({ page }) => {
    await login(page, DEMO_URL, DEMO_EMAIL, DEMO_PASSWORD);
    await expect(page.getByRole('navigation', { name: 'Hauptnavigation' })).toBeVisible();
    await expect(page.getByTestId('bottom-tabbar')).toBeHidden();
    await expect(page.getByTestId('mobile-header')).toBeHidden();
  });
});
```

- [ ] **Step 2: Stack neu bauen + Spec isoliert laufen lassen**

Run: `docker compose up -d --build && pnpm exec playwright test e2e/mobile-pwa.spec.ts`
Expected: 6 passed (5 mobil + 1 Desktop-Guard). Bei Selektor-Fehlern in Szenario 3: Selektoren gegen `e2e/discogs.spec.ts` abgleichen.

- [ ] **Step 3: Full Gate**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: alle Unit-/Integration-Tests grün (589 Bestand + neue Slice-5-Tests).

Run: `pnpm e2e`
Expected: komplette E2E-Suite grün (54 Bestand + 6 neue = 60). Die neue Spec läuft alphabetisch VOR einigen Bestands-Specs — falls eine Bestands-Spec durch die neuen Ankäufe/Verkäufe kippt, verletzt sie die Live-DB-Truth-Regel (Slice-4-Lektion): DIE Spec fixen, nicht Szenario 3/4 abschwächen.

- [ ] **Step 4: Commit**

```bash
git add e2e/mobile-pwa.spec.ts
git commit -m "test(slice5): E2E — Mobile Shell, Scanner-Fallback-Ankauf, mobiler Verkauf, PWA

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Nach Task 9 (Abschluss — kein eigener Task)

1. Whole-Branch-Final-Review (superpowers:requesting-code-review, Package über `git merge-base main HEAD`).
2. Roadmap-Zeile Slice 5 in `docs/superpowers/specs/2026-06-25-qrecords-v2-architecture-overview.md` auf **Implementiert + reviewed (…)** setzen (mit echten Testzahlen), committen.
3. superpowers:finishing-a-development-branch → PR gegen main.

