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
    // Only (0,0) is active
    const hasActiveSubscribers = (gameId: string, chunkX: number, chunkY: number) => chunkX === 0 && chunkY === 0;
    const chunkManager = new ChunkManager('testgame', CHUNK_SIZE, createCellGenerator(), hasActiveSubscribers);

    // Reveal a cell in (0,0) that will flood to neighbors
    await chunkManager.revealAndPropagate(0, 0);

    // All cells in (0,0) should be revealed
    const chunk = chunkManager.getChunk(0, 0);
    for (let y = 0; y < CHUNK_SIZE; y++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        expect(chunk.getTile(x, y)?.revealed).toBe(true);
      }
    }

    // Neighboring chunks should exist, but not be revealed
    // test all of the catty corner chunks are also pending fills
    const neighbors = [
      chunkManager.getChunk(1, 0),
      chunkManager.getChunk(-1, 0),
      chunkManager.getChunk(0, 1),
      chunkManager.getChunk(0, -1),
      chunkManager.getChunk(1, 1),
      chunkManager.getChunk(-1, 1),
      chunkManager.getChunk(1, -1),
      chunkManager.getChunk(-1, -1)
    ];
    for (const neighbor of neighbors) {
      for (let y = 0; y < CHUNK_SIZE; y++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          expect(neighbor.getTile(x, y)?.revealed).toBe(false);
        }
      }
      // Should have pending fills
      expect(neighbor.pendingFills.length).toBeGreaterThan(0);
    }

    // check that other chunks are not pending fills
    const otherChunks = [
      chunkManager.getChunk(2, 0),
      chunkManager.getChunk(-2, 0),
      chunkManager.getChunk(0, 2),
      chunkManager.getChunk(0, -2)
    ];
    for (const chunk of otherChunks) {
      expect(chunk.pendingFills.length).toBe(0);
    }
  });

  it('should process pending fills when chunk is loaded/subscribed', async () => {
    // both (0,0) and (1,1) are active
    const hasActiveSubscribers = (gameId: string, chunkX: number, chunkY: number) => (chunkX === 0 && chunkY === 0) || (chunkX === 1 && chunkY === 1);
    const chunkManager = new ChunkManager('testgame', CHUNK_SIZE, createCellGenerator(), hasActiveSubscribers);

    // reveal a cell in (0,0) that will flood to neighbors
    await chunkManager.revealAndPropagate(0, 0);

    // check that both 0,0 and 1,1 are revealed
    const chunk00 = chunkManager.getChunk(0, 0);
    const chunk11 = chunkManager.getChunk(1, 1);
    expect(chunk00.getTile(0, 0)?.revealed).toBe(true);
    expect(chunk11.getTile(0, 0)?.revealed).toBe(true);

    // check that unloaded chunks are not revealed but have pending fills
    // This should be every chunk that boarders 0,0 and 1,1
    const neighbors = [
    //border of 0,0
      chunkManager.getChunk(1, 0),
      chunkManager.getChunk(-1, 0),
      chunkManager.getChunk(0, 1),
      chunkManager.getChunk(0, -1),
    //border of 1,1
      chunkManager.getChunk(2, 1),
      chunkManager.getChunk(2, 2),
      chunkManager.getChunk(1, 2),
    ]
    for (const neighbor of neighbors) {
      expect(neighbor.getTile(0, 0)?.revealed).toBe(false);
      expect(neighbor.pendingFills.length).toBeGreaterThan(0);
    }

    // check that chunks not on the border are revealed and have no pending fills
    const otherChunks = [
      chunkManager.getChunk(5, 5),
      chunkManager.getChunk(-2, -2),
    ]
    for (const chunk of otherChunks) {
      expect(chunk.getTile(0, 0)?.revealed).toBe(true);
      expect(chunk.pendingFills.length).toBe(0);
    }
  });



    
}); 