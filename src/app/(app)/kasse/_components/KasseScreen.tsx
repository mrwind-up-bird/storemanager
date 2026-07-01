'use client';

import { useMemo, useState } from 'react';
import type { InventoryRow } from '@/lib/inventory';
import type { QuickItemRow } from '@/lib/quickItems';
import {
  computeCartTotals,
  type CartInput,
  type CartLineInput,
  type DiscountInput,
  type PaymentMethod,
  type ResolvedCartLine,
} from '@/lib/sales';
import { createSale } from '@/app/(app)/kasse/actions';
import { InventorySearch } from './InventorySearch';
import { QuickItemButtons } from './QuickItemButtons';
import { AdhocAdd } from './AdhocAdd';
import { Cart, type UiCartLine } from './Cart';
import { DiscountInput as DiscountControl } from './DiscountInput';
import { PaymentCluster } from './PaymentCluster';

const PRICE_RE = /^\d+(\.\d{1,2})?$/;

/** UI line → pure-totals line: inventory quantity is always 1 (C2 invariant). */
function toResolved(l: UiCartLine): ResolvedCartLine {
  return { label: l.label, unitPrice: l.unitPrice, quantity: l.kind === 'inventory' ? 1 : l.quantity };
}

/** UI line → C4 CartLineInput: strip display fields; inventory/quick carry NO client price (server is authority). */
function toInput(l: UiCartLine): CartLineInput {
  if (l.kind === 'inventory') return { kind: 'inventory', purchaseId: l.purchaseId };
  if (l.kind === 'quick') return { kind: 'quick', quickItemId: l.quickItemId, quantity: l.quantity };
  return { kind: 'adhoc', label: l.label, unitPrice: l.unitPrice, quantity: l.quantity };
}

export function KasseScreen({
  inventory,
  quickItems,
}: {
  inventory: InventoryRow[];
  quickItems: QuickItemRow[];
}) {
  const [lines, setLines] = useState<UiCartLine[]>([]);
  const [adhocCounter, setAdhocCounter] = useState(0);
  const [discountMode, setDiscountMode] = useState<DiscountInput['kind']>('amount');
  const [discountValue, setDiscountValue] = useState('');
  const [payment, setPayment] = useState<PaymentMethod>('bar');
  const [voucherCode, setVoucherCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const discount: DiscountInput | null = useMemo(() => {
    const v = discountValue.trim();
    if (!v) return null;
    if (discountMode === 'percent') {
      const n = Number(v);
      return Number.isFinite(n) ? { kind: 'percent', value: n } : null;
    }
    return PRICE_RE.test(v) ? { kind: 'amount', value: v } : null;
  }, [discountMode, discountValue]);

  const totals = useMemo(() => {
    try {
      return computeCartTotals(lines.map(toResolved), discount);
    } catch {
      return { subtotal: '0.00', discount: '0.00', total: '0.00' };
    }
  }, [lines, discount]);

  function addInventory(row: InventoryRow) {
    const key = `inv-${row.copyId}`;
    setLines((prev) =>
      prev.some((l) => l.key === key)
        ? prev // single-instance-per-copy (server independently dedupes; never trusts this key)
        : [...prev, { key, kind: 'inventory', purchaseId: row.copyId, label: row.title, unitPrice: row.vk ?? '0.00' }],
    );
  }

  function addQuick(item: QuickItemRow) {
    const key = `quick-${item.id}`;
    setLines((prev) => {
      const existing = prev.find((l) => l.key === key);
      if (existing && existing.kind === 'quick') {
        return prev.map((l) =>
          l.key === key && l.kind === 'quick' ? { ...l, quantity: l.quantity + 1 } : l,
        );
      }
      return [...prev, { key, kind: 'quick', quickItemId: item.id, label: item.name, unitPrice: item.price, quantity: 1 }];
    });
  }

  function addAdhoc(name: string, price: string) {
    const key = `adhoc-${adhocCounter}`;
    setAdhocCounter((c) => c + 1);
    setLines((prev) => [...prev, { key, kind: 'adhoc', label: name, unitPrice: price, quantity: 1 }]);
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  async function handleSubmit() {
    if (lines.length === 0) return;
    const input: CartInput = {
      lines: lines.map(toInput),
      payment,
      discount,
      voucherCode: payment === 'gutschein' ? voucherCode.trim() || null : null,
    };
    setSubmitting(true);
    const res = await createSale(input);
    setSubmitting(false);
    if (res.ok) {
      setLines([]);
      setDiscountValue('');
      setVoucherCode('');
      setPayment('bar');
      setMessage('Verkauf gespeichert.');
    } else {
      setMessage(res.message ?? 'Verkauf fehlgeschlagen.');
    }
  }

  return (
    <div
      data-testid="kasse-screen"
      style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start' }}
    >
      {/* Left: selection */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <InventorySearch rows={inventory} onAdd={addInventory} />
        <QuickItemButtons items={quickItems} onAdd={addQuick} />
        <AdhocAdd onAdd={addAdhoc} />
      </section>

      {/* Right: cart */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Cart
          lines={lines}
          totals={totals}
          onRemove={removeLine}
          onSubmit={handleSubmit}
          submitting={submitting}
        />
        <DiscountControl
          mode={discountMode}
          value={discountValue}
          onModeChange={setDiscountMode}
          onValueChange={setDiscountValue}
        />
        <PaymentCluster
          payment={payment}
          voucherCode={voucherCode}
          onPaymentChange={setPayment}
          onVoucherChange={setVoucherCode}
        />
        {message && (
          <p role="status" style={{ color: 'var(--text-3)', margin: 0 }}>
            {message}
          </p>
        )}
      </section>
    </div>
  );
}
