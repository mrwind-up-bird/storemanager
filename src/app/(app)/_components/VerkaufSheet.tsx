'use client';

// Schnellverkauf-Bottom-Sheet (C9): Artikel via Textsuche ODER Etiketten-Scan wählen.
// Der eigentliche Verkauf läuft IMMER über das bestehende SellModal — hier gibt es
// keine eigene createSale-Logik (Preisautorität bleibt der Server, C10/Slice 3).

import { useEffect, useRef, useState } from 'react';
import { Sheet } from '@/components/ui/Sheet';
import { ScannerSheet } from '@/components/scanner/ScannerSheet';
import { SellModal } from '@/app/(app)/inventar/_components/SellModal';
import {
  findAvailableCopiesByRelease,
  searchAvailableCopies,
  type CopyHit,
} from '@/app/(app)/kasse/actions';

export function VerkaufSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<CopyHit[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [sellCopy, setSellCopy] = useState<CopyHit | null>(null);

  // Textsuche und Etiketten-Scan schreiben beide in `hits`/`message` — Härtung gegen die
  // Race, dass eine spätere Nutzeraktion von einer zuvor gestarteten, langsameren Antwort
  // überschrieben wird (gleiche Klasse wie der isPending-Guard in SearchForm, Task 5).
  const opIdRef = useRef(0);

  // Debounced Suche über verfügbare Exemplare (Muster FilterBar, 300 ms)
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      opIdRef.current += 1; // invalidiert eine noch laufende Suchantwort, bevor sie `hits` stale wiederherstellen kann
      setHits([]);
      return;
    }
    const tid = setTimeout(() => {
      const opId = ++opIdRef.current;
      void searchAvailableCopies(q).then((res) => {
        if (opIdRef.current !== opId) return;
        if (res.ok) setHits(res.copies);
      });
    }, 300);
    return () => clearTimeout(tid);
  }, [query]);

  // Reopen-Reset: Sheet öffnet immer mit sauberem State (keine Reste aus einer vorigen
  // Sitzung); der opId-Bump invalidiert dabei auch alles, was zum Schließzeitpunkt noch in-flight war.
  useEffect(() => {
    if (!open) return;
    opIdRef.current += 1;
    setQuery('');
    setHits([]);
    setMessage(null);
    setSellCopy(null);
    setScanOpen(false);
  }, [open]);

  const handleRelease = async (releaseId: number) => {
    const opId = ++opIdRef.current;
    setScanOpen(false);
    setMessage(null);
    const res = await findAvailableCopiesByRelease(releaseId);
    if (opIdRef.current !== opId) return;
    if (!res.ok) {
      setMessage('Fehler beim Nachschlagen. Bitte erneut versuchen.');
      return;
    }
    if (res.copies.length === 0) {
      setMessage('Kein verfügbares Exemplar zu diesem Release im Bestand.');
      return;
    }
    if (res.copies.length === 1) {
      setSellCopy(res.copies[0]!);
      return;
    }
    setHits(res.copies); // mehrere: dieselbe Trefferliste wie die Suche
  };

  return (
    <>
      <Sheet open={open} onClose={onClose} side="bottom" title="Schnellverkauf">
        <div
          data-testid="verkauf-sheet"
          style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
        >
          <button
            type="button"
            onClick={() => setScanOpen(true)}
            className="focus-ring-button"
            style={{
              minHeight: 'var(--tap)', border: 'none', borderRadius: 'var(--r-pill)',
              background: 'var(--accent)', color: 'var(--on-accent)',
              fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14.5, cursor: 'pointer',
            }}
          >
            Etikett scannen
          </button>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <span style={{ fontWeight: 600, fontSize: 13.5 }}>Artikel suchen</span>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Titel oder Künstler…"
              style={{
                width: '100%', minHeight: 'var(--tap)', padding: '0 14px',
                border: '1.5px solid var(--border-strong)', borderRadius: 'var(--r-md)',
                background: 'var(--surface-2)', color: 'var(--text)', fontSize: 15,
              }}
            />
          </label>
          {message !== null && (
            <p
              role="alert"
              style={{
                margin: 0, padding: '10px 14px', borderRadius: 'var(--r-md)',
                background: 'var(--warn-soft)', color: 'var(--warn)',
                border: '1px solid color-mix(in srgb, var(--warn) 30%, transparent)',
                fontSize: 13.5,
              }}
            >
              {message}
            </p>
          )}
          <ul
            style={{
              listStyle: 'none', margin: 0, padding: 0,
              display: 'flex', flexDirection: 'column', gap: 4,
            }}
          >
            {hits.map((c) => (
              <li key={c.purchaseId}>
                <button
                  type="button"
                  onClick={() => setSellCopy(c)}
                  style={{
                    width: '100%', textAlign: 'left', padding: '8px 10px',
                    border: '1px solid var(--border)', borderRadius: 'var(--r-md)',
                    background: 'var(--surface)', cursor: 'pointer',
                  }}
                >
                  {c.artist} – {c.title} · {c.targetPrice ?? '—'} €
                </button>
              </li>
            ))}
          </ul>
        </div>
      </Sheet>
      <ScannerSheet
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        mode="label"
        onDetectRelease={(id) => { void handleRelease(id); }}
      />
      {sellCopy !== null && (
        <SellModal
          purchaseId={sellCopy.purchaseId}
          title={sellCopy.title}
          artist={sellCopy.artist}
          targetPrice={sellCopy.targetPrice}
          onClose={() => setSellCopy(null)}
        />
      )}
    </>
  );
}
