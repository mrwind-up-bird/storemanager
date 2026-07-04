'use client';

// Start-Screen Quick-Actions (C12) — nur mobil (.qr-mobile-only), nur Staff (Gate im Aufrufer).

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Euro, Heart, ScanLine, type LucideIcon } from 'lucide-react';
import { ScannerSheet } from '@/components/scanner/ScannerSheet';
import { VerkaufSheet } from './VerkaufSheet';

export function QuickActions() {
  const router = useRouter();
  const [scanOpen, setScanOpen] = useState(false);
  const [sellOpen, setSellOpen] = useState(false);

  const actions: Array<{ label: string; Icon: LucideIcon; onClick: () => void }> = [
    { label: 'Scannen', Icon: ScanLine, onClick: () => setScanOpen(true) },
    { label: 'Verkauf', Icon: Euro, onClick: () => setSellOpen(true) },
    { label: 'Wünsche', Icon: Heart, onClick: () => router.push('/wunschlisten') },
  ];

  return (
    <div
      className="qr-mobile-only"
      data-testid="quick-actions"
      style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 11 }}
    >
      {actions.map(({ label, Icon, onClick }) => (
        <button
          key={label}
          type="button"
          onClick={onClick}
          className="focus-ring-button"
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7,
            padding: '15px 8px', border: '1.5px solid var(--border-strong)',
            borderRadius: 'var(--r-lg)', background: 'var(--surface)',
            color: 'var(--text)', cursor: 'pointer',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 40, height: 40, borderRadius: '50%',
              background: 'var(--accent-soft)', color: 'var(--accent-ink)',
              display: 'grid', placeItems: 'center',
            }}
          >
            <Icon size={19} />
          </span>
          <span style={{ fontSize: 12, fontWeight: 700 }}>{label}</span>
        </button>
      ))}
      <ScannerSheet
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        mode="ean"
        onDetectEan={(ean) => {
          setScanOpen(false);
          router.push(`/ankauf?barcode=${encodeURIComponent(ean)}`);
        }}
      />
      <VerkaufSheet open={sellOpen} onClose={() => setSellOpen(false)} />
    </div>
  );
}
