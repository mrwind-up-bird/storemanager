'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';
import type { InventoryStatus } from '@/lib/inventory';

type TabValue = InventoryStatus | '';

interface TabDef {
  label: string;
  value: TabValue;
}

const TABS: TabDef[] = [
  { label: 'Alle', value: '' },
  { label: 'im Lager', value: 'verfuegbar' },
  { label: 'Verliehen', value: 'verliehen' },
  { label: 'Verkauft', value: 'verkauft' },
];

export interface StatusTabsProps {
  byStatus: Record<InventoryStatus, number>;
  total: number; // count matching q+format+genre+condition, ignoring status tab
}

export function StatusTabs({ byStatus, total }: StatusTabsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = (searchParams.get('status') ?? '') as TabValue;

  const setStatus = useCallback(
    (value: TabValue) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set('status', value);
      } else {
        params.delete('status');
      }
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );

  const countFor = (value: TabValue): number => {
    if (value === '') return total;
    return byStatus[value] ?? 0;
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {TABS.map((tab) => {
        const active = current === tab.value;
        return (
          <button
            key={tab.value || 'alle'}
            type="button"
            onClick={() => setStatus(tab.value)}
            aria-pressed={active}
            className="focus-ring-button"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 14px',
              minHeight: 'var(--tap)',
              borderRadius: 'var(--r-pill)',
              border: active ? 'none' : '1px solid var(--border-strong)',
              background: active ? 'var(--accent)' : 'var(--surface)',
              color: active ? 'var(--on-accent)' : 'var(--text-2)',
              fontFamily: 'var(--font-body)',
              fontWeight: active ? 700 : 600,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            {tab.label}
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                opacity: 0.7,
                fontSize: 12,
              }}
            >
              {countFor(tab.value)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
