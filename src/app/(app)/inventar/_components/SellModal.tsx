'use client';

// src/app/(app)/inventar/_components/SellModal.tsx
// Einzel-Verkauf-Modal (handoff-true) — quick single-copy sale from an inventory row.
// Submits a 1-line { kind:'inventory', purchaseId } cart to createSale (C11). The SERVER is
// the sole price authority (spec §6.1, C5 §0a delta 2): sell-price-input is a READ-ONLY display
// of the copy's stored targetPrice; no client price is ever sent. If targetPrice is absent the
// modal disables sell-submit and shows "kein VK-Preis hinterlegt" — createSale then cannot record
// a €0.00 sale (C5 SalePriceMissingError, fail-closed; §0a delta 3).

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { createSale } from '@/app/(app)/kasse/actions';
import type { PaymentMethod } from '@/lib/sales';

export interface SellModalProps {
  purchaseId: number;
  title: string;
  artist: string;
  targetPrice: string | null; // InventoryRow.vk (numeric(10,2) string) or null
  onClose: () => void;
}

const PAYMENTS: { method: PaymentMethod; label: string }[] = [
  { method: 'bar', label: '⛁ Bar' },
  { method: 'karte', label: '▭ Karte' },
  { method: 'paypal', label: 'PayPal' },
  { method: 'gutschein', label: '◫ Gutschein' },
];

