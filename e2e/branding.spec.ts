import { test, expect } from '@playwright/test';
import { DEMO_URL, DEMO_EMAIL, DEMO_PASSWORD, login } from './helpers';

// §9.7: tenant branding without FOUC, and theme + accent both controlled on <html>.
// ThemeToggle + AccentSwitch live ONLY in the authenticated shell — log in first for those.

test('SSR response inlines tenant branding <style> with --accent (no FOUC)', async ({ page }) => {
  const response = await page.goto(`${DEMO_URL}/login`);
  expect(response?.status()).toBe(200);

  // Raw SSR HTML must carry the inlined branding <style> (from src/app/layout.tsx) so the
  // accent is correct on first paint.
  const html = await response!.text();
  expect(html).toMatch(/<style[^>]*>[\s\S]*--accent[\s\S]*<\/style>/i);

  // <html> already has data-theme + data-accent in the SSR markup.
  expect(html).toMatch(/<html[^>]*data-theme=/i);
  expect(html).toMatch(/<html[^>]*data-accent=/i);

  await page.waitForLoadState('domcontentloaded');
  const dataTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  expect(['light', 'dark']).toContain(dataTheme);
  const dataAccent = await page.evaluate(() => document.documentElement.getAttribute('data-accent'));
  expect(dataAccent).toBeTruthy();
});

test('theme toggle flips data-theme on <html>', async ({ page }) => {
  await login(page, DEMO_URL, DEMO_EMAIL, DEMO_PASSWORD);

  const initialTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  expect(['light', 'dark']).toContain(initialTheme);

  // ThemeToggle aria-label is "Dunkelmodus einschalten" / "Zu hellem Theme wechseln".
  await page.getByRole('button', { name: /dunkelmodus|hellem theme/i }).click();

  await expect
    .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme')))
    .not.toBe(initialTheme);
  const newTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  expect(['light', 'dark']).toContain(newTheme);
});

test('accent switch changes data-accent on <html>', async ({ page }) => {
  await login(page, DEMO_URL, DEMO_EMAIL, DEMO_PASSWORD);

  const initialAccent = await page.evaluate(() => document.documentElement.getAttribute('data-accent'));

  // AccentSwitch renders three role=radio swatches (aria-label Coral/Indigo/Forest, values
  // coral/indigo/forest). Pick one different from the current accent and click it.
  const options: Array<[string, string]> = [
    ['coral', 'Coral'],
    ['indigo', 'Indigo'],
    ['forest', 'Forest'],
  ];
  const target = options.find(([value]) => value !== initialAccent) ?? options[1];

  await page.getByRole('radio', { name: target[1], exact: true }).click();

  await expect
    .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-accent')))
    .toBe(target[0]);
});
