import { describe, expect, it } from 'vitest';
import { createFakeEmbeddingsAdapter } from '@/lib/embeddings/fake';

describe('fake embeddings adapter', () => {
  const adapter = createFakeEmbeddingsAdapter();

  it('ist deterministisch: gleicher Text → gleicher Vektor', async () => {
    const [a] = await adapter.embed(['melancholischer Herbst-Jazz']);
    const [b] = await adapter.embed(['melancholischer Herbst-Jazz']);
    expect(a).toEqual(b);
  });

  it('liefert Dimension 1536', async () => {
    const [v] = await adapter.embed(['x']);
    expect(v).toHaveLength(1536);
  });

  it('ist unit-normalisiert (‖v‖ ≈ 1)', async () => {
    const [v] = await adapter.embed(['irgendein Text']);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('verschiedene Texte → verschiedene Vektoren', async () => {
    const [a] = await adapter.embed(['a']);
    const [b] = await adapter.embed(['b']);
    expect(a).not.toEqual(b);
  });

  it('erhält Reihenfolge und Länge des Batch', async () => {
    const out = await adapter.embed(['a', 'b', 'c']);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual((await adapter.embed(['a']))[0]);
  });

  it('model === fake-v1', () => {
    expect(adapter.model).toBe('fake-v1');
  });
});
