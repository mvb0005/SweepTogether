import { Cell } from '../domain/types';

export type ChunkConfig =
  | { type: 'noise' }
  | { type: 'custom'; mines: Uint8Array }; // CHUNK_SIZE²-byte: 0xFF=mine, 0–8=adjacentMines

export type ChunkPersistenceLoader = (
  chunkX: number,
  chunkY: number
) => Promise<{
  mines?: Uint8Array;
  revealedIndices?: Set<number>;
  flaggedIndices?: Set<number>;
  revealedBuf?: Buffer;
  flaggedBuf?: Buffer;
} | null>;

export interface Coordinate {
  x: number;
  y: number;
}

export const CHUNK_SIZE = 32;

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
  tileData?: Cell;
}

// Interface for a Chunk, which will be a class
export interface IChunk {
  id: string; // e.g., "x_y"
  coordinates: Coordinate; // Chunk's coordinates (not individual tile coordinates)
  tiles: Cell[][]; // 2D array of Cells within this chunk
  state: ChunkState;
  size: number; // Typically CHUNK_SIZE

  // Methods
  getTile(localX: number, localY: number): Cell | undefined;
  setTile(localX: number, localY: number, cell: Cell): void;
  getChunkBuffers?(): { mines: Uint8Array; revealed: Buffer; flagged: Buffer };
  executeLocalFloodFill(startX: number, startY: number, originalMineCountHint: number | undefined, boardManager: IChunkManager, visited?: Set<string>): Promise<FloodFillResult>;
}

export interface IChunkManager {
  getChunk(chunkX: number, chunkY: number): Promise<IChunk>;
  getChunkById(chunkId: string): IChunk | undefined;
  convertGlobalToChunkCoordinates(globalX: number, globalY: number): Coordinate;
  convertGlobalToChunkLocalCoordinates(globalX: number, globalY: number): { chunkCoordinate: Coordinate, localCoordinate: Coordinate };
  convertChunkLocalToGlobalCoordinates(chunkX: number, chunkY: number, localX: number, localY: number): Coordinate;
  getChunkId(chunkX: number, chunkY: number): string;
  revealAndPropagate(x: number, y: number, originalMineCountHint?: number): Promise<Cell[]>;
  processPendingFillsForChunk(chunkId: string, visited?: Set<string>): Promise<void>;
  drainSubscribedPendingFills(): Promise<void>;
  preloadMany(docs: Array<{
    chunkX: number;
    chunkY: number;
    mines?: Uint8Array;
    revealedIndices?: Set<number>;
    flaggedIndices?: Set<number>;
    revealedBuf?: Buffer;
    flaggedBuf?: Buffer;
  }>): void;
  readonly pendingFills: Map<string, PendingFillItem[]>;
  readonly chunks: Map<string, IChunk>;
  broadcastChunkUpdate?: (chunk: IChunk) => void;
}

// Flood fill result type for chunked infinite board
export type FloodFillResult = {
  revealedCells: Cell[];
  pendingFills: {
    [chunkId: string]: {
      cells: { x: number; y: number }[];
    };
  };
};
