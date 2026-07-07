'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Lock, ScanLine } from 'lucide-react';
import { SearchField } from '@/components/ui/SearchField';
import { Select } from '@/components/ui/Select';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ScannerSheet } from '@/components/scanner/ScannerSheet';
import { SellModal } from './SellModal';
import { findAvailableCopiesByRelease, type CopyHit } from '@/app/(app)/kasse/actions';

const FORMAT_OPTIONS = [
  { value: '', label: 'Alle Formate' },
  { value: 'Vinyl', label: 'Vinyl' },
  { value: 'CD', label: 'CD' },
  { value: 'Kassette', label: 'Kassette' },
];

const CONDITION_OPTIONS = [
  { value: '', label: 'Jeder Zustand' },
  { value: 'mint_nm', label: 'Mint – NM (≥6)' },
  { value: 'vgplus', label: 'VG+ und besser (≥5)' },
  { value: 'vg', label: 'VG und besser (≥4)' },
];

export interface FilterBarProps {
  genreOptions: string[];
  resultCount: number;
  valueAvailable: number;
  kiEnabled: boolean;
  planName: string;
  isAdmin: boolean;
}

export function FilterBar({ genreOptions, resultCount, valueAvailable, kiEnabled, planName, isAdmin }: FilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // KI-Suche (Slice 7): Modus aus der URL — 'ki' nur bei explizitem ?mode=ki UND aktivem Feature,
  // sonst 'classic'. Ohne das kiEnabled-Gate würde ein downgegradeter Tenant mit einem alten
  // ?mode=ki-Bookmark den KI-Placeholder + Enter-only-Submit neben der "KI locked"-Anzeige sehen.
  const mode = kiEnabled && searchParams.get('mode') === 'ki' ? 'ki' : 'classic';

  // Controlled search field — debounced URL push
  const [q, setQ] = useState(searchParams.get('q') ?? '');

  // Keep local q in sync on URL change (back-navigation, StatusTabs push, etc.)
  useEffect(() => {
    setQ(searchParams.get('q') ?? '');
  }, [searchParams]);

  // Debounce: push URL 300 ms after q changes, skip if already matches URL.
  // Im KI-Modus NICHT feuern — dort löst Enter (onKeyDown) den ?q=-Push aus, damit pro Suche
  // genau ein Embedding-Call entsteht statt einer pro Tastendruck.
  useEffect(() => {
    if (mode !== 'classic') return;
    const trimmed = q.trim();
    const urlQ = searchParams.get('q') ?? '';
    if (trimmed === urlQ) return;
    const tid = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (trimmed) {
        params.set('q', trimmed);
      } else {
        params.delete('q');
      }
      router.push(`${pathname}?${params.toString()}`);
    }, 300);
    return () => clearTimeout(tid);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, mode]); // intentionally only q/mode — avoid infinite loop from searchParams/router/pathname deps

  const setParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );

  const reset = useCallback(() => {
    router.push(pathname);
  }, [router, pathname]);

  // Etiketten-Scan (Slice 5): QR auf dem Preisetikett → Release-ID → verfügbare Exemplare
  const [labelScanOpen, setLabelScanOpen] = useState(false);
  const [scanCopies, setScanCopies] = useState<CopyHit[] | null>(null);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [sellCopy, setSellCopy] = useState<CopyHit | null>(null);

  // Härtung gegen die Race, dass eine spätere Scan-Antwort von einer zuvor gestarteten,
  // langsameren Antwort überschrieben wird (gleiches Muster wie VerkaufSheet).
  const opIdRef = useRef(0);

  const handleRelease = async (releaseId: number) => {
    const opId = ++opIdRef.current;
    setLabelScanOpen(false);
    setScanMessage(null);
    setScanCopies(null);
    const res = await findAvailableCopiesByRelease(releaseId);
    if (opIdRef.current !== opId) return;
    if (!res.ok) {
      setScanMessage('Fehler beim Nachschlagen. Bitte erneut versuchen.');
      return;
    }
    if (res.copies.length === 0) {
      setScanMessage('Kein verfügbares Exemplar zu diesem Release im Bestand.');
      return;
    }
    if (res.copies.length === 1) {
      setSellCopy(res.copies[0]!);
      return;
    }
    setScanCopies(res.copies);
  };

  const genreSelectOptions = [
    { value: '', label: 'Alle Genres' },
    ...genreOptions.map((g) => ({ value: g, label: g })),
  ];

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-lg)',
        background: 'var(--surface)',
        boxShadow: 'var(--shadow-1)',
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      {/* Row 1: search + barcode placeholder */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 230 }}>
          <SearchField
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              // KI-Modus: Submit-on-Enter statt Debounce (ein Embedding-Call pro Suche).
              if (mode === 'ki' && e.key === 'Enter') {
                setParam('q', q.trim());
              }
            }}
            placeholder={
              mode === 'ki'
                ? 'Beschreibe, wonach du suchst…'
                : 'Im Sortiment suchen — Titel, Artist, Label, Katalog-Nr…'
            }
          />
        </div>
        {/* Etiketten-Scan (Slice 5): QR auf dem Preisetikett → Exemplar → SellModal */}
        <button
          type="button"
          aria-label="Etikett scannen"
          onClick={() => setLabelScanOpen(true)}
          className="focus-ring-button"
          style={{
            flexShrink: 0,
            width: 'var(--tap)',
            height: 'var(--tap)',
            border: 'none',
            borderRadius: 'var(--r-md)',
            background: 'var(--surface-3)',
            color: 'var(--text-2)',
            display: 'grid',
            placeItems: 'center',
            cursor: 'pointer',
          }}
        >
          <ScanLine size={20} aria-hidden="true" />
        </button>
        {/* KI-Suche (Slice 7): Modus-Umschalter (eine responsive Leiste, mobil+desktop) oder Lock/Upsell */}
        {kiEnabled ? (
          <SegmentedControl
            aria-label="Suchmodus"
            value={mode}
            onChange={(v) => setParam('mode', v === 'ki' ? 'ki' : '')}
            options={[
              { value: 'classic', label: 'Klassisch' },
              { value: 'ki', label: 'KI-Suche' },
            ]}
          />
        ) : (
          <div data-testid="kisuche-lock" style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: 0.7 }}>
            <Lock size={16} aria-hidden />
            <span>KI-Suche — nicht im {planName}-Plan enthalten</span>
            {isAdmin ? (
              <Link href="/einstellungen?tab=abo" data-testid="kisuche-lock-cta" className="focus-ring-button">
                Ab Small verfügbar
              </Link>
            ) : (
              <span>Verfügbar ab Small — wende dich an deinen Admin.</span>
            )}
          </div>
        )}
      </div>

      {/* Row 2: selects + reset + count/value */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <Select
          options={FORMAT_OPTIONS}
          value={searchParams.get('format') ?? ''}
          onChange={(v) => setParam('format', v)}
          aria-label="Format filtern"
          style={{ minWidth: 140 }}
        />
        <Select
          options={genreSelectOptions}
          value={searchParams.get('genre') ?? ''}
          onChange={(v) => setParam('genre', v)}
          aria-label="Genre filtern"
          style={{ minWidth: 150 }}
        />
        <Select
          options={CONDITION_OPTIONS}
          value={searchParams.get('condition') ?? ''}
          onChange={(v) => setParam('condition', v)}
          aria-label="Zustand filtern"
          style={{ minWidth: 180 }}
        />
        <button
          type="button"
          onClick={reset}
          className="focus-ring-button"
          style={{
            minHeight: 40,
            padding: '0 14px',
            border: 'none',
            borderRadius: 'var(--r-pill)',
            background: 'transparent',
            color: 'var(--accent-ink)',
            fontFamily: 'var(--font-body)',
            fontWeight: 600,
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          Zurücksetzen
        </button>
        {/* Treffer + Wert (server-computed, SSR-updated on each URL change) */}
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            whiteSpace: 'nowrap',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '12.5px',
              color: 'var(--text-3)',
            }}
          >
            <strong style={{ color: 'var(--text)' }}>{resultCount}</strong> Treffer
          </span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '12.5px',
              color: 'var(--text-3)',
            }}
          >
            Wert{' '}
            <strong style={{ color: 'var(--text)' }}>
              € {valueAvailable.toFixed(2)}
            </strong>
          </span>
        </div>
      </div>
      {scanMessage !== null && (
        <p
          role="alert"
          style={{
            margin: 0, padding: '10px 14px', borderRadius: 'var(--r-md)',
            background: 'var(--warn-soft)', color: 'var(--warn)',
            border: '1px solid color-mix(in srgb, var(--warn) 30%, transparent)', fontSize: 13.5,
          }}
        >
          {scanMessage}
        </p>
      )}
      {scanCopies !== null && (
        <div data-testid="labelscan-picker" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>Mehrere Exemplare — welches verkaufen?</span>
          {scanCopies.map((c) => (
            <button
              key={c.purchaseId}
              type="button"
              onClick={() => { setScanCopies(null); setSellCopy(c); }}
              style={{
                width: '100%', textAlign: 'left', padding: '8px 10px',
                border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
                background: 'var(--surface)', cursor: 'pointer',
              }}
            >
              {c.artist} – {c.title} · {c.targetPrice ?? '—'} €
            </button>
          ))}
        </div>
      )}
      {sellCopy !== null && (
        <SellModal
          purchaseId={sellCopy.purchaseId}
          title={sellCopy.title}
          artist={sellCopy.artist}
          targetPrice={sellCopy.targetPrice}
          onClose={() => setSellCopy(null)}
        />
      )}
      <ScannerSheet
        open={labelScanOpen}
        onClose={() => setLabelScanOpen(false)}
        mode="label"
        onDetectRelease={(id) => { void handleRelease(id); }}
      />
    </div>
  );
}
