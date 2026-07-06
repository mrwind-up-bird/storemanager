/**
 * E2E acceptance — Slice 6: Platform-Zone + Onboarding + Billing + Gating (Spec §14).
 * Serial (workers:1): Szenario 2 verbraucht den in Szenario 1 angelegten Tenant.
 * Stack: docker compose up -d --build (BILLING_DRIVER=fake, DISCOGS_DRIVER=fake, seeded).
 * Re-Seed setzt freeshop zurück (plan free, limits {maxRecords:2}, Bestände) — Szenarien 3/4
 * sind daher über Läufe hinweg deterministisch, solange vor dem Lauf geseedet wurde.
 */
import { test, expect } from '@playwright/test';
import {
  FREESHOP_URL,
  FREESHOP_EMAIL,
  FREESHOP_PASSWORD,
  platformLogin,
  login,
} from './helpers';

test.describe.configure({ mode: 'serial' });

const RUN = Date.now();
const NEW_SLUG = `e2e${RUN}`; // 16 Zeichen — im SLUG_REGEX-Rahmen (3–32)
const NEW_URL = `http://${NEW_SLUG}.localhost:3000`;
const NEW_ADMIN_EMAIL = `admin@${NEW_SLUG}.test`;
const NEW_PASSWORD = 'WizardTest123!';
let tempPassword = '';

test('1. Platform-Login → Tenant anlegen → temp. Passwort sichtbar → Tenant lädt', async ({ page }) => {
  await platformLogin(page);

  // Regression Middleware-Passthrough (T3): geteilte Root-Assets werden auf dem Platform-Host
  // NICHT auf /platform/* rewritet — sonst 404 für Icons/Service-Worker aus dem Root-Layout.
  // page.request (APIRequestContext) nutzt Node-DNS und löst *.localhost NICHT auf (nur der
  // Browser tut das via page.goto). Wie in Szenario 5: 127.0.0.1 + Host-Header statt Subdomain.
  const platformHost = { host: 'admin.localhost:3000' };
  expect(
    (await page.request.get('http://127.0.0.1:3000/sw.js', { headers: platformHost })).status(),
  ).toBe(200);
  expect(
    (await page.request.get('http://127.0.0.1:3000/icons/apple-touch-icon.png', { headers: platformHost })).status(),
  ).toBe(200);

  await page.getByTestId('platform-tenant-create-link').click();
  await page.getByLabel('Slug').fill(NEW_SLUG);
  await page.getByLabel('Name').fill('E2E Wizardshop');
  await page.getByLabel('Admin-E-Mail').fill(NEW_ADMIN_EMAIL);
  await page.getByLabel('Primärfarbe').fill('#C84B31');
  await page.getByLabel('Plan').selectOption('free');
  await page.getByRole('button', { name: 'Anlegen' }).click();

  await expect(page.getByTestId('platform-tenant-created')).toBeVisible();
  tempPassword = (await page.getByTestId('temp-password').textContent())!.trim();
  expect(tempPassword).toMatch(/^[A-Z2-7]{16}$/);

  // Neuer Tenant lädt unter <slug>.localhost mit Login-Seite:
  await page.goto(`${NEW_URL}/login`);
  await expect(page.getByRole('button', { name: /anmelden/i })).toBeVisible();
});

