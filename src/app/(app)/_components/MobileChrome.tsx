'use client';

// Client-Klammer für die mobilen Shell-Teile mit State.
// Task 3: nur MobileHeader. Task 7: + VerkaufSheet-State und onSchnellverkauf.

import { MobileHeader } from './MobileHeader';
import type { Role } from '@/db/schema';

export function MobileChrome({ role, tenantName }: { role: Role; tenantName: string }) {
  return <MobileHeader role={role} tenantName={tenantName} />;
}
