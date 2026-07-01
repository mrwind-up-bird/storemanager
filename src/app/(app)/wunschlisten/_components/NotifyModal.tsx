'use client';

// src/app/(app)/wunschlisten/_components/NotifyModal.tsx
// Benachrichtigen-Modal (spec §5.5). The preview is READ-ONLY (CONTRACTS §0a delta 1 / C10):
// it renders the sendWishlistNotificationEmail copy verbatim; there is NO staff-editable body in Slice 3.
// "Senden" enqueues the notify job via notifyWishlistMatch (C11); the worker is the sole sender (C9.4).

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PendingMatchRow } from '@/lib/wishlist';
import { notifyWishlistMatch } from '../actions';

export interface NotifyModalProps {
  match: PendingMatchRow;
  tenantName: string;
  onClose: () => void;
}

/** Read-only preview text mirroring the locked C10 sendWishlistNotificationEmail template
 *  (permalinkUrl omitted in Slice 3). Kept in sync with C10 by contract. */
function buildPreview(match: PendingMatchRow, tenantName: string): { subject: string; body: string } {
  const subject = `Dein Wunsch ist da: ${match.artist} – ${match.title}`;
  const body = [
    `Hallo ${match.customerName},`,
    '',
    `gute Nachrichten! Ein Titel von deiner Wunschliste ist bei ${tenantName} eingetroffen:`,
    '',
    `${match.artist} – ${match.title}`,
    '',
    'Komm gern vorbei oder melde dich, wenn du ihn reservieren möchtest.',
    '',
    'Viele Grüße',
    tenantName,
  ].join('\n');
  return { subject, body };
}

export function NotifyModal({ match, tenantName, onClose }: NotifyModalProps) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const { subject, body } = buildPreview(match, tenantName);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSend = async () => {
    setError(null);
    setIsPending(true);
    try {
      const res = await notifyWishlistMatch({ matchId: match.matchId });
      if (res.ok) {
        onClose();
      } else {
        setError(res.message ?? 'Benachrichtigung fehlgeschlagen.');
      }
    } finally {
      setIsPending(false);
    }
  };

  return createPortal(
    <div
      onClick={onClose}
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
        data-testid="notify-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(560px, 100%)',
          background: 'var(--surface)',
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--r-lg)',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        <h2 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: '18px', color: 'var(--text)' }}>
          Kunde benachrichtigen
        </h2>
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-2)' }}>An: {match.customerEmail}</p>
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-2)' }}>Betreff: {subject}</p>

        {/* READ-ONLY rendered template — NOT an editable field (CONTRACTS §0a delta 1). */}
        <pre
          data-testid="notify-preview"
          style={{
            margin: 0,
            padding: '12px 14px',
            borderRadius: 'var(--r-md)',
            border: '1px solid var(--border)',
            background: 'var(--surface-2)',
            color: 'var(--text)',
            fontFamily: 'inherit',
            fontSize: '13px',
            whiteSpace: 'pre-wrap',
          }}
        >
          {body}
        </pre>

        {error && (
          <p role="alert" style={{ margin: 0, color: 'var(--bad)', fontSize: '13px' }}>
            {error}
          </p>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button
            type="button"
            data-testid="notify-cancel"
            onClick={onClose}
            style={{
              padding: '9px 16px',
              borderRadius: 'var(--r-pill)',
              border: '1px solid var(--border-strong)',
              background: 'var(--surface)',
              color: 'var(--text)',
              fontWeight: 600,
              fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            Abbrechen
          </button>
          <button
            type="button"
            data-testid="notify-send"
            onClick={handleSend}
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
            {isPending ? 'Sendet…' : 'Senden'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
