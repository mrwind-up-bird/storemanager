'use client';

// Kamera-Scanner-Bottom-Sheet (C8). Zwei Modi:
//   'ean'   → EAN/UPC erkennen (oder manuell eingeben) → onDetectEan(ean)
//   'label' → Etiketten-QR (Discogs-Release-URL, Slice 4) → onDetectRelease(releaseId)
// barcode-detector (zxing-wasm) ist schwer → dynamic import NUR nach Kamera-Start
// (Global Constraint 6). Der Stream wird über stopStream() in JEDEM Pfad beendet.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Sheet } from '@/components/ui/Sheet';
import { parseDiscogsReleaseUrl } from '@/lib/discogs/parse';

const EAN_RE = /^\d{8,14}$/;
const EAN_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'] as const;

export interface ScannerSheetProps {
  open: boolean;
  onClose: () => void;
  mode: 'ean' | 'label';
  /** mode='ean': erkannter/manuell eingegebener EAN/UPC (8–14 Ziffern, getrimmt). */
  onDetectEan?: (ean: string) => void;
  /** mode='label': via QR aufgelöste Discogs-Release-ID (> 0). */
  onDetectRelease?: (releaseId: number) => void;
}

export function ScannerSheet({ open, onClose, mode, onDetectEan, onDetectRelease }: ScannerSheetProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanHint, setScanHint] = useState<string | null>(null);
  const [manualValue, setManualValue] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (!open) return;
    setCameraError(null);
    setScanHint(null);
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | undefined;

    void (async () => {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setCameraError('Keine Kamera verfügbar — Code unten manuell eingeben.');
        return;
      }
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
      } catch (err) {
        setCameraError(
          err instanceof DOMException && err.name === 'NotAllowedError'
            ? 'Kamera-Zugriff verweigert — bitte in den Browser-Einstellungen erlauben.'
            : 'Keine Kamera verfügbar — Code unten manuell eingeben.',
        );
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => undefined);
      }

      const { BarcodeDetector } = await import('barcode-detector/ponyfill');
      if (cancelled) return; // Sheet ggf. während des (schweren) dynamic imports geschlossen worden
      const detector = new BarcodeDetector({ formats: [...EAN_FORMATS, 'qr_code'] });
      intervalId = setInterval(() => {
        void (async () => {
          const v = videoRef.current;
          if (!v || v.readyState < 2) return;
          let codes: Awaited<ReturnType<typeof detector.detect>>;
          try {
            codes = await detector.detect(v);
          } catch {
            return;
          }
          for (const code of codes) {
            if (mode === 'ean' && (EAN_FORMATS as readonly string[]).includes(code.format)) {
              const value = code.rawValue.trim();
              if (EAN_RE.test(value)) {
                stopStream();
                onDetectEan?.(value);
                return;
              }
            }
            if (mode === 'label' && code.format === 'qr_code') {
              const releaseId = parseDiscogsReleaseUrl(code.rawValue);
              if (releaseId !== null) {
                stopStream();
                onDetectRelease?.(releaseId);
                return;
              }
              setScanHint('Kein Q-Records-Etikett erkannt.');
            }
          }
        })();
      }, 250);
    })();

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
      stopStream();
    };
  }, [open, mode, onDetectEan, onDetectRelease, stopStream]);

  const handleManualSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const value = manualValue.trim();
    if (!EAN_RE.test(value)) {
      setManualError('Ungültiger Barcode — 8 bis 14 Ziffern.');
      return;
    }
    setManualError(null);
    stopStream();
    onDetectEan?.(value);
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      side="bottom"
      title={mode === 'ean' ? 'Barcode scannen' : 'Etikett scannen'}
    >
      <div data-testid="scanner-sheet" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Drag-Handle-Optik (statisch, Handoff Z. 335ff) */}
        <div
          aria-hidden="true"
          style={{
            width: 40, height: 4, borderRadius: 'var(--r-pill)',
            background: 'var(--border-strong)', margin: '0 auto',
          }}
        />
        {/* Viewfinder */}
        {cameraError === null && (
          <video
            ref={videoRef}
            muted
            playsInline
            style={{
              width: '100%', aspectRatio: '4 / 3', objectFit: 'cover',
              borderRadius: 'var(--r-lg)', background: 'var(--n-950)',
            }}
          />
        )}
        {cameraError !== null && (
          <p
            role="alert"
            style={{
              margin: 0, padding: '10px 14px', borderRadius: 'var(--r-md)',
              background: 'var(--warn-soft)', color: 'var(--warn)',
              border: '1px solid color-mix(in srgb, var(--warn) 30%, transparent)',
              fontSize: 13.5,
            }}
          >
            {cameraError}
          </p>
        )}
        {scanHint !== null && (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-3)' }}>{scanHint}</p>
        )}

        {mode === 'ean' ? (
          <form onSubmit={handleManualSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <span style={{ fontWeight: 600, fontSize: 13.5 }}>EAN/UPC manuell eingeben</span>
              <input
                type="text"
                inputMode="numeric"
                data-testid="scanner-manual-input"
                value={manualValue}
                onChange={(e) => setManualValue(e.target.value)}
                placeholder="z. B. 4988031234567"
                style={{
                  width: '100%', minHeight: 'var(--tap)', padding: '0 14px',
                  border: '1.5px solid var(--border-strong)', borderRadius: 'var(--r-md)',
                  background: 'var(--surface-2)', color: 'var(--text)',
                  fontFamily: 'var(--font-mono)', fontSize: 15,
                }}
              />
            </label>
            {manualError !== null && (
              <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--bad)' }}>
                {manualError}
              </p>
            )}
            <button
              type="submit"
              data-testid="scanner-manual-submit"
              className="focus-ring-button"
              style={{
                minHeight: 'var(--tap)', border: 'none', borderRadius: 'var(--r-pill)',
                background: 'var(--accent)', color: 'var(--on-accent)',
                fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 14.5, cursor: 'pointer',
              }}
            >
              Suchen
            </button>
          </form>
        ) : (
          cameraError !== null && (
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-2)' }}>
              Nutze stattdessen die Artikel-Suche im Schnellverkauf.
            </p>
          )
        )}
      </div>
    </Sheet>
  );
}
