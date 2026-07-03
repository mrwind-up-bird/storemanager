// src/app/(app)/analytik/_components/PeriodToggle.tsx
'use client';

import { useRouter } from 'next/navigation';
import { SegmentedControl } from '@/components/ui';
import type { AnalyticsPeriod } from '@/lib/analytics';

export interface PeriodToggleProps {
  period: AnalyticsPeriod;
}

const OPTIONS: { value: AnalyticsPeriod; label: string }[] = [
  { value: 'week', label: 'Woche' },
  { value: 'month', label: 'Monat' },
  { value: 'quarter', label: 'Quartal' },
];

/** Woche/Monat/Quartal segmented toggle — pushes `?period=` so the RSC re-fetches (C14). */
export function PeriodToggle({ period }: PeriodToggleProps) {
  const router = useRouter();

  return (
    <div data-testid="analytik-period-toggle">
      <SegmentedControl
        options={OPTIONS}
        value={period}
        onChange={(value) => router.push(`/analytik?period=${value}`)}
        aria-label="Zeitraum"
      />
    </div>
  );
}
