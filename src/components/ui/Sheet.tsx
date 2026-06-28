'use client';
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { X } from 'lucide-react';

const FOCUSABLE_SEL = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (!el) return;
    const getFocusable = () => Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE_SEL));
    getFocusable()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const els = getFocusable();
      if (!els.length) return;
      const first = els[0], last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, [ref, active]);
}

export type SheetSide = 'right' | 'bottom';
export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  side?: SheetSide;
  children: ReactNode;
}

export function Sheet({ open, onClose, title, side = 'right', children }: SheetProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [open, onClose]);

  useFocusTrap(dialogRef, open);

  if (!open) return null;

  const positionStyle: React.CSSProperties = side === 'right'
    ? { top: 0, right: 0, bottom: 0, width: 'min(480px, 90vw)', borderRadius: 'var(--r-xl) 0 0 var(--r-xl)' }
    : { left: 0, right: 0, bottom: 0, borderRadius: 'var(--r-xl) var(--r-xl) 0 0', maxHeight: '85vh' };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'rgba(20,14,8,.42)',
        backdropFilter: 'blur(2px)',
        WebkitBackdropFilter: 'blur(2px)',
      }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          position: 'absolute', background: 'var(--surface)',
          border: '1px solid var(--border)', boxShadow: 'var(--shadow-3)',
          display: 'flex', flexDirection: 'column', overflowY: 'auto',
          ...positionStyle,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '16px 18px', borderBottom: '1px solid var(--border)', flexShrink: 0,
          }}
        >
          {title && (
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '18px' }}>
              {title}
            </span>
          )}
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="focus-ring-button"
            style={{
              width: 34, height: 34, border: 'none', borderRadius: '50%',
              background: 'var(--surface-3)', color: 'var(--text-2)',
              cursor: 'pointer', display: 'grid', placeItems: 'center',
            }}
          >
            <X size={16} aria-hidden />
          </button>
        </div>
        <div style={{ padding: '18px', flex: 1, overflowY: 'auto' }}>{children}</div>
      </div>
    </div>
  );
}
