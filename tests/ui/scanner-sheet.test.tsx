import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScannerSheet } from '@/components/scanner/ScannerSheet';

afterEach(cleanup);

// jsdom hat kein navigator.mediaDevices → der Kein-Kamera-Pfad ist der Default.
describe('ScannerSheet (C8) — Fallback-Pfade', () => {
  it('ohne Kamera: exakter Fehlertext + manuelles Feld (mode=ean)', async () => {
    render(<ScannerSheet open mode="ean" onClose={() => {}} onDetectEan={() => {}} />);
    expect(
      await screen.findByText('Keine Kamera verfügbar — Code unten manuell eingeben.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('EAN/UPC manuell eingeben')).toBeInTheDocument();
  });

  it('manueller EAN wird getrimmt an onDetectEan gereicht', async () => {
    const user = userEvent.setup();
    const onDetect = vi.fn();
    render(<ScannerSheet open mode="ean" onClose={() => {}} onDetectEan={onDetect} />);
    await user.type(screen.getByLabelText('EAN/UPC manuell eingeben'), ' 4988031234567 ');
    await user.click(screen.getByRole('button', { name: 'Suchen' }));
    // Vitest 2.x: toHaveBeenCalledExactlyOnceWith gibt es erst ab v3 — Paar-Muster nutzen.
    expect(onDetect).toHaveBeenCalledOnce();
    expect(onDetect).toHaveBeenCalledWith('4988031234567');
  });

  it('ungültiger EAN → Inline-Fehler, kein Callback', async () => {
    const user = userEvent.setup();
    const onDetect = vi.fn();
    render(<ScannerSheet open mode="ean" onClose={() => {}} onDetectEan={onDetect} />);
    await user.type(screen.getByLabelText('EAN/UPC manuell eingeben'), '123');
    await user.click(screen.getByRole('button', { name: 'Suchen' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Ungültiger Barcode — 8 bis 14 Ziffern.');
    expect(onDetect).not.toHaveBeenCalled();
  });

  it('mode=label: KEIN manuelles Feld, stattdessen Hinweis auf Artikel-Suche', async () => {
    render(<ScannerSheet open mode="label" onClose={() => {}} onDetectRelease={() => {}} />);
    expect(
      await screen.findByText('Nutze stattdessen die Artikel-Suche im Schnellverkauf.'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('EAN/UPC manuell eingeben')).toBeNull();
  });

  it('open=false rendert nichts', () => {
    render(<ScannerSheet open={false} mode="ean" onClose={() => {}} />);
    expect(screen.queryByTestId('scanner-sheet')).toBeNull();
  });
});
