'use client';

// src/app/(app)/ankauf/sammlung/_components/CollectionWizard.tsx
// Batch-Ankauf wizard (spec §5.8-ish / Slice 4 C10/C14): capture one seller + N line items in a
// single Sammlung, then submit them all in one createCollectionAction call. Each item's pricing
// is owned by CollectionItemRow (uncontrolled); this component only tracks presence (for the
// running total + submit gate) and assembles the final payload on submit.

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { sumLineCents, toCents } from '@/lib/money';
import { formatEuroCents } from '@/lib/format';
import { createCollectionAction } from '../actions';
import { CollectionItemRow, type CollectionRowValue } from './CollectionItemRow';

interface Row {
  id: number;
}

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 5,
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--text-2)',
};

const fieldStyle: React.CSSProperties = {
  minHeight: 'var(--tap)',
  padding: '0 12px',
  border: '1.5px solid var(--border-strong)',
  borderRadius: 'var(--r-md)',
  background: 'var(--surface-2)',
  color: 'var(--text)',
  fontFamily: 'var(--font-body)',
  fontSize: 14,
};

/** toCents throws on anything that isn't a clean 2-decimal string — treat that as "not priced yet". */
function safeToCents(value: string): number {
  try {
    return toCents(value);
  } catch {
    return 0;
  }
}

export function CollectionWizard() {
  const router = useRouter();
  const nextRowId = useRef(0);

  const [sellerName, setSellerName] = useState('');
  const [sellerContact, setSellerContact] = useState('');
  const [note, setNote] = useState('');
  const [acquiredAt, setAcquiredAt] = useState('');

  const [rows, setRows] = useState<Row[]>([]);
  const itemValues = useRef<Map<number, CollectionRowValue>>(new Map());
  // Bumped whenever a row reports a change, so the component re-renders and picks up the
  // (mutated-in-place) itemValues map for the running total / submit payload.
  const [, forceRender] = useState(0);

  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const addItem = () => {
    const id = nextRowId.current++;
    setRows((rs) => [...rs, { id }]);
  };

  const removeItem = (id: number) => {
    itemValues.current.delete(id);
    setRows((rs) => rs.filter((r) => r.id !== id));
  };

  const handleItemChange = (id: number, value: CollectionRowValue) => {
    itemValues.current.set(id, value);
    forceRender((n) => n + 1);
  };

  const totalCents = sumLineCents(
    rows.map((r) => ({ unitCents: safeToCents(itemValues.current.get(r.id)?.purchasePrice ?? ''), quantity: 1 })),
  );

  // A row that hasn't reported in yet (no onChange fired) is treated as invalid, not exempt —
  // an empty/undefined map entry must never let the batch through (finding F1).
  const allItemsValid = rows.every((r) => itemValues.current.get(r.id)?.valid === true);
  const canSubmit = sellerName.trim().length > 0 && rows.length > 0 && allItemsValid && !isPending;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setError(null);
    setIsPending(true);
    try {
      const items = rows.map((r) => {
        const v = itemValues.current.get(r.id);
        return {
          release: v?.release ?? null,
          purchasePrice: v?.purchasePrice ?? '',
          targetPrice: v?.targetPrice ?? '',
          conditionRecord: v?.conditionRecord,
          conditionCover: v?.conditionCover,
          listOnDiscogs: v?.listOnDiscogs ?? false,
        };
      });
      const res = await createCollectionAction({
        sellerName: sellerName.trim(),
        sellerContact: sellerContact.trim() || undefined,
        note: note.trim() || undefined,
        acquiredAt: acquiredAt ? new Date(acquiredAt).toISOString() : undefined,
        items,
      });
      if (res.ok) {
        router.push('/ankauf/sammlungen');
      } else {
        setError(res.message ?? 'Sammlung konnte nicht angelegt werden.');
      }
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div
      data-testid="sammlung-screen"
      style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 900 }}
    >
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 12,
          padding: 16,
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-lg)',
          background: 'var(--surface)',
        }}
      >
        <label style={labelStyle}>
          Verkäufer:in
          <input
            data-testid="sammlung-seller-input"
            style={fieldStyle}
            value={sellerName}
            onChange={(e) => setSellerName(e.target.value)}
            required
          />
        </label>
        <label style={labelStyle}>
          Kontakt (Telefon/E-Mail)
          <input
            style={fieldStyle}
            value={sellerContact}
            onChange={(e) => setSellerContact(e.target.value)}
          />
        </label>
        <label style={labelStyle}>
          Ankaufsdatum
          <input
            type="date"
            style={fieldStyle}
            value={acquiredAt}
            onChange={(e) => setAcquiredAt(e.target.value)}
          />
        </label>
        <label style={{ ...labelStyle, gridColumn: '1 / -1' }}>
          Notiz
          <textarea
            style={{ ...fieldStyle, minHeight: 60, padding: '10px 12px', resize: 'vertical' }}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Artikel</h2>
          <button
            type="button"
            data-testid="sammlung-add-item"
            onClick={addItem}
            style={{
              minHeight: 'var(--tap)',
              padding: '0 16px',
              border: 'none',
              borderRadius: 'var(--r-pill)',
              background: 'var(--accent)',
              color: 'var(--on-accent)',
              fontWeight: 700,
              fontSize: 13.5,
              cursor: 'pointer',
            }}
          >
            + Artikel hinzufügen
          </button>
        </div>

        <div data-testid="sammlung-items" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {rows.length === 0 && (
            <p style={{ margin: 0, color: 'var(--text-3)', fontSize: 13.5 }}>
              Noch keine Artikel erfasst.
            </p>
          )}
          {rows.map((r, i) => (
            <CollectionItemRow
              key={r.id}
              index={i}
              onChange={(v) => handleItemChange(r.id, v)}
              onRemove={() => removeItem(r.id)}
            />
          ))}
        </div>

        {rows.length > 0 && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 8,
              fontFamily: 'var(--font-mono)',
              fontSize: 14,
            }}
          >
            <span style={{ color: 'var(--text-2)' }}>Gesamt (EK):</span>
            <strong>{formatEuroCents(totalCents)}</strong>
          </div>
        )}
      </section>

      {error != null && (
        <p
          role="alert"
          style={{
            margin: 0,
            padding: '10px 14px',
            borderRadius: 'var(--r-md)',
            background: 'var(--bad-soft)',
            color: 'var(--bad)',
            fontSize: 13.5,
          }}
        >
          {error}
        </p>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          data-testid="sammlung-submit"
          disabled={!canSubmit}
          onClick={handleSubmit}
          style={{
            minHeight: 'var(--tap)',
            padding: '0 24px',
            border: 'none',
            borderRadius: 'var(--r-pill)',
            background: canSubmit ? 'var(--accent)' : 'var(--surface-3)',
            color: canSubmit ? 'var(--on-accent)' : 'var(--text-3)',
            fontWeight: 700,
            fontSize: 14.5,
            cursor: canSubmit ? 'pointer' : 'not-allowed',
          }}
        >
          {isPending ? 'Wird angelegt…' : 'Sammlung anlegen'}
        </button>
      </div>
    </div>
  );
}
