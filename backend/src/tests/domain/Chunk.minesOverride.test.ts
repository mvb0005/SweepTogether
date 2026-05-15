import { Chunk } from '../../domain/Chunk';
import { CHUNK_SIZE, IChunkManager } from '../../types/chunkTypes';

const mockChunkManager: IChunkManager = {
  getChunk: jest.fn((chunkX: number, chunkY: number) => Promise.resolve(new Chunk(chunkX, chunkY, CHUNK_SIZE))),
  preloadMany: jest.fn(),
  getChunkById: jest.fn(),
  convertGlobalToChunkCoordinates: jest.fn((globalX: number, globalY: number) => ({
    x: Math.floor(globalX / CHUNK_SIZE),
    y: Math.floor(globalY / CHUNK_SIZE),
  })),
  convertGlobalToChunkLocalCoordinates: jest.fn((globalX: number, globalY: number) => {
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
  convertChunkLocalToGlobalCoordinates: jest.fn((chunkX: number, chunkY: number, localX: number, localY: number) => ({
    x: chunkX * CHUNK_SIZE + localX,
    y: chunkY * CHUNK_SIZE + localY,
  })),
  getChunkId: jest.fn((chunkX: number, chunkY: number) => `${chunkX}_${chunkY}`),
  revealAndPropagate: jest.fn(),
  processPendingFillsForChunk: jest.fn(),
  drainSubscribedPendingFills: jest.fn(),
  pendingFills: new Map(),
  chunks: new Map(),
};

describe('Chunk with minesOverride', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should use minesOverride buffer to set isMine on tiles', () => {
    // Build a 4x4 override buffer with mines at (0,0) and (3,3): 0xFF=mine, 0-8=adjacentMines
    const size = 4;
    const override = new Uint8Array(size * size); // all 0 = open, adjacentMines=0
    override[0 * size + 0] = 0xFF; // (localX=0, localY=0) is a mine
    override[3 * size + 3] = 0xFF; // (localX=3, localY=3) is a mine

    const chunk = new Chunk(0, 0, size, undefined, override);

    expect(chunk.getTile(0, 0)?.isMine).toBe(true);
    expect(chunk.getTile(3, 3)?.isMine).toBe(true);
    expect(chunk.getTile(1, 0)?.isMine).toBe(false);
    expect(chunk.getTile(2, 2)?.isMine).toBe(false);
  });

  it('should override isMine even when initialCellGenerator is provided', () => {
    // The generator marks everything as a mine; the override says only (0,0) is a mine
    const size = 4;
    const override = new Uint8Array(size * size); // all 0 = open, adjacentMines=0
    override[0 * size + 0] = 0xFF; // only (localX=0, localY=0) is a mine

    const allMinesGenerator = (gx: number, gy: number) => ({
      x: gx, y: gy, isMine: true, adjacentMines: 0, revealed: false, flagged: false,
    });

    const chunk = new Chunk(0, 0, size, allMinesGenerator, override);

    // minesOverride should win: only (0,0) is a mine
    expect(chunk.getTile(0, 0)?.isMine).toBe(true);
    expect(chunk.getTile(1, 0)?.isMine).toBe(false);
    expect(chunk.getTile(0, 1)?.isMine).toBe(false);
    // Other generator fields should still be applied (adjacentMines from generator = 0, and revealed/flagged = false)
    const tile = chunk.getTile(1, 1)!;
    expect(tile.revealed).toBe(false);
    expect(tile.flagged).toBe(false);
  });

  it('executeLocalFloodFill stops at cells backed by the override mine buffer', async () => {
    // 4x4 chunk: mine at (2,0) stops flood fill from spreading rightward from (0,0)
    const size = 4;
    const override = new Uint8Array(size * size); // all 0 = open, adjacentMines=0
    override[0 * size + 2] = 0xFF; // (localX=2, localY=0) is a mine

    const chunk = new Chunk(0, 0, size, undefined, override);

    // Wire getChunk to return fresh empty chunks for neighbors
    (mockChunkManager.getChunk as jest.Mock).mockImplementation(
      (cx: number, cy: number) => (cx === 0 && cy === 0) ? chunk : new Chunk(cx, cy, size)
    );

    const result = await chunk.executeLocalFloodFill(0, 0, 0, mockChunkManager);

    // Mine at (2,0) should never be revealed
    expect(chunk.getTile(2, 0)?.revealed).toBe(false);
    expect(result.revealedCells.some(c => c.isMine)).toBe(false);
    // (0,0) should be revealed
    expect(chunk.getTile(0, 0)?.revealed).toBe(true);
  });
});
