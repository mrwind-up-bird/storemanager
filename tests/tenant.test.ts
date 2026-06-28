import { vi, describe, it, expect } from 'vitest';

// Mock Next.js server APIs and DB dependencies — this file tests only
// the pure WCAG helpers exported from tenant.ts.
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({ get: vi.fn().mockReturnValue(null) }),
}));
vi.mock('next/navigation', () => ({ notFound: vi.fn() }));
vi.mock('@/db/tenant', () => ({ withOwner: vi.fn() }));
vi.mock('@/db/schema', () => ({ tenants: {} }));
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }));

import { accentOnColor, assertAccessibleAccent } from '@/lib/tenant';

// --- WCAG math reference (verified against spec) ---
// L(#111111) ≈ 0.00562  (the "dark" pole used by the helpers)
// L(#1a1a2e) ≈ 0.012   contrast with white ≈ 17.0  → white wins
// L(#2d3748) ≈ 0.037   contrast with white ≈ 12.0  → white wins
// L(#ffd700) ≈ 0.698   contrast with dark  ≈ 13.5  → dark wins
// L(#E8533A) ≈ 0.236   contrast with dark  ≈ 5.15  → dark wins (3.67 with white)
// L(#7a7a7a) ≈ 0.194   white ≈ 4.30, dark ≈ 4.39  → BOTH FAIL 4.5:1

describe('accentOnColor', () => {
  it('returns #FFFFFF for very dark navy (#1a1a2e)', () => {
    expect(accentOnColor('#1a1a2e')).toBe('#FFFFFF');
  });

  it('returns #FFFFFF for dark slate (#2d3748)', () => {
    expect(accentOnColor('#2d3748')).toBe('#FFFFFF');
  });

  it('returns #111111 for bright gold (#ffd700)', () => {
    expect(accentOnColor('#ffd700')).toBe('#111111');
  });

  it('returns #111111 for coral (#E8533A) — contrast with dark (5.15) beats white (3.67)', () => {
    expect(accentOnColor('#E8533A')).toBe('#111111');
  });

  it('returns #FFFFFF for pure black (#000000)', () => {
    expect(accentOnColor('#000000')).toBe('#FFFFFF');
  });

  it('returns #111111 for pure white (#ffffff)', () => {
    expect(accentOnColor('#ffffff')).toBe('#111111');
  });

  it('handles 3-digit shorthand (#fff → white)', () => {
    expect(accentOnColor('#fff')).toBe('#111111');
  });
});

describe('assertAccessibleAccent', () => {
  it('does not throw and returns correct on-color for dark navy (#2d3748)', () => {
    expect(assertAccessibleAccent('#2d3748')).toEqual({ onAccent: '#FFFFFF' });
  });

  it('does not throw for coral (#E8533A) — passes with dark text', () => {
    expect(assertAccessibleAccent('#E8533A')).toEqual({ onAccent: '#111111' });
  });

  it('does not throw for gold (#ffd700) — passes with dark text', () => {
    expect(assertAccessibleAccent('#ffd700')).toEqual({ onAccent: '#111111' });
  });

  it('throws for mid-gray (#7a7a7a) — fails 4.5:1 against BOTH white and #111111', () => {
    // L(#7a7a7a) ≈ 0.194: contrast with white ≈ 4.30, contrast with #111111 ≈ 4.39
    expect(() => assertAccessibleAccent('#7a7a7a')).toThrow(/WCAG AA/);
  });
});
