import { CHUNK_SIZE } from './constants';
import { Chunk } from './types';

export interface WireCellState {
  index: number;
  isMine: boolean;
  adjacentMines: number;
  revealedBy?: string;
  flaggedBy?: string;
}

export interface WireRevealedCell {
  index: number;
  isMine: boolean;
  adjacentMines: number;
  playerId: string;
}

export function buildChunk(chunkX: number, chunkY: number, wireCells: WireCellState[]): Chunk {
  const grid = Array.from({ length: CHUNK_SIZE }, (_, ly) =>
    Array.from({ length: CHUNK_SIZE }, (_, lx) => ({
      x: chunkX * CHUNK_SIZE + lx,
      y: chunkY * CHUNK_SIZE + ly,
      revealed: false,
      flagged: false,
    })),
  );
  for (const c of wireCells) {
    const lx = c.index % CHUNK_SIZE;
    const ly = Math.floor(c.index / CHUNK_SIZE);
    grid[ly][lx] = {
      x: chunkX * CHUNK_SIZE + lx,
      y: chunkY * CHUNK_SIZE + ly,
      revealed: !!c.revealedBy,
      flagged: !!c.flaggedBy,
      ...(c.revealedBy && { isMine: c.isMine, adjacentMines: c.adjacentMines }),
    };
  }
  return { coords: { x: chunkX, y: chunkY }, cells: grid };
}

export function applyChunkDelta(
  chunk: Chunk,
  revealed: WireRevealedCell[] | undefined,
  flagged: { index: number; playerId: string }[] | undefined,
  unflagged: number[] | undefined,
): Chunk {
  const grid = chunk.cells.map(row => [...row]);

  if (revealed) {
    for (const c of revealed) {
      const lx = c.index % CHUNK_SIZE;
      const ly = Math.floor(c.index / CHUNK_SIZE);
      grid[ly][lx] = {
        ...grid[ly][lx],
        revealed: true,
        isMine: c.isMine,
        adjacentMines: c.adjacentMines,
      };
    }
  }
  if (flagged) {
    for (const c of flagged) {
      const lx = c.index % CHUNK_SIZE;
      const ly = Math.floor(c.index / CHUNK_SIZE);
      grid[ly][lx] = { ...grid[ly][lx], flagged: true };
    }
  }
  if (unflagged) {
    for (const idx of unflagged) {
      const lx = idx % CHUNK_SIZE;
      const ly = Math.floor(idx / CHUNK_SIZE);
      grid[ly][lx] = { ...grid[ly][lx], flagged: false };
    }
  }

  return { ...chunk, cells: grid };
}

export function chunkKey(x: number, y: number): string {
  return `${x}_${y}`;
}
