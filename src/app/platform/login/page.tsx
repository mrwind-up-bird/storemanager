'use client';

import { useActionState } from 'react';
import { Button, Input } from '@/components/ui';
import { platformLoginAction, type PlatformLoginState } from './actions';

const initialState: PlatformLoginState = { error: null };

export default function PlatformLoginPage() {
  const [state, action, pending] = useActionState(platformLoginAction, initialState);
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: 'var(--bg)',
        color: 'var(--text)',
        fontFamily: 'var(--font-body)',
        padding: 24,
      }}
    >
      <form
        action={action}
        data-testid="platform-login-form"
        style={{
          width: 'min(380px, 100%)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-lg)',
          padding: 24,
        }}
      >
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22, margin: 0 }}>
          Platform-Login
        </h1>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-3)' }}>
          q·records Superadmin-Zone
        </p>
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
