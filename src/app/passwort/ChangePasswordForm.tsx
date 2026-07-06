'use client';

import { useActionState } from 'react';
import { Button, Input } from '@/components/ui';
import { changePasswordAction, type ChangePasswordState } from './actions';

const initialState: ChangePasswordState = { error: null };

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, initialState);
  return (
    <form
      action={action}
      data-testid="change-password-form"
      style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      <label htmlFor="currentPassword">Aktuelles Passwort</label>
      <Input
        id="currentPassword"
        name="currentPassword"
        type="password"
        autoComplete="current-password"
        required
        aria-label="Aktuelles Passwort"
      />
      <label htmlFor="newPassword">Neues Passwort (mind. 12 Zeichen)</label>
      <Input
        id="newPassword"
        name="newPassword"
        type="password"
        autoComplete="new-password"
        required
        minLength={12}
        aria-label="Neues Passwort"
      />
      <label htmlFor="confirmPassword">Neues Passwort wiederholen</label>
      <Input
        id="confirmPassword"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        required
        aria-label="Neues Passwort wiederholen"
      />
      {state.error ? <p role="alert">{state.error}</p> : null}
      <Button type="submit" loading={pending}>
        Passwort ändern
      </Button>
    </form>
  );
}
