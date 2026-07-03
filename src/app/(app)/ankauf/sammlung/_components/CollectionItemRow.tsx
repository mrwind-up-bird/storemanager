'use client';

// src/app/(app)/ankauf/sammlung/_components/CollectionItemRow.tsx
// One line item of the batch-Ankauf wizard: source a release (Discogs search OR manual entry),
// pick condition (record/cover), enter EK/VK (VK prefilled from the Discogs price suggestion via
// suggestSalePrice — same pattern as the single-item AnkaufModal). Fully self-contained/uncontrolled;
// reports its current value up to CollectionWizard via `onChange` so the wizard can compute the
// running total and assemble the createCollectionAction payload.

import { useEffect, useState } from 'react';
import { SearchField } from '@/components/ui/SearchField';
import {
  CONDITION_PILLS,
  conditionFromLabel,
  conditionLabel,
  DEFAULT_CONDITION_RECORD,
  DEFAULT_CONDITION_COVER,
  suggestSalePrice,
} from '@/lib/pricing';
import type { ConditionGrade } from '@/lib/pricing';
import { isValidMoneyString } from '@/lib/money';
import { searchDiscogs, getPriceSuggestion } from '../../actions';
import type { DiscogsSearchResult, DiscogsPriceSuggestion } from '@/lib/discogs/types';
import type { AnkaufRelease } from '@/lib/ankauf';

export interface CollectionRowValue {
  release: AnkaufRelease | null;
  purchasePrice: string;
  targetPrice: string;
  conditionRecord: ConditionGrade;
  conditionCover: ConditionGrade;
  listOnDiscogs: boolean;
  // True iff this row would pass the server's per-item schema (release picked/filled-in, EK and
  // VK both valid decimal strings) — CollectionWizard gates the whole-batch submit on this so an
  // invalid row never reaches createCollectionAction (finding F1).
  valid: boolean;
}

export interface CollectionItemRowProps {
  index: number;
  onChange: (value: CollectionRowValue) => void;
  onRemove: () => void;
}

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 5,
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--text-2)',
};

const fieldStyle: React.CSSProperties = {
  minHeight: 'var(--tap)',
  padding: '0 12px',
  border: '1.5px solid var(--border-strong)',
  borderRadius: 'var(--r-md)',
  background: 'var(--surface-2)',
  color: 'var(--text)',
  fontFamily: 'var(--font-body)',
  fontSize: 14,
};

