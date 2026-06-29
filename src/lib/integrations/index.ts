// src/lib/integrations/index.ts

/** Throw from every stub method. Every adapter in Slice 0 is interface-only. */
export function notImplemented(name: string): never {
  throw new Error(`${name}: not implemented in Slice 0`);
}

// ---------------------------------------------------------------------------
// Payments (e.g. Stripe, SumUp)
// ---------------------------------------------------------------------------
export interface PaymentsAdapter {
  createCheckout(args: {
    tenantId: number;
    amountCents: number;
    description: string;
    returnUrl: string;
  }): Promise<{ checkoutUrl: string; sessionId: string }>;

  getCheckoutStatus(args: {
    tenantId: number;
    sessionId: string;
  }): Promise<{ status: 'pending' | 'paid' | 'failed' }>;

  refund(args: {
    tenantId: number;
    sessionId: string;
    amountCents: number;
  }): Promise<{ refundId: string }>;
}

// ---------------------------------------------------------------------------
// Point-of-sale terminal (e.g. SumUp Card Reader)
// ---------------------------------------------------------------------------
export interface PosAdapter {
  createSale(args: {
    tenantId: number;
    amountCents: number;
    reference: string;
  }): Promise<{ transactionId: string }>;

  cancelSale(args: { tenantId: number; transactionId: string }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Social / marketing (e.g. Instagram, Discogs marketplace listing)
// ---------------------------------------------------------------------------
export interface SocialAdapter {
  postListing(args: {
    tenantId: number;
    recordId: number;
    caption: string;
    imageUrl?: string;
  }): Promise<{ postId: string; postUrl: string }>;

  deleteListing(args: { tenantId: number; postId: string }): Promise<void>;
}

// ---------------------------------------------------------------------------
// AI semantic search (Slice 4)
// ---------------------------------------------------------------------------
export interface AiSearchAdapter {
  searchRecords(args: {
    tenantId: number;
    query: string;
    limit?: number;
  }): Promise<Array<{ id: number; score: number }>>;

  indexRecord(args: { tenantId: number; recordId: number }): Promise<void>;
}

// ---------------------------------------------------------------------------
// ELSTER tax export (German tax authority, Slice 6)
// ---------------------------------------------------------------------------
export interface ElsterExportAdapter {
  exportTaxData(args: {
    tenantId: number;
    year: number;
  }): Promise<{ xmlPayload: string; validationWarnings: string[] }>;
}
