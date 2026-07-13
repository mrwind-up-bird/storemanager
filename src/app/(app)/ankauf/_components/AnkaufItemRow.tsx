'use client';

// src/app/(app)/ankauf/_components/AnkaufItemRow.tsx
// One item row of the 1A "Zeilen-Flow / Erfassungsbogen" Ankaufseite. An evolution of the batch
// wizard's CollectionItemRow: same proven uncontrolled-row → onChange-up-to-parent contract, same
// per-row Discogs search + condition-pill radiogroups + VK auto-suggest (suggestSalePrice), plus
// the 1A design's card layout — cover thumbnail, results dropdown with covers/market/rar, a market
// signal line (median · want/have · demand chip, all real Discogs data), and a live Marge box.
//
// Two states per row:
//   • no release yet  → pill search input (+ "Manuell erfassen" + remove) with a results dropdown.
//   • release chosen  → identity view (cover, title, artist, meta, market line) + the EK/VK /
//     condition / margin grid.
//
// Design elements deliberately dropped vs. the prototype (no data source): the 12-month sparkline
// and the STATIC "RAR" badge. Demand + rarity are derived from live community counts via
// marketSignal() instead (honest, backed).

import { useEffect, useRef, useState } from 'react';
import { Search, ScanLine, X } from 'lucide-react';
import { CoverPlaceholder } from '@/components/ui';
import { ScannerSheet } from '@/components/scanner/ScannerSheet';
import {
  CONDITION_PILLS,
  conditionFromLabel,
  conditionLabel,
  DEFAULT_CONDITION_RECORD,
  DEFAULT_CONDITION_COVER,
  suggestSalePrice,
} from '@/lib/pricing';
import type { ConditionGrade } from '@/lib/pricing';
import { isValidMoneyString, toCents } from '@/lib/money';
import { formatEuroCents } from '@/lib/format';
import { marketSignal, type DemandLevel } from '@/lib/market';
import { searchDiscogs, searchDiscogsByBarcode, getPriceSuggestion } from '../actions';
import type { DiscogsSearchResult, DiscogsPriceSuggestion } from '@/lib/discogs/types';
import type { AnkaufRelease } from '@/lib/ankauf';

export interface AnkaufRowValue {
  release: AnkaufRelease | null;
  purchasePrice: string;
  targetPrice: string;
  conditionRecord: ConditionGrade;
  conditionCover: ConditionGrade;
  listOnDiscogs: boolean;
  /** True iff this row would pass the server's per-item schema (release + valid EK + valid VK). */
  valid: boolean;
}

export interface AnkaufItemRowProps {
  index: number;
  onChange: (value: AnkaufRowValue) => void;
  onRemove: () => void;
  /** Optional EAN/UPC to auto-search once on mount — feeds the /ankauf?barcode=… QuickAction. */
  initialBarcode?: string;
}

/** Token colour per demand level — hot→accent, high→honey-ink, normal→ok, low→text-3 (per handoff). */
function demandColor(level: DemandLevel): string {
  switch (level) {
    case 'hot':
      return 'var(--accent)';
    case 'high':
      return 'var(--honey-ink)';
    case 'normal':
      return 'var(--ok)';
    case 'low':
      return 'var(--text-3)';
    default:
      return 'var(--text-3)';
  }
}

/** €-median → mono euro string (e.g. 22.5 → '€ 22,50'), or '—' when unknown. */
function marketLabel(median: number | null): string {
  if (typeof median !== 'number' || !isFinite(median)) return '—';
  return formatEuroCents(Math.round(median * 100));
}

const inputBase: React.CSSProperties = {
  width: '100%',
  minHeight: 44,
  border: '1.5px solid var(--border-strong)',
  borderRadius: 'var(--r-md)',
  background: 'var(--surface-2)',
  color: 'var(--text)',
  fontFamily: 'var(--font-body)',
  fontSize: 15,
};

const priceLabelStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  color: 'var(--text-3)',
};

const gradeBadgeStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11.5,
  fontWeight: 700,
  color: 'var(--text-2)',
};

