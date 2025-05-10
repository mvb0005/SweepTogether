import { IBoardManager, IChunk, Coordinate, CHUNK_SIZE } from '../types/chunkTypes';
import { Chunk } from './Chunk';
import { Cell, Coordinates } from './types'; // Assuming Cell is in domain/types.ts

export class BoardManager implements IBoardManager {
  private chunks: Map<string, IChunk>;
  public readonly chunkSize: number;
  private worldGenerator: (globalX: number, globalY: number) => Cell; // To generate cells for new chunks

  constructor(chunkSize: number = CHUNK_SIZE, worldGenerator?: (globalX: number, globalY: number) => Cell) {
    this.chunks = new Map<string, IChunk>();
    this.chunkSize = chunkSize;
    // Default world generator if none provided
    this.worldGenerator = worldGenerator || ((gX, gY) => ({
      x: gX,
      y: gY,
      isMine: false, // Default: no mines
      adjacentMines: 0,
      revealed: false,
      flagged: false,
    }));
  }

  public getChunkId(chunkX: number, chunkY: number): string {
    return `${chunkX}_${chunkY}`;
  }

  public getChunk(chunkX: number, chunkY: number): IChunk {
    const chunkId = this.getChunkId(chunkX, chunkY);
    if (!this.chunks.has(chunkId)) {
      // console.log(`BoardManager: Creating new chunk ${chunkId}`);
      const newChunk = new Chunk(chunkX, chunkY, this.chunkSize, this.worldGenerator);
      this.chunks.set(chunkId, newChunk);
      return newChunk;
    }
    return this.chunks.get(chunkId)!;
  }

  public getChunkById(chunkId: string): IChunk | undefined {
    return this.chunks.get(chunkId);
  }

  public propagateFillToNeighbor(
    fromChunkId: string,
    neighborChunkX: number,
    neighborChunkY: number,
    entryLocalX: number,
    entryLocalY: number,
    originalMineCountHint?: number
  ): void {
    const targetChunkId = this.getChunkId(neighborChunkX, neighborChunkY);
    if (fromChunkId === targetChunkId) {
      // console.log(`BoardManager: Skipping propagation from ${fromChunkId} to itself.`);
      return; // Do not propagate to the same chunk
    }

    // console.log(`BoardManager: Propagating fill from ${fromChunkId} to chunk (${neighborChunkX},${neighborChunkY}) at local (${entryLocalX},${entryLocalY})`);
    const neighborChunk = this.getChunk(neighborChunkX, neighborChunkY);
    neighborChunk.addPendingFill(entryLocalX, entryLocalY, originalMineCountHint);
    // console.log(`BoardManager: Added pending fill to chunk ${neighborChunk.id}. Current pending fills: ${neighborChunk.pendingFills.length}`);
    
    // For immediate testing, we might process it directly, but in a real scenario, this would be handled by the game loop or viewport activation.
    // setTimeout(() => neighborChunk.processPendingFills(this), 0); // Simulating async processing
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
}