export function SellModal({ purchaseId, title, artist, targetPrice, onClose }: SellModalProps) {
  const [payment, setPayment] = useState<PaymentMethod>('bar');
  const [voucherCode, setVoucherCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const priceMissing = targetPrice == null || targetPrice.trim() === '';
  const voucherMissing = payment === 'gutschein' && voucherCode.trim() === '';
  const submitDisabled = priceMissing || voucherMissing || isPending;

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSubmit = async () => {
    if (submitDisabled) return;
    setError(null);
    setIsPending(true);
    try {
      const res = await createSale({
        lines: [{ kind: 'inventory', purchaseId }],
        payment,
        discount: null,
        voucherCode: payment === 'gutschein' ? voucherCode.trim() : null,
      });
      if (res.ok) {
        onClose();
      } else {
        setError(res.message ?? 'Verkauf fehlgeschlagen. Bitte erneut versuchen.');
      }
    } finally {
      setIsPending(false);
    }
  };

  return createPortal(
    <div
      onClick={onClose}
      className="qr-modal-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'grid',
        placeItems: 'center',
        padding: '16px',
        background: 'rgba(20,14,8,.42)',
        backdropFilter: 'blur(2px)',
        WebkitBackdropFilter: 'blur(2px)',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Exemplar verkaufen"
        data-testid="sell-modal"
        className="qr-modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(460px, 100%)',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-xl)',
          boxShadow: 'var(--shadow-3)',
          overflow: 'hidden',
        }}
      >
        {/* ── Header ─────────────────────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '18px 22px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <span
            aria-hidden="true"
            style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--accent)', flex: 'none' }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 19, lineHeight: 1.1 }}>
              {title}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-2)' }}>Verkauf · {artist}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Schließen"
            className="focus-ring-button"
            style={{
              width: 36,
              height: 36,
              border: 'none',
              borderRadius: '50%',
              background: 'var(--surface-3)',
              color: 'var(--text-2)',
              fontSize: 16,
              cursor: 'pointer',
              display: 'grid',
              placeItems: 'center',
            }}
          >
            ✕
          </button>
        </div>

        {/* ── Body ───────────────────────────────────────────────── */}
        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Verkaufspreis € — READ-ONLY (server is price authority) */}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <span style={{ fontWeight: 600, fontSize: 13.5 }}>Verkaufspreis €</span>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <span
                aria-hidden="true"
                style={{ position: 'absolute', left: 14, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}
              >
                €
              </span>
              <input
                type="text"
                data-testid="sell-price-input"
                readOnly
                value={priceMissing ? '' : (targetPrice as string)}
                aria-label="Verkaufspreis (Festpreis aus dem Bestand)"
                style={{
                  width: '100%',
                  minHeight: 'var(--tap)',
                  padding: '0 14px 0 30px',
                  border: '1.5px solid var(--border-strong)',
                  borderRadius: 'var(--r-md)',
                  background: 'var(--surface-2)',
                  color: 'var(--text)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 15,
                  cursor: 'default',
                }}
              />
            </div>
          </label>

          {priceMissing && (
            <p
              role="alert"
              style={{
                margin: 0,
                padding: '10px 14px',
                borderRadius: 'var(--r-md)',
                background: 'var(--bad-soft)',
                color: 'var(--bad)',
                border: '1px solid color-mix(in srgb, var(--bad) 30%, transparent)',
                fontSize: 13.5,
              }}
            >
              kein VK-Preis hinterlegt
            </p>
          )}

          {/* Zahlungsart cluster */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <span style={{ fontWeight: 600, fontSize: 13.5 }}>Zahlungsart</span>
            <div role="radiogroup" aria-label="Zahlungsart" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {PAYMENTS.map(({ method, label }) => {
                const isSelected = payment === method;
                return (
                  <button
                    key={method}
                    type="button"
                    role="radio"
                    data-testid={`sell-pay-${method}`}
                    aria-checked={isSelected}
                    onClick={() => setPayment(method)}
                    style={{
                      padding: '9px 14px',
                      borderRadius: 'var(--r-pill)',
                      border: 'none',
                      fontSize: 13,
                      fontWeight: isSelected ? 700 : 600,
                      background: isSelected ? 'var(--accent)' : 'var(--surface-3)',
                      color: isSelected ? 'var(--on-accent)' : 'var(--text-2)',
                      boxShadow: isSelected ? 'var(--shadow-1)' : undefined,
                      cursor: 'pointer',
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Gutschein-Code — only for gutschein */}
          {payment === 'gutschein' && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <span style={{ fontWeight: 600, fontSize: 13.5 }}>Gutschein-Code</span>
              <input
                type="text"
                data-testid="voucher-code-input"
                value={voucherCode}
                onChange={(e) => setVoucherCode(e.target.value)}
                placeholder="z. B. GUT-2026-XYZ"
                style={{
                  width: '100%',
                  minHeight: 'var(--tap)',
                  padding: '0 14px',
                  border: '1.5px solid var(--border-strong)',
                  borderRadius: 'var(--r-md)',
                  background: 'var(--surface-2)',
                  color: 'var(--text)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 15,
                }}
              />
            </label>
          )}

          {/* Summe */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              paddingTop: 4,
              borderTop: '1px solid var(--border)',
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--text-2)' }}>Summe</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 18 }}>
              € {priceMissing ? '—' : (targetPrice as string)}
            </span>
          </div>

          {error != null && (
            <p
              role="alert"
              style={{
                margin: 0,
                padding: '10px 14px',
                borderRadius: 'var(--r-md)',
                background: 'var(--bad-soft)',
                color: 'var(--bad)',
                border: '1px solid color-mix(in srgb, var(--bad) 30%, transparent)',
                fontSize: 13.5,
              }}
            >
              {error}
            </p>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            gap: 12,
            padding: '16px 22px',
            borderTop: '1px solid var(--border)',
            background: 'var(--surface-2)',
          }}
        >
          <button
            type="button"
            data-testid="sell-cancel"
            onClick={onClose}
            style={{
              flex: 1,
              minHeight: 'var(--tap)',
              border: '1.5px solid var(--border-strong)',
              borderRadius: 'var(--r-pill)',
              background: 'var(--surface)',
              color: 'var(--text)',
              fontFamily: 'var(--font-body)',
              fontWeight: 600,
              fontSize: 14.5,
              cursor: 'pointer',
            }}
          >
            Abbrechen
          </button>
          <button
            type="button"
            data-testid="sell-submit"
            onClick={handleSubmit}
            disabled={submitDisabled}
            className="focus-ring-button"
            style={{
              flex: 1.5,
              minHeight: 'var(--tap)',
              border: 'none',
              borderRadius: 'var(--r-pill)',
              background: submitDisabled ? 'var(--surface-3)' : 'var(--accent)',
              color: submitDisabled ? 'var(--text-3)' : 'var(--on-accent)',
              fontFamily: 'var(--font-body)',
              fontWeight: 700,
              fontSize: 14.5,
              cursor: submitDisabled ? 'not-allowed' : 'pointer',
              transition: 'background var(--dur-1) var(--ease)',
            }}
          >
            Verkaufen
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
