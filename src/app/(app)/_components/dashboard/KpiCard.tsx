import type { ReactNode } from 'react';
import { Card } from '@/components/ui';

export interface KpiCardProps {
  label: string;
  icon?: ReactNode;
  /** When true renders the accent (coral) variant — Ankäufe heute card */
  accent?: boolean;
  children: ReactNode;
}

/**
 * Generic KPI card wrapper.
 * Verbatim layout from Q-Records App.dc.html DASHBOARD section:
 *   border: 1px solid var(--border), border-radius: var(--r-lg), padding: 20px,
 *   shadow-1 (default) / shadow-2 (accent). Label 13px text-2 600, icon 15px text-3.
 */
export function KpiCard({ label, icon, accent = false, children }: KpiCardProps) {
  return (
    <Card
      elevation={accent ? 2 : 1}
      style={{
        padding: '20px',
        ...(accent
          ? { background: 'var(--accent)', color: 'var(--on-accent)' }
          : {}),
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span
          style={{
            fontSize: '13px',
            fontWeight: 600,
            ...(accent ? { opacity: 0.9 } : { color: 'var(--text-2)' }),
          }}
        >
          {label}
        </span>
        {icon != null && (
          <span
            aria-hidden="true"
            style={{
              fontSize: '15px',
              ...(accent ? { opacity: 0.8 } : { color: 'var(--text-3)' }),
            }}
          >
            {icon}
          </span>
        )}
      </div>
      {children}
    </Card>
  );
}
