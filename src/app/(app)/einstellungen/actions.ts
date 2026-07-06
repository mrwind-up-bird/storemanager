'use server';

import { revalidatePath } from 'next/cache';
import { forbidden, redirect } from 'next/navigation';
import { z } from 'zod';
import { requireSession } from '@/auth/session';
import { getCurrentTenant, assertAccessibleAccent } from '@/lib/tenant';
import { isValidOrigin } from '@/lib/csrf';
import { HEX_COLOR_REGEX } from '@/lib/provisioning';
import { updateTenantInfo } from '@/lib/tenant-settings';

export type ShopInfoState = { ok: boolean; error: string | null };

const shopInfoSchema = z.object({
  name: z.string().trim().min(1, 'Name darf nicht leer sein.'),
  primaryColor: z
    .string()
    .trim()
    .regex(HEX_COLOR_REGEX, 'Primärfarbe muss #RGB oder #RRGGBB sein.'),
  // Geschlossene Whitelist statt freiem returnTo (kein Open-Redirect):
  next: z.enum(['stay', 'wizard']).default('stay'),
});

export async function updateShopInfoAction(
  _prev: ShopInfoState,
  formData: FormData,
): Promise<ShopInfoState> {
  const user = await requireSession();
  if (!(user.role === 'admin' || user.isSuperadmin)) forbidden();
  if (!(await isValidOrigin())) return { ok: false, error: 'Ungültige Herkunft (Origin).' };

  const parsed = shopInfoSchema.safeParse({
    name: formData.get('name'),
    primaryColor: formData.get('primaryColor'),
    next: formData.get('next') ?? 'stay',
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Ungültige Eingaben.' };
  }

  try {
    assertAccessibleAccent(parsed.data.primaryColor); // WCAG AA 4.5:1 wie Provisioning (Spec §11.1)
  } catch {
    return {
      ok: false,
      error: 'Diese Farbe erreicht keinen ausreichenden Kontrast (WCAG AA 4.5:1) — bitte eine andere wählen.',
    };
  }

  const tenant = await getCurrentTenant();
  await updateTenantInfo(tenant.id, {
    name: parsed.data.name,
    primaryColor: parsed.data.primaryColor,
  });

  // Branding wirkt im gesamten Layout (Accent-Variablen) → Layout-weit revalidieren.
  revalidatePath('/', 'layout');

  if (parsed.data.next === 'wizard') redirect('/onboarding?step=2');
  return { ok: true, error: null };
}
