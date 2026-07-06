// Slice 6 T11 — Stepper pixel-treu zum Handoff: 4 Kreise (30px), Labels Info/Discogs/Admin/Review,
// done/current = accent, future = surface-3 + border-strong, aria-current auf dem aktuellen Schritt.
// Plus Spec §14 „Wizard-Schritt-Actions (jsdom/RTL für … Formularfehler)": das im Wizard
// eingebettete ShopInfoForm (T7) zeigt den Action-Fehler als role="alert".
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { WizardStepper } from '@/app/onboarding/_components/WizardStepper';
import { ShopInfoForm } from '@/app/(app)/einstellungen/_components/ShopInfoForm';

vi.mock('@/app/(app)/einstellungen/actions', () => ({
  updateShopInfoAction: vi.fn(async () => ({ ok: false, error: 'Name darf nicht leer sein.' })),
}));

// Kein globales Auto-Cleanup (vitest.config.ts) — Konvention wie tests/theme-provider.test.tsx.
afterEach(() => {
  cleanup();
});

describe('WizardStepper', () => {
  it('rendert 4 Schritte mit den Handoff-Labels', () => {
    render(<WizardStepper current={2} />);
    for (const label of ['Info', 'Discogs', 'Admin', 'Review']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('markiert den aktuellen Schritt mit aria-current="step"', () => {
    render(<WizardStepper current={3} />);
    const items = screen.getAllByTestId('wizard-step');
    expect(items).toHaveLength(4);
    expect(items[2]!.getAttribute('aria-current')).toBe('step');
    expect(items[0]!.getAttribute('aria-current')).toBeNull();
    expect(items[0]!.getAttribute('data-state')).toBe('done');
    expect(items[2]!.getAttribute('data-state')).toBe('current');
    expect(items[3]!.getAttribute('data-state')).toBe('future');
  });
});

describe('Wizard-Schritt: Formularfehler (Spec §14)', () => {
  it('ShopInfoForm (next="wizard") zeigt den Action-Fehler als role="alert"', async () => {
    render(<ShopInfoForm initialName="Demo" initialColor="#C84B31" next="wizard" submitLabel="Weiter" />);
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.submit(screen.getByTestId('shop-info-form'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Name darf nicht leer sein.');
  });
});
