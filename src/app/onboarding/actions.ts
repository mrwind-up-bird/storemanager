'use server';

import { forbidden, redirect } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { getCurrentTenant } from '@/lib/tenant';
import { isValidOrigin } from '@/lib/csrf';
import { completeOnboarding } from '@/lib/tenant-settings';

/**
 * „Los geht's" (Schritt 4) UND „Überspringen" (global) — beide setzen den Timestamp,
 * der Wizard erscheint nie zweimal (Spec §11). Volle Kette (Global Constraint 2).
 */
export async function completeOnboardingAction(): Promise<void> {
  const user = await requireSession();
  if (!(user.role === 'admin' || user.isSuperadmin)) forbidden();
  if (!(await isValidOrigin())) redirect('/onboarding');
  const tenant = await getCurrentTenant();
  await completeOnboarding(tenant.id);
  redirect('/');
}
