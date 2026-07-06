'use client';

import { useActionState } from 'react';
import { Button, Input } from '@/components/ui';
import { createTeamUserAction, type TeamActionState } from '../actions';

const initialState: TeamActionState = { ok: false, error: null, info: null };

// Natives <select> statt UI-Select: dessen options/value/onChange sind Pflicht (controlled-only),
// hier reicht ein unkontrolliertes FormData-Feld (siehe Task 4, Step 4).
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

export function CreateUserForm() {
  const [state, action, pending] = useActionState(createTeamUserAction, initialState);
  return (
    <form
      action={action}
      data-testid="create-user-form"
      style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 420 }}
    >
      <label htmlFor="team-email">E-Mail</label>
      <Input id="team-email" name="email" type="email" required aria-label="E-Mail" />
      <label htmlFor="team-role">Rolle</label>
      <select id="team-role" name="role" defaultValue="mitarbeiter" aria-label="Rolle" className="focus-ring-field" style={selectStyle}>
        <option value="mitarbeiter">Mitarbeiter</option>
        <option value="kunde">Kunde</option>
      </select>
      {state.error ? <p role="alert" data-testid="create-user-error">{state.error}</p> : null}
      {state.ok && state.info ? <p data-testid="create-user-ok">{state.info}</p> : null}
      <Button type="submit" loading={pending}>
        User anlegen
      </Button>
    </form>
  );
}
