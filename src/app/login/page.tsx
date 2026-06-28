'use client';

import { useActionState } from 'react';
import { Button, Input } from '@/components/ui';
import { loginAction, type LoginState } from './actions';

const initialState: LoginState = { error: null };

export default function LoginPage() {
  const [state, action, pending] = useActionState(loginAction, initialState);
  return (
    <main>
      <form action={action}>
        <label htmlFor="email">E-Mail</label>
        <Input id="email" name="email" type="email" autoComplete="email" required aria-label="E-Mail" />
        <label htmlFor="password">Passwort</label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-label="Passwort"
        />
        {state.error ? <p role="alert">{state.error}</p> : null}
        <Button type="submit" loading={pending}>
          Anmelden
        </Button>
      </form>
    </main>
  );
}
