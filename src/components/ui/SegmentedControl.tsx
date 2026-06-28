'use client';
import { useId } from 'react';

export interface SegmentedOption { value: string; label: string }
export interface SegmentedControlProps {
  options: SegmentedOption[];
  value: string;
  onChange: (value: string) => void;
  'aria-label': string;
  className?: string;
}

export function SegmentedControl({ options, value, onChange, 'aria-label': ariaLabel, className }: SegmentedControlProps) {
  const groupId = useId();
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={className}
      style={{
        display: 'inline-flex', gap: 4, padding: 3,
        borderRadius: 'var(--r-pill)', background: 'var(--surface-3)',
      }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        const inputId = `${groupId}-${opt.value}`;
        return (
          <label
            key={opt.value}
            htmlFor={inputId}
            className="focus-ring-within"
            style={{
              display: 'inline-block', padding: '6px 14px',
              borderRadius: 'var(--r-pill)', fontSize: '12.5px',
              fontWeight: active ? 700 : 600,
              color: active ? 'var(--text)' : 'var(--text-3)',
              background: active ? 'var(--surface)' : 'transparent',
              boxShadow: active ? 'var(--shadow-1)' : 'none',
              cursor: 'pointer',
              transition: `background var(--dur-1) var(--ease)`,
            }}
          >
            <input
              id={inputId}
              type="radio"
              name={groupId}
              value={opt.value}
              checked={active}
              onChange={() => onChange(opt.value)}
              style={{
                position: 'absolute', width: 1, height: 1, padding: 0,
                margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', border: 0,
              }}
            />
            {opt.label}
          </label>
        );
      })}
    </div>
  );
}
