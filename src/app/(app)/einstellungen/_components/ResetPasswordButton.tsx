'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui';
import { resetTeamPasswordAction, type TeamActionState } from '../actions';

const initialState: TeamActionState = { ok: false, error: null, info: null };

export function ResetPasswordButton({ userId }: { userId: number }) {
  const [state, action, pending] = useActionState(resetTeamPasswordAction, initialState);
  return (
    <form action={action} style={{ display: 'inline' }}>
      <input type="hidden" name="userId" value={userId} />
      <Button type="submit" loading={pending}>
        Passwort zurücksetzen
      </Button>
      {state.info ? <span style={{ marginLeft: 8, fontSize: 12.5 }}>{state.info}</span> : null}
      {state.error ? <span role="alert" style={{ marginLeft: 8, fontSize: 12.5 }}>{state.error}</span> : null}
    </form>
  );
}
