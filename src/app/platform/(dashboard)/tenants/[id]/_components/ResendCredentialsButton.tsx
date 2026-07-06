'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui';
import { resendCredentialsAction, type PlatformActionState } from '../../actions';

const initialState: PlatformActionState = { ok: false, error: null };

export function ResendCredentialsButton({ tenantId, adminEmail }: { tenantId: number; adminEmail: string }) {
  const [state, action, pending] = useActionState(resendCredentialsAction, initialState);
  return (
    <form action={action} data-testid="resend-credentials-form">
      <input type="hidden" name="tenantId" value={tenantId} />
      <Button type="submit" loading={pending}>
        Credentials-Mail erneut senden
      </Button>
      <p style={{ fontSize: 12.5, color: 'var(--text-3)', margin: '6px 0 0' }}>
        Setzt ein neues temporäres Passwort für {adminEmail} und erzwingt den Passwortwechsel.
      </p>
      {state.ok ? <p data-testid="resend-ok">Mail verschickt.</p> : null}
      {state.error ? <p role="alert">{state.error}</p> : null}
    </form>
  );
}
