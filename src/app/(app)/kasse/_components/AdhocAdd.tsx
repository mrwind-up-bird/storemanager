'use client';

import { useState } from 'react';

const PRICE_RE = /^\d+(\.\d{1,2})?$/;

export function AdhocAdd({ onAdd }: { onAdd: (name: string, price: string) => void }) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const valid = name.trim().length > 0 && PRICE_RE.test(price.trim());
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <input
        placeholder="Bezeichnung"
        value={name}
        onChange={(e) => setName(e.target.value)}
        style={{
          padding: '8px 10px',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-md)',
          background: 'var(--surface)',
        }}
      />
      <input
        placeholder="Preis"
        value={price}
        inputMode="decimal"
        onChange={(e) => setPrice(e.target.value)}
        style={{
          width: 90,
          padding: '8px 10px',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-md)',
          background: 'var(--surface)',
        }}
      />
      <button
        type="button"
        data-testid="kasse-adhoc-add"
        disabled={!valid}
        onClick={() => {
          onAdd(name.trim(), price.trim());
          setName('');
          setPrice('');
        }}
        style={{
          padding: '8px 12px',
          border: 'none',
          borderRadius: 'var(--r-md)',
          background: 'var(--accent)',
          color: 'var(--on-accent)',
          cursor: valid ? 'pointer' : 'not-allowed',
          opacity: valid ? 1 : 0.5,
        }}
      >
        +
      </button>
    </div>
  );
}
