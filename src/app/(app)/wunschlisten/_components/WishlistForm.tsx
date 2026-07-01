'use client';

// src/app/(app)/wunschlisten/_components/WishlistForm.tsx
// Wunsch-Erfassen-Formular (spec §5.4). artist required; label/title/country optional.
// Optional initialArtist/initialTitle support the §5.6 ♡ "Auf Wunschliste" prefill (♡ wiring is T11).

import { useState } from 'react';
import { createWishlist } from '../actions';

export interface WishlistFormProps {
  initialArtist?: string;
  initialTitle?: string;
}

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 11px',
  borderRadius: 'var(--r-md)',
  border: '1px solid var(--border-strong)',
  background: 'var(--surface-2)',
  color: 'var(--text)',
  fontSize: '14px',
};

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '5px',
  fontSize: '13px',
  fontWeight: 600,
  color: 'var(--text-2)',
};

export function WishlistForm({ initialArtist = '', initialTitle = '' }: WishlistFormProps) {
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [artist, setArtist] = useState(initialArtist);
  const [label, setLabel] = useState('');
  const [title, setTitle] = useState(initialTitle);
  const [country, setCountry] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsPending(true);
    try {
      const res = await createWishlist({
        customerName,
        customerEmail,
        artist,
        label: label.trim() || null,
        title: title.trim() || null,
        country: country.trim() || null,
      });
      if (res.ok) {
        setCustomerName('');
        setCustomerEmail('');
        setArtist('');
        setLabel('');
        setTitle('');
        setCountry('');
      } else {
        setError(res.message ?? 'Wunsch konnte nicht gespeichert werden.');
      }
    } finally {
      setIsPending(false);
    }
  };

  return (
    <form
      data-testid="wishlist-form"
      onSubmit={handleSubmit}
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: '12px',
        padding: '16px',
        borderRadius: 'var(--r-lg)',
        border: '1px solid var(--border)',
        background: 'var(--surface)',
      }}
    >
      <label style={labelStyle}>
        Kundenname
        <input
          data-testid="wl-customer-name"
          style={fieldStyle}
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          required
        />
      </label>
      <label style={labelStyle}>
        E-Mail
        <input
          data-testid="wl-customer-email"
          type="email"
          style={fieldStyle}
          value={customerEmail}
          onChange={(e) => setCustomerEmail(e.target.value)}
          required
        />
      </label>
      <label style={labelStyle}>
        Künstler
        <input
          data-testid="wl-artist"
          style={fieldStyle}
          value={artist}
          onChange={(e) => setArtist(e.target.value)}
          required
        />
      </label>
      <label style={labelStyle}>
        Label
        <input
          data-testid="wl-label"
          style={fieldStyle}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </label>
      <label style={labelStyle}>
        Titel
        <input
          data-testid="wl-title"
          style={fieldStyle}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label style={labelStyle}>
        Land
        <input
          data-testid="wl-country"
          style={fieldStyle}
          value={country}
          onChange={(e) => setCountry(e.target.value)}
        />
      </label>

      {error && (
        <p role="alert" style={{ gridColumn: '1 / -1', margin: 0, color: 'var(--bad)', fontSize: '13px' }}>
          {error}
        </p>
      )}

      <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="submit"
          data-testid="wishlist-submit"
          disabled={isPending}
          style={{
            padding: '9px 18px',
            borderRadius: 'var(--r-pill)',
            border: 'none',
            background: 'var(--accent)',
            color: 'var(--on-accent)',
            fontWeight: 600,
            fontSize: '14px',
            cursor: isPending ? 'default' : 'pointer',
            opacity: isPending ? 0.6 : 1,
          }}
        >
          {isPending ? 'Speichert…' : 'Wunsch speichern'}
        </button>
      </div>
    </form>
  );
}
