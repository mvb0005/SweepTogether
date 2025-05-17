import { Cell } from './types';
import { IChunk, Coordinate, ChunkState, PendingFillItem, CHUNK_SIZE, IChunkManager, FloodFillResult } from '../types/chunkTypes';

export class Chunk implements IChunk {
  public id: string;
  public coordinates: Coordinate;
  public tiles: Cell[][];
  public state: ChunkState;
  public readonly size: number;
  private broadcastChunkUpdate?: (chunk: IChunk) => void;

  constructor(chunkX: number, chunkY: number, size: number = CHUNK_SIZE, initialCellGenerator?: (globalX: number, globalY: number) => Cell, broadcastChunkUpdate?: (chunk: IChunk) => void) {
    this.coordinates = { x: chunkX, y: chunkY };
    this.id = `${chunkX}_${chunkY}`;
    this.size = size;
    this.tiles = [];
    this.state = ChunkState.LOADED_CLEAN; // Initial state
    this.broadcastChunkUpdate = broadcastChunkUpdate;

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

  async executeLocalFloodFill(
    startX: number, 
    startY: number, 
    originalMineCountHint: number | undefined, 
    boardManager: IChunkManager,
    visited: Set<string>
  ): Promise<FloodFillResult> {
    const queue: { x: number; y: number }[] = [{ x: startX, y: startY }];
    const revealedCellsInThisFill: Cell[] = [];
    let pendingFills: { [chunkId: string]: { cells: { x: number; y: number }[] } } = {};

    while (queue.length > 0) {
      const { x: localX, y: localY } = queue.shift()!;
      const globalX = this.coordinates.x * this.size + localX;
      const globalY = this.coordinates.y * this.size + localY;
      const visitedKey = `${globalX},${globalY}`;

      if (visited.has(visitedKey)) {
        continue;
      }
      visited.add(visitedKey);

      let cell = this.getTile(localX, localY);
      if (!cell) {
        continue;
      }
      if (cell.revealed || cell.flagged || cell.isMine) {
        continue;
      }

      // Always recalculate adjacent mines, including across chunk boundaries
      let adjacentMines = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const neighborGlobalX = globalX + dx;
          const neighborGlobalY = globalY + dy;
          const { chunkCoordinate, localCoordinate } = boardManager.convertGlobalToChunkLocalCoordinates(neighborGlobalX, neighborGlobalY);
          const neighborChunk = boardManager.getChunk(chunkCoordinate.x, chunkCoordinate.y);
          const neighborCell = neighborChunk.getTile(localCoordinate.x, localCoordinate.y);
          if (neighborCell && neighborCell.isMine) {
            adjacentMines++;
          }
        }
      }
      cell.adjacentMines = adjacentMines;

      cell.revealed = true;
      this.setTile(localX, localY, cell);
      revealedCellsInThisFill.push(cell);

      if (adjacentMines === 0) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const neighborLocalX = localX + dx;
            const neighborLocalY = localY + dy;
            const neighborGlobalX = this.coordinates.x * this.size + neighborLocalX;
            const neighborGlobalY = this.coordinates.y * this.size + neighborLocalY;
            const neighborVisitedKey = `${neighborGlobalX},${neighborGlobalY}`;

            if (neighborLocalX >= 0 && neighborLocalX < this.size &&
                neighborLocalY >= 0 && neighborLocalY < this.size) {
              const neighborCell = this.getTile(neighborLocalX, neighborLocalY);
              if (neighborCell && !neighborCell.revealed && !neighborCell.flagged && !visited.has(neighborVisitedKey)) {
                queue.push({ x: neighborLocalX, y: neighborLocalY });
              }
            } else {
              // Neighbor is outside this chunk, propagate to BoardManager
              const targetChunkCoordinates = boardManager.convertGlobalToChunkCoordinates(neighborGlobalX, neighborGlobalY);
              const entryPoint = boardManager.convertGlobalToChunkLocalCoordinates(neighborGlobalX, neighborGlobalY);
              const chunkId = boardManager.getChunkId(targetChunkCoordinates.x, targetChunkCoordinates.y);
              if (!pendingFills[chunkId]) {
                pendingFills[chunkId] = { cells: [] };
              }
              pendingFills[chunkId].cells.push({ x: entryPoint.localCoordinate.x, y: entryPoint.localCoordinate.y });
            }
          }
        }
      }
    }
    if (this.broadcastChunkUpdate) {
      this.broadcastChunkUpdate(this);
    }
    // broadcast an update to the board manager
    return { revealedCells: revealedCellsInThisFill, pendingFills };
  }
}
