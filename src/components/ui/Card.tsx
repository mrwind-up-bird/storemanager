import type { ReactNode, HTMLAttributes } from 'react';

export type CardElevation = 1 | 2 | 3;
export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  elevation?: CardElevation;
  children: ReactNode;
}

export function Card({ elevation = 1, className, style, children, ...rest }: CardProps) {
  return (
    <div
      {...rest}
      className={className}
      style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-lg)',
        background: 'var(--surface)',
        boxShadow: `var(--shadow-${elevation})`,
        overflow: 'hidden',
        ...style,
      }}
    >
      {children}
    </div>
  );
}
