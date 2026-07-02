// tests/app/sammlungen.test.tsx
// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom/vitest" />
//
// Presentational component tests for the Sammlungen list + detail screens (Slice 4, Task 8).
// Both screens are thin async RSC pages that can't run in jsdom, so we render the presentational
// components they delegate to directly, from hand-built CollectionSummary[]/CollectionDetail
// fixtures (no DB, no server actions — mirrors tests/app/analytik.test.tsx).

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';

import { CollectionsList } from '@/app/(app)/ankauf/sammlungen/_components/CollectionsList';
import { CollectionDetailView } from '@/app/(app)/ankauf/sammlungen/_components/CollectionDetailView';
import type { CollectionSummary, CollectionDetail } from '@/lib/collections';
import { fromCents } from '@/lib/money';
import { conditionLabel } from '@/lib/pricing';

afterEach(cleanup);

function fixtureSummaries(): CollectionSummary[] {
  return [
    {
      id: 1,
      sellerName: 'Herbert Grönemeyer',
      acquiredAt: new Date('2026-06-27T10:00:00Z'),
      itemCount: 3,
      totalEkCents: 4550,
    },
    {
      id: 2,
      sellerName: 'Anna Krüger',
      acquiredAt: new Date('2026-06-20T09:00:00Z'),
      itemCount: 1,
      totalEkCents: 1200,
    },
  ];
}

function fixtureDetail(): CollectionDetail {
  return {
    id: 1,
    sellerName: 'Herbert Grönemeyer',
    acquiredAt: new Date('2026-06-27T10:00:00Z'),
    itemCount: 2,
    totalEkCents: 3550,
    sellerContact: '0170 1234567',
    note: 'Dachbodenfund, alles Vinyl',
    items: [
      {
        purchaseId: 101,
        recordId: 201,
        artist: 'Depeche Mode',
        title: 'Violator',
        format: 'Vinyl',
        conditionRecord: 5,
        purchasePriceCents: 2000,
        targetPriceCents: 3500,
        discogsId: 12345,
      },
      {
        purchaseId: 102,
        recordId: 202,
        artist: 'Kraftwerk',
        title: 'Autobahn',
        format: 'Vinyl',
        conditionRecord: 6,
        purchasePriceCents: 1550,
        targetPriceCents: null,
        discogsId: null,
      },
    ],
  };
}

describe('CollectionsList', () => {
  it('renders sammlungen-list, one sammlung-row per collection, with seller/date/count/total EK', () => {
    const collections = fixtureSummaries();
    render(<CollectionsList collections={collections} />);

    expect(screen.getByTestId('sammlungen-list')).toBeInTheDocument();

    const rows = screen.getAllByTestId('sammlung-row');
    expect(rows).toHaveLength(collections.length);

    const first = rows[0];
    expect(within(first).getByText('Herbert Grönemeyer')).toBeVisible();
    expect(within(first).getByText('3')).toBeVisible();
    expect(within(first).getByText(`€ ${fromCents(4550)}`)).toBeVisible();
    // formatted date (de-DE) — exact string the component is expected to produce
    expect(within(first).getByText(collections[0].acquiredAt.toLocaleDateString('de-DE'))).toBeVisible();
  });

  it('offers a "Sammlung anlegen" link to the batch-Ankauf wizard, selected by accessible name', () => {
    render(<CollectionsList collections={fixtureSummaries()} />);
    const link = screen.getByRole('link', { name: 'Sammlung anlegen' });
    expect(link).toHaveAttribute('href', '/ankauf/sammlung');
  });

  it('shows a friendly empty state when there are no collections', () => {
    render(<CollectionsList collections={[]} />);
    expect(screen.getByTestId('sammlungen-list')).toBeInTheDocument();
    expect(screen.queryAllByTestId('sammlung-row')).toHaveLength(0);
    expect(screen.getByText(/noch keine sammlungen/i)).toBeVisible();
  });
});

describe('CollectionDetailView', () => {
  it('renders sammlung-detail with header + item rows (conditionLabel, EK) + sammlung-print-labels', () => {
    const collection = fixtureDetail();
    render(<CollectionDetailView collection={collection} />);

    const detail = screen.getByTestId('sammlung-detail');
    expect(detail).toBeInTheDocument();
    expect(within(detail).getByText('Herbert Grönemeyer')).toBeVisible();
    expect(within(detail).getByText(collection.sellerContact!)).toBeVisible();
    expect(within(detail).getByText(collection.note!)).toBeVisible();

    // item rows: conditionLabel(5) === 'VG+', conditionLabel(6) === 'NM' — exact grade labels
    expect(within(detail).getByText(conditionLabel(5))).toBeVisible();
    expect(within(detail).getByText(conditionLabel(6))).toBeVisible();
    expect(within(detail).getByText(`€ ${fromCents(2000)}`)).toBeVisible();
    expect(within(detail).getByText(`€ ${fromCents(1550)}`)).toBeVisible();

    const printBtn = screen.getByTestId('sammlung-print-labels');
    expect(printBtn).toBeInTheDocument();
    expect(printBtn).toHaveAccessibleName(/etiketten drucken/i);
  });
});
