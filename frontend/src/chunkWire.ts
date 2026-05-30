import { CHUNK_SIZE } from './constants';
import { Chunk, ChunkCoords } from './types';

/** Matches backend `ChunkWireData`. */
export interface ChunkWirePayload {
  gameId?: string;
  chunkX: number;
  chunkY: number;
  size: number;
  revealed?: number[];
  adjMines?: number[];
  revealedMines?: number[];
  flagged?: number[];
}

export function emptyChunk(coords: ChunkCoords, size = CHUNK_SIZE, isLoading = false): Chunk {
  return {
    coords,
    size,
    revealed: [],
    adjMines: [],
    revealedMines: [],
    flagged: [],
    isLoading,
  };
}

export function parseChunkWire(data: ChunkWirePayload): Chunk {
  return {
    coords: { x: data.chunkX, y: data.chunkY },
    size: data.size,
    revealed: data.revealed ?? [],
    adjMines: data.adjMines ?? [],
    revealedMines: data.revealedMines ?? [],
    flagged: data.flagged ?? [],
  };
}
