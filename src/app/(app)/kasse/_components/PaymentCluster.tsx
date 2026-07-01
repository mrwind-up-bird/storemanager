'use client';

import type { PaymentMethod } from '@/lib/sales';

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'bar', label: 'Bar' },
  { value: 'karte', label: 'Karte' },
  { value: 'paypal', label: 'PayPal' },
  { value: 'gutschein', label: 'Gutschein' },
];

export function PaymentCluster({
  payment,
  voucherCode,
  onPaymentChange,
  onVoucherChange,
}: {
  payment: PaymentMethod;
  voucherCode: string;
  onPaymentChange: (m: PaymentMethod) => void;
  onVoucherChange: (v: string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {METHODS.map((m) => {
          const selected = m.value === payment;
          return (
            <button
              key={m.value}
              type="button"
              data-testid={`kasse-pay-${m.value}`}
              aria-pressed={selected}
              onClick={() => onPaymentChange(m.value)}
              style={{
                padding: '8px 12px',
                borderRadius: 'var(--r-md)',
                border: selected ? '1px solid var(--accent)' : '1px solid var(--border)',
                background: selected ? 'var(--accent)' : 'var(--surface)',
                color: selected ? 'var(--on-accent)' : 'var(--text-1)',
                cursor: 'pointer',
              }}
            >
              {m.label}
            </button>
          );
        })}
      </div>
      {payment === 'gutschein' && (
        <input
          data-testid="voucher-code-input"
          placeholder="Gutschein-Code"
          value={voucherCode}
          onChange={(e) => onVoucherChange(e.target.value)}
          style={{
            padding: '8px 10px',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-md)',
            background: 'var(--surface)',
          }}
        />
      )}
    </div>
  );
}
