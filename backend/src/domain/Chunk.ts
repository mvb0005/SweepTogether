import { Cell } from './types';
import { IChunk, Coordinate, ChunkState, PendingFillItem, CHUNK_SIZE, IBoardManager } from '../types/chunkTypes';

export class Chunk implements IChunk {
  public id: string;
  public coordinates: Coordinate;
  public tiles: Cell[][];
  public pendingFills: PendingFillItem[];
  public state: ChunkState;
  public readonly size: number;

  constructor(chunkX: number, chunkY: number, size: number = CHUNK_SIZE, initialCellGenerator?: (globalX: number, globalY: number) => Cell) {
    this.coordinates = { x: chunkX, y: chunkY };
    this.id = `${chunkX}_${chunkY}`;
    this.size = size;
    this.tiles = [];
    this.pendingFills = [];
    this.state = ChunkState.LOADED_CLEAN; // Initial state

    // Initialize tiles
    for (let y = 0; y < this.size; y++) {
      this.tiles[y] = [];
      for (let x = 0; x < this.size; x++) {
        const globalX = chunkX * this.size + x;
        const globalY = chunkY * this.size + y;
        if (initialCellGenerator) {
          this.tiles[y][x] = initialCellGenerator(globalX, globalY);
        } else {
          // Default cell initialization if no generator is provided
          this.tiles[y][x] = {
            x: globalX,
            y: globalY,
            isMine: false,
            adjacentMines: 0,
            revealed: false,
            flagged: false,
          };
        }
      }
    }
  }

  getTile(localX: number, localY: number): Cell | undefined {
    if (localX < 0 || localX >= this.size || localY < 0 || localY >= this.size) {
      return undefined;
    }
    return this.tiles[localY][localX];
  }

  setTile(localX: number, localY: number, cell: Cell): void {
    if (localX < 0 || localX >= this.size || localY < 0 || localY >= this.size) {
      return;
    }
    this.tiles[localY][localX] = cell;
  }

  addPendingFill(localX: number, localY: number, originalMineCountHint?: number): void {
    // Avoid adding duplicates if already pending
    if (!this.pendingFills.some(pf => pf.localX === localX && pf.localY === localY)) {
      this.pendingFills.push({ localX, localY, originalMineCountHint });
      if (this.state !== ChunkState.PROCESSING) {
        this.state = ChunkState.DIRTY_PENDING_FILLS;
      }
    }
  }

  async processPendingFills(boardManager: IBoardManager): Promise<Cell[]> {
    // If already processing by another call (guard against accidental re-entrancy if not perfectly safe),
    // or if there's genuinely nothing to process, return early.
    if (this.state === ChunkState.PROCESSING || this.pendingFills.length === 0) {
      return []; // Return empty array if no processing is done or needed
    }

    this.state = ChunkState.PROCESSING;
    const allRevealedCellsThisCycle: Cell[] = [];

    // Take a snapshot of the items to process in this cycle.
    // New items added to this.pendingFills (e.g., by propagations) during this cycle
    // will be handled in a subsequent call to processPendingFills.
    const itemsToProcessThisCycle = [...this.pendingFills];
    this.pendingFills = []; // Clear the main queue; items are now in itemsToProcessThisCycle.

    for (const fillItem of itemsToProcessThisCycle) {
      // executeLocalFloodFill itself checks if the starting cell is already revealed,
      // so it won't re-process cells revealed by a previous fillItem in this same cycle.
      const revealedInFill = await this.executeLocalFloodFill(
        fillItem.localX,
        fillItem.localY,
        fillItem.originalMineCountHint,
        boardManager
      );
      allRevealedCellsThisCycle.push(...revealedInFill);
    }

    // After processing the snapshot, if new items were added to this.pendingFills
    // (e.g., by recursive or looped-back propagations that called addPendingFill on this chunk
    // while this.state was PROCESSING), the chunk is dirty again.
    // Otherwise, it's up to date with respect to the items processed in this cycle.
    this.state = this.pendingFills.length > 0 ? ChunkState.DIRTY_PENDING_FILLS : ChunkState.UP_TO_DATE;
    
    return allRevealedCellsThisCycle;
  }

  async executeLocalFloodFill(
    startX: number, 
    startY: number, 
    originalMineCountHint: number | undefined, 
    boardManager: IBoardManager 
  ): Promise<Cell[]> { // Updated return type
    const queue: { x: number; y: number }[] = [{ x: startX, y: startY }];
    const visitedInThisFill: Set<string> = new Set();
    const revealedCellsInThisFill: Cell[] = []; // Accumulator for revealed cells

    while (queue.length > 0) {
      const { x: localX, y: localY } = queue.shift()!;
      const visitedKey = `${localX},${localY}`;

      if (visitedInThisFill.has(visitedKey)) {
        continue;
      }
      visitedInThisFill.add(visitedKey);

      const cell = this.getTile(localX, localY);

      if (!cell || cell.revealed || cell.flagged || cell.isMine) {
        continue;
      }

      cell.revealed = true;
      this.setTile(localX, localY, cell); // Update the cell in the chunk
      revealedCellsInThisFill.push(cell); // Add to accumulator

      if (cell.adjacentMines === 0) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;

            const neighborLocalX = localX + dx;
            const neighborLocalY = localY + dy;

            if (neighborLocalX >= 0 && neighborLocalX < this.size &&
                neighborLocalY >= 0 && neighborLocalY < this.size) {
              const neighborCell = this.getTile(neighborLocalX, neighborLocalY);
              if (neighborCell && !neighborCell.revealed && !neighborCell.flagged) {
                queue.push({ x: neighborLocalX, y: neighborLocalY });
              }
            } else {
              // Neighbor is outside this chunk, propagate to BoardManager
              const globalNeighborX = this.coordinates.x * this.size + neighborLocalX;
              const globalNeighborY = this.coordinates.y * this.size + neighborLocalY;
              
              const targetChunkCoordinates = boardManager.convertGlobalToChunkCoordinates(globalNeighborX, globalNeighborY);

              const entryPoint = boardManager.convertGlobalToChunkLocalCoordinates(globalNeighborX, globalNeighborY);
              
              boardManager.propagateFillToNeighbor(
                this.id, // fromChunkId
                targetChunkCoordinates.x,
                targetChunkCoordinates.y,
                entryPoint.localCoordinate.x,
                entryPoint.localCoordinate.y,
                originalMineCountHint
              );
            }
          }
        }
      }
    }
    return revealedCellsInThisFill; // Return cells revealed in this specific fill
  }
}
