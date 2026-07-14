import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ScoreBadge } from '@/app/(app)/inventar/_components/ScoreBadge';

afterEach(cleanup);

describe('ScoreBadge (KI-Relevanz)', () => {
  it('rendert eine positive Relevanz als gerundetes Prozent', () => {
    render(<ScoreBadge score={0.853} />);
    expect(screen.getByTestId('ki-score')).toHaveTextContent('85%');
    expect(screen.getByLabelText('Relevanz: 85 Prozent')).toBeInTheDocument();
  });

  it('clamped eine negative Relevanz (negative Korrelation) auf 0 %', () => {
    // score = 1 - cosineDistance ∈ [-1, 1]; bei negativer Korrelation < 0. Ein negatives
    // Prozent-Badge ("-20 %") ist UX-Unsinn — auf 0 % clampen.
    render(<ScoreBadge score={-0.2} />);
    expect(screen.getByTestId('ki-score')).toHaveTextContent('0%');
    expect(screen.getByLabelText('Relevanz: 0 Prozent')).toBeInTheDocument();
  });
});
