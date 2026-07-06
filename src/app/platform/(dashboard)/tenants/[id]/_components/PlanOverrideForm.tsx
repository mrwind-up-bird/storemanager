'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui';
import { setTenantPlanAction, type PlatformActionState } from '../../actions';

const initialState: PlatformActionState = { ok: false, error: null };

const selectStyle: React.CSSProperties = {
  minHeight: 'var(--tap)',
  padding: '0 14px',
  border: '1.5px solid var(--border-strong)',
  borderRadius: 'var(--r-md)',
  background: 'var(--surface-2)',
  color: 'var(--text)',
  fontFamily: 'var(--font-body)',
  fontSize: 15,
  cursor: 'pointer',
};

export function PlanOverrideForm({ tenantId, currentPlan }: { tenantId: number; currentPlan: string }) {
  const [state, action, pending] = useActionState(setTenantPlanAction, initialState);
  return (
    <form action={action} data-testid="plan-override-form" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      <input type="hidden" name="tenantId" value={tenantId} />
      <select name="plan" defaultValue={currentPlan} aria-label="Plan" className="focus-ring-field" style={selectStyle}>
        <option value="free">Free</option>
        <option value="small">Small</option>
        <option value="big">Big</option>
      </select>
      <Button type="submit" loading={pending}>
        Plan speichern
      </Button>
      {state.ok ? <span data-testid="plan-saved">Gespeichert.</span> : null}
      {state.error ? <p role="alert">{state.error}</p> : null}
    </form>
  );
}
