'use client';
import type { InputHTMLAttributes } from 'react';
import { Search } from 'lucide-react';

export interface SearchFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  pill?: boolean;
}

export function SearchField({ pill = true, className, style, ...rest }: SearchFieldProps) {
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <Search
        aria-hidden
        size={17}
        style={{ position: 'absolute', left: 13, color: 'var(--text-3)', pointerEvents: 'none' }}
      />
      <input
        type="search"
        {...rest}
        className={`focus-ring-field${className ? ` ${className}` : ''}`}
        style={{
          width: '100%', minHeight: 'var(--tap)', padding: '0 14px 0 38px',
          border: '1.5px solid var(--border-strong)',
          borderRadius: pill ? 'var(--r-pill)' : 'var(--r-md)',
          background: 'var(--surface-2)', color: 'var(--text)',
          fontFamily: 'var(--font-body)', fontSize: '15px',
          ...style,
        }}
      />
    </div>
  );
}
