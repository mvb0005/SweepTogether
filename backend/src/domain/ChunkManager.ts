import { IChunkManager, IChunk, Coordinate, CHUNK_SIZE, PendingFillItem, ChunkPersistenceLoader } from '../types/chunkTypes';
import { invalidateChunkWireCache } from '../application/chunkWire';
import { BufferChunk } from './BufferChunk';
import { extractPersistedState, getChunkBuffers, minesFromGenerator, ChunkBufferView, HIDDEN_CELL } from './chunkBuffers';
import { Cell, Coordinates } from './types';

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
  private noiseMinesCache = new Map<string, Uint8Array>();
  private deferredChunks = new Map<string, {
    mines?: Uint8Array;
    revealedBuf?: Buffer;
    flaggedBuf?: Buffer;
  }>();

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
    flaggedIndices: Set<number> = new Set(),
    revealedBuf?: Buffer,
    flaggedBuf?: Buffer,
  ): IChunk {
    const size = this.chunkSize;
    const cells = size * size;
    const resolvedMines = mines
      ?? this.chunkMineGenerator?.(chunkX, chunkY)
      ?? minesFromGenerator(chunkX, chunkY, size, this.worldGenerator);

    let revealed = revealedBuf ? Buffer.from(revealedBuf) : Buffer.alloc(cells, 0xff);
    let flagged = flaggedBuf ? Buffer.from(flaggedBuf) : Buffer.alloc(cells, 0xff);

    if (!revealedBuf) {
      for (const idx of revealedIndices) {
        if (idx >= 0 && idx < cells) revealed[idx] = 0;
      }
    }
    if (!flaggedBuf) {
      for (const idx of flaggedIndices) {
        if (idx >= 0 && idx < cells) flagged[idx] = 0;
      }
    }

    return new BufferChunk(
      chunkX,
      chunkY,
      resolvedMines,
      revealed,
      flagged,
      size,
      this.broadcastChunkUpdate,
    );
  }

  public async getChunk(chunkX: number, chunkY: number): Promise<IChunk> {
    const chunkId = this.getChunkId(chunkX, chunkY);
    if (this.chunks.has(chunkId)) return this.chunks.get(chunkId)!;
    if (this.deferredChunks.has(chunkId) || this.noiseMinesCache.has(chunkId)) {
      return this.materializeChunk(chunkX, chunkY);
    }

    const t0 = performance.now();
    let mines: Uint8Array | undefined;
    let revealedIndices = new Set<number>();
    let flaggedIndices = new Set<number>();

    if (this.persistenceLoader) {
      const tDb0 = performance.now();
      const data = await this.persistenceLoader(chunkX, chunkY);
      const dbMs = performance.now() - tDb0;
      const tBuild0 = performance.now();
      let chunk: IChunk;
      if (data?.revealedBuf || data?.flaggedBuf) {
        chunk = this.buildChunkFromData(
          chunkX, chunkY, data.mines, new Set(), new Set(), data.revealedBuf, data.flaggedBuf,
        );
      } else if (data) {
        chunk = this.buildChunkFromData(
          chunkX, chunkY, data.mines, data.revealedIndices ?? new Set(), data.flaggedIndices ?? new Set(),
        );
      } else {
        chunk = this.buildChunkFromData(chunkX, chunkY, mines, revealedIndices, flaggedIndices);
      }
      const buildMs = performance.now() - tBuild0;
      if (dbMs > 2000) {
        console.warn(
          `[chunk] load (${chunkX},${chunkY}) db=${dbMs.toFixed(1)}ms build=${buildMs.toFixed(1)}ms ` +
          `(slow — usually event-loop queue wait, not Mongo latency)`,
        );
      } else if (dbMs > 250) {
        console.log(`[chunk] load (${chunkX},${chunkY}) db=${dbMs.toFixed(1)}ms build=${buildMs.toFixed(1)}ms`);
      }
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

  public preloadMany(docs: Array<{
    chunkX: number;
    chunkY: number;
    mines?: Uint8Array;
    revealedIndices?: Set<number>;
    flaggedIndices?: Set<number>;
    revealedBuf?: Buffer;
    flaggedBuf?: Buffer;
  }>): void {
    for (const { chunkX, chunkY, mines, revealedIndices, flaggedIndices, revealedBuf, flaggedBuf } of docs) {
      const chunkId = this.getChunkId(chunkX, chunkY);
      if (this.chunks.has(chunkId)) continue;
      this.chunks.set(chunkId, this.buildChunkFromData(
        chunkX, chunkY, mines,
        revealedIndices ?? new Set(),
        flaggedIndices ?? new Set(),
        revealedBuf,
        flaggedBuf,
      ));
    }
  }

  public getChunkById(chunkId: string): IChunk | undefined {
    return this.chunks.get(chunkId);
  }

  public getDeferredBuffers(chunkId: string): { revealedBuf?: Buffer; flaggedBuf?: Buffer } | undefined {
    return this.deferredChunks.get(chunkId);
  }

  public hasPendingFills(chunkX: number, chunkY: number): boolean {
    return (this.pendingFills.get(this.getChunkId(chunkX, chunkY))?.length ?? 0) > 0;
  }

  public registerNoiseChunks(items: Array<{ chunkX: number; chunkY: number; mines: Uint8Array }>): void {
    for (const { chunkX, chunkY, mines } of items) {
      const chunkId = this.getChunkId(chunkX, chunkY);
      if (this.chunks.has(chunkId) || this.deferredChunks.has(chunkId)) continue;
      this.noiseMinesCache.set(chunkId, mines);
    }
  }

  public hasNoiseMines(chunkX: number, chunkY: number): boolean {
    return this.noiseMinesCache.has(this.getChunkId(chunkX, chunkY));
  }

  public hasDeferredChunk(chunkX: number, chunkY: number): boolean {
    return this.deferredChunks.has(this.getChunkId(chunkX, chunkY));
  }

  /** Buffer snapshot for flood fill without requiring a materialized chunk. */
  public snapshotForFill(chunkX: number, chunkY: number): ChunkBufferView | null {
    const chunkId = this.getChunkId(chunkX, chunkY);
    const materialized = this.chunks.get(chunkId);
    if (materialized) {
      return getChunkBuffers(materialized);
    }

    const cells = this.chunkSize * this.chunkSize;
    const resolveMines = (mines?: Uint8Array): Uint8Array | null => {
      if (mines) return mines;
      if (this.chunkMineGenerator) {
        try {
          return this.chunkMineGenerator(chunkX, chunkY);
        } catch {
          return null;
        }
      }
      return minesFromGenerator(chunkX, chunkY, this.chunkSize, this.worldGenerator);
    };

    const deferred = this.deferredChunks.get(chunkId);
    if (deferred) {
      const mines = resolveMines(deferred.mines ?? this.noiseMinesCache.get(chunkId));
      if (!mines) return null;
      return {
        mines,
        revealed: deferred.revealedBuf ? Buffer.from(deferred.revealedBuf) : Buffer.alloc(cells, HIDDEN_CELL),
        flagged: deferred.flaggedBuf ? Buffer.from(deferred.flaggedBuf) : Buffer.alloc(cells, HIDDEN_CELL),
      };
    }

    const cachedMines = this.noiseMinesCache.get(chunkId);
    if (cachedMines) {
      return {
        mines: cachedMines,
        revealed: Buffer.alloc(cells, HIDDEN_CELL),
        flagged: Buffer.alloc(cells, HIDDEN_CELL),
      };
    }

    return null;
  }

  public ensureMaterialized(chunkX: number, chunkY: number): IChunk | null {
    const chunkId = this.getChunkId(chunkX, chunkY);
    const existing = this.chunks.get(chunkId);
    if (existing) return existing;
    try {
      return this.materializeChunk(chunkX, chunkY);
    } catch {
      return null;
    }
  }

  public registerDeferredChunks(items: Array<{
    chunkX: number;
    chunkY: number;
    mines?: Uint8Array;
    revealedBuf?: Buffer;
    flaggedBuf?: Buffer;
  }>): void {
    for (const { chunkX, chunkY, mines, revealedBuf, flaggedBuf } of items) {
      const chunkId = this.getChunkId(chunkX, chunkY);
      if (this.chunks.has(chunkId)) continue;
      this.deferredChunks.set(chunkId, { mines, revealedBuf, flaggedBuf });
      this.noiseMinesCache.delete(chunkId);
    }
  }

  public materializeChunk(chunkX: number, chunkY: number): IChunk {
    const chunkId = this.getChunkId(chunkX, chunkY);
    const existing = this.chunks.get(chunkId);
    if (existing) return existing;

    const deferred = this.deferredChunks.get(chunkId);
    if (deferred) {
      this.deferredChunks.delete(chunkId);
      const chunk = this.buildChunkFromData(
        chunkX, chunkY, deferred.mines, new Set(), new Set(), deferred.revealedBuf, deferred.flaggedBuf,
      );
      this.chunks.set(chunkId, chunk);
      return chunk;
    }

    const mines = this.noiseMinesCache.get(chunkId);
    if (mines) {
      this.noiseMinesCache.delete(chunkId);
      const chunk = this.buildChunkFromData(chunkX, chunkY, mines);
      this.chunks.set(chunkId, chunk);
      return chunk;
    }

    throw new Error(`Chunk (${chunkX},${chunkY}) is not loaded or deferred`);
  }

  public extractChunkBuffers(chunk: IChunk): {
    mines: Uint8Array;
    revealedBuf: Buffer;
    flaggedBuf: Buffer;
    hasPersistedState: boolean;
  } {
    return this.extractChunkBuffersInternal(chunk);
  }

  /** Drop materialized chunks nobody is subscribed to; does not retain buffers in memory. */
  public releaseUnsubscribedChunks(): number {
    let released = 0;
    for (const chunkId of [...this.chunks.keys()]) {
      const [chunkX, chunkY] = chunkId.split('_').map(Number);
      if (this.hasActiveSubscribers(this.gameId, chunkX, chunkY)) continue;
      if ((this.pendingFills.get(chunkId)?.length ?? 0) > 0) continue;

      invalidateChunkWireCache(this.chunks.get(chunkId)!);
      this.chunks.delete(chunkId);
      released++;
    }
    return released;
  }

  /** @deprecated Use releaseUnsubscribedChunks after Mongo sync. Retains deferred/noise caches. */
  public evictUnsubscribedChunks(): number {
    let evicted = 0;
    for (const chunkId of [...this.chunks.keys()]) {
      const [chunkX, chunkY] = chunkId.split('_').map(Number);
      if (this.hasActiveSubscribers(this.gameId, chunkX, chunkY)) continue;
      if ((this.pendingFills.get(chunkId)?.length ?? 0) > 0) continue;

      const chunk = this.chunks.get(chunkId)!;
      const { mines, revealedBuf, flaggedBuf, hasPersistedState } = this.extractChunkBuffersInternal(chunk);
      if (hasPersistedState) {
        this.deferredChunks.set(chunkId, { mines, revealedBuf, flaggedBuf });
      } else {
        this.noiseMinesCache.set(chunkId, mines);
      }
      invalidateChunkWireCache(chunk);
      this.chunks.delete(chunkId);
      evicted++;
    }
    return evicted;
  }

  private extractChunkBuffersInternal(chunk: IChunk): {
    mines: Uint8Array;
    revealedBuf: Buffer;
    flaggedBuf: Buffer;
    hasPersistedState: boolean;
  } {
    const bufs = getChunkBuffers(chunk);
    if (bufs) {
      return {
        mines: bufs.mines,
        revealedBuf: bufs.revealed,
        flaggedBuf: bufs.flagged,
        hasPersistedState: extractPersistedState(chunk),
      };
    }

    const size = chunk.size;
    const cells = size * size;
    const mines = new Uint8Array(cells);
    const revealedBuf = Buffer.alloc(cells, 0xff);
    const flaggedBuf = Buffer.alloc(cells, 0xff);
    let hasPersistedState = false;

    for (let ly = 0; ly < size; ly++) {
      const row = chunk.tiles[ly];
      if (!row) continue;
      for (let lx = 0; lx < size; lx++) {
        const cell = row[lx];
        if (!cell) continue;
        const idx = ly * size + lx;
        mines[idx] = cell.isMine ? 0xff : cell.adjacentMines;
        if (cell.revealed) {
          revealedBuf[idx] = 0;
          hasPersistedState = true;
        }
        if (cell.flagged) {
          flaggedBuf[idx] = 0;
          hasPersistedState = true;
        }
      }
    }
    return { mines, revealedBuf, flaggedBuf, hasPersistedState };
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
