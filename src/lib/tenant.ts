// src/lib/tenant.ts
import 'server-only';

import { cache } from 'react';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { withSuperadmin } from '@/db/tenant';
import { tenants } from '@/db/schema';
import { DEFAULT_PRIMARY_COLOR } from '@/lib/branding';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type TenantBranding = { primaryColor: string; logo: string | null };

export type Tenant = {
  id: number;
  slug: string;
  name: string;
  domain: string | null;
  plan: string;
  branding: TenantBranding;
  limits: Record<string, unknown>;
  onboardingCompletedAt: Date | null;
};

// ---------------------------------------------------------------------------
// Tenant resolution (React cache — deduped per request)
// ---------------------------------------------------------------------------

export async function getCurrentTenantSlug(): Promise<string | null> {
  const h = await headers();
  return h.get('x-tenant-slug');
}

export const getCurrentTenant: () => Promise<Tenant> = cache(
  async (): Promise<Tenant> => {
    const slug = await getCurrentTenantSlug();
    if (!slug) notFound();

    // Read-only registry lookup on the RLS-bound runtime pool (qr_app holds
    // GRANT SELECT on `tenants`, which carries no RLS). withOwner (BYPASSRLS) is
    // reserved for provisioning/migrations — this per-request hot path stays on
    // the least-privileged role (spec §4.2).
    const rows = await withSuperadmin((tx) =>
      tx.select().from(tenants).where(eq(tenants.slug, slug)).limit(1),
    );

    if (rows.length === 0) notFound();

    const row = rows[0];
    const config = (row.config ?? {}) as {
      branding?: { primaryColor?: string; logo?: string | null };
    };

    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      domain: row.domain ?? null,
      plan: row.plan,
      branding: {
        primaryColor: config.branding?.primaryColor ?? DEFAULT_PRIMARY_COLOR,
        logo: config.branding?.logo ?? null,
      },
      limits: (row.limits ?? {}) as Record<string, unknown>,
      onboardingCompletedAt: row.onboardingCompletedAt ?? null,
    };
  },
);

// ---------------------------------------------------------------------------
// WCAG luminance helpers
// ---------------------------------------------------------------------------

/** Linearise one sRGB channel (0–255) per WCAG 2.1 §1.4.3 */
function channelLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance of a hex colour (3 or 6 digit, with or without #). */
function luminance(hex: string): number {
  const clean = hex.replace(/^#/, '');
  let r: number, g: number, b: number;
  if (clean.length === 3) {
    r = parseInt(clean[0] + clean[0], 16);
    g = parseInt(clean[1] + clean[1], 16);
    b = parseInt(clean[2] + clean[2], 16);
  } else {
    r = parseInt(clean.slice(0, 2), 16);
    g = parseInt(clean.slice(2, 4), 16);
    b = parseInt(clean.slice(4, 6), 16);
  }
  return (
    0.2126 * channelLinear(r) +
    0.7152 * channelLinear(g) +
    0.0722 * channelLinear(b)
  );
}

/** WCAG contrast ratio (both arguments are relative luminances). */
function contrastRatio(l1: number, l2: number): number {
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

// Pre-computed poles — these are the only two text colours the design system
// places on top of an accent background.
const L_WHITE = 1; // #FFFFFF
const L_DARK = luminance('#111111'); // ≈ 0.00562

/** Shared hex format guard — throws on anything that is not #RGB or #RRGGBB. */
function assertValidHex(hex: string): void {
  if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex)) {
    throw new Error(
      `Invalid hex color: "${hex}" — expected #RGB or #RRGGBB`,
    );
  }
}

/**
 * Returns '#FFFFFF' or '#111111' — whichever yields the higher contrast
 * ratio against the given background colour.
 */
export function accentOnColor(hex: string): '#FFFFFF' | '#111111' {
  assertValidHex(hex);
  const L = luminance(hex);
  const withWhite = contrastRatio(L_WHITE, L);
  const withDark = contrastRatio(L, L_DARK);
  return withWhite >= withDark ? '#FFFFFF' : '#111111';
}

/**
 * Like accentOnColor but also asserts that at least one pairing meets
 * WCAG AA (4.5:1).  Throws if BOTH white and #111111 fall below the
 * threshold — used by provisionTenant() to validate primaryColor.
 */
export function assertAccessibleAccent(
  hex: string,
): { onAccent: '#FFFFFF' | '#111111' } {
  assertValidHex(hex);
  const L = luminance(hex);
  const withWhite = contrastRatio(L_WHITE, L);
  const withDark = contrastRatio(L, L_DARK);

  if (withWhite < 4.5 && withDark < 4.5) {
    throw new Error(
      `Color ${hex} fails WCAG AA: contrast with white=${withWhite.toFixed(
        2,
      )}, with #111111=${withDark.toFixed(2)} (both < 4.5:1)`,
    );
  }

  return { onAccent: withWhite >= withDark ? '#FFFFFF' : '#111111' };
}
