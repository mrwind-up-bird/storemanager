import type { ReactNode, HTMLAttributes } from 'react';

export type SurfaceLevel = 1 | 2 | 3;
export interface SurfaceProps extends HTMLAttributes<HTMLDivElement> {
  level?: SurfaceLevel;
  children: ReactNode;
}

const BG: Record<SurfaceLevel, string> = {
  1: 'var(--surface)',
  2: 'var(--surface-2)',
  3: 'var(--surface-3)',
};

export function Surface({ level = 1, className, style, children, ...rest }: SurfaceProps) {
  return (
    <div
      {...rest}
      className={className}
      style={{ background: BG[level], ...style }}
    >
      {children}
    </div>
  );
}
