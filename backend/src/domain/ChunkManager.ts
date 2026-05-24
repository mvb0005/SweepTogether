import { IChunkManager, IChunk, Coordinate, CHUNK_SIZE, PendingFillItem, ChunkPersistenceLoader } from '../types/chunkTypes';
import { Chunk } from './Chunk';
import { Cell, Coordinates } from './types'; // Assuming Cell is in domain/types.ts

export class ChunkManager implements IChunkManager {
  public chunks: Map<string, IChunk>;
  public readonly chunkSize: number;
  private worldGenerator: (globalX: number, globalY: number) => Cell;
  private chunkMineGenerator?: (chunkX: number, chunkY: number) => Uint8Array;
  public hasActiveSubscribers: (gameId: string, chunkX: number, chunkY: number) => boolean;
  public processAndBroadcastChunk: (gameId: string, chunkX: number, chunkY: number) => Promise<void>;
  public gameId: string;
  public broadcastChunkUpdate: (chunk: IChunk) => void;
  public pendingFills: Map<string, PendingFillItem[]> = new Map();
  private persistenceLoader?: ChunkPersistenceLoader;

  constructor(
    gameId: string,
    chunkSize: number = CHUNK_SIZE,
    worldGenerator?: (globalX: number, globalY: number) => Cell,
    hasActiveSubscribers?: (gameId: string, chunkX: number, chunkY: number) => boolean,
    processAndBroadcastChunk?: (gameId: string, chunkX: number, chunkY: number) => Promise<void>,
    broadcastChunkUpdate?: (chunk: IChunk) => void,
    persistenceLoader?: ChunkPersistenceLoader,
    chunkMineGenerator?: (chunkX: number, chunkY: number) => Uint8Array,
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
    this.broadcastChunkUpdate = broadcastChunkUpdate || (() => {});
    this.persistenceLoader = persistenceLoader;
    this.chunkMineGenerator = chunkMineGenerator;
  }

  public getChunkId(chunkX: number, chunkY: number): string {
    return `${chunkX}_${chunkY}`;
  }

  private buildChunkFromData(
    chunkX: number,
    chunkY: number,
    mines?: Uint8Array,
    revealedIndices: Set<number> = new Set(),
    flaggedIndices: Set<number> = new Set()
  ): IChunk {
    // Prefer the fast Rust chunk generator over the per-cell JS noise fallback.
    const resolvedMines = mines ?? this.chunkMineGenerator?.(chunkX, chunkY);
    const chunk = new Chunk(chunkX, chunkY, this.chunkSize, this.worldGenerator, resolvedMines, this.broadcastChunkUpdate);
    for (const idx of revealedIndices) {
      const lx = idx % this.chunkSize;
      const ly = Math.floor(idx / this.chunkSize);
      const cell = chunk.getTile(lx, ly);
      if (cell) chunk.setTile(lx, ly, { ...cell, revealed: true });
    }
    for (const idx of flaggedIndices) {
      const lx = idx % this.chunkSize;
      const ly = Math.floor(idx / this.chunkSize);
      const cell = chunk.getTile(lx, ly);
      if (cell) chunk.setTile(lx, ly, { ...cell, flagged: true });
    }
    return chunk;
  }

  public async getChunk(chunkX: number, chunkY: number): Promise<IChunk> {
    const chunkId = this.getChunkId(chunkX, chunkY);
    if (this.chunks.has(chunkId)) return this.chunks.get(chunkId)!;

    const t0 = performance.now();
    let mines: Uint8Array | undefined;
    let revealedIndices = new Set<number>();
    let flaggedIndices = new Set<number>();

    if (this.persistenceLoader) {
      const tDb0 = performance.now();
      const data = await this.persistenceLoader(chunkX, chunkY);
      const dbMs = (performance.now() - tDb0).toFixed(1);
      if (data) {
        mines = data.mines;
        revealedIndices = data.revealedIndices;
        flaggedIndices = data.flaggedIndices;
      }
      const tBuild0 = performance.now();
      const chunk = this.buildChunkFromData(chunkX, chunkY, mines, revealedIndices, flaggedIndices);
      const buildMs = (performance.now() - tBuild0).toFixed(1);
      const totalMs = (performance.now() - t0).toFixed(1);
      console.log(`[chunk] load (${chunkX},${chunkY}) db=${dbMs}ms build=${buildMs}ms total=${totalMs}ms`);
      this.chunks.set(chunkId, chunk);
      return chunk;
    }

    const tBuild0 = performance.now();
    const chunk = this.buildChunkFromData(chunkX, chunkY, mines, revealedIndices, flaggedIndices);
    const buildMs = (performance.now() - tBuild0).toFixed(1);
    console.log(`[chunk] generate (${chunkX},${chunkY}) build=${buildMs}ms`);
    this.chunks.set(chunkId, chunk);
    return chunk;
  }

