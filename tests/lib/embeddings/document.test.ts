import { describe, expect, it } from 'vitest';
import { buildEmbeddingDocument } from '@/lib/embeddings/document';
import { sha256Hex } from '@/db/hash';

const full = {
  artist: 'John Coltrane',
  title: 'A Love Supreme',
  label: ['Impulse!'],
  genre: ['Jazz', 'Modal'],
  format: 'Vinyl',
  releaseYear: 1965,
  country: 'US',
};

describe('buildEmbeddingDocument', () => {
  it('ist deterministisch und feld-geordnet (artist — title — labels — genres — format — year — country)', () => {
    expect(buildEmbeddingDocument(full)).toBe(
      'John Coltrane — A Love Supreme — Impulse! — Jazz, Modal — Vinyl — 1965 — US',
    );
  });
  it('lässt leere Felder aus, ohne die Reihenfolge zu brechen', () => {
    expect(
      buildEmbeddingDocument({ artist: 'X', title: 'Y', label: [], genre: [], format: null, releaseYear: null, country: null }),
    ).toBe('X — Y');
  });
  it('gleicher Input → gleiches Dokument (Idempotenz)', () => {
    expect(buildEmbeddingDocument(full)).toBe(buildEmbeddingDocument({ ...full }));
  });
});

describe('sha256Hex', () => {
  it('ist stabil und 64 hex chars', () => {
    const h = sha256Hex('abc');
    expect(h).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(h).toHaveLength(64);
  });
});
