'use client';

// src/app/(app)/inventar/_components/LabelPrintModal.tsx
// A4 price-label printing (C12). jsPDF and qrcode are heavy client-only libs — they're loaded via
// dynamic import() inside the submit handler ONLY, so they never end up in the server bundle or
// the initial client bundle for /inventar or /ankauf/sammlungen/[id].

import { useState } from 'react';
import { Modal, Select } from '@/components/ui';
import { conditionLabel, type ConditionGrade } from '@/lib/pricing';
import {
  AVERY_3x8,
  labelGridLayout,
  discogsReleaseUrl,
  labelPriceText,
  type LabelItem,
  type LabelTemplate,
} from '@/lib/labels';

export interface LabelPrintModalProps {
  items: LabelItem[];
  open: boolean;
  onClose: () => void;
}

// Only one template for now (C12) — the select is still rendered so the layout is ready for more.
const TEMPLATES: { id: string; label: string; template: LabelTemplate }[] = [
  { id: 'avery_3x8', label: 'Avery 3×8 (24/Blatt, A4)', template: AVERY_3x8 },
];

/** Keeps a single label line from overflowing its cell. */
function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function LabelPrintModal({ items, open, onClose }: LabelPrintModalProps) {
  const [templateId, setTemplateId] = useState(TEMPLATES[0].id);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const template = TEMPLATES.find((t) => t.id === templateId)!.template;

  const handlePrint = async () => {
    setError(null);
    setIsPending(true);
    try {
      const { jsPDF } = await import('jspdf');
      const QR = (await import('qrcode')).default;

      const doc = new jsPDF({ unit: 'mm', format: 'a4' });
      let currentPage = 0;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const { page, cell } = labelGridLayout(i, template);
        if (page > currentPage) {
          doc.addPage();
          currentPage = page;
        }
        const { x, y, w, h } = cell;
        const pad = 2;

        doc.setFontSize(8);
        doc.text(truncate(`${item.artist} — ${item.title}`, 42), x + pad, y + pad + 3);

        doc.setFontSize(7);
        const grade = conditionLabel(item.conditionRecord as ConditionGrade);
        doc.text(item.format ? `${item.format} · ${grade}` : grade, x + pad, y + pad + 7);

        doc.setFontSize(13);
        doc.text(labelPriceText(item.priceCents), x + pad, y + h - pad - 1);

        if (item.discogsId != null) {
          const dataUrl = await QR.toDataURL(discogsReleaseUrl(item.discogsId));
          const qrSize = Math.min(w * 0.3, h - 2 * pad);
          doc.addImage(dataUrl, 'PNG', x + w - pad - qrSize, y + pad, qrSize, qrSize);
        }
      }

      doc.save('etiketten.pdf');
      onClose();
    } catch (err) {
      console.error('[label-print] PDF generation failed', err);
      setError('Etiketten konnten nicht erzeugt werden. Bitte erneut versuchen.');
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Etiketten drucken">
      <div data-testid="label-print-modal" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <span style={{ fontWeight: 600, fontSize: 13.5 }}>Vorlage</span>
          <div data-testid="label-template-select">
            <Select
              aria-label="Etiketten-Vorlage"
              options={TEMPLATES.map((t) => ({ value: t.id, label: t.label }))}
              value={templateId}
              onChange={setTemplateId}
            />
          </div>
        </label>

        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-2)' }}>
          {items.length} {items.length === 1 ? 'Etikett wird' : 'Etiketten werden'} erzeugt.
        </p>

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

        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              minHeight: 'var(--tap)',
              padding: '0 18px',
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
            data-testid="label-print-submit"
            onClick={handlePrint}
            disabled={items.length === 0 || isPending}
            className="focus-ring-button"
            style={{
              minHeight: 'var(--tap)',
              padding: '0 18px',
              border: 'none',
              borderRadius: 'var(--r-pill)',
              background: items.length === 0 || isPending ? 'var(--surface-3)' : 'var(--accent)',
              color: items.length === 0 || isPending ? 'var(--text-3)' : 'var(--on-accent)',
              fontFamily: 'var(--font-body)',
              fontWeight: 700,
              fontSize: 14.5,
              cursor: items.length === 0 || isPending ? 'not-allowed' : 'pointer',
            }}
          >
            {isPending ? 'Erzeuge…' : 'PDF erzeugen'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
