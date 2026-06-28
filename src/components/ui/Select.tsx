import type { SelectHTMLAttributes } from 'react';

export interface SelectOption { value: string; label: string }
export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  error?: boolean;
}

export function Select({ options, value, onChange, error = false, className, style, ...rest }: SelectProps) {
  return (
    <div style={{ position: 'relative', display: 'flex' }}>
      <select
        {...rest}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`focus-ring-field${className ? ` ${className}` : ''}`}
        style={{
          appearance: 'none', width: '100%', minHeight: 'var(--tap)', padding: '0 40px 0 14px',
          border: `1.5px solid ${error ? 'var(--bad)' : 'var(--border-strong)'}`,
          borderRadius: 'var(--r-md)',
          background: error ? 'var(--bad-soft)' : 'var(--surface-2)',
          color: 'var(--text)', fontFamily: 'var(--font-body)', fontSize: '15px', cursor: 'pointer',
          ...style,
        }}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <span
        aria-hidden="true"
        style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', pointerEvents: 'none' }}
      >
        ▾
      </span>
    </div>
  );
}
