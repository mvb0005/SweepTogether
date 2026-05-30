import { CHUNK_SIZE } from './constants';
import { Chunk, ChunkMap } from './types';
import { emptyChunk } from './chunkWire';

function cellIndex(x: number, y: number, chunkSize: number): {
  key: string;
  idx: number;
  coords: { x: number; y: number };
} {
  const chunkX = Math.floor(x / chunkSize);
  const chunkY = Math.floor(y / chunkSize);
  const lx = ((x % chunkSize) + chunkSize) % chunkSize;
  const ly = ((y % chunkSize) + chunkSize) % chunkSize;
  return {
    key: `${chunkX}_${chunkY}`,
    idx: ly * chunkSize + lx,
    coords: { x: chunkX, y: chunkY },
  };
}

function ensureChunk(chunks: ChunkMap, key: string, coords: { x: number; y: number }): Chunk {
  return chunks[key] ?? emptyChunk(coords, CHUNK_SIZE);
}

export function patchReveal(chunks: ChunkMap, x: number, y: number): ChunkMap {
  const { key, idx, coords } = cellIndex(x, y, CHUNK_SIZE);
  const chunk = ensureChunk(chunks, key, coords);
  if (chunk.revealed.includes(idx) || chunk.revealedMines.includes(idx)) return chunks;

  return {
    ...chunks,
    [key]: {
      ...chunk,
      revealed: [...chunk.revealed, idx],
      // -1 = unconfirmed: optimistic reveal doesn't know the true adjacency yet.
      // The renderer only draws counts for adj > 0, so this shows blank until the
      // authoritative server chunkData overwrites it (avoids asserting a wrong 0).
      adjMines: [...chunk.adjMines, -1],
      flagged: chunk.flagged.filter(i => i !== idx),
    },
  };
}

export function patchFlag(chunks: ChunkMap, x: number, y: number): ChunkMap {
  const { key, idx, coords } = cellIndex(x, y, CHUNK_SIZE);
  const chunk = ensureChunk(chunks, key, coords);
  if (chunk.revealed.includes(idx) || chunk.revealedMines.includes(idx)) return chunks;

  const flagged = new Set(chunk.flagged);
  if (flagged.has(idx)) flagged.delete(idx);
  else flagged.add(idx);

  return {
    ...chunks,
    [key]: {
      ...chunk,
      flagged: Array.from(flagged).sort((a, b) => a - b),
    },
  };
}
