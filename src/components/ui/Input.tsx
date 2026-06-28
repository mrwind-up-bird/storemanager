import type { InputHTMLAttributes } from 'react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> { error?: boolean }

export function Input({ error = false, className, style, ...rest }: InputProps) {
  return (
    <input
      {...rest}
      // focus-ring-field: :focus-visible { outline:none; border-color:var(--accent); box-shadow:0 0 0 3px var(--accent-soft) }
      className={`focus-ring-field${className ? ` ${className}` : ''}`}
      style={{
        width: '100%', minHeight: 'var(--tap)', padding: '0 14px',
        border: `1.5px solid ${error ? 'var(--bad)' : 'var(--border-strong)'}`,
        borderRadius: 'var(--r-md)',
        background: error ? 'var(--bad-soft)' : 'var(--surface-2)',
        color: 'var(--text)', fontFamily: 'var(--font-body)', fontSize: '15px',
        ...style,
      }}
    />
  );
}
