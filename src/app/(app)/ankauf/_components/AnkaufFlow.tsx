'use client';

// src/app/(app)/ankauf/_components/AnkaufFlow.tsx
// Variante 1A — "Zeilen-Flow / Erfassungsbogen". ONE page that handles a single item and a whole
// collection in the same flow: a seller card + N item rows + a sticky summary bar. Replaces the old
// single-item search+modal experience on /ankauf.
//
// Single + collection are unified through ONE submit path: createCollectionAction. A single item is
// just a 1-item collection — no separate ankaufRecord call, no branching. On success we push to
// /ankauf/sammlungen (matches the batch wizard's behaviour).
//
// Each row owns its own pricing/condition/validity (uncontrolled) and reports up via onChange; this
// component only tracks presence (running totals + submit gate) and assembles the final payload.

import { useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toCents, isValidMoneyString } from '@/lib/money';
import { formatEuroCents } from '@/lib/format';
import { createCollectionAction } from '../sammlung/actions';
import { AnkaufItemRow, type AnkaufRowValue } from './AnkaufItemRow';

interface Row {
  id: number;
}

const fieldLabelStyle: React.CSSProperties = {
  fontWeight: 600,
  fontSize: 13,
  color: 'var(--text-2)',
};

const fieldStyle: React.CSSProperties = {
  minHeight: 44,
  padding: '0 14px',
  border: '1.5px solid var(--border-strong)',
  borderRadius: 'var(--r-md)',
  background: 'var(--surface-2)',
  color: 'var(--text)',
  fontFamily: 'var(--font-body)',
  fontSize: 15,
  width: '100%',
};

const sectionHeadingStyle: React.CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontWeight: 700,
  fontSize: 13,
  textTransform: 'uppercase',
  letterSpacing: '.05em',
  color: 'var(--text-3)',
  margin: 0,
};

function safeToCents(value: string): number {
  if (!isValidMoneyString(value)) return 0;
  try {
    return toCents(value);
  } catch {
    return 0;
  }
}

