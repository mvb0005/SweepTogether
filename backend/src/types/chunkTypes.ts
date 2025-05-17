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
  executeLocalFloodFill(startX: number, startY: number, originalMineCountHint: number | undefined, boardManager: IChunkManager, visited: Set<string>): Promise<FloodFillResult>;
}

export interface IChunkManager {
  getChunk(chunkX: number, chunkY: number): IChunk;
  getChunkById(chunkId: string): IChunk | undefined;
  convertGlobalToChunkCoordinates(globalX: number, globalY: number): Coordinate;
  convertGlobalToChunkLocalCoordinates(globalX: number, globalY: number): { chunkCoordinate: Coordinate, localCoordinate: Coordinate };
  convertChunkLocalToGlobalCoordinates(chunkX: number, chunkY: number, localX: number, localY: number): Coordinate;
  getChunkId(chunkX: number, chunkY: number): string;
  revealAndPropagate(x: number, y: number, originalMineCountHint?: number): Promise<Cell[]>;
  processPendingFillsForChunk(chunkId: string, visited: Set<string>): Promise<void>;
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
