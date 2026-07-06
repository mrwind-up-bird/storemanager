'use client';

import { useActionState } from 'react';
import { Button, Input } from '@/components/ui';
import { createTenantAction, type CreateTenantState } from '../actions';

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

const initialState: CreateTenantState = { ok: false, error: null, temporaryPassword: null, slug: null };

export function CreateTenantForm({ rootDomain }: { rootDomain: string }) {
  const [state, action, pending] = useActionState(createTenantAction, initialState);

  if (state.ok && state.temporaryPassword) {
    return (
      <div
        data-testid="platform-tenant-created"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          background: 'var(--surface)',
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--r-lg)',
          padding: 20,
        }}
      >
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 18 }}>Tenant angelegt</h2>
        <p style={{ margin: 0, fontSize: 14 }}>
          Login: <strong>{state.slug}.{rootDomain}</strong>
        </p>
        <p style={{ margin: 0, fontSize: 14 }}>
          Temporäres Passwort (einmalige Anzeige — wurde zusätzlich per Mail verschickt):
        </p>
        <code
          data-testid="temp-password"
          style={{
            fontFamily: 'monospace',
            letterSpacing: '.05em',
            fontSize: 16,
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-md)',
            padding: '10px 14px',
          }}
        >
          {state.temporaryPassword}
        </code>
      </div>
    );
  }

  return (
    <form
      action={action}
      data-testid="platform-tenant-create-form"
      style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 420 }}
    >
      <label htmlFor="slug">Slug (Subdomain)</label>
      <Input id="slug" name="slug" required aria-label="Slug" placeholder="plattenkiste" />
      <label htmlFor="name">Name</label>
      <Input id="name" name="name" required aria-label="Name" placeholder="Die Plattenkiste" />
      <label htmlFor="adminEmail">Admin-E-Mail</label>
      <Input id="adminEmail" name="adminEmail" type="email" required aria-label="Admin-E-Mail" />
      <label htmlFor="primaryColor">Primärfarbe</label>
      <Input id="primaryColor" name="primaryColor" defaultValue="#C84B31" required aria-label="Primärfarbe" />
      <label htmlFor="plan">Plan</label>
      <select id="plan" name="plan" defaultValue="free" aria-label="Plan" className="focus-ring-field" style={selectStyle}>
        <option value="free">Free</option>
        <option value="small">Small</option>
        <option value="big">Big</option>
      </select>
      {state.error ? <p role="alert">{state.error}</p> : null}
      <Button type="submit" loading={pending}>
        Anlegen
      </Button>
    </form>
  );
}
