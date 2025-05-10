import { Chunk } from '../../domain/Chunk';
import { Cell } from '../../domain/types';
import { ChunkState, CHUNK_SIZE, IBoardManager, Coordinate } from '../../types/chunkTypes';

// Mock IBoardManager for testing propagation
const mockBoardManager: IBoardManager = {
  getChunk: jest.fn(),
  getChunkById: jest.fn(),
  propagateFillToNeighbor: jest.fn(),
  convertGlobalToChunkCoordinates: jest.fn((globalX, globalY) => ({
    x: Math.floor(globalX / CHUNK_SIZE),
    y: Math.floor(globalY / CHUNK_SIZE),
  })),
  convertGlobalToChunkLocalCoordinates: jest.fn((globalX, globalY) => {
    const chunkX = Math.floor(globalX / CHUNK_SIZE);
    const chunkY = Math.floor(globalY / CHUNK_SIZE);
    const localX = globalX % CHUNK_SIZE;
    const localY = globalY % CHUNK_SIZE;
    return {
      chunkCoordinate: { x: chunkX, y: chunkY },
      localCoordinate: {
        x: localX < 0 ? localX + CHUNK_SIZE : localX,
        y: localY < 0 ? localY + CHUNK_SIZE : localY,
      },
    };
  }),
  convertChunkLocalToGlobalCoordinates: jest.fn((chunkX, chunkY, localX, localY) => ({
    x: chunkX * CHUNK_SIZE + localX,
    y: chunkY * CHUNK_SIZE + localY,
  })),
  getChunkId: jest.fn((chunkX, chunkY) => `${chunkX}_${chunkY}`),
};

