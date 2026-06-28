import { test, expect } from '@playwright/test';
import { DEMO_URL } from './helpers';

// Basic reachability — proves the compose stack is up and tenant routing works.

test('demo.localhost/login returns HTTP 200', async ({ page }) => {
  const res = await page.goto(`${DEMO_URL}/login`);
  expect(res?.status()).toBe(200);
});

test('root domain localhost returns 404 (no tenant subdomain)', async ({ page }) => {
  const res = await page.goto('http://localhost:3000/');
  expect(res?.status()).toBe(404);
});
