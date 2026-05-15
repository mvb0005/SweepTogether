import { Chunk } from '../../domain/Chunk';
import { Cell } from '../../domain/types';
import { ChunkState, CHUNK_SIZE, IChunkManager, Coordinate } from '../../types/chunkTypes';

// Mock IChunkManager for testing propagation
const mockChunkManager: IChunkManager = {
  getChunk: jest.fn(),
  getChunkById: jest.fn(),
  preloadMany: jest.fn(),
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
  revealAndPropagate: jest.fn(),
  processPendingFillsForChunk: jest.fn(),
  drainSubscribedPendingFills: jest.fn(),
  pendingFills: new Map(),
  chunks: new Map(),
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

  describe('executeLocalFloodFill', () => {
    let chunk: Chunk;

    beforeEach(() => {
      // getChunk returns the test chunk for (0,0); creates a fresh empty chunk for any other coords
      (mockChunkManager.getChunk as jest.Mock).mockImplementation((chunkX: number, chunkY: number) =>
        (chunkX === 0 && chunkY === 0 && chunk) ? chunk : new Chunk(chunkX, chunkY, CHUNK_SIZE)
      );
    });

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

      const result = await chunk.executeLocalFloodFill(1, 1, 1, mockChunkManager);
      expect(result.revealedCells.length).toBe(1);
      expect(result.revealedCells[0]).toEqual(expect.objectContaining({ x: 1, y: 1, revealed: true }));
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

      const result = await chunk.executeLocalFloodFill(1, 1, 0, mockChunkManager);
      // In a 3x3 chunk, a 0-mine cell at the center with no other mines reveals all 9 cells.
      expect(result.revealedCells.length).toBe(9);
      result.revealedCells.forEach(cell => expect(cell.revealed).toBe(true));
      // Every border cell propagates to external chunks — pendingFills should be non-empty
      expect(Object.keys(result.pendingFills).length).toBeGreaterThan(0);
    });

    it('should not reveal mines or flagged cells', async () => {
      chunk = new Chunk(0, 0); // 16x16, all non-mine by default
      chunk.setTile(0, 0, { ...chunk.getTile(0, 0)!, isMine: true });
      chunk.setTile(CHUNK_SIZE - 1, CHUNK_SIZE - 1, { ...chunk.getTile(CHUNK_SIZE - 1, CHUNK_SIZE - 1)!, flagged: true });

      // Start far from both the mine and flagged cell
      const result = await chunk.executeLocalFloodFill(5, 5, 0, mockChunkManager as any);

      expect(chunk.getTile(0, 0)?.revealed).toBe(false);
      expect(chunk.getTile(CHUNK_SIZE - 1, CHUNK_SIZE - 1)?.revealed).toBe(false);
      expect(result.revealedCells.some(c => c.isMine)).toBe(false);
      expect(result.revealedCells.some(c => c.flagged)).toBe(false);
    });

    it('should propagate to neighbors when fill reaches chunk boundary (0-mine cell at edge)', async () => {
      chunk = new Chunk(0, 0); // 16x16 chunk, all non-mine by default
      // Mines at (2,0) and (0,2) give (1,0), (0,1), (1,1) each adjacentMines>0 via recalculation,
      // stopping the flood fill after the immediate neighbors of (0,0).
      chunk.setTile(2, 0, { ...chunk.getTile(2, 0)!, isMine: true });
      chunk.setTile(0, 2, { ...chunk.getTile(0, 2)!, isMine: true });

      const result = await chunk.executeLocalFloodFill(0, 0, 0, mockChunkManager as any);

      expect(chunk.getTile(0, 0)?.revealed).toBe(true);
      expect(result.pendingFills['-1_-1']).toBeDefined();
      expect(result.pendingFills['0_-1']).toBeDefined();
      expect(result.pendingFills['-1_0']).toBeDefined();
      expect(Object.keys(result.pendingFills).length).toBe(3);
    });

    it('should propagate to all 3 catty corner (diagonal) neighbors at a chunk corner', async () => {
      chunk = new Chunk(0, 0, 3);
      // Mines at (2,0) and (0,2) make (1,0), (0,1), (1,1) each have adjacentMines>0,
      // stopping the fill after (0,0)'s immediate neighbors — only external neighbors of (0,0) get pendingFills.
      chunk.setTile(2, 0, { ...chunk.getTile(2, 0)!, isMine: true });
      chunk.setTile(0, 2, { ...chunk.getTile(0, 2)!, isMine: true });

      const result = await chunk.executeLocalFloodFill(0, 0, 0, mockChunkManager as any);

      expect(result.pendingFills['-1_-1']).toBeDefined();
      expect(result.pendingFills['0_-1']).toBeDefined();
      expect(result.pendingFills['-1_0']).toBeDefined();
      expect(Object.keys(result.pendingFills).length).toBe(3);
    });
  });
});
