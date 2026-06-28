import { test, expect } from '@playwright/test';
import { DEMO_URL } from './helpers';

// §9.4: unknown/reserved subdomains → 404; unknown permalink → 404; known permalink → not 404.

test('unknown subdomain nope.localhost returns 404', async ({ page }) => {
  const res = await page.goto('http://nope.localhost:3000/');
  expect(res?.status()).toBe(404);
});

test('reserved subdomain www.localhost returns 404', async ({ page }) => {
  const res = await page.goto('http://www.localhost:3000/');
  expect(res?.status()).toBe(404);
});

test('unknown permalink on demo.localhost returns 404', async ({ page }) => {
  const res = await page.goto(`${DEMO_URL}/s/does-not-exist-xyz`);
  expect(res?.status()).toBe(404);
});

test('known "lager" permalink on demo.localhost is not 404', async ({ page }) => {
  // provisionTenant() seeds a default "lager" permalink for every tenant.
  const res = await page.goto(`${DEMO_URL}/s/lager`);
  expect(res?.status()).not.toBe(404);
  expect(res?.status()).toBe(200);
});
