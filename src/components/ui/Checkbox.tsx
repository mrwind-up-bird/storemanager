'use client';
import { useId } from 'react';

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  /** Accessible name WITHOUT rendering visible text — for uses where the visible row/card
   *  context already makes the label's content obvious (e.g. a per-row selection checkbox next
   *  to a title the row already displays) and a repeated visible sentence would just be noise.
   *  Additive/backwards-compatible: existing `label` usages are unaffected. If both are given,
   *  `ariaLabel` wins for the accessible name (visible `label` text still renders). */
  ariaLabel?: string;
  disabled?: boolean;
  id?: string;
}

export function Checkbox({ checked, onChange, label, ariaLabel, disabled = false, id: propId }: CheckboxProps) {
  const autoId = useId();
  const id = propId ?? autoId;
  return (
    <label
      htmlFor={id}
      className="focus-ring-within"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 12,
        cursor: disabled ? 'not-allowed' : 'pointer',
        minHeight: 'var(--tap)', opacity: disabled ? 0.6 : 1,
      }}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={ariaLabel}
        style={{
          position: 'absolute', width: 1, height: 1, padding: 0,
          margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', border: 0,
        }}
      />
      <span
        aria-hidden="true"
        style={{
          width: 24, height: 24, borderRadius: 7,
          display: 'grid', placeItems: 'center', flexShrink: 0,
          background: checked ? 'var(--accent)' : 'var(--surface)',
          border: checked ? 'none' : '1.5px solid var(--border-strong)',
          color: 'var(--on-accent)', fontSize: '14px', fontWeight: 800,
          transition: `background var(--dur-1) var(--ease)`,
        }}
      >
        {checked && '✓'}
      </span>
      {label && <span style={{ fontSize: '14px', color: 'var(--text)' }}>{label}</span>}
    </label>
  );
}
