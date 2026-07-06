import type { Role } from '@/db/schema';

export type { Role };

export type SessionUser = {
  id: number;
  email: string;
  tenantId: number;
  role: Role;
  isSuperadmin: boolean;
  mustChangePassword: boolean;
};
