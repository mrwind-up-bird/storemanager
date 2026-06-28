import type { TextareaHTMLAttributes } from 'react';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> { error?: boolean }

export function Textarea({ error = false, className, style, ...rest }: TextareaProps) {
  return (
    <textarea
      {...rest}
      className={`focus-ring-field${className ? ` ${className}` : ''}`}
      style={{
        width: '100%', padding: '12px 14px',
        border: `1.5px solid ${error ? 'var(--bad)' : 'var(--border-strong)'}`,
        borderRadius: 'var(--r-md)',
        background: error ? 'var(--bad-soft)' : 'var(--surface-2)',
        color: 'var(--text)', fontFamily: 'var(--font-body)', fontSize: '15px', resize: 'vertical',
        ...style,
      }}
    />
  );
}
