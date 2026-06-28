'use client';
import { useId } from 'react';

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  id?: string;
}

export function Toggle({ checked, onChange, label, disabled = false, id: propId }: ToggleProps) {
  const autoId = useId();
  const id = propId ?? autoId;
  return (
    <label
      htmlFor={id}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 12,
        cursor: disabled ? 'not-allowed' : 'pointer',
        minHeight: 28, opacity: disabled ? 0.6 : 1,
      }}
    >
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{
          position: 'absolute', width: 1, height: 1, padding: 0,
          margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', border: 0,
        }}
      />
      <span
        aria-hidden="true"
        style={{
          position: 'relative', width: 46, height: 28, borderRadius: 'var(--r-pill)',
          background: checked ? 'var(--accent)' : 'var(--surface-3)',
          border: checked ? 'none' : '1px solid var(--border-strong)',
          flexShrink: 0, transition: `background var(--dur-1) var(--ease)`,
        }}
      >
        <span
          style={{
            position: 'absolute', top: 3, left: checked ? 21 : 3,
            width: 22, height: 22, borderRadius: '50%',
            background: checked ? '#ffffff' : 'var(--surface)',
            boxShadow: 'var(--shadow-1)',
            transition: `left var(--dur-1) var(--ease)`,
          }}
        />
      </span>
      {label && <span style={{ fontSize: '14px', color: 'var(--text)' }}>{label}</span>}
    </label>
  );
}
