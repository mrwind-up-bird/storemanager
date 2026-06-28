// src/app/(app)/schaufenster/page.tsx
export default function SchaufensterPage() {
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
        Schaufenster
      </h1>
      <p style={{ color: 'var(--text-2)', fontSize: '15px' }}>
        Öffentliche Permalinks verwalten — Slice 3 folgt.
      </p>
    </div>
  );
}
