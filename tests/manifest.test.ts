import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/tenant', () => ({
  getCurrentTenant: async () => ({
    id: 1, slug: 'demo', name: 'Demo Records', domain: null, plan: 'free',
    branding: { primaryColor: '#1D4ED8', logo: null }, limits: {},
  }),
}));

import manifest from '@/app/manifest';

describe('manifest (C11) — tenant-gebrandet', () => {
  it('name/short_name/theme_color kommen aus dem Tenant', async () => {
    const m = await manifest();
    expect(m.name).toBe('Demo Records — Q-Records');
    expect(m.short_name).toBe('Demo Records');
    expect(m.short_name!.length).toBeLessThanOrEqual(12);
    expect(m.theme_color).toBe('#1D4ED8');
  });

  it('PWA-Grundfelder + 3 Icons (any/any/maskable)', async () => {
    const m = await manifest();
    expect(m).toMatchObject({
      start_url: '/', scope: '/', display: 'standalone', background_color: '#FAF6F1',
    });
    expect(m.icons).toHaveLength(3);
    expect(m.icons![2]).toMatchObject({ purpose: 'maskable', sizes: '512x512' });
  });
});
