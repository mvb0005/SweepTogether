import { IChunk, CHUNK_SIZE } from '../types/chunkTypes';
import { getChunkBuffers } from '../domain/chunkBuffers';

export interface ChunkWireData {
  gameId: string;
  chunkX: number;
  chunkY: number;
  size: number;
  revealed: number[];
  adjMines: number[];
  revealedMines: number[];
  flagged: number[];
}

const wireCache = new WeakMap<IChunk, ChunkWireData>();

export function emptyChunkWire(gameId: string, chunkX: number, chunkY: number): ChunkWireData {
  return { gameId, chunkX, chunkY, size: CHUNK_SIZE, revealed: [], adjMines: [], revealedMines: [], flagged: [] };
}

export function bufferHasPersistedState(buf: Buffer | undefined): boolean {
  if (!buf) return false;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] !== 0xff) return true;
  }
  return false;
}

export function serializeChunkWireFromBuffers(
  gameId: string,
  chunkX: number,
  chunkY: number,
  revealedBuf?: Buffer,
  flaggedBuf?: Buffer,
  mines?: Uint8Array,
): ChunkWireData {
  const revealed: number[] = [];
  const adjMines: number[] = [];
  const revealedMines: number[] = [];
  const flagged: number[] = [];
  const cells = CHUNK_SIZE * CHUNK_SIZE;

  for (let i = 0; i < cells; i++) {
    if (revealedBuf && revealedBuf[i] !== 0xff) {
      if (mines && mines[i] === 0xff) {
        revealedMines.push(i);
      } else {
        revealed.push(i);
        adjMines.push(mines ? mines[i] : 0);
      }
    } else if (flaggedBuf && flaggedBuf[i] !== 0xff) {
      flagged.push(i);
    }
  }

  return { gameId, chunkX, chunkY, size: CHUNK_SIZE, revealed, adjMines, revealedMines, flagged };
}

export function serializeChunkWire(chunk: IChunk, gameId: string): ChunkWireData {
  const cached = wireCache.get(chunk);
  if (cached) return cached;

  const [chunkX, chunkY] = chunk.id.split('_').map(Number);
  const bufs = getChunkBuffers(chunk);
  if (bufs) {
    const wire = serializeChunkWireFromBuffers(
      gameId, chunkX, chunkY, bufs.revealed, bufs.flagged, bufs.mines,
    );
    wireCache.set(chunk, wire);
    return wire;
  }

  const size = chunk.size;
  const revealed: number[] = [];
  const adjMines: number[] = [];
  const revealedMines: number[] = [];
  const flagged: number[] = [];

  for (let ly = 0; ly < size; ly++) {
    const row = chunk.tiles[ly];
    for (let lx = 0; lx < size; lx++) {
      const cell = row[lx];
      const idx = ly * size + lx;
      if (cell.revealed) {
        if (cell.isMine) {
          revealedMines.push(idx);
        } else {
          revealed.push(idx);
          adjMines.push(cell.adjacentMines);
        }
      } else if (cell.flagged) {
        flagged.push(idx);
      }
    }
  }

  const wire: ChunkWireData = { gameId, chunkX, chunkY, size, revealed, adjMines, revealedMines, flagged };
  wireCache.set(chunk, wire);
  return wire;
}

export function invalidateChunkWireCache(chunk: IChunk): void {
  wireCache.delete(chunk);
}

/** @deprecated Use serializeChunkWire */
export function serializeChunk(chunk: IChunk, gameId: string): ChunkWireData {
  return serializeChunkWire(chunk, gameId);
}
