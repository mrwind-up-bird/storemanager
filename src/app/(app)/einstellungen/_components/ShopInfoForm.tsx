'use client';

import { useActionState } from 'react';
import { Button, Input } from '@/components/ui';
import { updateShopInfoAction, type ShopInfoState } from '../actions';

const initialState: ShopInfoState = { ok: false, error: null };

/**
 * EIN Formular, zwei Einbettungen (Spec §12): Einstellungen-Info-Tab (next='stay')
 * und Wizard Schritt 1 (next='wizard' → Redirect auf ?step=2).
 */
export function ShopInfoForm({
  initialName,
  initialColor,
  next = 'stay',
  submitLabel = 'Speichern',
}: {
  initialName: string;
  initialColor: string;
  next?: 'stay' | 'wizard';
  submitLabel?: string;
}) {
  const [state, action, pending] = useActionState(updateShopInfoAction, initialState);
  return (
    <form
      action={action}
      data-testid="shop-info-form"
      style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 420 }}
    >
      <input type="hidden" name="next" value={next} />
      <label htmlFor="shop-name">Shop-Name</label>
      <Input id="shop-name" name="name" defaultValue={initialName} required aria-label="Shop-Name" />
      <label htmlFor="shop-color">Primärfarbe</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Input
          id="shop-color"
          name="primaryColor"
          defaultValue={initialColor}
          required
          aria-label="Primärfarbe"
          style={{ flex: 1 }}
        />
        <span
          aria-hidden="true"
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            background: initialColor,
            border: '1px solid var(--border-strong)',
            flexShrink: 0,
          }}
        />
      </div>
      {state.error ? <p role="alert">{state.error}</p> : null}
      {state.ok ? <p data-testid="shop-info-saved">Gespeichert.</p> : null}
      <Button type="submit" loading={pending}>
        {submitLabel}
      </Button>
    </form>
  );
}
