'use client';
import type { ReactNode } from 'react';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'honey';
export type ButtonSize    = 'sm36' | 'md44' | 'lg52';

export interface ButtonProps {
  variant?:    ButtonVariant;
  size?:       ButtonSize;
  loading?:    boolean;
  disabled?:   boolean;
  icon?:       ReactNode;
  onClick?:    () => void;
  type?:       'button' | 'submit' | 'reset';
  className?:  string;
  children?:   ReactNode;
  'aria-label'?: string;
}

const SIZES: Record<ButtonSize, { minHeight: string; padding: string; fontSize: string }> = {
  sm36: { minHeight: '36px',       padding: '0 16px', fontSize: '13px' },
  md44: { minHeight: 'var(--tap)', padding: '0 22px', fontSize: '15px' },
  lg52: { minHeight: '52px',       padding: '0 28px', fontSize: '17px' },
};

const VARIANTS: Record<ButtonVariant, { bg: string; color: string; border: string; spinnerColor: string }> = {
  primary:   { bg: 'var(--accent)',  color: 'var(--on-accent)', border: 'none',                             spinnerColor: 'var(--on-accent)' },
  secondary: { bg: 'var(--surface)', color: 'var(--text)',      border: '1.5px solid var(--border-strong)', spinnerColor: 'var(--text)' },
  ghost:     { bg: 'transparent',   color: 'var(--accent-ink)', border: 'none',                            spinnerColor: 'var(--accent-ink)' },
  danger:    { bg: 'var(--bad)',     color: '#ffffff',           border: 'none',                            spinnerColor: '#ffffff' },
  honey:     { bg: 'var(--honey)',   color: '#3a2400',           border: 'none',                            spinnerColor: '#3a2400' },
};

export function Button({
  variant = 'primary',
  size = 'md44',
  loading = false,
  disabled = false,
  icon,
  onClick,
  type = 'button',
  className,
  children,
  'aria-label': ariaLabel,
}: ButtonProps) {
  const v = VARIANTS[variant];
  const s = SIZES[size];
  const isDisabled = disabled || loading;

  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={loading ? 'true' : undefined}
      aria-label={ariaLabel}
      onClick={onClick}
      // focus-ring-button applies: :focus-visible { outline:3px solid var(--focus); outline-offset:2px }
      className={`focus-ring-button${className ? ` ${className}` : ''}`}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
        minHeight: s.minHeight, padding: s.padding, fontSize: s.fontSize,
        fontFamily: 'var(--font-body)', fontWeight: 700,
        borderRadius: 'var(--r-pill)', border: v.border,
        background: (isDisabled && !loading) ? 'var(--surface-3)' : v.bg,
        color:      (isDisabled && !loading) ? 'var(--text-3)'    : v.color,
        cursor: loading ? 'wait' : isDisabled ? 'not-allowed' : 'pointer',
        transition: `background var(--dur-1) var(--ease)`,
        boxShadow: (variant === 'primary' && !isDisabled) ? 'var(--shadow-1)' : 'none',
        lineHeight: 1,
      }}
    >
      {loading && <Spinner size={16} color={v.spinnerColor} />}
      {!loading && icon}
      {children}
    </button>
  );
}
