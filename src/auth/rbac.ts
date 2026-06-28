import type { Role, SessionUser } from './schema-types';

export type Capability =
  | 'records:read'
  | 'records:write'
  | 'tenant:admin'
  | 'platform:superadmin';

const ROLE_CAPS: Record<Role, readonly Capability[]> = {
  superadmin: ['records:read', 'records:write', 'tenant:admin', 'platform:superadmin'],
  admin: ['records:read', 'records:write', 'tenant:admin'],
  mitarbeiter: ['records:read', 'records:write'],
  kunde: ['records:read'],
};

export function can(user: SessionUser, cap: Capability): boolean {
  if (user.isSuperadmin) return true;
  return ROLE_CAPS[user.role].includes(cap);
}