describe('Chunk', () => {
  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with correct ID, coordinates, and default size', () => {
      const chunk = new Chunk(1, 2);
      expect(chunk.id).toBe('1_2');
      expect(chunk.coordinates).toEqual({ x: 1, y: 2 });
      expect(chunk.size).toBe(CHUNK_SIZE);
      expect(chunk.state).toBe(ChunkState.LOADED_CLEAN);
    });

    it('should initialize tiles with default cell values if no generator provided', () => {
      const chunk = new Chunk(0, 0);
      const tile = chunk.getTile(0, 0);
      expect(tile).toEqual({
        x: 0,
        y: 0,
        isMine: false,
        adjacentMines: 0,
        revealed: false,
        flagged: false,
      });
    });

    it('should initialize tiles using the custom cell generator if provided', () => {
      const customGenerator = (globalX: number, globalY: number): Cell => ({
        x: globalX,
        y: globalY,
        isMine: true,
        adjacentMines: 1,
        revealed: true,
        flagged: true,
      });
      const chunk = new Chunk(0, 0, CHUNK_SIZE, customGenerator);
      const tile = chunk.getTile(0, 0);
      expect(tile).toEqual({
        x: 0,
        y: 0,
        isMine: true,
        adjacentMines: 1,
        revealed: true,
        flagged: true,
      });
    });
  });

  describe('getTile and setTile', () => {
    let chunk: Chunk;
    beforeEach(() => {
      chunk = new Chunk(0, 0);
    });

    it('should get and set a tile within bounds', () => {
      const cell: Cell = { x: 0, y: 0, isMine: true, adjacentMines: 0, revealed: false, flagged: false };
      chunk.setTile(0, 0, cell);
      expect(chunk.getTile(0, 0)).toEqual(cell);
    });

    it('getTile should return undefined for out-of-bounds coordinates', () => {
      expect(chunk.getTile(-1, 0)).toBeUndefined();
      expect(chunk.getTile(CHUNK_SIZE, 0)).toBeUndefined();
    });

    it('setTile should not throw for out-of-bounds coordinates but not set anything', () => {
      const originalTile = chunk.getTile(0,0);
      expect(() => chunk.setTile(-1, 0, { x: -1, y: 0, isMine: true, adjacentMines: 0, revealed: false, flagged: false })).not.toThrow();
      // Ensure no other tile was accidentally modified
      expect(chunk.getTile(0,0)).toEqual(originalTile);
    });
  });

  describe('addPendingFill', () => {
    let chunk: Chunk;
    beforeEach(() => {
      chunk = new Chunk(0, 0);
    });

    it('should add an item to pendingFills and set state to DIRTY_PENDING_FILLS', () => {
      chunk.addPendingFill(1, 1, 0);
      expect(chunk.pendingFills).toEqual([{ localX: 1, localY: 1, originalMineCountHint: 0 }]);
      expect(chunk.state).toBe(ChunkState.DIRTY_PENDING_FILLS);
    });

    it('should not add duplicate pending fill items', () => {
      chunk.addPendingFill(1, 1, 0);
      chunk.addPendingFill(1, 1, 0);
      expect(chunk.pendingFills.length).toBe(1);
    });

    it('should not change state to DIRTY_PENDING_FILLS if already PROCESSING', () => {
      chunk.state = ChunkState.PROCESSING;
      chunk.addPendingFill(2, 2);
      expect(chunk.pendingFills.length).toBe(1);
      expect(chunk.state).toBe(ChunkState.PROCESSING);
    });
  });

  describe('executeLocalFloodFill', () => {
    let chunk: Chunk;

    // Helper to create a chunk with a specific 3x3 setup for flood fill tests
    // Center (1,1) is the start point. Mines can be placed at neighbors.
    const createChunkForFloodFill = (setup: {
      center?: Partial<Cell>;
      neighbors?: Partial<Cell>[]; // 8 neighbors in order: TL, T, TR, L, R, BL, B, BR
      isMine?: boolean[]; // Corresponds to neighbors array
    }) => {
      chunk = new Chunk(0, 0, 3); // Use a 3x3 chunk for easier testing
      // Center cell (1,1)
      chunk.setTile(1, 1, {
        x: 1, y: 1, isMine: false, adjacentMines: 0, revealed: false, flagged: false,
        ...(setup.center || {}),
      });

      const neighborCoords = [
        { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, // Top row
        { x: 0, y: 1 },                     { x: 2, y: 1 }, // Middle row (sides)
        { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 }, // Bottom row
      ];

      let mineCountForCenter = 0;
      for (let i = 0; i < 8; i++) {
        const coord = neighborCoords[i];
        const isMine = setup.isMine?.[i] || false;
        if (isMine) mineCountForCenter++;
        chunk.setTile(coord.x, coord.y, {
          x: coord.x, y: coord.y, isMine: isMine, adjacentMines: 0, revealed: false, flagged: false,
          ...(setup.neighbors?.[i] || {}),
        });
      }
      // Update center cell's adjacentMines count based on actual mines placed
      const centerCell = chunk.getTile(1,1)!;
      centerCell.adjacentMines = mineCountForCenter;
      chunk.setTile(1,1, centerCell);

      // Calculate adjacentMines for all other cells (simplified for 3x3)
      for(let y = 0; y < 3; y++) {
        for (let x = 0; x < 3; x++) {
          if (x === 1 && y === 1) continue; // Skip center, already done
          const currentCell = chunk.getTile(x,y)!;
          if (currentCell.isMine) continue;
          let count = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = x + dx;
              const ny = y + dy;
              if (nx >= 0 && nx < 3 && ny >= 0 && ny < 3) {
                if (chunk.getTile(nx,ny)?.isMine) count++;
              }
            }
          }
          currentCell.adjacentMines = count;
          chunk.setTile(x,y,currentCell);
        }
      }
      return chunk;
    };

    it('should reveal a single non-mine, non-zero cell and return it', async () => {
      chunk = createChunkForFloodFill({ center: { adjacentMines: 1 } }); // Center has 1 adjacent mine
      chunk.setTile(0,0, {...chunk.getTile(0,0)!, isMine: true}); // Place a mine to make center non-zero
      const centerCell = chunk.getTile(1,1)!;
      centerCell.adjacentMines = 1;
      chunk.setTile(1,1, centerCell);

      const revealed = await chunk.executeLocalFloodFill(1, 1, 1, mockBoardManager);
      expect(revealed.length).toBe(1);
      expect(revealed[0]).toEqual(expect.objectContaining({ x: 1, y: 1, revealed: true }));
      expect(chunk.getTile(1, 1)?.revealed).toBe(true);
    });

    it('should reveal a 0-mine cell and its non-mine neighbors within the chunk', async () => {
      // Setup: (1,1) is 0-mine. (0,0) is a mine. All others are not mines.
      // Expected: (1,1) and its 7 non-mine neighbors revealed.
      chunk = createChunkForFloodFill({ isMine: [true, false, false, false, false, false, false, false] });
      // Ensure center is 0 after mine placement
      const center = chunk.getTile(1,1)!;
      expect(center.adjacentMines).toBe(1); // Should be 1 due to the mine at (0,0)
      // Let's make (1,1) a true 0-mine cell for this test by removing the mine at (0,0)
      chunk.setTile(0,0, {...chunk.getTile(0,0)!, isMine: false});
      // Recalculate for the whole 3x3 grid
      chunk = createChunkForFloodFill({ isMine: [false, false, false, false, false, false, false, false] });
      expect(chunk.getTile(1,1)!.adjacentMines).toBe(0);

      const revealed = await chunk.executeLocalFloodFill(1, 1, 0, mockBoardManager);
      // In a 3x3 chunk, a 0-mine cell at the center with no other mines reveals all 9 cells.
      expect(revealed.length).toBe(9); 
      revealed.forEach(cell => expect(cell.revealed).toBe(true));
      // For a 3x3 grid of all 0-mine cells, every cell on the border will attempt to propagate outwards.
      // Corner cells (4 of them) propagate to 5 neighbors each: 4 * 5 = 20
      // Edge-center cells (4 of them) propagate to 3 neighbors each: 4 * 3 = 12
      // Total expected propagations: 20 + 12 = 32
      expect(mockBoardManager.propagateFillToNeighbor).toHaveBeenCalledTimes(32);
    });

    it('should not reveal mines or flagged cells', async () => {
      chunk = createChunkForFloodFill({});
      chunk.setTile(0, 0, { ...chunk.getTile(0,0)!, isMine: true });
      chunk.setTile(1, 0, { ...chunk.getTile(1,0)!, flagged: true });

      const revealed = await chunk.executeLocalFloodFill(1, 1, 0, mockBoardManager);
      // Center (1,1) is 0-adj, (0,1), (2,1), (0,2), (1,2), (2,2), (2,0) should be revealed (6 cells)
      // (0,0) is mine, (1,0) is flagged, (1,1) is the start point
      // Total revealed should be 7 (start + 6 neighbors)
      expect(revealed.length).toBe(7); 
      expect(chunk.getTile(0, 0)?.revealed).toBe(false);
      expect(chunk.getTile(1, 0)?.revealed).toBe(false);
    });

    it('should propagate to neighbors when fill reaches chunk boundary (0-mine cell at edge)', async () => {
      // Chunk size is CHUNK_SIZE (16). Place a 0-mine cell at (0,0)
      chunk = new Chunk(0,0); // Standard 16x16 chunk
      const startCell = chunk.getTile(0,0)!;
      startCell.adjacentMines = 0; // Make (0,0) a 0-mine cell
      chunk.setTile(0,0, startCell);
      
      // Make its internal neighbors non-0-mine to stop the flood fill after them
      // This ensures we only test propagation from the initial (0,0) cell for this test's purpose.
      chunk.setTile(1,0, {...chunk.getTile(1,0)!, adjacentMines: 1}); 
      chunk.setTile(0,1, {...chunk.getTile(0,1)!, adjacentMines: 1});
      chunk.setTile(1,1, {...chunk.getTile(1,1)!, adjacentMines: 1});

      await chunk.executeLocalFloodFill(0, 0, 0, mockBoardManager);

      // Propagation should occur only from the (0,0) cell because its internal neighbors are not 0-mine.
      // For cell (0,0) in chunk (0,0), external neighbors are:
      // (-1,-1), (0,-1), (1,-1) (3 top)
      // (-1,0) (1 left)
      // (-1,1) (1 bottom-left relative to this propagation path)
      // Total = 5 propagations.
      expect(mockBoardManager.propagateFillToNeighbor).toHaveBeenCalledTimes(5);
      // Example check for one propagation call (top neighbor of (0,0) which is (0,-1) globally)
      expect(mockBoardManager.propagateFillToNeighbor).toHaveBeenCalledWith(
        chunk.id, // fromChunkId
        0, -1,   // neighborChunkX, neighborChunkY
        0, CHUNK_SIZE - 1, // entryLocalX, entryLocalY (0, 15 for a CHUNK_SIZE 16)
        0         // originalMineCountHint
      );
      // Example check for left neighbor of (0,0) which is (-1,0) globally
      expect(mockBoardManager.propagateFillToNeighbor).toHaveBeenCalledWith(
        chunk.id, 
        -1, 0, 
        CHUNK_SIZE -1, 0, 
        0
      );
    });
  });

  describe('processPendingFills', () => {
    let chunk: Chunk;

    beforeEach(() => {
      // Use a 3x3 chunk for easier visualization
      chunk = new Chunk(0, 0, 3);
      // Setup a simple scenario: (1,1) is a 0-mine cell, all others are numbers/empty
      for (let y = 0; y < 3; y++) {
        for (let x = 0; x < 3; x++) {
          chunk.setTile(x, y, { x: x + 0*3, y: y + 0*3, isMine: false, adjacentMines: (x === 1 && y === 1) ? 0 : 1, revealed: false, flagged: false });
        }
      }
    });

    it('should process all items in pendingFills and return aggregated revealed cells', async () => {
      chunk.addPendingFill(1, 1, 0); // Fill from center (0-mine cell)
      // Add another pending fill that will reveal just one cell
      chunk.setTile(0,0, {...chunk.getTile(0,0)!, adjacentMines: 1});
      chunk.addPendingFill(0,0,1);

      const revealedCells = await chunk.processPendingFills(mockBoardManager);
      // Fill from (1,1) reveals all 9 cells in 3x3. Fill from (0,0) reveals 1 cell (itself).
      // Since (0,0) is already revealed by the first fill, it won't be re-added.
      expect(revealedCells.length).toBe(9);
      expect(chunk.state).toBe(ChunkState.UP_TO_DATE);
      expect(chunk.pendingFills.length).toBe(0);
    });

    it('should set state to PROCESSING during operation and UP_TO_DATE after', async () => {
      chunk.addPendingFill(1, 1, 0);
      const promise = chunk.processPendingFills(mockBoardManager);
      expect(chunk.state).toBe(ChunkState.PROCESSING);
      await promise;
      expect(chunk.state).toBe(ChunkState.UP_TO_DATE);
    });

    it('should return empty array if no pending fills', async () => {
      expect(chunk.pendingFills.length).toBe(0);
      const revealedCells = await chunk.processPendingFills(mockBoardManager);
      expect(revealedCells.length).toBe(0);
      expect(chunk.state).toBe(ChunkState.LOADED_CLEAN); // Or UP_TO_DATE if it was dirty before
    });

     it('should handle multiple pending fills correctly, aggregating results', async () => {
      // Chunk is 3x3. (0,0) is a non-0 cell. (2,2) is a non-0 cell.
      // Neither are 0-adj mines, so they only reveal themselves.
      chunk.setTile(0,0, { x:0, y:0, isMine: false, adjacentMines:1, revealed: false, flagged: false });
      chunk.setTile(2,2, { x:2, y:2, isMine: false, adjacentMines:1, revealed: false, flagged: false });
      
      chunk.addPendingFill(0,0, 1);
      chunk.addPendingFill(2,2, 1);

      const revealedCells = await chunk.processPendingFills(mockBoardManager);
      expect(revealedCells.length).toBe(2);
      expect(revealedCells.find(c => c.x === 0 && c.y === 0 && c.revealed)).toBeTruthy();
      expect(revealedCells.find(c => c.x === 2 && c.y === 2 && c.revealed)).toBeTruthy();
      expect(chunk.state).toBe(ChunkState.UP_TO_DATE);
    });

    it('should set state to DIRTY_PENDING_FILLS if new fills are added during processing by propagation (simulated)', async () => {
      chunk.addPendingFill(1, 1, 0); // This will be processed

      // Mock executeLocalFloodFill to simulate a new fill being added (e.g., by a different async operation or complex propagation)
      const originalExecute = chunk.executeLocalFloodFill.bind(chunk);
      jest.spyOn(chunk, 'executeLocalFloodFill').mockImplementation(async (startX, startY, hint, bm) => {
        const result = await originalExecute(startX, startY, hint, bm);
        // Simulate a new fill being added to this chunk *after* the current one started processing but *before* all are done
        if (startX === 1 && startY === 1) { // Only for the first item
            chunk.addPendingFill(0, 0, 1); 
        }
        return result;
      });
      
      await chunk.processPendingFills(mockBoardManager);
      // The first fill (1,1) completes. The second fill (0,0) was added while processing.
      // So, pendingFills should contain (0,0) and state should be DIRTY.
      expect(chunk.pendingFills.length).toBe(1);
      expect(chunk.pendingFills[0]).toEqual({ localX: 0, localY: 0, originalMineCountHint: 1 });
      expect(chunk.state).toBe(ChunkState.DIRTY_PENDING_FILLS);
      (chunk.executeLocalFloodFill as jest.Mock).mockRestore(); // Clean up spy
    });
  });
});
