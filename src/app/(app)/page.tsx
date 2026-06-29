// src/app/(app)/page.tsx
export default function DashboardPage() {
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
        Übersicht
      </h1>
      <p style={{ color: 'var(--text-2)', fontSize: '15px' }}>Dashboard — Slice 1 folgt.</p>
    </div>
  );
}
