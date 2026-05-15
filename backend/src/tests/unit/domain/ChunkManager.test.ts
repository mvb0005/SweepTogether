import { ChunkManager } from '../../../domain/ChunkManager';
import { Cell } from '../../../domain/types';
import { CHUNK_SIZE } from '../../../types/chunkTypes';

describe('ChunkManager and Chunk - Pending Fill Propagation', () => {
  function createCellGenerator() {
    return (x: number, y: number): Cell => ({
      x, y, isMine: false, adjacentMines: 0, revealed: false, flagged: false
    });
  }

  it('should only process the initial chunk, leaving pending fills in neighbors', async () => {
    const hasActiveSubscribers = (gameId: string, chunkX: number, chunkY: number) => chunkX === 0 && chunkY === 0;
    const chunkManager = new ChunkManager('testgame', CHUNK_SIZE, createCellGenerator(), hasActiveSubscribers);

    await chunkManager.revealAndPropagate(0, 0);

    // All cells in (0,0) should be revealed
    const chunk = await chunkManager.getChunk(0, 0);
    for (let y = 0; y < CHUNK_SIZE; y++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        expect(chunk.getTile(x, y)?.revealed).toBe(true);
      }
    }

    // All 8 neighbors should have pending fills
    const neighborKeys = ['1_0', '-1_0', '0_1', '0_-1', '1_1', '-1_1', '1_-1', '-1_-1'];
    for (const key of neighborKeys) {
      expect((chunkManager.pendingFills.get(key)?.length ?? 0)).toBeGreaterThan(0);
    }

    // Chunks further away should have no pending fills
    for (const key of ['2_0', '-2_0', '0_2', '0_-2']) {
      expect(chunkManager.pendingFills.get(key)?.length ?? 0).toBe(0);
    }
  });

  it('should process pending fills when chunk is loaded/subscribed', async () => {
    const hasActiveSubscribers = (gameId: string, chunkX: number, chunkY: number) =>
      (chunkX === 0 && chunkY === 0) || (chunkX === 1 && chunkY === 1);
    const chunkManager = new ChunkManager('testgame', CHUNK_SIZE, createCellGenerator(), hasActiveSubscribers);

    await chunkManager.revealAndPropagate(0, 0);

    // Both (0,0) and (1,1) should be fully revealed
    expect((await chunkManager.getChunk(0, 0)).getTile(0, 0)?.revealed).toBe(true);
    expect((await chunkManager.getChunk(1, 1)).getTile(0, 0)?.revealed).toBe(true);

    // Chunks on the boundary of (0,0) and (1,1) but not active should have pending fills
    const borderedKeys = ['1_0', '-1_0', '0_1', '0_-1', '2_1', '2_2', '1_2'];
    for (const key of borderedKeys) {
      const [cx, cy] = key.split('_').map(Number);
      expect((await chunkManager.getChunk(cx, cy)).getTile(0, 0)?.revealed).toBe(false);
      expect((chunkManager.pendingFills.get(key)?.length ?? 0)).toBeGreaterThan(0);
    }

    // Chunks far away should not have been reached
    for (const key of ['5_5', '-2_-2']) {
      const [cx, cy] = key.split('_').map(Number);
      expect((await chunkManager.getChunk(cx, cy)).getTile(0, 0)?.revealed).toBe(false);
      expect(chunkManager.pendingFills.get(key)?.length ?? 0).toBe(0);
    }
  });
});
