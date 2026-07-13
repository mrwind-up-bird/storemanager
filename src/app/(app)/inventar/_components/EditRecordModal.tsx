'use client';

// src/app/(app)/inventar/_components/EditRecordModal.tsx
// Edit-Record-Modal (Design-Update) — 3 tabs: Plattendaten · Klassifizierung · Bestand & Finanzen.
// Metadata + classification (genres/styles/tags/notes) save via the footer (updateRecordAction).
// Per-copy edits are LOCAL to each CopyRow (keyed by purchaseId, so unsaved edits in one row
// survive another row's save/refresh) and persist immediately via updatePurchaseAction. Selling a
// copy is intentionally NOT here — a sale must run through the POS; status editing excludes
// 'verkauft'. Data model: one record (catalog) → many purchases (physical copies).

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import type { RecordDetail, RecordCopy } from '@/lib/records';
import {
  CONDITION_PILLS,
  conditionFromLabel,
  DEFAULT_CONDITION_RECORD,
  DEFAULT_CONDITION_COVER,
  type ConditionGrade,
} from '@/lib/pricing';
import { fromCents } from '@/lib/money';
import { formatEuroCents } from '@/lib/format';
import {
  updateRecordAction,
  updatePurchaseAction,
  addCopyAction,
  duplicateCopyAction,
  deleteCopyAction,
} from '@/app/(app)/inventar/actions';
import type { EditableStatus } from '@/lib/copies';

export interface EditRecordModalProps {
  detail: RecordDetail;
  onClose: () => void;
}

const FORMAT_OPTIONS = ['Vinyl', 'CD', 'Kassette', 'Zubehör'];
const STATUS_OPTIONS: { value: EditableStatus; label: string }[] = [
  { value: 'verfuegbar', label: 'im Lager' },
  { value: 'reserviert', label: 'Reserviert' },
  { value: 'verliehen', label: 'Verliehen' },
];

type TabKey = 'daten' | 'tags' | 'bestand';
const TABS: { key: TabKey; icon: string; label: string }[] = [
  { key: 'daten', icon: '◉', label: 'Plattendaten' },
  { key: 'tags', icon: '🏷', label: 'Klassifizierung' },
  { key: 'bestand', icon: '▤', label: 'Bestand & Finanzen' },
];

// ── shared inline styles ──────────────────────────────────────────────────────
const fieldLabel: React.CSSProperties = { fontWeight: 600, fontSize: 13, color: 'var(--text-2)' };
const inputStyle: React.CSSProperties = {
  minHeight: 'var(--tap)',
  padding: '0 14px',
  border: '1.5px solid var(--border-strong)',
  borderRadius: 'var(--r-md)',
  background: 'var(--surface)',
  color: 'var(--text)',
  fontSize: 15,
  width: '100%',
};
const monoInput: React.CSSProperties = { ...inputStyle, fontFamily: 'var(--font-mono)' };
const sectionTitle: React.CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontWeight: 700,
  fontSize: 13,
  textTransform: 'uppercase',
  letterSpacing: '.05em',
  color: 'var(--text-3)',
  margin: 0,
};
const errorBox: React.CSSProperties = {
  margin: 0,
  padding: '10px 14px',
  borderRadius: 'var(--r-md)',
  background: 'var(--bad-soft)',
  color: 'var(--bad)',
  border: '1px solid color-mix(in srgb, var(--bad) 30%, transparent)',
  fontSize: 13.5,
};

function moneyOrNull(s: string): string | null {
  const t = s.trim();
  return t === '' ? null : t;
}
function isMoneyOrEmpty(s: string): boolean {
  const t = s.trim();
  return t === '' || /^\d+(\.\d{1,2})?$/.test(t);
}

