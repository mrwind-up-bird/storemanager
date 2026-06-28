// e2e/theme.spec.ts
import { test, expect } from '@playwright/test';

// These tests require a running dev/prod server. They are authored in Task 2
// and first executed as part of Task 15 acceptance (§9.7).

test.describe('theming cascade — accent + dark mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('initial paint is already themed — no FOUC (SSR sets data-theme/data-accent)', async ({
    page,
  }) => {
    const html = page.locator('html');
    const theme = await html.getAttribute('data-theme');
    const accent = await html.getAttribute('data-accent');
    expect(['light', 'dark']).toContain(theme);
    expect(['coral', 'indigo', 'forest']).toContain(accent);
  });

  test('--accent resolves to a hex value (not empty)', async ({ page }) => {
    const accent = await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue('--accent')
        .trim()
    );
    expect(accent).toMatch(/^#[0-9a-fA-F]{6}|var\(--/);
  });

  test('switching data-accent coral→indigo changes --accent', async ({ page }) => {
    const html = page.locator('html');

    await html.evaluate((el) => el.setAttribute('data-accent', 'coral'));
    const coralAccent = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
    );

    await html.evaluate((el) => el.setAttribute('data-accent', 'indigo'));
    const indigoAccent = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
    );

    expect(coralAccent).not.toBe(indigoAccent);
  });

  test('switching data-accent coral→forest changes --accent', async ({ page }) => {
    const html = page.locator('html');

    await html.evaluate((el) => el.setAttribute('data-accent', 'coral'));
    const coralAccent = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
    );

    await html.evaluate((el) => el.setAttribute('data-accent', 'forest'));
    const forestAccent = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
    );

    expect(coralAccent).not.toBe(forestAccent);
  });

  test('switching data-theme light→dark changes --bg', async ({ page }) => {
    const html = page.locator('html');

    await html.evaluate((el) => el.setAttribute('data-theme', 'light'));
    const lightBg = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
    );

    await html.evaluate((el) => el.setAttribute('data-theme', 'dark'));
    const darkBg = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
    );

    expect(lightBg).not.toBe(darkBg);
  });

  test('dark + indigo: --accent differs from dark + coral', async ({ page }) => {
    const html = page.locator('html');

    await html.evaluate((el) => {
      el.setAttribute('data-theme', 'dark');
      el.setAttribute('data-accent', 'coral');
    });
    const darkCoral = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
    );

    await html.evaluate((el) => el.setAttribute('data-accent', 'indigo'));
    const darkIndigo = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
    );

    expect(darkCoral).not.toBe(darkIndigo);
  });

  test('--disc-label stays coral regardless of accent family (brand pin)', async ({
    page,
  }) => {
    const html = page.locator('html');

    await html.evaluate((el) => {
      el.setAttribute('data-theme', 'light');
      el.setAttribute('data-accent', 'coral');
    });
    const labelCoral = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--disc-label').trim()
    );

    await html.evaluate((el) => el.setAttribute('data-accent', 'indigo'));
    const labelIndigo = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--disc-label').trim()
    );

    expect(labelCoral).toBe(labelIndigo);
  });
});
