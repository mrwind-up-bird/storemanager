import { test, expect } from '@playwright/test';
import { DEMO_URL, VINYLCAVE_URL, DEMO_EMAIL, DEMO_PASSWORD, login } from './helpers';

// §9.3: the session↔tenant invariant fires at the HTTP level. A valid demo session token
// presented to vinylcave.localhost must NOT grant access — RLS makes the session row
// invisible under vinylcave's tenant context, so requireSession() rejects.

test('a valid demo session token is rejected on vinylcave.localhost', async ({ browser }) => {
  // 1. Log in on demo, capture the opaque session cookie (the DB session token).
  const demoCtx = await browser.newContext();
  const demoPage = await demoCtx.newPage();
  await login(demoPage, DEMO_URL, DEMO_EMAIL, DEMO_PASSWORD);

  const cookies = await demoCtx.cookies(`${DEMO_URL}/`);
  // dev (http) → `authjs.session-token`; prod (https) → `__Host-authjs.session-token`.
  const sessionCookie = cookies.find((c) => c.name.endsWith('authjs.session-token'));
  expect(sessionCookie, 'demo login must set an authjs.session-token cookie').toBeDefined();
  await demoCtx.close();

  // 2. Inject demo's token into a fresh context scoped to vinylcave, then load the vinylcave
  //    dashboard via the browser (Chromium resolves *.localhost; the node-side request context
  //    does not). The server must NOT honour the cross-tenant token: under vinylcave's tenant
  //    context the session row (tenant_id = demo) is invisible to RLS → no session → /login.
  const vcCtx = await browser.newContext();
  await vcCtx.addCookies([
    {
      name: sessionCookie!.name,
      value: sessionCookie!.value,
      domain: 'vinylcave.localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const vcPage = await vcCtx.newPage();
  await vcPage.goto(`${VINYLCAVE_URL}/`, { waitUntil: 'domcontentloaded' });
  // Must be bounced to /login, and must NOT render the authenticated shell (sidebar nav).
  expect(vcPage.url()).toContain('/login');
  await expect(vcPage.getByRole('navigation')).toHaveCount(0);
  await vcCtx.close();
});

test('unauthenticated access to vinylcave.localhost redirects to /login', async ({ page }) => {
  await page.goto(`${VINYLCAVE_URL}/`, { waitUntil: 'domcontentloaded' });
  expect(page.url()).toContain('/login');
});