// ── Condition radiogroup (8 pills) ────────────────────────────────────────────
function ConditionRadio({
  label,
  value,
  onChange,
}: {
  label: string;
  value: ConditionGrade;
  onChange: (g: ConditionGrade) => void;
}) {
  return (
    <div>
      <div style={{ fontSize: '10.5px', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 6 }}>
        {label}
      </div>
      <div role="radiogroup" aria-label={label} style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {CONDITION_PILLS.map((pill) => {
          const grade = conditionFromLabel(pill);
          const selected = grade === value;
          return (
            <button
              key={pill}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(grade)}
              className="focus-ring-button"
              style={{
                minWidth: 40,
                padding: '7px 11px',
                borderRadius: 'var(--r-pill)',
                border: '1px solid transparent',
                fontSize: 12.5,
                fontWeight: selected ? 700 : 600,
                background: selected ? 'var(--accent)' : 'var(--surface-3)',
                color: selected ? 'var(--on-accent)' : 'var(--text-3)',
                boxShadow: selected ? 'var(--shadow-1)' : undefined,
                cursor: 'pointer',
              }}
            >
              {pill}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Chip editor (genres / styles / tags) ──────────────────────────────────────
const CHIP_ACCENTS = {
  ok: { soft: 'var(--ok-soft)', ink: 'var(--ok)' },
  honey: { soft: 'var(--honey-soft)', ink: 'var(--honey-ink)' },
  info: { soft: 'var(--info-soft)', ink: 'var(--info)' },
} as const;

function ChipEditor({
  title,
  hint,
  items,
  onChange,
  accent,
  placeholder,
}: {
  title: string;
  hint: string;
  items: string[];
  onChange: (next: string[]) => void;
  accent: keyof typeof CHIP_ACCENTS;
  placeholder: string;
}) {
  const [draft, setDraft] = useState('');
  const c = CHIP_ACCENTS[accent];

  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (!items.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...items, v]);
    setDraft('');
  };

  return (
    <section style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', background: 'var(--surface)', padding: 20, boxShadow: 'var(--shadow-1)' }}>
      <h3 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, margin: 0 }}>{title}</h3>
      <p style={{ color: 'var(--text-2)', fontSize: 13, margin: '5px 0 14px' }}>{hint}</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          className="focus-ring-field"
          style={{ ...inputStyle, minHeight: 42, flex: 1, background: 'var(--surface-2)' }}
        />
        <button
          type="button"
          onClick={add}
          className="focus-ring-button"
          style={{ flex: 'none', minHeight: 42, padding: '0 16px', border: 'none', borderRadius: 'var(--r-md)', background: 'var(--accent)', color: 'var(--on-accent)', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
        >
          + Hinzufügen
        </button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
        {items.length === 0 && <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>Noch nichts erfasst.</span>}
        {items.map((x) => (
          <span key={x} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 8px 7px 13px', borderRadius: 'var(--r-pill)', background: c.soft, color: c.ink, fontSize: 13, fontWeight: 600 }}>
            {x}
            <button
              type="button"
              onClick={() => onChange(items.filter((y) => y !== x))}
              aria-label={`${x} entfernen`}
              style={{ width: 20, height: 20, border: 'none', borderRadius: '50%', background: `color-mix(in srgb, ${c.ink} 16%, transparent)`, color: c.ink, fontSize: 12, cursor: 'pointer', display: 'grid', placeItems: 'center', lineHeight: 1 }}
            >
              ✕
            </button>
          </span>
        ))}
      </div>
    </section>
  );
}

// ── One editable copy (purchases row) ─────────────────────────────────────────
function CopyRow({ copy, index }: { copy: RecordCopy; index: number }) {
  const router = useRouter();
  const sold = copy.status === 'verkauft';

  const [ek, setEk] = useState(copy.purchasePriceCents != null ? fromCents(copy.purchasePriceCents) : '');
  const [vk, setVk] = useState(copy.targetPriceCents != null ? fromCents(copy.targetPriceCents) : '');
  const [cr, setCr] = useState<ConditionGrade>((copy.conditionRecord ?? DEFAULT_CONDITION_RECORD) as ConditionGrade);
  const [cc, setCc] = useState<ConditionGrade>((copy.conditionCover ?? DEFAULT_CONDITION_COVER) as ConditionGrade);
  const [status, setStatus] = useState<EditableStatus>(sold ? 'verfuegbar' : (copy.status as EditableStatus));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);

  const ekBad = !isMoneyOrEmpty(ek);
  const vkBad = !isMoneyOrEmpty(vk);

  const save = async () => {
    if (ekBad || vkBad || sold) return;
    setBusy(true);
    setError(null);
    const res = await updatePurchaseAction({
      purchaseId: copy.purchaseId,
      purchasePrice: moneyOrNull(ek),
      targetPrice: moneyOrNull(vk),
      conditionRecord: cr,
      conditionCover: cc,
      status,
      notes: copy.notes ?? null,
    });
    setBusy(false);
    if (res.ok) router.refresh();
    else setError(res.message ?? 'Speichern fehlgeschlagen.');
  };

  const structural = async (fn: () => Promise<{ ok: boolean; message?: string }>) => {
    setBusy(true);
    setError(null);
    const res = await fn();
    setBusy(false);
    if (res.ok) router.refresh();
    else setError(res.message ?? 'Aktion fehlgeschlagen.');
  };

  const marginCents =
    copy.soldPriceCents != null && copy.purchasePriceCents != null
      ? copy.soldPriceCents - copy.purchasePriceCents
      : null;

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-md)', background: 'var(--surface-2)', padding: 16, display: 'flex', flexDirection: 'column', gap: 12, opacity: sold ? 0.85 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-3)' }}>Exemplar {index + 1}</span>
          <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
            Eingang {copy.acquiredAt ? new Date(copy.acquiredAt).toLocaleDateString('de-DE') : '—'}
          </span>
        </div>
        {confirmDel ? (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }} role="group" aria-label="Löschen bestätigen">
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--bad)' }}>Wirklich löschen?</span>
            <button type="button" onClick={() => structural(() => deleteCopyAction({ purchaseId: copy.purchaseId }))} disabled={busy} className="focus-ring-button" style={{ minHeight: 'var(--tap)', padding: '0 16px', border: 'none', borderRadius: 'var(--r-pill)', background: 'var(--bad)', color: 'var(--on-accent, #fff)', fontWeight: 700, fontSize: 13, cursor: busy ? 'wait' : 'pointer' }}>Löschen</button>
            <button type="button" onClick={() => setConfirmDel(false)} disabled={busy} className="focus-ring-button" style={{ minHeight: 'var(--tap)', padding: '0 14px', border: '1.5px solid var(--border-strong)', borderRadius: 'var(--r-pill)', background: 'var(--surface)', color: 'var(--text-2)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Abbrechen</button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" onClick={() => structural(() => duplicateCopyAction({ purchaseId: copy.purchaseId }))} disabled={busy} aria-label="Duplizieren" title="Duplizieren" className="focus-ring-button" style={iconBtn}>⧉</button>
            <button type="button" onClick={() => { setError(null); setConfirmDel(true); }} disabled={busy} aria-label="Löschen" title="Löschen" className="focus-ring-button" style={iconBtnDanger}>🗑</button>
          </div>
        )}
      </div>

      {sold ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 24px', alignItems: 'baseline' }}>
          <ReadStat k="Status" v="Verkauft" />
          <ReadStat k="Verkauft am" v={copy.soldDate ? new Date(copy.soldDate).toLocaleDateString('de-DE') : '—'} />
          <ReadStat k="EK" v={copy.purchasePriceCents != null ? formatEuroCents(copy.purchasePriceCents) : '—'} />
          <ReadStat k="VK" v={copy.soldPriceCents != null ? formatEuroCents(copy.soldPriceCents) : '—'} />
          <ReadStat k="Marge" v={marginCents != null ? formatEuroCents(marginCents) : '—'} strong color={marginCents != null && marginCents < 0 ? 'var(--bad)' : 'var(--ok)'} />
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 12 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={microLabel}>EK €</span>
              <input inputMode="decimal" value={ek} onChange={(e) => setEk(e.target.value)} className="focus-ring-field" style={{ ...monoInput, minHeight: 40, borderColor: ekBad ? 'var(--bad)' : 'var(--border-strong)' }} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={microLabel}>Ziel-VK €</span>
              <input inputMode="decimal" value={vk} onChange={(e) => setVk(e.target.value)} className="focus-ring-field" style={{ ...monoInput, minHeight: 40, borderColor: vkBad ? 'var(--bad)' : 'var(--border-strong)' }} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={microLabel}>Status</span>
              <div role="radiogroup" aria-label="Status" style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {STATUS_OPTIONS.map((s) => {
                  const sel = s.value === status;
                  return (
                    <button key={s.value} type="button" role="radio" aria-checked={sel} onClick={() => setStatus(s.value)} className="focus-ring-button" style={{ padding: '8px 12px', borderRadius: 'var(--r-pill)', border: 'none', fontSize: 12.5, fontWeight: sel ? 700 : 600, background: sel ? 'var(--accent)' : 'var(--surface-3)', color: sel ? 'var(--on-accent)' : 'var(--text-2)', cursor: 'pointer' }}>{s.label}</button>
                  );
                })}
              </div>
            </label>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            <ConditionRadio label="Zustand Platte" value={cr} onChange={setCr} />
            <ConditionRadio label="Zustand Cover" value={cc} onChange={setCc} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12 }}>
            {(ekBad || vkBad) && <span style={{ fontSize: 12, color: 'var(--bad)' }}>Preis prüfen (z. B. 12.50)</span>}
            <button type="button" onClick={save} disabled={busy || ekBad || vkBad} className="focus-ring-button" style={{ minHeight: 38, padding: '0 18px', border: '1.5px solid var(--accent)', borderRadius: 'var(--r-pill)', background: 'transparent', color: 'var(--accent-ink)', fontWeight: 700, fontSize: 13.5, cursor: busy ? 'wait' : 'pointer' }}>
              {busy ? 'Speichern…' : 'Exemplar speichern'}
            </button>
          </div>
        </>
      )}
      {error && <p role="alert" style={errorBox}>{error}</p>}
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  width: 34,
  height: 34,
  border: '1.5px solid var(--border-strong)',
  borderRadius: 'var(--r-sm)',
  background: 'var(--surface)',
  color: 'var(--text-2)',
  fontSize: 14,
  cursor: 'pointer',
  display: 'grid',
  placeItems: 'center',
};
const iconBtnDanger: React.CSSProperties = {
  ...iconBtn,
  borderColor: 'color-mix(in srgb, var(--bad) 42%, transparent)',
  color: 'var(--bad)',
};
const microLabel: React.CSSProperties = { fontSize: '10.5px', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-3)' };
const srOnly: React.CSSProperties = { position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 };

