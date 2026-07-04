'use client';

// Client-Klammer der mobilen Shell: MobileHeader + Schnellverkauf-State (C3/C9).

import { useState } from 'react';
import { MobileHeader } from './MobileHeader';
import { VerkaufSheet } from './VerkaufSheet';
import type { Role } from '@/db/schema';

export function MobileChrome({ role, tenantName }: { role: Role; tenantName: string }) {
  const [verkaufOpen, setVerkaufOpen] = useState(false);
  const isStaff = role !== 'kunde';
  return (
    <>
      <MobileHeader
        role={role}
        tenantName={tenantName}
        onSchnellverkauf={isStaff ? () => setVerkaufOpen(true) : undefined}
      />
      {isStaff && <VerkaufSheet open={verkaufOpen} onClose={() => setVerkaufOpen(false)} />}
    </>
  );
}
