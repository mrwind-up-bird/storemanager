'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireSession } from '@/auth/session';
import { getCurrentTenant } from '@/lib/tenant';
import { isValidOrigin } from '@/lib/csrf';
import { verifyAndChangePassword } from '@/lib/account';

export type ChangePasswordState = { error: string | null };

// export: Schema-Unit-Tests (Spec §14, Step 5 unten).
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Bitte das aktuelle Passwort eingeben.'),
    newPassword: z.string().min(12, 'Das neue Passwort muss mindestens 12 Zeichen haben.'),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: 'Die Passwörter stimmen nicht überein.',
    path: ['confirmPassword'],
  });

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
  if ((user.role === 'admin' || user.isSuperadmin) && !tenant.onboardingCompletedAt) {
    redirect('/onboarding');
  }
  redirect('/');
}
