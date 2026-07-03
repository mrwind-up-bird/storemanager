// tests/lib/labels.test.ts
import { describe, it, expect } from 'vitest';
import { labelGridLayout, AVERY_3x8, discogsReleaseUrl, labelPriceText } from '@/lib/labels';

it('AVERY_3x8 places 24 labels per page then wraps to page 2', () => {
  expect(labelGridLayout(0, AVERY_3x8).page).toBe(0);
  expect(labelGridLayout(23, AVERY_3x8).page).toBe(0);
  const c24 = labelGridLayout(24, AVERY_3x8);
  expect(c24.page).toBe(1);
  expect(c24.cell.x).toBeCloseTo(labelGridLayout(0, AVERY_3x8).cell.x); // back to col 0 row 0
});
it('cells advance left-to-right, top-to-bottom', () => {
  const a = labelGridLayout(0, AVERY_3x8).cell; const b = labelGridLayout(1, AVERY_3x8).cell;
  expect(b.x).toBeGreaterThan(a.x); expect(b.y).toBe(a.y);
  const rowNext = labelGridLayout(3, AVERY_3x8).cell; // 4th → next row, col 0
  expect(rowNext.x).toBe(a.x); expect(rowNext.y).toBeGreaterThan(a.y);
});
it('discogs url + price text', () => {
  expect(discogsReleaseUrl(1234)).toBe('https://www.discogs.com/release/1234');
  expect(labelPriceText(1200)).toBe('€ 12,00');
  expect(labelPriceText(null)).toBe('—');
});
