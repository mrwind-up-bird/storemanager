import { describe, it, expect } from 'vitest';
import { notImplemented } from '@/lib/integrations/index';

describe('notImplemented', () => {
  it('throws including the adapter name', () => {
    expect(() => notImplemented('PaymentsAdapter.createCheckout')).toThrow(
      'PaymentsAdapter.createCheckout: not implemented in Slice 0',
    );
  });

  it('return type is never — TS compile guard (runtime: throws)', () => {
    // If notImplemented() returned, this test would fail via the throw check above.
    expect(() => notImplemented('test')).toThrow();
  });
});
