'use server';

import { headers } from 'next/headers';
import { AuthError } from 'next-auth';
import { signIn } from '@/auth';
import { env } from '@/env';

export type LoginState = { error: string | null };

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  // Origin check: reject cross-site form posts to this mutating action. When the browser
  // sends an Origin header it MUST match our own protocol+host, otherwise it is a CSRF attempt.
  const h = await headers();
  const origin = h.get('origin');
  const host = h.get('host');
  if (origin && host && origin !== `${env.APP_PROTOCOL}://${host}`) {
    return { error: 'Ungültige Herkunft (Origin).' };
  }

  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  try {
    await signIn('credentials', { email, password, redirectTo: '/' });
    return { error: null };
  } catch (e) {
    if (e instanceof AuthError) return { error: 'Ungültige Anmeldedaten.' };
    throw e; // re-throw NEXT_REDIRECT (successful login) and unexpected errors
  }
}
