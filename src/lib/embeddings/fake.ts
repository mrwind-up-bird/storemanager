import 'server-only';
import { createHash } from 'node:crypto';
import type { EmbeddingsAdapter } from './types';

const DIM = 1536;

/** Deterministischer Pseudo-Vektor aus sha256(text), unit-normalisiert. Offline, reproduzierbar. */
function fakeVector(text: string): number[] {
  const out = new Array<number>(DIM);
  // Byte-Strom aus verketteten sha256-Blöcken (32 Byte je Block) auf DIM Floats mappen.
  let block = createHash('sha256').update(text).digest();
  let bi = 0;
  for (let i = 0; i < DIM; i++) {
    if (bi >= block.length) {
      block = createHash('sha256').update(block).digest();
      bi = 0;
    }
    // Byte 0..255 → [-1, 1)
    out[i] = (block[bi]! / 128) - 1;
    bi++;
  }
  const norm = Math.sqrt(out.reduce((s, x) => s + x * x, 0)) || 1;
  return out.map((x) => x / norm);
}

export function createFakeEmbeddingsAdapter(): EmbeddingsAdapter {
  return {
    model: 'fake-v1',
    async embed(texts: string[]): Promise<number[][]> {
      return texts.map(fakeVector);
    },
  };
}