test('2. Erst-Login → Passwortzwang → Wizard (4 Schritte, Discogs überspringen) → nie wieder', async ({ page }) => {
  // Login mit temp. Passwort → (app)-Layout redirectet auf /passwort:
  await page.goto(`${NEW_URL}/login`);
  await page.getByLabel(/e-mail/i).fill(NEW_ADMIN_EMAIL);
  await page.getByLabel(/passwort/i).fill(tempPassword);
  await page.getByRole('button', { name: /anmelden/i }).click();
  await expect(page).toHaveURL(`${NEW_URL}/passwort`);

  // Accessible Name = aria-label der Inputs (gewinnt über den <label>-Text) →
  // exact-Matching, weil „Neues Passwort" ein Präfix von „Neues Passwort wiederholen" ist:
  await page.getByLabel('Aktuelles Passwort', { exact: true }).fill(tempPassword);
  await page.getByLabel('Neues Passwort', { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel('Neues Passwort wiederholen', { exact: true }).fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Passwort ändern' }).click();

  // Admin ohne Onboarding → Wizard Schritt 1:
  await expect(page).toHaveURL(new RegExp(`${NEW_URL}/onboarding`));
  await expect(page.getByTestId('wizard-stepper')).toBeVisible();

  // Schritt 1: Name ändern + Weiter (Submit):
  await page.getByLabel('Shop-Name').fill('E2E Wizardshop GmbH');
  await page.getByRole('button', { name: 'Weiter' }).click();
  await expect(page).toHaveURL(`${NEW_URL}/onboarding?step=2`);

  // Schritt 2 (Discogs): überspringen via „Später":
  await page.getByTestId('wizard-next').click();
  await expect(page).toHaveURL(`${NEW_URL}/onboarding?step=3`);

  // Schritt 3 (Team): überspringen:
  await page.getByTestId('wizard-next').click();
  await expect(page).toHaveURL(`${NEW_URL}/onboarding?step=4`);

  // Schritt 4 (Review): Zusammenfassung zeigt den neuen Namen; „Los geht's" → Dashboard:
  await expect(page.getByTestId('onboarding-wizard')).toContainText('E2E Wizardshop GmbH');
  await page.getByTestId('wizard-finish').click();
  await expect(page).toHaveURL(`${NEW_URL}/`);

  // Erneuter Login zeigt keinen Wizard mehr:
  await page.context().clearCookies();
  await login(page, NEW_URL, NEW_ADMIN_EMAIL, NEW_PASSWORD);
  await expect(page).toHaveURL(`${NEW_URL}/`);
});

test('3. freeshop (free, maxRecords=2): Analytik-Upsell + Limit-Fehler beim Ankauf', async ({ page }) => {
  await login(page, FREESHOP_URL, FREESHOP_EMAIL, FREESHOP_PASSWORD);

  // Analytik zeigt Upsell-Karte statt Charts:
  await page.goto(`${FREESHOP_URL}/analytik`);
  await expect(page.getByTestId('analytik-upsell')).toBeVisible();
  await expect(page.getByTestId('analytik-upsell')).toContainText('verfügbar ab Small');

  // Positive Kontrolle UNTER dem Limit (Seed: 1 Platte, Limit 2) — Sammlungs-Ankauf,
  // manuelle Erfassung (freeshop hat KEINE Discogs-Verbindung; Muster aus
  // e2e/analytics-batch-labels.spec.ts):
  await page.goto(`${FREESHOP_URL}/ankauf/sammlung`);
  await expect(page.getByTestId('sammlung-screen')).toBeVisible();
  await page.getByTestId('sammlung-seller-input').fill(`E2E Limit ${RUN}`);
  await page.getByTestId('sammlung-add-item').click();
  await page.getByRole('button', { name: 'Manuell erfassen' }).click();
  await page.getByLabel('Titel').fill(`Unter Limit ${RUN}`);
  await page.getByLabel('Künstler').fill('E2E Gate');
  await page.getByLabel('Einkaufspreis (EK)').fill('5.00');
  await page.getByLabel('Verkaufspreis (VK)').fill('10.00');
  await page.getByTestId('sammlung-submit').click();
  await expect(page).toHaveURL(new RegExp('/ankauf/sammlungen'), { timeout: 15_000 });

  // Jetzt 2/2 — der nächste Ankauf schlägt mit dem exakten Limit-Formularfehler fehl:
  await page.goto(`${FREESHOP_URL}/ankauf/sammlung`);
  await page.getByTestId('sammlung-seller-input').fill(`E2E Über Limit ${RUN}`);
  await page.getByTestId('sammlung-add-item').click();
  await page.getByRole('button', { name: 'Manuell erfassen' }).click();
  await page.getByLabel('Titel').fill(`Über Limit ${RUN}`);
  await page.getByLabel('Künstler').fill('E2E Gate');
  await page.getByLabel('Einkaufspreis (EK)').fill('5.00');
  await page.getByLabel('Verkaufspreis (VK)').fill('10.00');
  await page.getByTestId('sammlung-submit').click();
  await expect(page.getByText(/Plan-Limit erreicht: max\. 2 Platten im Free-Plan/)).toBeVisible();
});

test('4. Upgrade freeshop → Small via Fake-Checkout: Plan sichtbar, Analytik rendert', async ({ page }) => {
  await login(page, FREESHOP_URL, FREESHOP_EMAIL, FREESHOP_PASSWORD);

  await page.goto(`${FREESHOP_URL}/einstellungen?tab=abo`);
  await expect(page.getByTestId('abo-current-plan')).toContainText('Free');
  await page.getByTestId('upgrade-small').click();

  // Fake-Checkout redirectet direkt zurück mit checkout=success:
  await expect(page).toHaveURL(`${FREESHOP_URL}/einstellungen?tab=abo&checkout=success`);
  await expect(page.getByTestId('abo-current-plan')).toContainText('Small');
  await expect(page.getByTestId('abo-subscription')).toContainText('aktiv');

  // Analytik rendert jetzt Charts statt Upsell:
  await page.goto(`${FREESHOP_URL}/analytik`);
  await expect(page.getByTestId('analytik-screen')).toBeVisible();
  await expect(page.getByTestId('analytik-upsell')).toHaveCount(0);
});

test('5. Zonen-Isolation: /platform auf Tenant-Host 404, admin-Host ohne Session → Login', async ({ request }) => {
  // Request-Fixture mit explizitem Host-Header (Muster aus Slice 5):
  const onTenant = await request.get('http://127.0.0.1:3000/platform', {
    headers: { host: 'demo.localhost:3000' },
    maxRedirects: 0,
  });
  expect(onTenant.status()).toBe(404);

  const directOnAdmin = await request.get('http://127.0.0.1:3000/platform', {
    headers: { host: 'admin.localhost:3000' },
    maxRedirects: 0,
  });
  expect(directOnAdmin.status()).toBe(404); // direkter Pfad ist AUCH auf dem Admin-Host 404

  const adminRoot = await request.get('http://127.0.0.1:3000/', {
    headers: { host: 'admin.localhost:3000' },
    maxRedirects: 0,
  });
  expect([302, 303, 307, 308]).toContain(adminRoot.status());
  expect(adminRoot.headers()['location']).toContain('/login');
});
