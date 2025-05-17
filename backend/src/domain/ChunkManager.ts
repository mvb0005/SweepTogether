import { IChunkManager, IChunk, Coordinate, CHUNK_SIZE, PendingFillItem } from '../types/chunkTypes';
import { Chunk } from './Chunk';
import { Cell, Coordinates } from './types'; // Assuming Cell is in domain/types.ts

export class ChunkManager implements IChunkManager {
  public chunks: Map<string, IChunk>;
  public readonly chunkSize: number;
  private worldGenerator: (globalX: number, globalY: number) => Cell; // To generate cells for new chunks
  public hasActiveSubscribers: (gameId: string, chunkX: number, chunkY: number) => boolean;
  public processAndBroadcastChunk: (gameId: string, chunkX: number, chunkY: number) => Promise<void>;
  public gameId: string;
  public broadcastChunkUpdate: (chunk: IChunk) => void;
  public pendingFills: Map<string, PendingFillItem[]> = new Map();

  constructor(
    gameId: string,
    chunkSize: number = CHUNK_SIZE,
    worldGenerator?: (globalX: number, globalY: number) => Cell,
    hasActiveSubscribers?: (gameId: string, chunkX: number, chunkY: number) => boolean,
    processAndBroadcastChunk?: (gameId: string, chunkX: number, chunkY: number) => Promise<void>,
    broadcastChunkUpdate?: (chunk: IChunk) => void
  ) {
    this.chunks = new Map<string, IChunk>();
    this.chunkSize = chunkSize;
    this.gameId = gameId;
    // Default world generator if none provided
    this.worldGenerator = worldGenerator || ((gX, gY) => ({
      x: gX,
      y: gY,
      isMine: false, // Default: no mines
      adjacentMines: 0,
      revealed: false,
      flagged: false,
    }));
    this.hasActiveSubscribers = hasActiveSubscribers || (() => false);
    this.processAndBroadcastChunk = processAndBroadcastChunk || (async () => {});
    this.broadcastChunkUpdate = broadcastChunkUpdate || ((chunk) => {
      // Placeholder: wire this up to the socket layer to emit to the chunk's room
      // e.g., io.to(room).emit('chunkData', ...)
    });
  }

  public getChunkId(chunkX: number, chunkY: number): string {
    return `${chunkX}_${chunkY}`;
  }

  public getChunk(chunkX: number, chunkY: number): IChunk {
    const chunkId = this.getChunkId(chunkX, chunkY);
    if (!this.chunks.has(chunkId)) {
      // console.log(`BoardManager: Creating new chunk ${chunkId}`);
      const newChunk = new Chunk(chunkX, chunkY, this.chunkSize, this.worldGenerator, this.broadcastChunkUpdate);
      this.chunks.set(chunkId, newChunk);
      return newChunk;
    }
    return this.chunks.get(chunkId)!;
  }

  public getChunkById(chunkId: string): IChunk | undefined {
    return this.chunks.get(chunkId);
  }

  /**
   * Given a pendingFills dictionary (from a FloodFillResult), add pending fills to the appropriate chunks.
   * This should be called after a chunk's flood fill returns a FloodFillResult with non-empty pendingFills.
   */
  public addPendingFillsToChunks(pendingFills: { [chunkId: string]: { cells: { x: number; y: number }[] } }) {
    for (const [chunkId, data] of Object.entries(pendingFills)) {
      for (const cell of data.cells) {
        this.addPendingFill(chunkId, { localX: cell.x, localY: cell.y });
      }
    }
  }

  public convertGlobalToChunkCoordinates(globalX: number, globalY: number): Coordinate {
    return {
      x: Math.floor(globalX / this.chunkSize),
      y: Math.floor(globalY / this.chunkSize),
    };
  }

  public convertGlobalToChunkLocalCoordinates(globalX: number, globalY: number): { chunkCoordinate: Coordinate; localCoordinate: Coordinate; } {
    const chunkX = Math.floor(globalX / this.chunkSize);
    const chunkY = Math.floor(globalY / this.chunkSize);
    let localX = globalX % this.chunkSize;
    let localY = globalY % this.chunkSize;
    return {
      chunkCoordinate: { x: chunkX, y: chunkY },
      localCoordinate: { 
        x: localX < 0 ? localX + this.chunkSize : (localX === -0 ? 0 : localX), 
        y: localY < 0 ? localY + this.chunkSize : (localY === -0 ? 0 : localY) 
      },
    };
  }

  public convertChunkLocalToGlobalCoordinates(chunkX: number, chunkY: number, localX: number, localY: number): Coordinate {
    return {
      x: chunkX * this.chunkSize + localX,
      y: chunkY * this.chunkSize + localY,
    };
  }

  /**
   * Reveals a cell at global (x, y) and propagates the flood fill across all affected chunks.
   * Returns only the revealed cells from the starting chunk. Other chunk updates are handled as side effects.
   */
  public async revealAndPropagate(x: number, y: number, originalMineCountHint?: number): Promise<Cell[]> {
    // Use a global set for visited global coordinates
    const visited = new Set<string>();

    const { chunkCoordinate, localCoordinate } = this.convertGlobalToChunkLocalCoordinates(x, y);
    const chunk = this.getChunk(chunkCoordinate.x, chunkCoordinate.y);
    const initialFill = await chunk.executeLocalFloodFill(localCoordinate.x, localCoordinate.y, originalMineCountHint, this, visited);
    const chunksWithPendingFills = Object.keys(initialFill.pendingFills);

    this.addPendingFillsToChunks(initialFill.pendingFills);
    
    for (const chunkId of chunksWithPendingFills) {
      const [chunkX, chunkY] = chunkId.split('_').map(Number);
      if (this.hasActiveSubscribers(this.gameId, chunkX, chunkY)) {
        await this.processPendingFillsForChunk(chunkId, visited);
        this.broadcastChunkUpdate(this.getChunk(chunkX, chunkY));
      }
    }
    return initialFill.revealedCells;
  }

  /**
   * Add a pending fill to the centralized queue for a chunk.
   */
  public addPendingFill(chunkId: string, fill: PendingFillItem) {
    if (!this.pendingFills.has(chunkId)) {
      this.pendingFills.set(chunkId, []);
    }
    // Avoid duplicates
    const fills = this.pendingFills.get(chunkId)!;
    if (!fills.some(f => f.localX === fill.localX && f.localY === fill.localY)) {
      fills.push(fill);
    }
  }

  /**
   * Process all pending fills for a chunk (if any), then clear them from the queue.
   * Accepts a global visited set for cross-chunk propagation.
   */
  public async processPendingFillsForChunk(chunkId: string, visited: Set<string>): Promise<void> {
    const fills = this.pendingFills.get(chunkId) || [];
    console.log(`[ChunkManager] processPendingFillsForChunk called for chunkId=${chunkId}, numFills=${fills.length}`);
    if (fills.length === 0) return;
    const [chunkX, chunkY] = chunkId.split('_').map(Number);
    const chunk = this.getChunk(chunkX, chunkY);
    for (const fill of fills) {
      console.log(`[ChunkManager] Processing fill in chunkId=${chunkId}: localX=${fill.localX}, localY=${fill.localY}`);
      await chunk.executeLocalFloodFill(fill.localX, fill.localY, fill.originalMineCountHint, this, visited);
    }
    this.pendingFills.delete(chunkId);
    console.log(`[ChunkManager] Deleted pending fills for chunkId=${chunkId}`);
  }
}