function ReadStat({ k, v, strong, color }: { k: string; v: string; strong?: boolean; color?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={microLabel}>{k}</span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: strong ? 15 : 13.5, fontWeight: strong ? 700 : 500, color: color ?? 'var(--text)' }}>{v}</span>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-md)', background: 'var(--surface)', padding: '14px 16px', boxShadow: 'var(--shadow-1)' }}>
      <div style={{ fontSize: 12, color: 'var(--text-2)', fontWeight: 600 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, fontSize: 24, marginTop: 4, letterSpacing: '-.02em', color: color ?? 'var(--text)' }}>{value}</div>
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────
export function EditRecordModal({ detail, onClose }: EditRecordModalProps) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>('daten');

  // metadata + classification — initialised once; the footer Save persists them.
  const [title, setTitle] = useState(detail.title);
  const [artist, setArtist] = useState(detail.artist);
  const [labelStr, setLabelStr] = useState(detail.label.join(', '));
  const [year, setYear] = useState(detail.releaseYear != null ? String(detail.releaseYear) : '');
  const [format, setFormat] = useState(detail.format ?? '');
  const [country, setCountry] = useState(detail.country ?? '');
  const [notes, setNotes] = useState(detail.notes ?? '');
  const [genres, setGenres] = useState<string[]>(detail.genre);
  const [styles, setStyles] = useState<string[]>(detail.styles);
  const [tags, setTags] = useState<string[]>(detail.tags);

  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [addBusy, setAddBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const saveMeta = useCallback(async () => {
    setSaving(true);
    setMetaError(null);
    setSavedTick(false);
    const yearNum = year.trim() === '' ? null : Number(year.trim());
    const res = await updateRecordAction({
      recordId: detail.id,
      title: title.trim(),
      artist: artist.trim(),
      label: labelStr.split(',').map((s) => s.trim()).filter(Boolean),
      country: country.trim() === '' ? null : country.trim(),
      releaseYear: yearNum != null && Number.isFinite(yearNum) ? Math.trunc(yearNum) : null,
      format: format.trim() === '' ? null : format.trim(),
      genre: genres,
      styles,
      tags,
      notes: notes.trim() === '' ? null : notes.trim(),
    });
    setSaving(false);
    if (res.ok) {
      setSavedTick(true);
      router.refresh();
    } else {
      setMetaError(res.message ?? 'Speichern fehlgeschlagen.');
    }
  }, [detail.id, title, artist, labelStr, country, year, format, genres, styles, tags, notes, router]);

  const addCopy = async () => {
    setAddBusy(true);
    await addCopyAction({
      recordId: detail.id,
      purchasePrice: null,
      targetPrice: null,
      conditionRecord: DEFAULT_CONDITION_RECORD,
      conditionCover: DEFAULT_CONDITION_COVER,
      listOnDiscogs: false,
    });
    setAddBusy(false);
    setTab('bestand');
    router.refresh();
  };

  const formatOpts = format && !FORMAT_OPTIONS.includes(format) ? [format, ...FORMAT_OPTIONS] : FORMAT_OPTIONS;
  const s = detail.stats;

  // Roving-tabindex arrow-key navigation for the tablist (WAI-ARIA tabs pattern).
  const onTabKeyDown = (e: React.KeyboardEvent, idx: number) => {
    let next = idx;
    if (e.key === 'ArrowRight') next = (idx + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    else return;
    e.preventDefault();
    const key = TABS[next].key;
    setTab(key);
    document.getElementById(`edit-tabbtn-${key}`)?.focus();
  };

  return createPortal(
    <div onClick={onClose} className="qr-modal-backdrop" style={{ position: 'fixed', inset: 0, zIndex: 70, display: 'grid', placeItems: 'center', padding: 16, background: 'rgba(20,14,8,.46)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)' }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${detail.title} bearbeiten`}
        data-testid="edit-record-modal"
        onClick={(e) => e.stopPropagation()}
        className="qr-modal-card"
        style={{ width: 'min(1040px, 100%)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-xl)', boxShadow: 'var(--shadow-3)', overflow: 'hidden' }}
      >
        {/* Header */}
        <header style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 20px', borderBottom: '1px solid var(--border)', flex: 'none' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 21, lineHeight: 1.05, letterSpacing: '-.02em', margin: 0 }}>{detail.title}</h1>
            <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 3 }}>
              {detail.artist} <span style={{ color: 'var(--border-strong)' }}>·</span> <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>#{detail.id}</span>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Schließen" className="focus-ring-button" style={{ width: 40, height: 40, flex: 'none', border: 'none', borderRadius: '50%', background: 'var(--surface-3)', color: 'var(--text-2)', fontSize: 17, cursor: 'pointer', display: 'grid', placeItems: 'center' }}>✕</button>
        </header>

        {/* Tabs */}
        <div role="tablist" aria-label="Bereiche" style={{ display: 'flex', gap: 4, padding: '10px 18px 0', borderBottom: '1px solid var(--border)', flex: 'none', overflowX: 'auto' }}>
          {TABS.map((t, i) => {
            const sel = t.key === tab;
            return (
              <button
                key={t.key}
                id={`edit-tabbtn-${t.key}`}
                type="button"
                role="tab"
                aria-selected={sel}
                aria-controls="edit-tabpanel"
                tabIndex={sel ? 0 : -1}
                onClick={() => setTab(t.key)}
                onKeyDown={(e) => onTabKeyDown(e, i)}
                data-testid={`edit-tab-${t.key}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 14px', border: 'none', borderBottom: `2px solid ${sel ? 'var(--accent)' : 'transparent'}`, background: 'transparent', color: sel ? 'var(--text)' : 'var(--text-2)', fontFamily: 'var(--font-body)', fontWeight: sel ? 700 : 600, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                <span aria-hidden="true" style={{ fontSize: 15 }}>{t.icon}</span>
                {t.label}
                {t.key === 'bestand' && <span style={{ marginLeft: 2, padding: '1px 8px', borderRadius: 'var(--r-pill)', background: 'var(--surface-3)', color: 'var(--text-2)', fontSize: 11.5, fontWeight: 700 }}>{s.total}<span style={srOnly}> Exemplare</span></span>}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div id="edit-tabpanel" role="tabpanel" aria-labelledby={`edit-tabbtn-${tab}`} className="qm-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: 'var(--bg)', padding: 'clamp(16px,3vw,26px)' }}>
          {tab === 'daten' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 760 }}>
              <section>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14 }}>
                  <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--accent)' }} />
                  <h2 style={sectionTitle}>Metadaten</h2>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: '16px 20px' }}>
                  <Field label="Künstler"><input value={artist} onChange={(e) => setArtist(e.target.value)} className="focus-ring-field" style={inputStyle} /></Field>
                  <Field label="Titel"><input value={title} onChange={(e) => setTitle(e.target.value)} className="focus-ring-field" style={inputStyle} /></Field>
                  <Field label="Label (Komma-getrennt)"><input value={labelStr} onChange={(e) => setLabelStr(e.target.value)} className="focus-ring-field" style={inputStyle} /></Field>
                  <Field label="Jahr"><input inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} className="focus-ring-field" style={monoInput} /></Field>
                  <Field label="Format">
                    <div style={{ position: 'relative', display: 'flex' }}>
                      <select value={format} onChange={(e) => setFormat(e.target.value)} className="focus-ring-field" style={{ ...inputStyle, appearance: 'none', paddingRight: 40, cursor: 'pointer' }}>
                        <option value="">—</option>
                        {formatOpts.map((f) => <option key={f} value={f}>{f}</option>)}
                      </select>
                      <span aria-hidden="true" style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', pointerEvents: 'none' }}>▾</span>
                    </div>
                  </Field>
                  <Field label="Land"><input value={country} onChange={(e) => setCountry(e.target.value)} className="focus-ring-field" style={inputStyle} /></Field>
                </div>
              </section>
              <section>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
                  <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--info)' }} />
                  <h2 style={sectionTitle}>Notizen / Beschreibung</h2>
                </div>
                <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} className="focus-ring-field" style={{ ...inputStyle, minHeight: undefined, padding: '12px 14px', lineHeight: 1.55, resize: 'vertical', fontSize: 14.5 }} />
              </section>
            </div>
          )}

          {tab === 'tags' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 820 }}>
              <ChipEditor title="Tags" hint="Eigene Tags zum Organisieren & Filtern deines Bestands" items={tags} onChange={setTags} accent="info" placeholder="Tag eingeben & Enter" />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 16 }}>
                <ChipEditor title="Genres" hint="Hauptgenres dieser Platte" items={genres} onChange={setGenres} accent="ok" placeholder="Genre & Enter" />
                <ChipEditor title="Styles" hint="Sub-Genres & Stilrichtungen" items={styles} onChange={setStyles} accent="honey" placeholder="Style & Enter" />
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--text-3)', fontSize: 12.5 }}>
                <span aria-hidden="true" style={{ color: 'var(--honey)' }}>ⓘ</span> Genres & Styles werden beim Discogs-Sync automatisch ergänzt.
              </div>
            </div>
          )}

          {tab === 'bestand' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 12 }}>
                <StatCard label="Ankäufe" value={String(s.total)} />
                <StatCard label="Im Lager" value={String(s.available + s.reserved)} color="var(--ok)" />
                <StatCard label="Verkauft" value={String(s.sold)} />
                <StatCard label="Marge gesamt" value={formatEuroCents(s.marginCents)} color={s.marginCents < 0 ? 'var(--bad)' : undefined} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17, letterSpacing: '-.01em', margin: 0 }}>Exemplare</h2>
                <button type="button" onClick={addCopy} disabled={addBusy} className="focus-ring-button" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 'var(--tap)', padding: '0 18px', border: 'none', borderRadius: 'var(--r-pill)', background: 'var(--accent)', color: 'var(--on-accent)', fontWeight: 700, fontSize: 14, cursor: addBusy ? 'wait' : 'pointer', boxShadow: 'var(--shadow-1)' }}>
                  <span aria-hidden="true" style={{ fontSize: 16 }}>+</span> Neuer Ankauf
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {detail.copies.length === 0 && <p style={{ color: 'var(--text-3)', fontSize: 13.5 }}>Noch keine Exemplare — &bdquo;Neuer Ankauf&ldquo; legt das erste an.</p>}
                {detail.copies.map((copy, i) => <CopyRow key={copy.purchaseId} copy={copy} index={i} />)}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '12px 14px', borderRadius: 'var(--r-md)', background: 'var(--info-soft)', color: 'var(--info)', fontSize: 12.5 }}>
                <span aria-hidden="true">ⓘ</span> Exemplar-Änderungen werden je Zeile direkt gespeichert. Verkäufe laufen über die Kasse.
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <footer style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 20px', borderTop: '1px solid var(--border)', background: 'var(--surface-2)', flex: 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--text-3)', minWidth: 0 }}>
            <span style={{ fontFamily: 'var(--font-mono)' }}>#{detail.id}</span>
            {savedTick && <><span aria-hidden="true" style={{ color: 'var(--border-strong)' }}>·</span><span style={{ color: 'var(--ok)' }}>Gespeichert ✓</span></>}
          </div>
          {metaError && <span role="alert" style={{ color: 'var(--bad)', fontSize: 12.5 }}>{metaError}</span>}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
            <button type="button" onClick={onClose} style={{ minHeight: 'var(--tap)', padding: '0 22px', border: '1.5px solid var(--border-strong)', borderRadius: 'var(--r-pill)', background: 'var(--surface)', color: 'var(--text)', fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14.5, cursor: 'pointer' }}>Schließen</button>
            {tab !== 'bestand' && (
              <button type="button" onClick={saveMeta} disabled={saving} data-testid="edit-record-save" className="focus-ring-button" style={{ minHeight: 'var(--tap)', padding: '0 26px', border: 'none', borderRadius: 'var(--r-pill)', background: 'var(--accent)', color: 'var(--on-accent)', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14.5, cursor: saving ? 'wait' : 'pointer' }}>
                {saving ? 'Speichern…' : 'Speichern'}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <span style={fieldLabel}>{label}</span>
      {children}
    </label>
  );
}
