'use server';

import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { requirePlatformSession } from '@/auth/platform';
import { isValidOrigin } from '@/lib/csrf';
import { withOwner } from '@/db/tenant';
import { tenants, users } from '@/db/schema';
import { provisionTenant, generateTempPassword } from '@/lib/provisioning';
import { hashPassword } from '@/lib/password';
import { getEmailAdapter, sendCredentialsEmail } from '@/lib/email';
import { tenantUrl } from '@/env';
import { createTenantSchema } from './schemas';

// ---------------------------------------------------------------------------
// Tenant anlegen (Spec §6.2) — Platform-Action-Kette (CONTRACTS C3):
// requirePlatformSession → Origin → zod → Delegation
// ---------------------------------------------------------------------------

export type CreateTenantState = {
  ok: boolean;
  error: string | null;
  /** Einmalige Anzeige (Spec §13.9) — danach nur noch per Mail. */
  temporaryPassword: string | null;
  slug: string | null;
};

export async function createTenantAction(
  _prev: CreateTenantState,
  formData: FormData,
): Promise<CreateTenantState> {
  await requirePlatformSession();
  if (!(await isValidOrigin())) {
    return { ok: false, error: 'Ungültige Herkunft (Origin).', temporaryPassword: null, slug: null };
  }
  const parsed = createTenantSchema.safeParse({
    slug: formData.get('slug'),
    name: formData.get('name'),
    adminEmail: formData.get('adminEmail'),
    primaryColor: formData.get('primaryColor'),
    plan: formData.get('plan'),
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Ungültige Eingaben.',
      temporaryPassword: null,
      slug: null,
    };
  }

  let temporaryPassword: string;
  try {
    // provisionTenant validiert Slug-Format/Reserved-Liste + WCAG-Kontrast und wirft
    // mit sprechender Message; Duplikat-Slug endet als unique-violation (23505).
    const result = await provisionTenant(parsed.data);
    temporaryPassword = result.temporaryPassword;
  } catch (err) {
    const code =
      (err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code;
    if (code === '23505') {
      return { ok: false, error: `Slug "${parsed.data.slug}" ist bereits vergeben.`, temporaryPassword: null, slug: null };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Anlegen fehlgeschlagen.',
      temporaryPassword: null,
      slug: null,
    };
  }

  // Credentials-Mail (mailpit/console) — soft-fail: Tenant ist bereits angelegt,
  // das Passwort wird zusätzlich einmalig angezeigt.
  try {
    await sendCredentialsEmail(getEmailAdapter(), {
      to: parsed.data.adminEmail,
      tenantName: parsed.data.name,
      loginUrl: `${tenantUrl(parsed.data.slug)}/login`,
      temporaryPassword,
    });
  } catch (err) {
    console.warn('[platform] Credentials-Mail fehlgeschlagen (non-fatal):', err);
  }

  revalidatePath('/platform');
  return { ok: true, error: null, temporaryPassword, slug: parsed.data.slug };
}

// ---------------------------------------------------------------------------
// Plan manuell setzen (Spec §6.3) — schreibt NUR tenants.plan, keine Stripe-Objekte.
// ---------------------------------------------------------------------------

export type PlatformActionState = { ok: boolean; error: string | null };

const setPlanSchema = z.object({
  tenantId: z.coerce.number().int().positive(),
  plan: z.enum(['free', 'small', 'big']),
});

export async function setTenantPlanAction(
  _prev: PlatformActionState,
  formData: FormData,
): Promise<PlatformActionState> {
  await requirePlatformSession();
  if (!(await isValidOrigin())) return { ok: false, error: 'Ungültige Herkunft (Origin).' };
  const parsed = setPlanSchema.safeParse({
    tenantId: formData.get('tenantId'),
    plan: formData.get('plan'),
  });
  if (!parsed.success) return { ok: false, error: 'Ungültige Eingaben.' };

  await withOwner((tx) =>
    tx
      .update(tenants)
      .set({ plan: parsed.data.plan, updatedAt: new Date() })
      .where(eq(tenants.id, parsed.data.tenantId)),
  );
  revalidatePath('/platform');
  revalidatePath(`/platform/tenants/${parsed.data.tenantId}`);
  return { ok: true, error: null };
}

// ---------------------------------------------------------------------------
// Credentials-Mail erneut senden (Spec §6.3): neues temp. Passwort an den admin-User,
// mustChangePassword=true. Passwort wird NICHT angezeigt — nur Mail (Spec §13.9).
// ---------------------------------------------------------------------------

const resendSchema = z.object({ tenantId: z.coerce.number().int().positive() });

export async function resendCredentialsAction(
  _prev: PlatformActionState,
  formData: FormData,
): Promise<PlatformActionState> {
  await requirePlatformSession();
  if (!(await isValidOrigin())) return { ok: false, error: 'Ungültige Herkunft (Origin).' };
  const parsed = resendSchema.safeParse({ tenantId: formData.get('tenantId') });
  if (!parsed.success) return { ok: false, error: 'Ungültige Eingaben.' };

  const temporaryPassword = generateTempPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  const target = await withOwner(async (tx) => {
    const [tenant] = await tx
      .select({ id: tenants.id, slug: tenants.slug, name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, parsed.data.tenantId))
      .limit(1);
    if (!tenant) return null;
    const [admin] = await tx
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(and(eq(users.tenantId, tenant.id), eq(users.role, 'admin')))
      .orderBy(users.id)
      .limit(1);
    if (!admin) return null;
    await tx
      .update(users)
      .set({ password: passwordHash, mustChangePassword: true, updatedAt: new Date() })
      .where(eq(users.id, admin.id));
    return { tenant, admin };
  });
  if (!target) return { ok: false, error: 'Tenant oder Admin-User nicht gefunden.' };

  try {
    await sendCredentialsEmail(getEmailAdapter(), {
      to: target.admin.email,
      tenantName: target.tenant.name,
      loginUrl: `${tenantUrl(target.tenant.slug)}/login`,
      temporaryPassword,
    });
  } catch (err) {
    console.error('[platform] Credentials-Resend-Mail fehlgeschlagen:', err);
    return { ok: false, error: 'Mail-Versand fehlgeschlagen — Passwort wurde trotzdem zurückgesetzt.' };
  }
  return { ok: true, error: null };
}