  public async preloadMany(docs: Array<{
    chunkX: number;
    chunkY: number;
    mines?: Uint8Array;
    revealedIndices: Set<number>;
    flaggedIndices: Set<number>;
  }>): Promise<void> {
    for (const { chunkX, chunkY, mines, revealedIndices, flaggedIndices } of docs) {
      const chunkId = this.getChunkId(chunkX, chunkY);
      if (this.chunks.has(chunkId)) continue;
      this.chunks.set(chunkId, this.buildChunkFromData(chunkX, chunkY, mines, revealedIndices, flaggedIndices));
    }
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
    const chunk = await this.getChunk(chunkCoordinate.x, chunkCoordinate.y);
    const initialFill = await chunk.executeLocalFloodFill(localCoordinate.x, localCoordinate.y, originalMineCountHint, this, visited);
    const chunksWithPendingFills = Object.keys(initialFill.pendingFills);

    this.addPendingFillsToChunks(initialFill.pendingFills);

    // Drain iteratively: each chunk's fill may spill new pending fills into already-active neighbors
    let hasMore: boolean;
    do {
      hasMore = false;
      for (const [chunkId] of [...this.pendingFills.entries()]) {
        if ((this.pendingFills.get(chunkId)?.length ?? 0) === 0) continue;
        const [chunkX, chunkY] = chunkId.split('_').map(Number);
        if (this.hasActiveSubscribers(this.gameId, chunkX, chunkY)) {
          await this.processPendingFillsForChunk(chunkId, visited);
          this.broadcastChunkUpdate(await this.getChunk(chunkX, chunkY));
          hasMore = true;
        }
      }
    } while (hasMore);

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
  public async processPendingFillsForChunk(chunkId: string, visited: Set<string> = new Set()): Promise<void> {
    const fills = this.pendingFills.get(chunkId) || [];
    console.log(`[ChunkManager] processPendingFillsForChunk called for chunkId=${chunkId}, numFills=${fills.length}`);
    if (fills.length === 0) return;
    const [chunkX, chunkY] = chunkId.split('_').map(Number);
    const chunk = await this.getChunk(chunkX, chunkY);
    for (const fill of fills) {
      console.log(`[ChunkManager] Processing fill in chunkId=${chunkId}: localX=${fill.localX}, localY=${fill.localY}`);
      const result = await chunk.executeLocalFloodFill(fill.localX, fill.localY, fill.originalMineCountHint, this, visited);
      this.addPendingFillsToChunks(result.pendingFills);
    }
    this.pendingFills.delete(chunkId);
    console.log(`[ChunkManager] Deleted pending fills for chunkId=${chunkId}`);
  }

  /**
   * Drain pending fills for all already-subscribed chunks.
   * Called after processing a newly subscribed chunk to propagate any fills that
   * spilled back into chunks that are already loaded and have active subscribers.
   */
  public async drainSubscribedPendingFills(): Promise<void> {
    let dirtyFound: boolean;
    do {
      dirtyFound = false;
      for (const [chunkId] of this.pendingFills.entries()) {
        if ((this.pendingFills.get(chunkId)?.length ?? 0) === 0) continue;
        const [cx, cy] = chunkId.split('_').map(Number);
        if (this.hasActiveSubscribers(this.gameId, cx, cy)) {
          await this.processAndBroadcastChunk(this.gameId, cx, cy);
          dirtyFound = true;
        }
      }
    } while (dirtyFound);
  }
}
