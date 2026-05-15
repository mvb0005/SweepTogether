import { createNoise2D } from 'simplex-noise';
import { CHUNK_SIZE } from './types';

const MINE_DENSITY_THRESHOLD = 0.9;

// FNV-1a string hash → deterministic uint32
function stringHash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

// Mulberry32 — fast, high-quality 32-bit seeded PRNG
function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class WorldGenerator {
  private readonly noise2D: (x: number, y: number) => number;
  private readonly cache = new Map<string, boolean>();

  constructor(seed: string) {
    this.noise2D = createNoise2D(mulberry32(stringHash(seed)));
  }

  isMine(x: number, y: number): boolean {
    const key = `${x},${y}`;
    let result = this.cache.get(key);
    if (result !== undefined) return result;
    const v = (this.noise2D(x, y) + 1) / 2;
    result = v < (1 - MINE_DENSITY_THRESHOLD);
    if (this.cache.size > 100_000) this.cache.clear();
    this.cache.set(key, result);
    return result;
  }

  /**
   * Computes the full CHUNK_SIZE² mine layout for a chunk.
   * Each byte: 0xFF = mine, 0-8 = adjacentMines.
   */
  computeChunkLayout(chunkX: number, chunkY: number): Uint8Array {
    const buf = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const gx = chunkX * CHUNK_SIZE + lx;
        const gy = chunkY * CHUNK_SIZE + ly;
        const idx = ly * CHUNK_SIZE + lx;
        if (this.isMine(gx, gy)) {
          buf[idx] = 0xff;
        } else {
          let adj = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              if (this.isMine(gx + dx, gy + dy)) adj++;
            }
          }
          buf[idx] = adj;
        }
      }
    }
    return buf;
  }
}
