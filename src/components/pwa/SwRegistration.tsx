'use client';

// Registriert den Service Worker NUR in Production (C11) — im Dev-Modus würde
// ein SW HMR/Turbopack-Assets cachen und Entwickler in Cache-Hölle schicken.

import { useEffect } from 'react';

export function SwRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }, []);
  return null;
}
