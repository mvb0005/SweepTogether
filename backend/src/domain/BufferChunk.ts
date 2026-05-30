import { invalidateChunkWireCache } from '../application/chunkWire';
import {
  cellIndex,
  ChunkBufferView,
  HIDDEN_CELL,
  isCellFlagged,
  isCellHidden,
  isCellMine,
  MINE_CELL,
} from './chunkBuffers';
import {
  CHUNK_SIZE,
  ChunkState,
  Coordinate,
  FloodFillResult,
  IChunk,
  IChunkManager,
} from '../types/chunkTypes';
import { Cell } from './types';

export class BufferChunk implements IChunk {
  public id: string;
  public coordinates: Coordinate;
  /** @deprecated Buffer-native chunks do not materialize a tile grid. */
  public readonly tiles: Cell[][] = [];
  public state: ChunkState;
  public readonly size: number;
  public readonly mines: Uint8Array;
  public readonly revealed: Buffer;
  public readonly flagged: Buffer;
  private broadcastChunkUpdate?: (chunk: IChunk) => void;

  constructor(
    chunkX: number,
    chunkY: number,
    mines: Uint8Array,
    revealed?: Buffer,
    flagged?: Buffer,
    size: number = CHUNK_SIZE,
    broadcastChunkUpdate?: (chunk: IChunk) => void,
  ) {
    this.coordinates = { x: chunkX, y: chunkY };
    this.id = `${chunkX}_${chunkY}`;
    this.size = size;
    this.state = ChunkState.LOADED_CLEAN;
    this.mines = mines;
    const cells = size * size;
    this.revealed = revealed ?? Buffer.alloc(cells, HIDDEN_CELL);
    this.flagged = flagged ?? Buffer.alloc(cells, HIDDEN_CELL);
    this.broadcastChunkUpdate = broadcastChunkUpdate;
  }

  getChunkBuffers(): ChunkBufferView {
    return { mines: this.mines, revealed: this.revealed, flagged: this.flagged };
  }

  getTile(localX: number, localY: number): Cell | undefined {
    if (localX < 0 || localX >= this.size || localY < 0 || localY >= this.size) return undefined;
    const idx = cellIndex(localX, localY, this.size);
    const mineVal = this.mines[idx];
    return {
      x: this.coordinates.x * this.size + localX,
      y: this.coordinates.y * this.size + localY,
      isMine: mineVal === MINE_CELL,
      adjacentMines: mineVal === MINE_CELL ? 0 : mineVal,
      revealed: !isCellHidden(this.revealed, idx),
      flagged: isCellFlagged(this.flagged, idx),
    };
  }

  setTile(localX: number, localY: number, cell: Cell): void {
    if (localX < 0 || localX >= this.size || localY < 0 || localY >= this.size) return;
    const idx = cellIndex(localX, localY, this.size);
    if (cell.revealed) {
      this.revealed[idx] = 0;
      this.flagged[idx] = HIDDEN_CELL;
    } else if (this.revealed[idx] !== HIDDEN_CELL) {
      this.revealed[idx] = HIDDEN_CELL;
    }
    if (cell.flagged) {
      this.flagged[idx] = 0;
    } else if (this.flagged[idx] !== HIDDEN_CELL) {
      this.flagged[idx] = HIDDEN_CELL;
    }
    invalidateChunkWireCache(this);
  }

  async executeLocalFloodFill(
    startX: number,
    startY: number,
    _originalMineCountHint: number | undefined,
    boardManager: IChunkManager,
    visited: Set<string> = new Set(),
  ): Promise<FloodFillResult> {
    const queue: { x: number; y: number }[] = [{ x: startX, y: startY }];
    const revealedCellsInThisFill: Cell[] = [];
    const pendingFills: { [chunkId: string]: { cells: { x: number; y: number }[] } } = {};

    while (queue.length > 0) {
      const { x: localX, y: localY } = queue.shift()!;
      const globalX = this.coordinates.x * this.size + localX;
      const globalY = this.coordinates.y * this.size + localY;
      const visitedKey = `${globalX},${globalY}`;
      if (visited.has(visitedKey)) continue;
      visited.add(visitedKey);

      const idx = cellIndex(localX, localY, this.size);
      if (!isCellHidden(this.revealed, idx) || isCellFlagged(this.flagged, idx) || isCellMine(this.mines, idx)) {
        continue;
      }

      this.revealed[idx] = 0;
      this.flagged[idx] = HIDDEN_CELL;
      const cell = this.getTile(localX, localY)!;
      revealedCellsInThisFill.push(cell);

      if (cell.adjacentMines !== 0) continue;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const neighborLocalX = localX + dx;
          const neighborLocalY = localY + dy;
          const neighborGlobalX = globalX + dx;
          const neighborGlobalY = globalY + dy;
          const neighborVisitedKey = `${neighborGlobalX},${neighborGlobalY}`;

          if (
            neighborLocalX >= 0 && neighborLocalX < this.size &&
            neighborLocalY >= 0 && neighborLocalY < this.size
          ) {
            const nIdx = cellIndex(neighborLocalX, neighborLocalY, this.size);
            if (
              isCellHidden(this.revealed, nIdx) &&
              !isCellFlagged(this.flagged, nIdx) &&
              !visited.has(neighborVisitedKey)
            ) {
              queue.push({ x: neighborLocalX, y: neighborLocalY });
            }
          } else {
            const target = boardManager.convertGlobalToChunkCoordinates(neighborGlobalX, neighborGlobalY);
            const entry = boardManager.convertGlobalToChunkLocalCoordinates(neighborGlobalX, neighborGlobalY);
            const chunkId = boardManager.getChunkId(target.x, target.y);
            if (!pendingFills[chunkId]) pendingFills[chunkId] = { cells: [] };
            pendingFills[chunkId].cells.push({
              x: entry.localCoordinate.x,
              y: entry.localCoordinate.y,
            });
          }
        }
      }
    }

    if (revealedCellsInThisFill.length > 0) {
      invalidateChunkWireCache(this);
      this.broadcastChunkUpdate?.(this);
    }
    return { revealedCells: revealedCellsInThisFill, pendingFills };
  }
}
