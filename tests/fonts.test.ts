import { describe, it, expect } from 'vitest';

describe('fonts.ts exports', () => {
  it('displayFont has variable --font-display', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../src/lib/fonts.ts'), 'utf8');
    expect(src).toContain("variable: '--font-display'");
    expect(src).toContain("variable: '--font-body'");
    expect(src).toContain("variable: '--font-mono'");
  });
  it('exports displayFont, bodyFont, monoFont', async () => {
    const src = (await import('node:fs')).readFileSync(
      (await import('node:path')).resolve(__dirname, '../src/lib/fonts.ts'), 'utf8'
    );
    expect(src).toContain('export const displayFont');
    expect(src).toContain('export const bodyFont');
    expect(src).toContain('export const monoFont');
  });
  it('uses display: swap for all fonts', async () => {
    const src = (await import('node:fs')).readFileSync(
      (await import('node:path')).resolve(__dirname, '../src/lib/fonts.ts'), 'utf8'
    );
    const swapCount = (src.match(/display: 'swap'/g) ?? []).length;
    expect(swapCount).toBe(3);
  });
  it('references woff2 files in src/fonts/', async () => {
    const src = (await import('node:fs')).readFileSync(
      (await import('node:path')).resolve(__dirname, '../src/lib/fonts.ts'), 'utf8'
    );
    expect(src).toContain('BricolageGrotesque-Variable.woff2');
    expect(src).toContain('HankenGrotesk-Variable.woff2');
    expect(src).toContain('GeistMono-Variable.woff2');
  });
});