export function AnkaufFlow() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextRowId = useRef(0);
  // /ankauf?barcode=… (global "Scannen" QuickAction) → auto-search on the first row, captured once.
  const bootBarcode = useRef<string | null>(searchParams.get('barcode'));

  const [sellerName, setSellerName] = useState('');
  const [sellerContact, setSellerContact] = useState('');
  const [note, setNote] = useState('');
  const [acquiredAt, setAcquiredAt] = useState('');
  const [sellerNameTouched, setSellerNameTouched] = useState(false);
  // CLIENT-ONLY confirmation toggle — a soft submit-gate, never persisted / transmitted.
  const [belegConfirmed, setBelegConfirmed] = useState(false);

  const [rows, setRows] = useState<Row[]>([{ id: nextRowId.current++ }]);
  const itemValues = useRef<Map<number, AnkaufRowValue>>(new Map());
  // Bumped whenever a row reports a change so we re-render and pick up the mutated map.
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
    forceRender((n) => n + 1);
  };

  const handleItemChange = (id: number, value: AnkaufRowValue) => {
    itemValues.current.set(id, value);
    forceRender((n) => n + 1);
  };

  // Running totals (EK/VK/margin). A row that hasn't reported yet contributes 0.
  let totalEkCents = 0;
  let totalVkCents = 0;
  for (const r of rows) {
    const v = itemValues.current.get(r.id);
    if (!v) continue;
    totalEkCents += safeToCents(v.purchasePrice);
    totalVkCents += safeToCents(v.targetPrice);
  }
  const totalMarginCents = totalVkCents - totalEkCents;

  const sellerNameValid = sellerName.trim().length > 0;
  // Every row must pass the server's per-item schema. A not-yet-reported row is invalid, not exempt.
  const allItemsValid = rows.length > 0 && rows.every((r) => itemValues.current.get(r.id)?.valid === true);
  // belegConfirmed is a CLIENT-ONLY confirmation nudge (never persisted) — it does NOT gate submit.
  const canSubmit = sellerNameValid && allItemsValid && !isPending;

  const itemCount = rows.length;
  const cta = itemCount > 1 ? 'Sammlung anlegen' : 'Ankauf buchen';

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
      // Single item = 1-item collection: one unified server path, no branching.
      const res = await createCollectionAction({
        sellerName: sellerName.trim(),
        sellerContact: sellerContact.trim() || undefined,
        note: note.trim() || undefined,
        acquiredAt: acquiredAt ? new Date(acquiredAt).toISOString() : undefined,
        items,
        // NB: belegConfirmed intentionally NOT included — client-only gate.
      });
      if (res.ok) {
        router.push('/ankauf/sammlungen');
      } else {
        setError(res.message ?? 'Ankauf konnte nicht gebucht werden.');
      }
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div
      data-testid="ankauf-screen"
      style={{
        width: '100%',
        maxWidth: 1220,
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-xl)',
        background: 'var(--surface-2)',
        boxShadow: 'var(--shadow-2)',
        overflow: 'hidden',
      }}
    >
      {/* page header */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          flexWrap: 'wrap',
          padding: '20px 26px',
          background: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div style={{ flex: 1, minWidth: 200 }}>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 800,
              fontSize: 23,
              letterSpacing: '-.02em',
              margin: 0,
            }}
          >
            Neuer Ankauf
          </h1>
          <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 2 }}>
            Einzelstück oder ganze Sammlung ·{' '}
            <span data-testid="ankauf-item-count">{itemCount}</span> Artikel erfasst
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 16px',
            borderRadius: 'var(--r-md)',
            background: 'var(--accent-soft)',
            border: '1px solid var(--accent-soft-border)',
          }}
        >
          <span style={{ fontSize: 12, color: 'var(--accent-ink)', fontWeight: 600 }}>Auszahlung</span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontWeight: 500,
              fontSize: 20,
              color: 'var(--accent-ink)',
              letterSpacing: '-.01em',
            }}
          >
            {formatEuroCents(totalEkCents)}
          </span>
        </div>
      </header>

      <div style={{ padding: '22px 26px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* seller card */}
        <section
          style={{
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-lg)',
            background: 'var(--surface)',
            boxShadow: 'var(--shadow-1)',
            padding: '18px 20px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14 }}>
            <span
              aria-hidden="true"
              style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--info)' }}
            />
            <h2 style={sectionHeadingStyle}>Verkäufer:in</h2>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
              gap: 14,
            }}
          >
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={fieldLabelStyle}>Name</span>
              <input
                data-testid="ankauf-seller-input"
                className="focus-ring-field"
                type="text"
                required
                value={sellerName}
                onChange={(e) => setSellerName(e.target.value)}
                onBlur={() => setSellerNameTouched(true)}
                aria-invalid={sellerNameTouched && !sellerNameValid}
                style={{
                  ...fieldStyle,
                  borderColor: sellerNameTouched && !sellerNameValid ? 'var(--bad)' : undefined,
                }}
              />
              {sellerNameTouched && !sellerNameValid && (
                <span role="alert" style={{ fontSize: 12, color: 'var(--bad)' }}>
                  Name ist erforderlich.
                </span>
              )}
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={fieldLabelStyle}>E-Mail</span>
              <input
                className="focus-ring-field"
                type="email"
                value={sellerContact}
                onChange={(e) => setSellerContact(e.target.value)}
                style={fieldStyle}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={fieldLabelStyle}>Datum</span>
              <input
                className="focus-ring-field"
                type="date"
                value={acquiredAt}
                onChange={(e) => setAcquiredAt(e.target.value)}
                style={{ ...fieldStyle, fontFamily: 'var(--font-mono)', fontSize: 14 }}
              />
            </label>
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 14 }}>
            <span style={fieldLabelStyle}>Notiz</span>
            <textarea
              className="focus-ring-field"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Kontext zum Ankauf, Herkunft der Sammlung …"
              style={{
                ...fieldStyle,
                minHeight: 60,
                padding: '11px 14px',
                lineHeight: 1.5,
                resize: 'vertical',
              }}
            />
          </label>

          {/* Ausweis-/Beleg-Bestätigung — CLIENT-ONLY soft submit-gate, never persisted. */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              cursor: 'pointer',
              marginTop: 14,
              paddingTop: 14,
              borderTop: '1px dashed var(--border)',
            }}
          >
            <button
              type="button"
              role="switch"
              aria-checked={belegConfirmed}
              aria-label="Ausweis geprüft & Ankaufsbeleg erstellt"
              data-testid="ankauf-beleg-toggle"
              className="focus-ring-button"
              onClick={() => setBelegConfirmed((v) => !v)}
              style={{
                position: 'relative',
                width: 38,
                height: 22,
                flexShrink: 0,
                borderRadius: 'var(--r-pill)',
                background: belegConfirmed ? 'var(--accent)' : 'var(--surface-3)',
                border: belegConfirmed ? 'none' : '1px solid var(--border-strong)',
                cursor: 'pointer',
                transition: 'background var(--dur-1) var(--ease)',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  top: 2,
                  left: belegConfirmed ? 18 : 2,
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  background: belegConfirmed ? '#ffffff' : 'var(--surface)',
                  boxShadow: 'var(--shadow-1)',
                  transition: 'left var(--dur-1) var(--ease)',
                }}
              />
            </button>
            <span style={{ fontSize: 13.5, color: 'var(--text-2)' }}>
              Ausweis geprüft &amp; Ankaufsbeleg erstellt{' '}
              <span style={{ color: 'var(--text-3)' }}>· gesetzlich für Gebrauchtankauf</span>
            </span>
          </label>
        </section>

        {/* items header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span
              aria-hidden="true"
              style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--accent)' }}
            />
            <h2 style={sectionHeadingStyle}>Artikel</h2>
          </div>
          <button
            type="button"
            data-testid="ankauf-add-item"
            onClick={addItem}
            className="focus-ring-button"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              minHeight: 42,
              padding: '0 18px',
              border: 'none',
              borderRadius: 'var(--r-pill)',
              background: 'var(--accent)',
              color: 'var(--on-accent)',
              fontWeight: 700,
              fontSize: 14,
              cursor: 'pointer',
              boxShadow: 'var(--shadow-1)',
            }}
          >
            <span aria-hidden="true" style={{ fontSize: 16 }}>
              +
            </span>{' '}
            Artikel hinzufügen
          </button>
        </div>

        {/* items list */}
        <div data-testid="ankauf-items" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {rows.length === 0 && (
            <p style={{ margin: 0, color: 'var(--text-3)', fontSize: 13.5 }}>
              Noch keine Artikel erfasst — füge den ersten hinzu.
            </p>
          )}
          {rows.map((r, i) => (
            <AnkaufItemRow
              key={r.id}
              index={i}
              onChange={(v) => handleItemChange(r.id, v)}
              onRemove={() => removeItem(r.id)}
              initialBarcode={i === 0 ? bootBarcode.current ?? undefined : undefined}
            />
          ))}
        </div>

        {error != null && (
          <p
            role="alert"
            data-testid="ankauf-error"
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

        {/* sticky summary bar */}
        <div
          className="ankauf-summary-bar"
          style={{
            position: 'sticky',
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 22,
            flexWrap: 'wrap',
            padding: '16px 20px',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-lg)',
            background: 'var(--surface)',
            boxShadow: 'var(--shadow-2)',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span
              style={{
                fontSize: 11,
                color: 'var(--text-3)',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '.05em',
              }}
            >
              Auszahlung (EK)
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontWeight: 500,
                fontSize: 22,
                letterSpacing: '-.01em',
              }}
            >
              {formatEuroCents(totalEkCents)}
            </span>
          </div>
          <div style={{ width: 1, height: 34, background: 'var(--border)' }} />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span
              style={{
                fontSize: 11,
                color: 'var(--text-3)',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '.05em',
              }}
            >
              Ziel-VK gesamt
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontWeight: 500,
                fontSize: 22,
                letterSpacing: '-.01em',
              }}
            >
              {formatEuroCents(totalVkCents)}
            </span>
          </div>
          <div style={{ width: 1, height: 34, background: 'var(--border)' }} />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span
              style={{
                fontSize: 11,
                color: 'var(--text-3)',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '.05em',
              }}
            >
              Marge gesamt
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontWeight: 500,
                fontSize: 22,
                letterSpacing: '-.01em',
                color: totalMarginCents >= 0 ? 'var(--ok)' : 'var(--bad)',
              }}
            >
              {formatEuroCents(totalMarginCents)}
            </span>
          </div>
          <button
            type="button"
            data-testid="ankauf-submit"
            disabled={!canSubmit}
            onClick={handleSubmit}
            className="focus-ring-button"
            style={{
              marginLeft: 'auto',
              minHeight: 'var(--tap)',
              padding: '0 26px',
              border: 'none',
              borderRadius: 'var(--r-pill)',
              background: canSubmit ? 'var(--accent)' : 'var(--surface-3)',
              color: canSubmit ? 'var(--on-accent)' : 'var(--text-3)',
              fontFamily: 'var(--font-body)',
              fontWeight: 700,
              fontSize: 15,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              boxShadow: canSubmit ? 'var(--shadow-1)' : 'none',
            }}
          >
            {isPending ? 'Wird gebucht…' : cta}
          </button>
        </div>
      </div>
    </div>
  );
}
