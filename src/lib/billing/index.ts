import 'server-only';
import { env } from '@/env';
import type { BillingAdapter } from './types';
import { createFakeBillingAdapter } from './fake';
import { createStripeBillingAdapter } from './stripe';

let cached: BillingAdapter | null = null;
export function getBillingAdapter(): BillingAdapter {
  if (cached) return cached;
  cached = env.BILLING_DRIVER === 'stripe' ? createStripeBillingAdapter() : createFakeBillingAdapter();
  return cached;
}
