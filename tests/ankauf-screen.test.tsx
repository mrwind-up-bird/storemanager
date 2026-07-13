// tests/ankauf-screen.test.tsx
// @vitest-environment jsdom

/// <reference types="@testing-library/jest-dom/vitest" />

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConnectPrompt } from '@/app/(app)/ankauf/_components/ConnectPrompt';

describe('ankauf screen pieces', () => {
  it('ConnectPrompt renders connect CTA', () => {
    render(<ConnectPrompt />);
    expect(screen.getByTestId('connect-discogs-prompt')).toBeTruthy();
    expect(screen.getByRole('link').getAttribute('href')).toBe('/api/discogs/connect');
  });
});
