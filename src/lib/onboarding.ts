import type { Role } from '@/auth/schema-types';

/**
 * Ob ein Nutzer in den Onboarding-Wizard geleitet werden muss: nur ein Admin bzw. Superadmin
 * eines Tenants OHNE abgeschlossenes Onboarding (Spec §11). Geteilt vom (app)-Layout-Redirect
 * und dem Post-Passwortwechsel-Redirect — die sicherheitsrelevante Gating-Regel lebt hier an
 * EINER Stelle statt wörtlich dupliziert. Strukturelle Param-Typen: SessionUser und Tenant
 * erfüllen sie beide, ohne diese Datei an sie zu koppeln.
 */
export function needsOnboarding(
  user: { role: Role; isSuperadmin: boolean },
  tenant: { onboardingCompletedAt: Date | null },
): boolean {
  return (user.role === 'admin' || user.isSuperadmin) && !tenant.onboardingCompletedAt;
}
