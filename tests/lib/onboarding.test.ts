import { describe, it, expect } from 'vitest';
import { needsOnboarding } from '@/lib/onboarding';

// Pure Gating-Regel (Spec §11), geteilt von (app)/layout + passwort/actions.
const tenant = (completed: Date | null) => ({ onboardingCompletedAt: completed });
const DONE = new Date('2026-07-06T00:00:00Z');

describe('needsOnboarding', () => {
  it('admin ohne abgeschlossenes Onboarding → true', () => {
    expect(needsOnboarding({ role: 'admin', isSuperadmin: false }, tenant(null))).toBe(true);
  });

  it('superadmin → true, auch wenn die role nicht admin ist', () => {
    expect(needsOnboarding({ role: 'mitarbeiter', isSuperadmin: true }, tenant(null))).toBe(true);
  });

  it('admin mit abgeschlossenem Onboarding → false', () => {
    expect(needsOnboarding({ role: 'admin', isSuperadmin: false }, tenant(DONE))).toBe(false);
  });

  it('mitarbeiter ohne Onboarding → false (nur Admins/Superadmins sehen den Wizard)', () => {
    expect(needsOnboarding({ role: 'mitarbeiter', isSuperadmin: false }, tenant(null))).toBe(false);
  });

  it('kunde ohne Onboarding → false', () => {
    expect(needsOnboarding({ role: 'kunde', isSuperadmin: false }, tenant(null))).toBe(false);
  });
});
