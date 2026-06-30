'use client';

// src/app/(app)/ankauf/_components/AnkaufModal.tsx
// Ankauf modal — EK/VK inputs, condition pills, live VK suggestion, listing toggle.
// Design-faithful to Q-Records App.dc.html lines 562–621 (ANKAUF modal section).

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { CoverPlaceholder } from '@/components/ui/CoverPlaceholder';
import {
  CONDITION_PILLS,
  conditionFromLabel,
  conditionLabel,
  DEFAULT_CONDITION_RECORD,
  DEFAULT_CONDITION_COVER,
  suggestSalePrice,
} from '@/lib/pricing';
import type { ConditionGrade } from '@/lib/pricing';
import { getPriceSuggestion, ankaufRecord } from '../actions';
import type { DiscogsSearchResult, DiscogsPriceSuggestion } from '@/lib/discogs/types';

export interface AnkaufModalProps {
  result: DiscogsSearchResult;
  onClose: () => void;
}

export function AnkaufModal({ result, onClose }: AnkaufModalProps) {
  const [conditionRecord, setConditionRecord] = useState<ConditionGrade>(DEFAULT_CONDITION_RECORD);
  const [conditionCover, setConditionCover] = useState<ConditionGrade>(DEFAULT_CONDITION_COVER);
  const [ek, setEk] = useState('');
  const [vk, setVk] = useState('');
  const [vkDirty, setVkDirty] = useState(false);
  const [listOnDiscogs, setListOnDiscogs] = useState(false);
  const [suggestion, setSuggestion] = useState<DiscogsPriceSuggestion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  // On mount: fetch price suggestion from Discogs
  useEffect(() => {
    getPriceSuggestion(result.discogsId).then((res) => {
      if (res.ok) {
        setSuggestion(res.suggestion);
      }
    });
  }, [result.discogsId]);

  // Close on Escape key
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Compute suggested VK from Discogs price suggestion + median fallback + current condition
  const suggestedVk = suggestSalePrice({
    suggestion,
    median: result.median,
    conditionRecord,
  });

  // Update VK input whenever suggestion arrives or condition changes — unless user has edited VK
  useEffect(() => {
    if (!vkDirty && suggestedVk !== null) {
      setVk(String(suggestedVk));
    }
  }, [suggestedVk, vkDirty]);

  const handleSubmit = async () => {
    setError(null);
    setIsPending(true);
    try {
      const input = {
        release: {
          discogsId: result.discogsId,
          title: result.title,
          artist: result.artist,
          country: result.country,
          year: result.year,
          format: result.format,
          genre: result.genre,
          label: result.label,
          coverImage: result.coverImage,
        },
        purchasePrice: ek,
        targetPrice: vk,
        conditionRecord,
        conditionCover,
        listOnDiscogs,
      };
      const res = await ankaufRecord(input);
      if (res.ok) {
        onClose();
      } else {
        setError(res.message ?? 'Fehler beim Ankauf. Bitte erneut versuchen.');
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
      {/* Modal panel — stopPropagation so backdrop click doesn't bubble */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Artikel ankaufen"
        data-testid="ankauf-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(560px, 100%)',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--r-xl)',
          boxShadow: 'var(--shadow-3)',
          overflow: 'hidden',
        }}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '18px 22px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          {/* Yellow status dot */}
          <span
            aria-hidden="true"
            style={{
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: 'var(--honey)',
              flex: 'none',
            }}
          />
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                fontSize: 19,
                lineHeight: 1.1,
              }}
            >
              {result.title}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-2)' }}>Ankauf · {result.artist}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Schließen"
            className="focus-ring-button"
            style={{
              width: 36,
              height: 36,
              border: 'none',
              borderRadius: '50%',
              background: 'var(--surface-3)',
              color: 'var(--text-2)',
              fontSize: 16,
              cursor: 'pointer',
              display: 'grid',
              placeItems: 'center',
            }}
          >
            ✕
          </button>
        </div>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div
          style={{
            padding: 22,
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
            maxHeight: '64vh',
            overflowY: 'auto',
          }}
        >
          {/* Cover thumbnail + meta pills */}
          <div style={{ display: 'flex', gap: 16 }}>
            {/* Cover placeholder: 104×104, matches design handoff repeating-gradient */}
            <div
              aria-hidden="true"
              style={{
                width: 104,
                height: 104,
                borderRadius: 'var(--r-md)',
                flex: 'none',
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              <CoverPlaceholder
                labelColor={result.format === 'CD' ? 'var(--info)' : 'var(--accent)'}
              />
            </div>

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* Country / year / format pills */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {result.country != null && (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      padding: '5px 10px',
                      borderRadius: 'var(--r-pill)',
                      background: 'var(--surface-3)',
                      color: 'var(--text-2)',
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    <span aria-hidden="true">⚑</span> {result.country}
                  </span>
                )}
                {result.year != null && (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      padding: '5px 10px',
                      borderRadius: 'var(--r-pill)',
                      background: 'var(--surface-3)',
                      color: 'var(--text-2)',
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    <span aria-hidden="true">▦</span> {result.year}
                  </span>
                )}
                {result.format != null && (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      padding: '5px 10px',
                      borderRadius: 'var(--r-pill)',
                      background: 'var(--surface-3)',
                      color: 'var(--text-2)',
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    {result.format}
                  </span>
                )}
              </div>

              {/* Genre pills (accent-soft) */}
              {result.genre.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {result.genre.map((g) => (
                    <span
                      key={g}
                      style={{
                        padding: '5px 10px',
                        borderRadius: 'var(--r-pill)',
                        background: 'var(--accent-soft)',
                        color: 'var(--accent-ink)',
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      #{g}
                    </span>
                  ))}
                </div>
              )}

              {/* Discogs want / have */}
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--text-3)',
                  fontFamily: 'var(--font-mono)',
                  marginTop: 2,
                }}
              >
                Discogs ♡ {result.community.want} · ⬩ {result.community.have} im Markt
              </div>
            </div>
          </div>

          {/* ── EK / VK two-column inputs ────────────────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <span style={{ fontWeight: 600, fontSize: 13.5 }}>Einkaufspreis</span>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    left: 14,
                    color: 'var(--text-3)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  €
                </span>
                <input
                  type="text"
                  data-testid="ek-input"
                  value={ek}
                  onChange={(e) => setEk(e.target.value)}
                  inputMode="decimal"
                  style={{
                    width: '100%',
                    minHeight: 'var(--tap)',
                    padding: '0 14px 0 30px',
                    border: '1.5px solid var(--border-strong)',
                    borderRadius: 'var(--r-md)',
                    background: 'var(--surface-2)',
                    color: 'var(--text)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 15,
                  }}
                />
              </div>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <span style={{ fontWeight: 600, fontSize: 13.5 }}>Zielpreis (VK)</span>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    left: 14,
                    color: 'var(--text-3)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  €
                </span>
                <input
                  type="text"
                  data-testid="vk-input"
                  value={vk}
                  onChange={(e) => {
                    setVkDirty(true);
                    setVk(e.target.value);
                  }}
                  inputMode="decimal"
                  style={{
                    width: '100%',
                    minHeight: 'var(--tap)',
                    padding: '0 14px 0 30px',
                    border: '1.5px solid var(--accent)',
                    borderRadius: 'var(--r-md)',
                    background: 'var(--accent-soft)',
                    color: 'var(--text)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 15,
                    fontWeight: 500,
                  }}
                />
              </div>
            </label>
          </div>

          {/* VK hint line: ◈ Vorschlag aus Discogs-Marktdaten (<grade>): € X.XX · Zustand angepasst */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginTop: -8,
              fontSize: 12,
              color: 'var(--text-3)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            <span aria-hidden="true" style={{ color: 'var(--accent)' }}>
              ◈
            </span>
            Vorschlag aus Discogs-Marktdaten ({conditionLabel(conditionRecord)}
            ): € {suggestedVk !== null ? suggestedVk.toFixed(2) : '—'} · Zustand angepasst
          </div>

          {/* ── Condition radiogroups ────────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            {/* Record condition */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
              }}
            >
              <span style={{ fontWeight: 600, fontSize: 13.5 }}>Zustand · Platte</span>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12,
                  color: 'var(--ok)',
                  fontWeight: 500,
                }}
              >
                {conditionLabel(conditionRecord)}
              </span>
            </div>
            <div role="radiogroup" aria-label="Zustand Platte" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {CONDITION_PILLS.map((label) => {
                const isSelected = conditionLabel(conditionRecord) === label;
                return (
                  <span
                    key={label}
                    role="radio"
                    data-testid={`cond-record-${label}`}
                    aria-checked={isSelected}
                    tabIndex={0}
                    onClick={() => setConditionRecord(conditionFromLabel(label))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        setConditionRecord(conditionFromLabel(label));
                      }
                    }}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 'var(--r-pill)',
                      fontSize: 12.5,
                      fontWeight: isSelected ? 700 : 600,
                      background: isSelected ? 'var(--accent)' : 'var(--surface-3)',
                      color: isSelected ? 'var(--on-accent)' : 'var(--text-3)',
                      boxShadow: isSelected ? 'var(--shadow-1)' : undefined,
                      cursor: 'pointer',
                    }}
                  >
                    {label}
                  </span>
                );
              })}
            </div>

            {/* Cover condition */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                marginTop: 4,
              }}
            >
              <span style={{ fontWeight: 600, fontSize: 13.5 }}>Zustand · Cover</span>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12,
                  color: 'var(--ok)',
                  fontWeight: 500,
                }}
              >
                {conditionLabel(conditionCover)}
              </span>
            </div>
            <div role="radiogroup" aria-label="Zustand Cover" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {CONDITION_PILLS.map((label) => {
                const isSelected = conditionLabel(conditionCover) === label;
                return (
                  <span
                    key={label}
                    role="radio"
                    data-testid={`cond-cover-${label}`}
                    aria-checked={isSelected}
                    tabIndex={0}
                    onClick={() => setConditionCover(conditionFromLabel(label))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        setConditionCover(conditionFromLabel(label));
                      }
                    }}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 'var(--r-pill)',
                      fontSize: 12.5,
                      fontWeight: isSelected ? 700 : 600,
                      background: isSelected ? 'var(--accent)' : 'var(--surface-3)',
                      color: isSelected ? 'var(--on-accent)' : 'var(--text-3)',
                      boxShadow: isSelected ? 'var(--shadow-1)' : undefined,
                      cursor: 'pointer',
                    }}
                  >
                    {label}
                  </span>
                );
              })}
            </div>
          </div>

          {/* ── Listing toggle ────────────────────────────────────────────── */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              cursor: 'pointer',
              minHeight: 32,
            }}
          >
            <button
              type="button"
              role="switch"
              data-testid="list-on-discogs-toggle"
              aria-checked={listOnDiscogs}
              onClick={() => setListOnDiscogs((v) => !v)}
              style={{
                position: 'relative',
                width: 46,
                height: 28,
                borderRadius: 'var(--r-pill)',
                background: listOnDiscogs ? 'var(--accent)' : 'var(--surface-3)',
                flex: 'none',
                border: 'none',
                cursor: 'pointer',
                transition: 'background var(--dur-1) var(--ease)',
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  top: 3,
                  left: listOnDiscogs ? 21 : 3,
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  background: 'var(--on-accent)',
                  boxShadow: 'var(--shadow-1)',
                  transition: 'left var(--dur-1) var(--ease)',
                }}
              />
            </button>
            <span style={{ fontSize: 14 }}>Direkt auf Discogs zum Verkauf listen</span>
          </label>

          {/* Inline error */}
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
                fontFamily: 'var(--font-body)',
                fontSize: 13.5,
              }}
            >
              {error}
            </p>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            gap: 12,
            padding: '16px 22px',
            borderTop: '1px solid var(--border)',
            background: 'var(--surface-2)',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              flex: 1,
              minHeight: 'var(--tap)',
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
            data-testid="ankauf-submit"
            onClick={handleSubmit}
            disabled={isPending}
            className="focus-ring-button"
            style={{
              flex: 1.5,
              minHeight: 'var(--tap)',
              border: 'none',
              borderRadius: 'var(--r-pill)',
              background: 'var(--accent)',
              color: 'var(--on-accent)',
              fontFamily: 'var(--font-body)',
              fontWeight: 700,
              fontSize: 14.5,
              cursor: isPending ? 'not-allowed' : 'pointer',
              transition: 'background var(--dur-1) var(--ease)',
            }}
          >
            Zum Bestand hinzufügen
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