function pillGroup(
  legend: string,
  selected: ConditionGrade,
  onSelect: (g: ConditionGrade) => void,
) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)' }}>{legend}</span>
      <div role="radiogroup" aria-label={legend} style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {CONDITION_PILLS.map((label) => {
          const isSelected = conditionLabel(selected) === label;
          return (
            <span
              key={label}
              role="radio"
              aria-checked={isSelected}
              tabIndex={0}
              onClick={() => onSelect(conditionFromLabel(label))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onSelect(conditionFromLabel(label));
              }}
              style={{
                padding: '6px 11px',
                borderRadius: 'var(--r-pill)',
                fontSize: 12,
                fontWeight: isSelected ? 700 : 600,
                background: isSelected ? 'var(--accent)' : 'var(--surface-3)',
                color: isSelected ? 'var(--on-accent)' : 'var(--text-3)',
                cursor: 'pointer',
              }}
            >
              {label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function CollectionItemRow({ index, onChange, onRemove }: CollectionItemRowProps) {
  // Release sourcing: Discogs search (default) or manual entry (fallback for off-Discogs items).
  const [manual, setManual] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [results, setResults] = useState<DiscogsSearchResult[]>([]);

  const [release, setRelease] = useState<AnkaufRelease | null>(null);
  const [median, setMedian] = useState<number | null>(null);
  const [suggestion, setSuggestion] = useState<DiscogsPriceSuggestion | null>(null);

  // Manual-entry fields (only used while `manual` is true).
  const [manualTitle, setManualTitle] = useState('');
  const [manualArtist, setManualArtist] = useState('');

  const [conditionRecord, setConditionRecord] = useState<ConditionGrade>(DEFAULT_CONDITION_RECORD);
  const [conditionCover, setConditionCover] = useState<ConditionGrade>(DEFAULT_CONDITION_COVER);
  const [ek, setEk] = useState('');
  const [vk, setVk] = useState('');
  const [vkDirty, setVkDirty] = useState(false);
  const [listOnDiscogs, setListOnDiscogs] = useState(false);
  // "Touched" flags so a freshly-added, still-empty row doesn't show red borders/messages before
  // the user has interacted with a field — only surface the inline indication once they have.
  const [ekTouched, setEkTouched] = useState(false);
  const [vkTouched, setVkTouched] = useState(false);
  const [manualTouched, setManualTouched] = useState(false);

  const ekValid = isValidMoneyString(ek);
  const vkValid = isValidMoneyString(vk);
  // Mirrors the server's per-item schema exactly: a release (Discogs-picked or manual
  // title+artist) plus two valid decimal-string prices — see CollectionRowValue.valid.
  const rowValid = release !== null && ekValid && vkValid;

  // VK prefill: exact Discogs price-suggestion for the current grade, else median × factor.
  const suggestedVk = suggestSalePrice({ suggestion, median, conditionRecord });
  useEffect(() => {
    if (!vkDirty && suggestedVk !== null) setVk(suggestedVk.toFixed(2));
  }, [suggestedVk, vkDirty]);

  // Manual entry: title/artist typed in directly become the release. discogsId stays null
  // (never a synthetic placeholder) — it means "no Discogs release", which the C12 label
  // logic and the records upsert both treat as such (no QR code, no clobbering a real id).
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

  // Report the row's current value up to the wizard whenever anything relevant changes. Prices
  // are trimmed here — the wizard's running total and the createCollectionAction payload both
  // read straight from this reported value, so trimming once at the source (finding F1) covers
  // both instead of relying on every consumer to remember to do it.
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

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setSearchError(null);
    const res = await searchDiscogs(q);
    setSearching(false);
    if (res.ok) {
      setResults(res.results);
    } else {
      setSearchError('Fehler bei der Discogs-Suche.');
    }
  };

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
    setResults([]);
    setQuery('');
    const s = await getPriceSuggestion(r.discogsId);
    if (s.ok) setSuggestion(s.suggestion);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 14,
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-lg)',
        background: 'var(--surface)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 700, fontSize: 13.5 }}>Artikel {index + 1}</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            aria-label={manual ? 'Discogs-Suche verwenden' : 'Manuell erfassen'}
            onClick={() => setManual((v) => !v)}
            style={{
              border: 'none',
              background: 'transparent',
              color: 'var(--accent-ink)',
              fontSize: 12.5,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {manual ? 'Discogs-Suche verwenden' : 'Manuell erfassen'}
          </button>
          <button
            type="button"
            aria-label={`Artikel ${index + 1} entfernen`}
            onClick={onRemove}
            style={{
              border: 'none',
              background: 'transparent',
              color: 'var(--bad)',
              fontSize: 12.5,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Entfernen
          </button>
        </div>
      </div>

      {manual ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
          <label style={labelStyle}>
            Titel
            <input
              style={{
                ...fieldStyle,
                borderColor: manualTouched && !manualTitle.trim() ? 'var(--bad)' : undefined,
              }}
              value={manualTitle}
              onChange={(e) => {
                setManualTitle(e.target.value);
                setManualTouched(true);
              }}
              aria-invalid={manualTouched && !manualTitle.trim()}
            />
          </label>
          <label style={labelStyle}>
            Künstler
            <input
              style={{
                ...fieldStyle,
                borderColor: manualTouched && !manualArtist.trim() ? 'var(--bad)' : undefined,
              }}
              value={manualArtist}
              onChange={(e) => {
                setManualArtist(e.target.value);
                setManualTouched(true);
              }}
              aria-invalid={manualTouched && !manualArtist.trim()}
            />
          </label>
          {manualTouched && (!manualTitle.trim() || !manualArtist.trim()) && (
            <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--bad)', gridColumn: '1 / -1' }}>
              Titel und Künstler sind erforderlich.
            </p>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {release ? (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: 14,
              }}
            >
              <span>
                <strong>{release.artist}</strong> — {release.title}
              </span>
              <button
                type="button"
                onClick={() => {
                  setRelease(null);
                  setSuggestion(null);
                  setMedian(null);
                }}
                aria-label={`Release für Artikel ${index + 1} zurücksetzen`}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--text-3)',
                  fontSize: 12.5,
                  cursor: 'pointer',
                }}
              >
                Ändern
              </button>
            </div>
          ) : (
            <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <SearchField
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Auf Discogs suchen…"
                  aria-label="Auf Discogs suchen"
                />
              </div>
              <button
                type="submit"
                disabled={searching || !query.trim()}
                style={{
                  minHeight: 'var(--tap)',
                  padding: '0 16px',
                  border: 'none',
                  borderRadius: 'var(--r-pill)',
                  background: 'var(--accent)',
                  color: 'var(--on-accent)',
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: searching || !query.trim() ? 'not-allowed' : 'pointer',
                }}
              >
                {searching ? 'Suche…' : 'Suchen'}
              </button>
            </form>
          )}

          {searchError && (
            <p role="alert" style={{ margin: 0, fontSize: 12.5, color: 'var(--bad)' }}>
              {searchError}
            </p>
          )}

          {results.length > 0 && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {results.map((r) => (
                <li key={r.discogsId}>
                  <button
                    type="button"
                    onClick={() => pickResult(r)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 10px',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--r-md)',
                      background: 'var(--surface-2)',
                      fontSize: 13.5,
                      cursor: 'pointer',
                    }}
                  >
                    <strong>{r.artist}</strong> — {r.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label style={labelStyle}>
          Einkaufspreis (EK)
          <input
            style={{ ...fieldStyle, borderColor: ekTouched && !ekValid ? 'var(--bad)' : undefined }}
            inputMode="decimal"
            value={ek}
            onChange={(e) => setEk(e.target.value)}
            onBlur={() => setEkTouched(true)}
            aria-invalid={ekTouched && !ekValid}
          />
          {ekTouched && !ekValid && (
            <span role="alert" style={{ fontSize: 12, color: 'var(--bad)' }}>
              Ungültiger Preis (z. B. 12.50).
            </span>
          )}
        </label>
        <label style={labelStyle}>
          Verkaufspreis (VK)
          <input
            style={{ ...fieldStyle, borderColor: vkTouched && !vkValid ? 'var(--bad)' : undefined }}
            inputMode="decimal"
            value={vk}
            onChange={(e) => {
              setVkDirty(true);
              setVk(e.target.value);
            }}
            onBlur={() => setVkTouched(true)}
            aria-invalid={vkTouched && !vkValid}
          />
          {vkTouched && !vkValid && (
            <span role="alert" style={{ fontSize: 12, color: 'var(--bad)' }}>
              Ungültiger Preis (z. B. 12.50).
            </span>
          )}
        </label>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        {pillGroup('Zustand Platte', conditionRecord, setConditionRecord)}
        {pillGroup('Zustand Cover', conditionCover, setConditionCover)}
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, cursor: 'pointer' }}>
        <button
          type="button"
          role="switch"
          aria-checked={listOnDiscogs}
          onClick={() => setListOnDiscogs((v) => !v)}
          style={{
            width: 38,
            height: 22,
            borderRadius: 'var(--r-pill)',
            background: listOnDiscogs ? 'var(--accent)' : 'var(--surface-3)',
            border: 'none',
            position: 'relative',
            cursor: 'pointer',
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: 2,
              left: listOnDiscogs ? 18 : 2,
              width: 18,
              height: 18,
              borderRadius: '50%',
              background: 'var(--on-accent)',
              transition: 'left var(--dur-1) var(--ease)',
            }}
          />
        </button>
        Direkt auf Discogs zum Verkauf listen
      </label>
    </div>
  );
}