function conditionGroup(
  legend: string,
  selected: ConditionGrade,
  onSelect: (g: ConditionGrade) => void,
) {
  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 6,
        }}
      >
        <span style={priceLabelStyle}>{legend}</span>
        <span style={gradeBadgeStyle}>{conditionLabel(selected)}</span>
      </div>
      <div
        role="radiogroup"
        aria-label={legend}
        style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}
      >
        {CONDITION_PILLS.map((label) => {
          const isSelected = conditionLabel(selected) === label;
          return (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={isSelected}
              className="focus-ring-button"
              onClick={() => onSelect(conditionFromLabel(label))}
              style={{
                minHeight: 30,
                padding: '5px 10px',
                border: isSelected ? '1.5px solid var(--accent)' : '1.5px solid var(--border)',
                borderRadius: 'var(--r-pill)',
                fontSize: 12,
                fontWeight: isSelected ? 700 : 600,
                background: isSelected ? 'var(--accent)' : 'var(--surface)',
                color: isSelected ? 'var(--on-accent)' : 'var(--text-3)',
                cursor: 'pointer',
                transition: 'all var(--dur-1) var(--ease)',
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ListToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 9, cursor: 'pointer' }}>
      <button
        type="button"
        role="switch"
        data-testid="ankauf-list-toggle"
        aria-checked={checked}
        aria-label="Auf Discogs listen"
        className="focus-ring-button"
        onClick={() => onChange(!checked)}
        style={{
          position: 'relative',
          width: 38,
          height: 22,
          flexShrink: 0,
          borderRadius: 'var(--r-pill)',
          background: checked ? 'var(--accent)' : 'var(--surface-3)',
          border: checked ? 'none' : '1px solid var(--border-strong)',
          cursor: 'pointer',
          transition: 'background var(--dur-1) var(--ease)',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 2,
            left: checked ? 18 : 2,
            width: 18,
            height: 18,
            borderRadius: '50%',
            background: checked ? '#ffffff' : 'var(--surface)',
            boxShadow: 'var(--shadow-1)',
            transition: 'left var(--dur-1) var(--ease)',
          }}
        />
      </button>
      <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>Auf Discogs listen</span>
    </label>
  );
}

/** Small square cover: real image when present, else the hatched CoverPlaceholder. */
function Cover({
  coverImage,
  title,
  size,
}: {
  coverImage: string | null;
  title: string;
  size: number;
}) {
  const box: React.CSSProperties = {
    position: 'relative',
    width: size,
    height: size,
    flex: 'none',
    borderRadius: 'var(--r-md)',
    overflow: 'hidden',
    border: '1px solid var(--border)',
    boxShadow: 'var(--shadow-1)',
    background: 'var(--surface-2)',
  };
  if (coverImage) {
    return (
      <div style={box}>
        {/* eslint-disable-next-line @next/next/no-img-element -- external Discogs CDN URLs, no next/image loader configured for them */}
        <img
          src={coverImage}
          alt={title}
          width={size}
          height={size}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      </div>
    );
  }
  return (
    <div style={box}>
      <CoverPlaceholder aspectRatio={1} labelColor="var(--accent)" />
    </div>
  );
}

function safeToCents(value: string): number | null {
  if (!isValidMoneyString(value)) return null;
  try {
    return toCents(value);
  } catch {
    return null;
  }
}

export function AnkaufItemRow({ index, onChange, onRemove, initialBarcode }: AnkaufItemRowProps) {
  // Release sourcing: Discogs search (default) or manual entry (off-Discogs fallback).
  const [manual, setManual] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [results, setResults] = useState<DiscogsSearchResult[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const bootFired = useRef(false);

  const [release, setRelease] = useState<AnkaufRelease | null>(null);
  const [median, setMedian] = useState<number | null>(null);
  const [community, setCommunity] = useState<{ want: number; have: number } | null>(null);
  const [suggestion, setSuggestion] = useState<DiscogsPriceSuggestion | null>(null);

  // Manual-entry fields (only used while `manual` is true).
  const [manualTitle, setManualTitle] = useState('');
  const [manualArtist, setManualArtist] = useState('');
  const [manualTouched, setManualTouched] = useState(false);

  const [conditionRecord, setConditionRecord] = useState<ConditionGrade>(DEFAULT_CONDITION_RECORD);
  const [conditionCover, setConditionCover] = useState<ConditionGrade>(DEFAULT_CONDITION_COVER);
  const [ek, setEk] = useState('');
  const [vk, setVk] = useState('');
  const [vkDirty, setVkDirty] = useState(false);
  const [listOnDiscogs, setListOnDiscogs] = useState(false);
  const [ekTouched, setEkTouched] = useState(false);
  const [vkTouched, setVkTouched] = useState(false);

  const ekValid = isValidMoneyString(ek);
  const vkValid = isValidMoneyString(vk);
  const rowValid = release !== null && ekValid && vkValid;

  const hasIdentity = release !== null;

  // VK prefill: exact Discogs price-suggestion for the current grade, else median × factor.
  const suggestedVk = suggestSalePrice({ suggestion, median, conditionRecord });
  useEffect(() => {
    if (!vkDirty && suggestedVk !== null) setVk(suggestedVk.toFixed(2));
  }, [suggestedVk, vkDirty]);

  // Manual entry → release (discogsId null; never a synthetic id — see AnkaufRelease/C12).
  useEffect(() => {
    if (!manual) return;
    const title = manualTitle.trim();
    const artist = manualArtist.trim();
    if (!title || !artist) {
      setRelease(null);
      return;
    }
    setRelease({
      discogsId: null,
      title,
      artist,
      country: null,
      year: null,
      format: null,
      genre: [],
      label: [],
      coverImage: null,
    });
  }, [manual, manualTitle, manualArtist]);

  // Report the row's current value up whenever anything relevant changes. Prices trimmed at the
  // source (F1) so the parent's running total + createCollectionAction payload both read clean.
  useEffect(() => {
    onChange({
      release,
      purchasePrice: ek.trim(),
      targetPrice: vk.trim(),
      conditionRecord,
      conditionCover,
      listOnDiscogs,
      valid: rowValid,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onChange is a fresh closure per render; only value fields should retrigger
  }, [release, ek, vk, conditionRecord, conditionCover, listOnDiscogs, rowValid]);

  const runSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setSearchError(null);
    setDropdownOpen(true);
    const res = await searchDiscogs(q);
    setSearching(false);
    if (res.ok) {
      setResults(res.results);
    } else {
      setResults([]);
      setSearchError(
        res.reason === 'auth'
          ? 'Discogs-Verbindung abgelaufen. Bitte erneut verbinden.'
          : 'Fehler bei der Discogs-Suche.',
      );
    }
  };

  const runBarcodeSearch = async (raw: string) => {
    const ean = raw.trim();
    if (!ean) return;
    setManual(false);
    setSearching(true);
    setSearchError(null);
    setDropdownOpen(true);
    const res = await searchDiscogsByBarcode(ean);
    setSearching(false);
    if (res.ok) {
      setResults(res.results);
      if (res.results.length === 0) setSearchError('Kein Treffer für diesen Barcode.');
    } else {
      setResults([]);
      setSearchError(
        res.reason === 'validation'
          ? 'Ungültiger Barcode — 8 bis 14 Ziffern.'
          : res.reason === 'auth'
            ? 'Discogs-Verbindung abgelaufen. Bitte erneut verbinden.'
            : res.reason === 'not_connected'
              ? 'Discogs nicht verbunden.'
              : 'Fehler bei der Discogs-Suche.',
      );
    }
  };

  // Boot: the global "Scannen" QuickAction deep-links to /ankauf?barcode=… — auto-search once.
  useEffect(() => {
    if (bootFired.current) return;
    bootFired.current = true;
    if (initialBarcode) void runBarcodeSearch(initialBarcode);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run exactly once on mount
  }, []);

  const pickResult = async (r: DiscogsSearchResult) => {
    setRelease({
      discogsId: r.discogsId,
      title: r.title,
      artist: r.artist,
      country: r.country,
      year: r.year,
      format: r.format,
      genre: r.genre,
      label: r.label,
      coverImage: r.coverImage,
    });
    setMedian(r.median);
    setCommunity(r.community);
    setResults([]);
    setDropdownOpen(false);
    setQuery('');
    const s = await getPriceSuggestion(r.discogsId);
    if (s.ok) setSuggestion(s.suggestion);
  };

  const resetRelease = () => {
    setRelease(null);
    setSuggestion(null);
    setMedian(null);
    setCommunity(null);
    setManual(false);
    setManualTitle('');
    setManualArtist('');
    setManualTouched(false);
    setVk('');
    setVkDirty(false);
    setVkTouched(false);
  };

  // Margin (only when both prices valid). Colour: positive → ok, negative → bad.
  const ekCents = safeToCents(ek);
  const vkCents = safeToCents(vk);
  const marginCents =
    ekCents !== null && vkCents !== null ? vkCents - ekCents : null;
  const marginPct =
    marginCents !== null && ekCents !== null && ekCents > 0
      ? (marginCents / ekCents) * 100
      : null;
  const marginColor =
    marginCents === null
      ? 'var(--text-3)'
      : marginCents >= 0
        ? 'var(--ok)'
        : 'var(--bad)';

  const signal = marketSignal(community);
  const cardBorderLeft = signal.rare ? '3px solid var(--honey)' : '3px solid var(--accent)';

  return (
    <article
      data-testid="ankauf-item-row"
      style={{
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid var(--border)',
        borderLeft: hasIdentity ? cardBorderLeft : '1px solid var(--border)',
        borderRadius: 'var(--r-lg)',
        background: 'var(--surface)',
        boxShadow: 'var(--shadow-1)',
        padding: 16,
      }}
    >
      {/* top: index + cover + identity/search */}
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: 'var(--text-3)',
            paddingTop: hasIdentity ? 34 : 12,
            flex: 'none',
            width: 22,
            textAlign: 'right',
          }}
        >
          {index + 1}
        </span>

        {hasIdentity && (
          <div style={{ position: 'relative', flex: 'none' }}>
            <Cover coverImage={release.coverImage} title={release.title} size={96} />
            {signal.rare && (
              <span
                style={{
                  position: 'absolute',
                  top: 6,
                  left: 6,
                  padding: '2px 7px',
                  borderRadius: 'var(--r-pill)',
                  background: 'var(--honey)',
                  color: '#3a2400',
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: '.03em',
                  boxShadow: 'var(--shadow-1)',
                }}
              >
                rar
              </span>
            )}
          </div>
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          {hasIdentity ? (
            <>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: 10,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontWeight: 700,
                      fontSize: 17,
                      lineHeight: 1.2,
                      letterSpacing: '-.01em',
                    }}
                  >
                    {release.title}
                  </div>
                  <div style={{ fontSize: 13.5, color: 'var(--text-2)', marginTop: 1 }}>
                    {release.artist}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
                  <button
                    type="button"
                    onClick={resetRelease}
                    title="Anderen Treffer wählen"
                    className="focus-ring-button"
                    style={{
                      minHeight: 32,
                      padding: '0 12px',
                      border: '1.5px solid var(--border-strong)',
                      borderRadius: 'var(--r-pill)',
                      background: 'var(--surface)',
                      color: 'var(--text-2)',
                      fontSize: 12.5,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Ändern
                  </button>
                  <button
                    type="button"
                    onClick={onRemove}
                    aria-label={`Artikel ${index + 1} entfernen`}
                    className="focus-ring-button"
                    style={{
                      width: 32,
                      height: 32,
                      border: '1.5px solid var(--border-strong)',
                      borderRadius: 'var(--r-pill)',
                      background: 'var(--surface)',
                      color: 'var(--text-3)',
                      cursor: 'pointer',
                      display: 'grid',
                      placeItems: 'center',
                    }}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </div>
              </div>

              {/* meta line */}
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11.5,
                  color: 'var(--text-3)',
                  marginTop: 8,
                }}
              >
                {[
                  release.discogsId === null ? 'Manuell erfasst' : `Discogs #${release.discogsId}`,
                  release.format,
                  release.year != null ? String(release.year) : null,
                  release.country,
                  release.label[0] ?? null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>

              {/* market + demand line — only for real Discogs releases with community data */}
              {release.discogsId !== null && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    flexWrap: 'wrap',
                    marginTop: 10,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 7,
                      padding: '5px 11px',
                      borderRadius: 'var(--r-pill)',
                      background: 'var(--ok-soft)',
                      color: 'var(--ok)',
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    <span aria-hidden="true">◈</span> Markt {conditionLabel(conditionRecord)}{' '}
                    {marketLabel(median)}
                  </div>
                  {community && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        fontFamily: 'var(--font-mono)',
                        fontSize: 12,
                        color: 'var(--text-2)',
                      }}
                    >
                      <span title="Discogs Want" style={{ color: 'var(--accent-ink)' }}>
                        ♡ {community.want}
                      </span>
                      <span title="Discogs Have" style={{ color: 'var(--text-3)' }}>
                        ⬩ {community.have}
                      </span>
                      {signal.level !== 'unknown' && (
                        <span
                          style={{
                            padding: '2px 9px',
                            borderRadius: 'var(--r-pill)',
                            background: 'var(--surface-2)',
                            border: '1px solid var(--border)',
                            color: demandColor(signal.level),
                            fontWeight: 700,
                          }}
                        >
                          {signal.label}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {manual ? (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                    gap: 10,
                  }}
                >
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)' }}>
                      Titel
                    </span>
                    <input
                      className="focus-ring-field"
                      style={{
                        ...inputBase,
                        padding: '0 14px',
                        borderColor:
                          manualTouched && !manualTitle.trim() ? 'var(--bad)' : undefined,
                      }}
                      value={manualTitle}
                      onChange={(e) => {
                        setManualTitle(e.target.value);
                        setManualTouched(true);
                      }}
                      aria-invalid={manualTouched && !manualTitle.trim()}
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)' }}>
                      Künstler
                    </span>
                    <input
                      className="focus-ring-field"
                      style={{
                        ...inputBase,
                        padding: '0 14px',
                        borderColor:
                          manualTouched && !manualArtist.trim() ? 'var(--bad)' : undefined,
                      }}
                      value={manualArtist}
                      onChange={(e) => {
                        setManualArtist(e.target.value);
                        setManualTouched(true);
                      }}
                      aria-invalid={manualTouched && !manualArtist.trim()}
                    />
                  </label>
                  <div
                    style={{
                      gridColumn: '1 / -1',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 10,
                    }}
                  >
                    {manualTouched && (!manualTitle.trim() || !manualArtist.trim()) ? (
                      <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--bad)' }}>
                        Titel und Künstler sind erforderlich.
                      </p>
                    ) : (
                      <span />
                    )}
                    <button
                      type="button"
                      onClick={() => setManual(false)}
                      className="focus-ring-button"
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color: 'var(--accent-ink)',
                        fontSize: 12.5,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Discogs-Suche verwenden
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ position: 'relative' }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                    }}
                  >
                    <div
                      style={{
                        position: 'relative',
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      <Search
                        aria-hidden="true"
                        size={17}
                        style={{
                          position: 'absolute',
                          left: 13,
                          color: 'var(--text-3)',
                          pointerEvents: 'none',
                        }}
                      />
                      <input
                        type="search"
                        data-testid="ankauf-search-input"
                        className="focus-ring-field"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onFocus={() => {
                          if (results.length > 0) setDropdownOpen(true);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void runSearch();
                          }
                        }}
                        placeholder="Titel, Artist oder Katalog-Nr. suchen …"
                        aria-label={`Discogs-Suche für Artikel ${index + 1}`}
                        style={{
                          ...inputBase,
                          padding: '0 14px 0 38px',
                          borderRadius: 'var(--r-pill)',
                        }}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setScannerOpen(true)}
                      aria-label="Barcode scannen"
                      className="focus-ring-button"
                      style={{
                        flex: 'none',
                        width: 44,
                        height: 44,
                        border: '1.5px solid var(--border-strong)',
                        borderRadius: 'var(--r-md)',
                        background: 'var(--surface)',
                        color: 'var(--text-2)',
                        cursor: 'pointer',
                        display: 'grid',
                        placeItems: 'center',
                      }}
                    >
                      <ScanLine size={18} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => runSearch()}
                      disabled={searching || !query.trim()}
                      className="focus-ring-button"
                      style={{
                        flex: 'none',
                        minHeight: 44,
                        padding: '0 15px',
                        border: 'none',
                        borderRadius: 'var(--r-pill)',
                        background:
                          searching || !query.trim() ? 'var(--surface-3)' : 'var(--accent)',
                        color:
                          searching || !query.trim() ? 'var(--text-3)' : 'var(--on-accent)',
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: searching || !query.trim() ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {searching ? 'Suche…' : 'Suchen'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setManual(true);
                        setResults([]);
                        setDropdownOpen(false);
                      }}
                      className="focus-ring-button"
                      style={{
                        flex: 'none',
                        minHeight: 44,
                        padding: '0 15px',
                        border: '1.5px solid var(--border-strong)',
                        borderRadius: 'var(--r-pill)',
                        background: 'var(--surface)',
                        color: 'var(--text-2)',
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Manuell erfassen
                    </button>
                    <button
                      type="button"
                      onClick={onRemove}
                      aria-label={`Artikel ${index + 1} entfernen`}
                      className="focus-ring-button"
                      style={{
                        flex: 'none',
                        width: 44,
                        height: 44,
                        border: '1.5px solid var(--border-strong)',
                        borderRadius: 'var(--r-pill)',
                        background: 'var(--surface)',
                        color: 'var(--text-3)',
                        cursor: 'pointer',
                        display: 'grid',
                        placeItems: 'center',
                      }}
                    >
                      <X size={15} aria-hidden="true" />
                    </button>
                  </div>

                  {searchError && (
                    <p
                      role="alert"
                      style={{ margin: '8px 0 0', fontSize: 12.5, color: 'var(--bad)' }}
                    >
                      {searchError}
                    </p>
                  )}

                  {dropdownOpen && results.length > 0 && (
                    <div
                      style={{
                        position: 'absolute',
                        zIndex: 20,
                        left: 0,
                        right: 0,
                        marginTop: 8,
                        maxHeight: 320,
                        overflowY: 'auto',
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--r-lg)',
                        boxShadow: 'var(--shadow-3)',
                        padding: 6,
                      }}
                    >
                      {results.map((r) => {
                        const rSignal = marketSignal(r.community);
                        return (
                          <button
                            key={r.discogsId}
                            type="button"
                            data-testid="ankauf-result"
                            onClick={() => pickResult(r)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 12,
                              width: '100%',
                              textAlign: 'left',
                              padding: '9px 10px',
                              border: 'none',
                              borderRadius: 'var(--r-md)',
                              background: 'transparent',
                              color: 'var(--text)',
                              cursor: 'pointer',
                            }}
                          >
                            <Cover coverImage={r.coverImage} title={r.title} size={44} />
                            <span style={{ flex: 1, minWidth: 0 }}>
                              <span
                                style={{
                                  display: 'block',
                                  fontWeight: 700,
                                  fontSize: 14,
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}
                              >
                                {r.title}
                              </span>
                              <span style={{ display: 'block', fontSize: 12.5, color: 'var(--text-2)' }}>
                                {r.artist}
                              </span>
                              <span
                                style={{
                                  display: 'block',
                                  fontFamily: 'var(--font-mono)',
                                  fontSize: 11,
                                  color: 'var(--text-3)',
                                  marginTop: 1,
                                }}
                              >
                                {[r.format, r.year != null ? String(r.year) : null, r.country]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </span>
                            </span>
                            <span
                              style={{
                                flex: 'none',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'flex-end',
                                gap: 3,
                              }}
                            >
                              <span
                                style={{
                                  fontFamily: 'var(--font-mono)',
                                  fontSize: 12.5,
                                  fontWeight: 500,
                                  color: 'var(--ok)',
                                }}
                              >
                                {marketLabel(r.median)}
                              </span>
                              {rSignal.rare && (
                                <span
                                  style={{
                                    padding: '1px 7px',
                                    borderRadius: 'var(--r-pill)',
                                    background: 'var(--honey-soft)',
                                    color: 'var(--honey-ink)',
                                    fontSize: 10,
                                    fontWeight: 700,
                                  }}
                                >
                                  rar
                                </span>
                              )}
                            </span>
                          </button>
                        );
                      })}
                      <div
                        style={{
                          padding: '8px 10px 4px',
                          fontSize: 11,
                          color: 'var(--text-3)',
                          fontFamily: 'var(--font-mono)',
                          borderTop: '1px dashed var(--border)',
                          marginTop: 4,
                        }}
                      >
                        Treffer aus Discogs · Cover &amp; Marktpreis werden übernommen
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* bottom: prices + conditions + margin (only with a chosen release) */}
      {hasIdentity && (
        <div
          style={{
            marginTop: 16,
            paddingTop: 16,
            borderTop: '1px dashed var(--border)',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 20,
            alignItems: 'start',
          }}
        >
          {/* prices */}
          <div style={{ display: 'flex', gap: 12 }}>
            <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={priceLabelStyle}>Einkauf (EK)</span>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    left: 13,
                    color: 'var(--text-3)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  €
                </span>
                <input
                  inputMode="decimal"
                  data-testid="ankauf-ek-input"
                  className="focus-ring-field"
                  value={ek}
                  onChange={(e) => setEk(e.target.value)}
                  onBlur={() => setEkTouched(true)}
                  aria-invalid={ekTouched && !ekValid}
                  aria-label="Einkaufspreis (EK)"
                  style={{
                    ...inputBase,
                    padding: '0 12px 0 28px',
                    fontFamily: 'var(--font-mono)',
                    borderColor: ekTouched && !ekValid ? 'var(--bad)' : undefined,
                  }}
                />
              </div>
              {ekTouched && !ekValid && (
                <span role="alert" style={{ fontSize: 12, color: 'var(--bad)' }}>
                  Ungültiger Preis (z. B. 12.50).
                </span>
              )}
            </label>
            <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ ...priceLabelStyle, color: 'var(--accent-ink)' }}>Verkauf (VK)</span>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    left: 13,
                    color: 'var(--accent-ink)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  €
                </span>
                <input
                  inputMode="decimal"
                  data-testid="ankauf-vk-input"
                  className="focus-ring-field"
                  value={vk}
                  onChange={(e) => {
                    setVkDirty(true);
                    setVk(e.target.value);
                  }}
                  onBlur={() => setVkTouched(true)}
                  aria-invalid={vkTouched && !vkValid}
                  aria-label="Verkaufspreis (VK)"
                  style={{
                    ...inputBase,
                    padding: '0 12px 0 28px',
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 500,
                    border: '1.5px solid var(--accent)',
                    background: 'var(--accent-soft)',
                    borderColor: vkTouched && !vkValid ? 'var(--bad)' : 'var(--accent)',
                  }}
                />
              </div>
              {vkTouched && !vkValid && (
                <span role="alert" style={{ fontSize: 12, color: 'var(--bad)' }}>
                  Ungültiger Preis (z. B. 12.50).
                </span>
              )}
            </label>
          </div>

          {/* conditions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {conditionGroup('Zustand Platte', conditionRecord, setConditionRecord)}
            {conditionGroup('Zustand Cover', conditionCover, setConditionCover)}
          </div>

          {/* margin + list toggle */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              justifyContent: 'space-between',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 10,
                padding: '10px 14px',
                borderRadius: 'var(--r-md)',
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
              }}
            >
              <span style={{ fontSize: 12, color: 'var(--text-2)', fontWeight: 600 }}>Marge</span>
              <span
                data-testid="ankauf-row-margin"
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 19,
                  fontWeight: 500,
                  color: marginColor,
                  letterSpacing: '-.01em',
                }}
              >
                {marginCents === null ? '—' : formatEuroCents(marginCents)}
              </span>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12.5,
                  color: marginColor,
                  marginLeft: 'auto',
                }}
              >
                {marginPct === null ? '' : `${marginPct >= 0 ? '+' : ''}${marginPct.toFixed(0)} %`}
              </span>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                gap: 10,
              }}
            >
              <ListToggle checked={listOnDiscogs} onChange={setListOnDiscogs} />
            </div>
          </div>
        </div>
      )}

      {!hasIdentity && (
        <ScannerSheet
          open={scannerOpen}
          onClose={() => setScannerOpen(false)}
          mode="ean"
          onDetectEan={(ean) => {
            setScannerOpen(false);
            void runBarcodeSearch(ean);
          }}
        />
      )}
    </article>
  );
}
