'use client';

import { useState } from 'react';
import { CoverPlaceholder } from '@/components/ui/CoverPlaceholder';

/**
 * Kachel-Cover: das echte (aus v1 importierte) Discogs-Cover, wenn vorhanden UND ladbar —
 * sonst der gehatchte CoverPlaceholder. Fällt bei kaputter/blockierter Bild-URL per onError
 * auf den Placeholder zurück (die importierten v1-URLs sind unterschiedlicher Qualität).
 * Gleiche Bildbox-Maße wie der Placeholder (aspectRatio 1.9), damit die Kartenhöhe konstant bleibt.
 */
export function TileCover({
  src,
  alt,
  discColor,
}: {
  src: string | null;
  alt: string;
  discColor: string;
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return <CoverPlaceholder aspectRatio={1.9} labelColor={discColor} />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- external Discogs CDN URLs, no next/image loader configured for them (mirrors AnkaufItemRow)
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      style={{
        display: 'block',
        width: '100%',
        aspectRatio: '1.9',
        objectFit: 'cover',
        background: 'var(--surface-2)',
      }}
    />
  );
}
