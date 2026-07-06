'use server';

import { revalidatePath } from 'next/cache';
import { forbidden, redirect } from 'next/navigation';
import { z } from 'zod';
import { requireSession } from '@/auth/session';
import { getCurrentTenant, assertAccessibleAccent } from '@/lib/tenant';
import { isValidOrigin } from '@/lib/csrf';
import { HEX_COLOR_REGEX } from '@/lib/provisioning';
import { updateTenantInfo } from '@/lib/tenant-settings';
import { getConnection } from '@/lib/discogs-connection';
import { getDiscogsAdapter } from '@/lib/discogs';
import { getEntitlements, LimitExceededError } from '@/lib/gating';
import { createTeamUser, resetTeamUserPassword, DuplicateEmailError } from '@/lib/team';
import { getEmailAdapter, sendCredentialsEmail } from '@/lib/email';
import { tenantUrl } from '@/env';
import { getBillingAdapter } from '@/lib/billing';
import { getSubscriptionForTenant } from '@/lib/billing/store';

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

// ---------------------------------------------------------------------------
// Discogs-Tab (Spec §12 — OAuth-Reuse-Amendment: Verbinden läuft über
// /api/discogs/connect?from=einstellungen; hier nur Test + Trennen)
// ---------------------------------------------------------------------------

export async function testDiscogsConnectionAction(): Promise<{ ok: boolean; message: string }> {
  const user = await requireSession();
  if (!(user.role === 'admin' || user.isSuperadmin)) forbidden();
  // Lesend — kein Origin-Check (Konvention wie searchDiscogs).
  const conn = await getConnection({ tenantId: user.tenantId, userId: user.id });
  if (!conn) return { ok: false, message: 'Keine Verbindung konfiguriert.' };
  try {
    const { username } = await getDiscogsAdapter().identity(conn.auth);
    return { ok: true, message: `Verbunden als ${username}.` };
  } catch {
    return { ok: false, message: 'Verbindung fehlgeschlagen — bitte neu verbinden.' };
  }
}

// ---------------------------------------------------------------------------
// Team-Tab + Wizard Schritt 3 (Spec §11.3/§12)
// ---------------------------------------------------------------------------

export type TeamActionState = { ok: boolean; error: string | null; info: string | null };

const createUserSchema = z.object({
  email: z.string().trim().email('Bitte eine gültige E-Mail angeben.'),
  role: z.enum(['mitarbeiter', 'kunde']),
});

export async function createTeamUserAction(
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const user = await requireSession();
  if (!(user.role === 'admin' || user.isSuperadmin)) forbidden();
  if (!(await isValidOrigin())) return { ok: false, error: 'Ungültige Herkunft (Origin).', info: null };

  const parsed = createUserSchema.safeParse({
    email: formData.get('email'),
    role: formData.get('role'),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Ungültige Eingaben.', info: null };
  }

  const tenant = await getCurrentTenant();
  const ent = await getEntitlements(tenant.id);

  let temporaryPassword: string;
  try {
    ({ temporaryPassword } = await createTeamUser(
      { tenantId: tenant.id, userId: user.id },
      ent,
      parsed.data,
    ));
  } catch (err) {
    if (err instanceof LimitExceededError) return { ok: false, error: err.message, info: null };
    if (err instanceof DuplicateEmailError) {
      return { ok: false, error: 'Diese E-Mail ist bereits vergeben.', info: null };
    }
    console.error('[team] createTeamUser fehlgeschlagen', err);
    return { ok: false, error: 'Anlegen fehlgeschlagen.', info: null };
  }

  // Temp. Passwort NUR per Mail (Spec §11.3/§13.9) — soft-fail mit Hinweis.
  let info = `Zugangsdaten wurden an ${parsed.data.email} geschickt.`;
  try {
    await sendCredentialsEmail(getEmailAdapter(), {
      to: parsed.data.email,
      tenantName: tenant.name,
      loginUrl: `${tenantUrl(tenant.slug)}/login`,
      temporaryPassword,
    });
  } catch (err) {
    console.error('[team] Credentials-Mail fehlgeschlagen', err);
    info = 'User angelegt, aber die Mail konnte nicht verschickt werden — „Passwort zurücksetzen" schickt sie erneut.';
  }

  revalidatePath('/einstellungen');
  return { ok: true, error: null, info };
}

const resetPasswordSchema = z.object({ userId: z.coerce.number().int().positive() });

export async function resetTeamPasswordAction(
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const user = await requireSession();
  if (!(user.role === 'admin' || user.isSuperadmin)) forbidden();
  if (!(await isValidOrigin())) return { ok: false, error: 'Ungültige Herkunft (Origin).', info: null };

  const parsed = resetPasswordSchema.safeParse({ userId: formData.get('userId') });
  if (!parsed.success) return { ok: false, error: 'Ungültige Eingaben.', info: null };

  const tenant = await getCurrentTenant();
  const result = await resetTeamUserPassword(
    { tenantId: tenant.id, userId: user.id },
    parsed.data.userId,
  );
  if (!result) return { ok: false, error: 'User nicht gefunden.', info: null };

  try {
    await sendCredentialsEmail(getEmailAdapter(), {
      to: result.email,
      tenantName: tenant.name,
      loginUrl: `${tenantUrl(tenant.slug)}/login`,
      temporaryPassword: result.temporaryPassword,
    });
  } catch (err) {
    console.error('[team] Reset-Mail fehlgeschlagen', err);
    return { ok: false, error: 'Passwort zurückgesetzt, aber Mail-Versand fehlgeschlagen.', info: null };
  }
  revalidatePath('/einstellungen');
  return { ok: true, error: null, info: `Neues temporäres Passwort an ${result.email} geschickt.` };
}

// ---------------------------------------------------------------------------
// Abo-Tab (Spec §9): Checkout + Portal. redirect() wirft NEXT_REDIRECT — nach
// dem Aufruf läuft nichts mehr. Fehler enden als Redirect zurück auf den Tab.
// ---------------------------------------------------------------------------

// export: Schema-Unit-Tests (Spec §14, T10 Step 5).
export const checkoutSchema = z.enum(['small', 'big']);

export async function startCheckoutAction(formData: FormData): Promise<void> {
  const user = await requireSession();
  if (!(user.role === 'admin' || user.isSuperadmin)) forbidden();
  if (!(await isValidOrigin())) redirect('/einstellungen?tab=abo');

  const parsed = checkoutSchema.safeParse(formData.get('plan'));
  if (!parsed.success) redirect('/einstellungen?tab=abo');

  const tenant = await getCurrentTenant();
  const base = tenantUrl(tenant.slug);
  const { url } = await getBillingAdapter().createCheckoutSession({
    tenantId: tenant.id,
    planSlug: parsed.data,
    successUrl: `${base}/einstellungen?tab=abo&checkout=success`,
    cancelUrl: `${base}/einstellungen?tab=abo`,
  });
  redirect(url);
}

export async function openPortalAction(): Promise<void> {
  const user = await requireSession();
  if (!(user.role === 'admin' || user.isSuperadmin)) forbidden();
  if (!(await isValidOrigin())) redirect('/einstellungen?tab=abo');

  const tenant = await getCurrentTenant();
  const sub = await getSubscriptionForTenant({ tenantId: tenant.id, userId: user.id });
  if (!sub) redirect('/einstellungen?tab=abo');

  const { url } = await getBillingAdapter().createPortalSession({
    customerId: sub.stripeCustomerId,
    returnUrl: `${tenantUrl(tenant.slug)}/einstellungen?tab=abo`,
  });
  redirect(url);
}
