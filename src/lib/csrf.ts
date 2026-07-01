import 'server-only';
import { headers } from 'next/headers';
import { env } from '@/env';

/** Reject cross-site form posts to a mutating server action (shared by ankauf/kasse/wunschlisten). */
export async function isValidOrigin(): Promise<boolean> {
  const h = await headers();
  const origin = h.get('origin');
  const host = h.get('host');
  if (origin && host && origin !== `${env.APP_PROTOCOL}://${host}`) {
    return false;
  }
  return true;
}
