'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useState, useEffect } from 'react';
import { SearchField } from '@/components/ui/SearchField';
import { Select } from '@/components/ui/Select';

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
}

export function FilterBar({ genreOptions, resultCount, valueAvailable }: FilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Controlled search field — debounced URL push
  const [q, setQ] = useState(searchParams.get('q') ?? '');

  // Keep local q in sync on URL change (back-navigation, StatusTabs push, etc.)
  useEffect(() => {
    setQ(searchParams.get('q') ?? '');
  }, [searchParams]);

  // Debounce: push URL 300 ms after q changes, skip if already matches URL
  useEffect(() => {
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
  }, [q]); // intentionally only q — avoid infinite loop from searchParams/router/pathname deps

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
            placeholder="Im Sortiment suchen — Titel, Artist, Label, Katalog-Nr…"
          />
        </div>
        {/* Barcode scanner — disabled placeholder (Slice 5) */}
        <button
          type="button"
          aria-label="Barcode scannen"
          disabled
          style={{
            flexShrink: 0,
            width: 'var(--tap)',
            height: 'var(--tap)',
            border: 'none',
            borderRadius: 'var(--r-md)',
            background: 'var(--surface-3)',
            color: 'var(--text-3)',
            fontSize: 21,
            display: 'grid',
            placeItems: 'center',
            cursor: 'not-allowed',
          }}
        >
          ▥
        </button>
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
    </div>
  );
}
