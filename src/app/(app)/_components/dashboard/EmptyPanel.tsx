import type { ReactNode } from 'react';
import { Card } from '@/components/ui';

export interface EmptyPanelProps {
  /** Panel header title (Bricolage Grotesque 700 16px) */
  title: string;
  /** Calm placeholder copy — no fake numbers, no "Error" language */
  emptyMessage: string;
  /** Optional right-side header element (e.g. disabled "Alle →" button) */
  headerExtra?: ReactNode;
  /** Optional element prepended to title in the header (e.g. honey dot for Wunschlisten) */
  titlePrefix?: ReactNode;
  /** Optional testid for E2E locators; spread as data-testid on the outer Card. */
  testId?: string;
}

/**
 * Generic empty-state panel for deferred features (Letzte Verkäufe, Wunschlisten-Treffer).
 *
 * Verbatim layout from Q-Records App.dc.html DASHBOARD section (panel row):
 *   header: flex items-center justify-between p-[16px 18px] border-b text
 *   body:   p-[48px 24px] text-center text-3 (calm empty, no "Error")
 */
export function EmptyPanel({ title, emptyMessage, headerExtra, titlePrefix, testId }: EmptyPanelProps) {
  return (
    <Card elevation={1} style={{ overflow: 'hidden' }} {...(testId ? { 'data-testid': testId } : {})}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 18px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
          {titlePrefix}
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: '16px',
            }}
          >
            {title}
          </span>
        </div>
        {headerExtra}
      </div>
      <div
        style={{
          padding: '48px 24px',
          textAlign: 'center',
          color: 'var(--text-3)',
        }}
      >
        <p style={{ margin: 0, fontSize: '13.5px', lineHeight: 1.6 }}>
          {emptyMessage}
        </p>
      </div>
    </Card>
  );
}
