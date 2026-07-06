'use server';

import { redirect } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { getCurrentTenant } from '@/lib/tenant';
import { needsOnboarding } from '@/lib/onboarding';
import { isValidOrigin } from '@/lib/csrf';
import { verifyAndChangePassword } from '@/lib/account';
import { changePasswordSchema } from './schemas';

export type ChangePasswordState = { error: string | null };

export async function changePasswordAction(
  _prev: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const user = await requireSession(); // jede Rolle — kunde unterliegt demselben Zwang (Spec §11)
  if (!(await isValidOrigin())) return { error: 'Ungültige Herkunft (Origin).' };

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get('currentPassword'),
    newPassword: formData.get('newPassword'),
    confirmPassword: formData.get('confirmPassword'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Ungültige Eingaben.' };

  const changed = await verifyAndChangePassword(
    { tenantId: user.tenantId, userId: user.id },
    parsed.data.currentPassword,
    parsed.data.newPassword,
  );
  if (!changed) return { error: 'Aktuelles Passwort ist falsch.' };

  // Danach: Admin ohne abgeschlossenes Onboarding → Wizard, sonst Dashboard (Spec §11).
  const tenant = await getCurrentTenant();
  if (needsOnboarding(user, tenant)) {
    redirect('/onboarding');
  }
  redirect('/');
}
