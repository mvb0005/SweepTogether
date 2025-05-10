import { Cell } from '../domain/types';

export interface Coordinate {
  x: number;
  y: number;
}

export const CHUNK_SIZE = 16; // Default chunk size

export enum ChunkState {
  UNLOADED = 'UNLOADED', // Not yet loaded or generated
  LOADED_CLEAN = 'LOADED_CLEAN', // Loaded, no pending operations
  DIRTY_PENDING_FILLS = 'DIRTY_PENDING_FILLS', // Has flood fills to process
  PROCESSING = 'PROCESSING', // Actively being processed (e.g., flood fill)
  UP_TO_DATE = 'UP_TO_DATE', // Processed and current
}

export interface PendingFillItem {
  localX: number;
  localY: number;
  originalMineCountHint?: number; // Optional: The mine count of the originally clicked cell
}

// Interface for a Chunk, which will be a class
export interface IChunk {
  id: string; // e.g., "x_y"
  coordinates: Coordinate; // Chunk's coordinates (not individual tile coordinates)
  tiles: Cell[][]; // 2D array of Cells within this chunk
  pendingFills: PendingFillItem[];
  state: ChunkState;
  size: number; // Typically CHUNK_SIZE

  // Methods
  getTile(localX: number, localY: number): Cell | undefined;
  setTile(localX: number, localY: number, cell: Cell): void;
  addPendingFill(localX: number, localY: number, originalMineCountHint?: number): void;
  processPendingFills(boardManager: IBoardManager): Promise<Cell[]>; // Updated return type
  executeLocalFloodFill(startX: number, startY: number, originalMineCountHint: number | undefined, boardManager: IBoardManager): Promise<Cell[]>; // Updated return type
}

export interface IBoardManager {
  getChunk(chunkX: number, chunkY: number): IChunk;
  getChunkById(chunkId: string): IChunk | undefined;
  propagateFillToNeighbor(
    fromChunkId: string,
    neighborChunkX: number,
    neighborChunkY: number,
    entryLocalX: number,
    entryLocalY: number,
    originalMineCountHint?: number
  ): void;
  convertGlobalToChunkCoordinates(globalX: number, globalY: number): Coordinate;
  convertGlobalToChunkLocalCoordinates(globalX: number, globalY: number): { chunkCoordinate: Coordinate, localCoordinate: Coordinate };
  convertChunkLocalToGlobalCoordinates(chunkX: number, chunkY: number, localX: number, localY: number): Coordinate;
  getChunkId(chunkX: number, chunkY: number): string;
}
