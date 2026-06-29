import { CoverPlaceholder, Button } from '@/components/ui';
import type { StorefrontRecord } from '@/lib/storefront';

/** CD → --info, everything else (Vinyl, Kassette, null) → --accent */
const discColor = (format: string | null) =>
  format === 'CD' ? 'var(--info)' : 'var(--accent)';

const AVAILABILITY: Record<StorefrontRecord['availability'], { label: string; color: string }> = {
  in: { label: 'Verfügbar im Store', color: 'var(--ok)' },
  low: { label: 'Nur noch 1×', color: 'var(--honey-ink)' },
};

export function StorefrontGrid({ records }: { records: StorefrontRecord[] }) {
  if (records.length === 0) {
    return (
      <div
        style={{
          border: '1.5px dashed var(--border-strong)',
          borderRadius: 'var(--r-lg)',
          padding: 'clamp(28px,6vw,56px)',
          textAlign: 'center',
          color: 'var(--text-2)',
          fontFamily: 'var(--font-body)',
        }}
      >
        <p style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '18px', color: 'var(--text)' }}>
          Nichts gefunden
        </p>
        <p style={{ marginTop: 6, fontSize: '14px' }}>
          Aktuell ist kein passender Titel im Live-Bestand.
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))',
        gap: 'clamp(14px,2vw,20px)',
      }}
    >
      {records.map((r) => {
        const avail = AVAILABILITY[r.availability];
        return (
          <article
            key={r.recordId}
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-lg)',
              overflow: 'hidden',
              boxShadow: 'var(--shadow-1)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{ position: 'relative' }}>
              <CoverPlaceholder aspectRatio={1} labelColor={discColor(r.format)} />
              <span
                style={{
                  position: 'absolute',
                  top: 10,
                  left: 10,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 10px',
                  borderRadius: 'var(--r-pill)',
                  background: 'var(--surface-2)',
                  border: '1px solid var(--border)',
                  color: avail.color,
                  fontFamily: 'var(--font-body)',
                  fontWeight: 700,
                  fontSize: '12px',
                  backdropFilter: 'blur(6px)',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{ width: 7, height: 7, borderRadius: '50%', background: avail.color }}
                />
                {avail.label}
              </span>
            </div>

            <div style={{ padding: '14px 14px 16px', display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
              <p
                style={{
                  fontFamily: 'var(--font-display)',
                  fontWeight: 700,
                  fontSize: '16px',
                  letterSpacing: '-.01em',
                  color: 'var(--text)',
                }}
              >
                {r.title}
              </p>
              <p style={{ fontSize: '14px', color: 'var(--text-2)' }}>{r.artist}</p>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-3)' }}>{r.meta}</p>
              <div style={{ marginTop: 'auto', paddingTop: 10 }}>
                <Button variant="secondary" size="sm36" disabled aria-label="Im Laden vormerken — folgt">
                  Im Laden vormerken
                </Button>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
