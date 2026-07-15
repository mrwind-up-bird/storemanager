'use client';

// src/app/(app)/inventar/_components/RecordDetail.tsx
// Lagerbestand-Kachel (Design-Update) — one record (catalog) + all its physical copies.
// Master card (cover, identity, metadata, styles) + a "Lagerbestand" list of copies (Exemplare),
// each with per-copy grade / price / status and the real sell (POS SellModal) + reserve actions.
// The ✎ button opens the Edit-Record-Modal. Dropped from the prototype (no data source): the
// Spotify button and the favourite star. "Im Katalog öffnen" links to the Discogs release.

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { RecordDetail as RecordDetailData, RecordCopy } from '@/lib/records';
import type { Condition } from '@/components/ui/ConditionPill';
import { ConditionPill } from '@/components/ui/ConditionPill';
import { CoverPlaceholder } from '@/components/ui/CoverPlaceholder';
import { fromCents } from '@/lib/money';
import { formatEuroCents } from '@/lib/format';
import { reserve, cancelReservation } from '@/app/(app)/kasse/actions';
import { SellModal } from './SellModal';
import { EditRecordModal } from './EditRecordModal';

export interface RecordDetailProps {
  detail: RecordDetailData;
  canEdit: boolean;
}

const discColor = (format: string | null) => (format === 'CD' ? 'var(--info)' : 'var(--accent)');

const STATUS_META: Record<RecordCopy['status'], { label: string; color: string }> = {
  verfuegbar: { label: 'im Lager', color: 'var(--ok)' },
  reserviert: { label: 'Reserviert', color: 'var(--honey-ink)' },
  verkauft: { label: 'Verkauft', color: 'var(--text-3)' },
  verliehen: { label: 'Verliehen', color: 'var(--info)' },
};

