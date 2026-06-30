'use server';

import { revalidatePath } from 'next/cache';
import { forbidden } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { deleteConnection } from '@/lib/discogs-connection';

export async function disconnectDiscogs(): Promise<void> {
  const user = await requireSession();
  if (!(user.role === 'admin' || user.isSuperadmin)) forbidden();
  await deleteConnection({ tenantId: user.tenantId, userId: user.id });
  revalidatePath('/ankauf');
}
