// tests/ankauf-screen.test.tsx
// @vitest-environment jsdom

/// <reference types="@testing-library/jest-dom/vitest" />

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConnectPrompt } from '@/app/(app)/ankauf/_components/ConnectPrompt';
import { ResultCard } from '@/app/(app)/ankauf/_components/ResultCard';

describe('ankauf screen pieces', () => {
  it('ConnectPrompt renders connect CTA', () => {
    render(<ConnectPrompt />);
    expect(screen.getByTestId('connect-discogs-prompt')).toBeTruthy();
    expect(screen.getByRole('link').getAttribute('href')).toBe('/api/discogs/connect');
  });
  it('ResultCard shows title/artist/median + Ankaufen, disabled wishlist', () => {
    render(
      <ResultCard
        result={{
          discogsId: 42,
          title: 'Kind of Blue',
          artist: 'Miles Davis',
          country: 'US',
          year: 1959,
          format: 'Vinyl',
          genre: ['Jazz'],
          label: ['Columbia'],
          coverImage: null,
          community: { want: 9, have: 5 },
          median: 22.5,
        }}
        onAnkauf={() => {}}
      />,
    );
    expect(screen.getByText('Kind of Blue')).toBeTruthy();
    expect(screen.getByTestId('ankauf-open')).toBeTruthy();
    expect(screen.getByLabelText(/merkliste|wunschliste/i)).toHaveProperty('disabled', true);
  });
});
