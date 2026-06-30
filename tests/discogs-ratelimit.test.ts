import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRateLimiter } from '@/lib/discogs/ratelimit';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createRateLimiter', () => {
  it('spaces acquires by >= 1000/ratePerSec ms', async () => {
    const rl = createRateLimiter({ ratePerSec: 2 }); // 500ms spacing
    const order: number[] = [];
    const p1 = rl.acquire().then(() => order.push(1));
    const p2 = rl.acquire().then(() => order.push(2));
    const p3 = rl.acquire().then(() => order.push(3));
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual([1]);          // first is immediate
    await vi.advanceTimersByTimeAsync(500);
    expect(order).toEqual([1, 2]);
    await vi.advanceTimersByTimeAsync(500);
    expect(order).toEqual([1, 2, 3]);
    await Promise.all([p1, p2, p3]);
  });
});