export function RecordDetail({ detail, canEdit }: RecordDetailProps) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [sellCopy, setSellCopy] = useState<RecordCopy | null>(null);
  const [rowError, setRowError] = useState<{ id: number; msg: string } | null>(null);

  const s = detail.stats;
  const inStock = s.available + s.reserved;
  const metaLine = [
    detail.releaseYear,
    detail.label.join(' / ') || null,
    detail.country,
    detail.genre.join(' / ') || null,
    detail.format,
    `#${detail.id}`,
  ]
    .filter(Boolean)
    .join(' · ');

  const onReserve = async (purchaseId: number) => {
    setRowError(null);
    const res = await reserve({ purchaseId });
    if (!res.ok) setRowError({ id: purchaseId, msg: 'Reservierung fehlgeschlagen — evtl. nicht mehr verfügbar.' });
    router.refresh();
  };
  const onCancel = async (purchaseId: number) => {
    setRowError(null);
    const res = await cancelReservation({ purchaseId });
    if (!res.ok) setRowError({ id: purchaseId, msg: 'Reservierung aufheben fehlgeschlagen.' });
    router.refresh();
  };

  return (
    <div style={{ width: '100%', maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 14, margin: '0 auto' }}>
      {/* eyebrow + back */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--accent)' }}>
          q·records · Lagerbestand
        </span>
        <Link href="/inventar" style={{ fontSize: 13, color: 'var(--text-2)', textDecoration: 'none' }}>← Inventar</Link>
      </div>

      {/* MASTER CARD */}
      <article style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-xl)', background: 'var(--surface)', boxShadow: 'var(--shadow-2)', overflow: 'hidden' }}>
        {/* cover */}
        <div style={{ position: 'relative', aspectRatio: 2.1, overflow: 'hidden', background: 'var(--surface-2)' }}>
          {detail.coverImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={detail.coverImage} alt={`${detail.title} – Cover`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <CoverPlaceholder aspectRatio={2.1} labelColor={discColor(detail.format)} />
          )}
          <span style={{ position: 'absolute', top: 14, left: 14, display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 13px', borderRadius: 'var(--r-pill)', background: inStock > 0 ? 'var(--ok-soft)' : 'var(--surface-3)', color: inStock > 0 ? 'var(--ok)' : 'var(--text-2)', border: `1px solid color-mix(in srgb, ${inStock > 0 ? 'var(--ok)' : 'var(--text-3)'} 30%, transparent)`, fontSize: 12.5, fontWeight: 700, backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}>
            <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: inStock > 0 ? 'var(--ok)' : 'var(--text-3)' }} />
            {inStock > 0 ? `${inStock} im Lager` : 'nicht am Lager'}
          </span>
          {detail.format && (
            <span style={{ position: 'absolute', bottom: 14, left: 14, display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 13px', borderRadius: 'var(--r-pill)', background: 'var(--accent-soft)', color: 'var(--accent-ink)', border: '1px solid var(--accent-soft-border)', fontSize: 12.5, fontWeight: 700, backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}>
              <span aria-hidden="true">⬤</span> {detail.format}
            </span>
          )}
        </div>

        <div style={{ padding: 'clamp(15px,3.5vw,20px)' }}>
          {/* action buttons */}
          <div style={{ display: 'flex', gap: 9, marginBottom: 15 }}>
            {canEdit && (
              <button type="button" onClick={() => setEditOpen(true)} aria-label="Artikel bearbeiten" data-testid="record-edit-open" className="focus-ring-button" style={{ minHeight: 'var(--tap)', padding: '0 16px', flex: 'none', border: 'none', borderRadius: 'var(--r-md)', background: 'var(--accent)', color: 'var(--on-accent)', fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span aria-hidden="true">✎</span> Bearbeiten
              </button>
            )}
            {detail.discogsId != null && (
              <a href={`https://www.discogs.com/release/${detail.discogsId}`} target="_blank" rel="noreferrer" aria-label="Im Discogs-Katalog öffnen" className="focus-ring-button" style={{ minHeight: 'var(--tap)', padding: '0 16px', flex: 'none', border: '1.5px solid var(--border-strong)', borderRadius: 'var(--r-md)', background: 'var(--surface)', color: 'var(--text-2)', fontWeight: 600, fontSize: 14, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
                <span aria-hidden="true">▤</span> Katalog
              </a>
            )}
          </div>

          <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 'clamp(26px,5vw,38px)', lineHeight: 1.03, letterSpacing: '-.025em', margin: 0, textWrap: 'balance' }}>{detail.title}</h1>
          <div style={{ fontSize: 'clamp(16px,2.6vw,20px)', fontWeight: 700, color: 'var(--accent-ink)', marginTop: 5 }}>{detail.artist}</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-3)', marginTop: 12, lineHeight: 1.5 }}>{metaLine}</div>

          {/* styles */}
          {detail.styles.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: '10.5px', fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 9 }}>Stile</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {detail.styles.map((st) => (
                  <span key={st} style={{ padding: '7px 13px', borderRadius: 'var(--r-pill)', background: 'var(--accent-soft)', color: 'var(--accent-ink)', fontSize: 13, fontWeight: 600 }}>{st}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      </article>

      {/* LAGERBESTAND */}
      <section style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-xl)', background: 'var(--surface)', boxShadow: 'var(--shadow-1)', padding: 'clamp(15px,3.5vw,20px)' }}>
        <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, marginBottom: 14 }}>
          <div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 21, letterSpacing: '-.01em', margin: 0 }}>Lagerbestand</h2>
            <p style={{ color: 'var(--text-2)', fontSize: 13.5, margin: '4px 0 0' }}>Physische Exemplare dieses Titels</p>
          </div>
          <span style={{ flex: 'none', padding: '6px 14px', borderRadius: 'var(--r-pill)', background: 'var(--accent-soft)', color: 'var(--accent-ink)', border: '1px solid var(--accent-soft-border)', fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap' }}>
            {s.total} {s.total === 1 ? 'Exemplar' : 'Exemplare'}
          </span>
        </header>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {detail.copies.length === 0 && <p style={{ color: 'var(--text-3)', fontSize: 13.5, margin: 0 }}>Keine Exemplare erfasst.</p>}
          {detail.copies.map((copy, i) => {
            const meta = STATUS_META[copy.status];
            const sold = copy.status === 'verkauft';
            const priceCents = sold ? copy.soldPriceCents : copy.targetPriceCents;
            const sellable = copy.status === 'verfuegbar' || copy.status === 'reserviert';
            return (
              <div key={copy.purchaseId} style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 18px', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', background: 'var(--surface-2)', opacity: sold ? 0.62 : 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13.5, color: meta.color }}>
                    <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: meta.color }} />
                    <span style={{ color: 'var(--text-3)', fontWeight: 600 }}>Exemplar {i + 1}</span>
                    <span aria-hidden="true" style={{ color: 'var(--border-strong)' }}>·</span>
                    {meta.label}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, fontSize: 20, letterSpacing: '-.01em', color: sold ? 'var(--text-3)' : 'var(--text)' }}>
                      {priceCents != null ? formatEuroCents(priceCents) : '—'}
                    </span>
                    {canEdit && sellable && (
                      <button type="button" onClick={() => setSellCopy(copy)} data-testid="detail-sell" className="focus-ring-button" style={{ minHeight: 40, padding: '0 20px', border: '1.5px solid var(--accent)', borderRadius: 'var(--r-pill)', background: 'transparent', color: 'var(--accent-ink)', fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        Verkaufen
                      </button>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px 20px' }}>
                  <GradeCell label="Cover" grade={copy.conditionCover} />
                  <GradeCell label="Platte" grade={copy.conditionRecord} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={microLabel}>Eingang</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13.5, color: 'var(--text-2)' }}>{copy.acquiredAt ? new Date(copy.acquiredAt).toLocaleDateString('de-DE') : '—'}</span>
                  </div>
                  {canEdit && copy.status === 'verfuegbar' && (
                    <button type="button" onClick={() => onReserve(copy.purchaseId)} style={secondaryPill}>Reservieren</button>
                  )}
                  {canEdit && copy.status === 'reserviert' && (
                    <button type="button" onClick={() => onCancel(copy.purchaseId)} style={secondaryPill}>Reservierung aufheben</button>
                  )}
                </div>
                {copy.notes && <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-3)' }}>&bdquo;{copy.notes}&ldquo;</p>}
                {rowError?.id === copy.purchaseId && <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--bad)' }}>{rowError.msg}</p>}
              </div>
            );
          })}
        </div>

        <footer style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, marginTop: 16, paddingTop: 16, borderTop: '1px dashed var(--border)' }}>
          <span style={{ fontSize: 13.5, color: 'var(--text-2)' }}>Bestandswert</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, fontSize: 18, color: 'var(--text)' }}>{formatEuroCents(s.stockValueCents)}</span>
        </footer>
      </section>

      {sellCopy && (
        <SellModal
          purchaseId={sellCopy.purchaseId}
          title={detail.title}
          artist={detail.artist}
          targetPrice={sellCopy.targetPriceCents != null ? fromCents(sellCopy.targetPriceCents) : null}
          onClose={() => {
            setSellCopy(null);
            router.refresh();
          }}
        />
      )}

      {editOpen && <EditRecordModal detail={detail} onClose={() => setEditOpen(false)} />}
    </div>
  );
}

const microLabel: React.CSSProperties = { fontSize: '10.5px', fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--text-3)' };
const secondaryPill: React.CSSProperties = {
  minHeight: 40,
  padding: '0 16px',
  border: '1.5px solid var(--border-strong)',
  borderRadius: 'var(--r-pill)',
  background: 'transparent',
  color: 'var(--text-2)',
  fontFamily: 'var(--font-body)',
  fontWeight: 600,
  fontSize: 13.5,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

function GradeCell({ label, grade }: { label: string; grade: number | null }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={microLabel}>{label}</span>
      {grade != null ? <ConditionPill condition={grade as Condition} /> : <span style={{ color: 'var(--text-3)', fontSize: 13 }}>—</span>}
    </div>
  );
}
