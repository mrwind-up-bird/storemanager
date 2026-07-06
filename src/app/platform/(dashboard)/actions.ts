'use server';

import { redirect } from 'next/navigation';
import { isValidOrigin } from '@/lib/csrf';
import { destroyPlatformSession } from '@/auth/platform';

export async function platformLogoutAction(): Promise<void> {
  if (!(await isValidOrigin())) return;
  await destroyPlatformSession();
  redirect('/login');
}
