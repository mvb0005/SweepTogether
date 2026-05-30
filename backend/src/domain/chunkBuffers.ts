import { invalidateChunkWireCache } from '../application/chunkWire';
import { bufferHasPersistedState } from '../application/chunkWire';
import { IChunk } from '../types/chunkTypes';

export const HIDDEN_CELL = 0xff;
export const MINE_CELL = 0xff;

export interface ChunkBufferView {
  mines: Uint8Array;
  revealed: Buffer;
  flagged: Buffer;
}

export function isBufferChunk(chunk: IChunk): chunk is IChunk & ChunkBufferView {
  return typeof (chunk as IChunk & { getChunkBuffers?: () => ChunkBufferView }).getChunkBuffers === 'function';
}

export function getChunkBuffers(chunk: IChunk): ChunkBufferView | null {
  const getter = chunk.getChunkBuffers;
  if (typeof getter !== 'function') return null;
  return getter.call(chunk);
}

export function cellIndex(localX: number, localY: number, chunkSize: number): number {
  return localY * chunkSize + localX;
}

export function isCellHidden(revealed: Buffer, idx: number): boolean {
  return revealed[idx] === HIDDEN_CELL;
}

export function isCellFlagged(flagged: Buffer, idx: number): boolean {
  return flagged[idx] !== HIDDEN_CELL;
}

export function isCellMine(mines: Uint8Array, idx: number): boolean {
  return mines[idx] === MINE_CELL;
}

export function adjacentMinesAt(mines: Uint8Array, idx: number): number {
  const val = mines[idx];
  return val === MINE_CELL ? 0 : val;
}

export function canRevealAt(bufs: ChunkBufferView, idx: number): boolean {
  return isCellHidden(bufs.revealed, idx)
    && !isCellFlagged(bufs.flagged, idx)
    && !isCellMine(bufs.mines, idx);
}

export function revealCellAt(chunk: IChunk, localX: number, localY: number, chunkSize: number): boolean {
  const bufs = getChunkBuffers(chunk);
  if (!bufs) return false;
  const idx = cellIndex(localX, localY, chunkSize);
  if (!isCellHidden(bufs.revealed, idx)) return false;
  bufs.revealed[idx] = 0;
  bufs.flagged[idx] = HIDDEN_CELL;
  invalidateChunkWireCache(chunk);
  return true;
}

export function revealIndices(chunk: IChunk, indices: number[], chunkSize: number): number {
  const bufs = getChunkBuffers(chunk);
  if (!bufs) return 0;
  let count = 0;
  for (const idx of indices) {
    if (!isCellHidden(bufs.revealed, idx)) continue;
    bufs.revealed[idx] = 0;
    bufs.flagged[idx] = HIDDEN_CELL;
    count++;
  }
  if (count > 0) invalidateChunkWireCache(chunk);
  return count;
}

export function extractPersistedState(chunk: IChunk): boolean {
  const bufs = getChunkBuffers(chunk);
  if (bufs) {
    return bufferHasPersistedState(bufs.revealed) || bufferHasPersistedState(bufs.flagged);
  }
  return false;
}

export function minesFromGenerator(
  chunkX: number,
  chunkY: number,
  size: number,
  generator: (globalX: number, globalY: number) => { isMine: boolean; adjacentMines: number },
): Uint8Array {
  const mines = new Uint8Array(size * size);
  for (let ly = 0; ly < size; ly++) {
    for (let lx = 0; lx < size; lx++) {
      const cell = generator(chunkX * size + lx, chunkY * size + ly);
      const idx = cellIndex(lx, ly, size);
      mines[idx] = cell.isMine ? MINE_CELL : cell.adjacentMines;
    }
  }
  return mines;
}
