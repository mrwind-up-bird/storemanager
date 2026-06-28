// src/app/(app)/wunschlisten/page.tsx
export default function WunschlistenPage() {
  return (
    <div>
      <h1
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: 'clamp(20px,3vw,26px)',
          letterSpacing: '-.02em',
          margin: '0 0 8px',
        }}
      >
        Wunschlisten
      </h1>
      <p style={{ color: 'var(--text-2)', fontSize: '15px' }}>Wunschlisten — Slice 3 folgt.</p>
    </div>
  );
}
