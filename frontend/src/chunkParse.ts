import { CHUNK_SIZE } from './constants';
import { CellState, Chunk } from './types';

interface TileCell {
  x: number;
  y: number;
  revealed: boolean;
  flagged: boolean;
  isMine?: boolean;
  adjacentMines?: number;
}

export function parseChunkFromSocket(data: {
  chunkX: number;
  chunkY: number;
  tiles?: TileCell[][];
  size?: number;
  revealed?: number[];
  adjMines?: number[];
  revealedMines?: number[];
  flagged?: number[];
}): Chunk {
  const { chunkX, chunkY } = data;

  if (data.tiles && data.tiles.length > 0) {
    const cells = data.tiles.map((row, ly) =>
      row.map((cell, lx) => ({
        x: cell.x ?? chunkX * CHUNK_SIZE + lx,
        y: cell.y ?? chunkY * CHUNK_SIZE + ly,
        revealed: cell.revealed,
        flagged: cell.flagged,
        ...(cell.revealed && {
          isMine: cell.isMine,
          adjacentMines: cell.adjacentMines,
        }),
      })),
    );
    return { coords: { x: chunkX, y: chunkY }, cells };
  }

  const size = data.size ?? CHUNK_SIZE;
  const cells: CellState[][] = Array.from({ length: size }, (_, ly) =>
    Array.from({ length: size }, (_, lx) => ({
      x: chunkX * size + lx,
      y: chunkY * size + ly,
      revealed: false,
      flagged: false,
    })),
  );

  const revealed = data.revealed ?? [];
  const adjMines = data.adjMines ?? [];
  const revealedMines = data.revealedMines ?? [];
  const flagged = data.flagged ?? [];

  for (let i = 0; i < revealed.length; i++) {
    const idx = revealed[i];
    const lx = idx % size;
    const ly = Math.floor(idx / size);
    cells[ly][lx] = {
      ...cells[ly][lx],
      revealed: true,
      flagged: false,
      adjacentMines: adjMines[i],
    };
  }
  for (const idx of revealedMines) {
    const lx = idx % size;
    const ly = Math.floor(idx / size);
    cells[ly][lx] = {
      ...cells[ly][lx],
      revealed: true,
      isMine: true,
    };
  }
  for (const idx of flagged) {
    const lx = idx % size;
    const ly = Math.floor(idx / size);
    cells[ly][lx] = { ...cells[ly][lx], flagged: true };
  }

  return { coords: { x: chunkX, y: chunkY }, cells };
}
