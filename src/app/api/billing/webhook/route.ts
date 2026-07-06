import { NextResponse, type NextRequest } from 'next/server';
import { getBillingAdapter } from '@/lib/billing';
import { BillingSignatureError } from '@/lib/billing/types';
import { processBillingEvent } from '@/lib/billing/apply';

// Node-Runtime (Default) — Owner-Pool + Stripe-SDK sind Node-only.
// Raw-Body VOR jedem JSON-Parse lesen: die Stripe-Signatur deckt die exakten Bytes (Spec §9).
export async function POST(request: NextRequest): Promise<Response> {
  const rawBody = await request.text();
  const signature = request.headers.get('stripe-signature') ?? '';

  let event;
  try {
    event = getBillingAdapter().parseWebhookEvent(rawBody, signature);
  } catch (err) {
    if (err instanceof BillingSignatureError) {
      return new NextResponse(null, { status: 400 });
    }
    throw err;
  }

  try {
    await processBillingEvent(event);
  } catch (err) {
    // Tx (inkl. Dedup-Insert) ist zurückgerollt → Stripe-Retry verarbeitet sauber neu.
    console.error('[billing] Webhook-Verarbeitung fehlgeschlagen', err);
    return new NextResponse(null, { status: 500 });
  }

  // Immer 200 ohne interne Details (Spec §9.5) — auch für duplicate/ignored/unknown_target.
  return NextResponse.json({ received: true });
}
