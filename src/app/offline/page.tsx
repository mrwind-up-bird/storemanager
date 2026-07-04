import { VinylDisc } from '@/components/ui/VinylDisc';
import { ReloadButton } from './ReloadButton';

export const metadata = { title: 'Offline' };

export default function OfflinePage() {
  return (
    <main
      style={{
        minHeight: '100vh', display: 'grid', placeItems: 'center',
        background: 'var(--bg)', color: 'var(--text)',
        fontFamily: 'var(--font-body)', padding: 24,
      }}
    >
      <div
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
          textAlign: 'center', border: '1px solid var(--border)',
          borderRadius: 'var(--r-xl)', background: 'var(--surface)',
          boxShadow: 'var(--shadow-2)', padding: '40px 32px', maxWidth: 380,
        }}
      >
        <VinylDisc size={56} />
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 24 }}>
          Du bist offline
        </h1>
        <p style={{ margin: 0, color: 'var(--text-2)', fontSize: 14.5, lineHeight: 1.6 }}>
          Sobald die Verbindung zurück ist, kann es weitergehen.
        </p>
        <ReloadButton />
      </div>
    </main>
  );
}
