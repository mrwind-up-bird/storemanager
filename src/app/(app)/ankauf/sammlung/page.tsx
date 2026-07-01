// src/app/(app)/ankauf/sammlung/page.tsx
// RSC: staff-only gate (batch-Ankauf is not customer-facing) → render the wizard.

import { forbidden } from 'next/navigation';
import { requireSession } from '@/auth/session';
import { CollectionWizard } from './_components/CollectionWizard';

export default async function SammlungPage() {
  const user = await requireSession();
  if (user.role === 'kunde') forbidden();

  return (
    <div style={{ maxWidth: 900 }}>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: 'clamp(20px,3vw,26px)',
            letterSpacing: '-.02em',
            margin: 0,
          }}
        >
          Batch-Ankauf
        </h1>
        <p style={{ color: 'var(--text-2)', fontSize: 15, margin: 0 }}>
          Eine Sammlung mit mehreren Artikeln in einem Ankauf erfassen.
        </p>
      </header>
      <CollectionWizard />
    </div>
  );
}
