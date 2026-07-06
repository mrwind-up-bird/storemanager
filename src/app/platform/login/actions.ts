'use server';

import { z } from 'zod';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { isValidOrigin } from '@/lib/csrf';
import {
  createPlatformSession,
  PLATFORM_COOKIE_NAME,
  platformSessionCookieOptions,
  verifyPlatformCredentials,
} from '@/auth/platform';

export type PlatformLoginState = { error: string | null };

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function platformLoginAction(
  _prev: PlatformLoginState,
  formData: FormData,
): Promise<PlatformLoginState> {
  // Kette (Global Constraint 2): (keine Session nötig) → Origin → zod → Delegation.
  if (!(await isValidOrigin())) return { error: 'Ungültige Herkunft (Origin).' };
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) return { error: 'Ungültige Anmeldedaten.' };

  const user = await verifyPlatformCredentials(parsed.data.email, parsed.data.password);
  if (!user) return { error: 'Ungültige Anmeldedaten.' };

  const { token } = await createPlatformSession(user.id);
  (await cookies()).set(PLATFORM_COOKIE_NAME, token, platformSessionCookieOptions());
  redirect('/');
}
