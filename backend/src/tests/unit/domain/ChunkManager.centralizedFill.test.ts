import { ChunkManager } from '../../../domain/ChunkManager';
import { CHUNK_SIZE } from '../../../types/chunkTypes';
import { Cell } from '../../../domain/types';

describe('ChunkManager - Centralized Pending Fill Queue', () => {
  function createZeroMineCellGenerator() {
    return (x: number, y: number): Cell => ({
      x, y, isMine: false, adjacentMines: 0, revealed: false, flagged: false
    });
  }

  it('flood fill within a single chunk reveals all cells, creates pending fills for all 8 neighbors', async () => {
    const broadcastSpy = jest.fn();
    const chunkManager = new ChunkManager('testgame', CHUNK_SIZE, createZeroMineCellGenerator(), undefined, undefined, broadcastSpy);
    await chunkManager.revealAndPropagate(0, 0);
    const chunk = chunkManager.getChunk(0, 0);
    for (let y = 0; y < CHUNK_SIZE; y++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        expect(chunk.getTile(x, y)?.revealed).toBe(true);
      }
    }
    expect(chunkManager.pendingFills.size).toBe(8);
    expect(broadcastSpy).toHaveBeenCalled();
    const broadcastedChunkIds = broadcastSpy.mock.calls.map(call => call[0].id);
    expect(broadcastedChunkIds).toContain('0_0');
  });

  it('flood fill at chunk edge creates pending fills for neighbor chunk', async () => {
    const broadcastSpy = jest.fn();
    const chunkManager = new ChunkManager('testgame', CHUNK_SIZE, createZeroMineCellGenerator(), undefined, undefined, broadcastSpy);
    await chunkManager.revealAndPropagate(CHUNK_SIZE - 1, 0);
    expect(chunkManager.pendingFills.has('1_0')).toBe(true);
    const fills = chunkManager.pendingFills.get('1_0')!;
    expect(fills.length).toBeGreaterThan(0);
    expect(fills.some(f => f.localX === 0 && f.localY === 0)).toBe(true);
    expect(broadcastSpy).toHaveBeenCalled();
    const broadcastedChunkIds = broadcastSpy.mock.calls.map(call => call[0].id);
    expect(broadcastedChunkIds).toContain('0_0');
  });

  it('processing pending fills on activation reveals cells and clears queue', async () => {
    const broadcastSpy = jest.fn();
    const chunkManager = new ChunkManager('testgame', CHUNK_SIZE, createZeroMineCellGenerator(), undefined, undefined, broadcastSpy);
    await chunkManager.revealAndPropagate(CHUNK_SIZE - 1, 0);
    expect(chunkManager.pendingFills.has('1_0')).toBe(true);
    await chunkManager.processPendingFillsForChunk('1_0');
    const neighborChunk = chunkManager.getChunk(1, 0);
    expect(neighborChunk.getTile(0, 0)?.revealed).toBe(true);
    expect(chunkManager.pendingFills.get('1_0')).toBeUndefined();
    expect(broadcastSpy).toHaveBeenCalled();
    const broadcastedChunkIds = broadcastSpy.mock.calls.map(call => call[0].id);
    expect(broadcastedChunkIds).toContain('1_0');
  });

  it('does not add duplicate pending fills for the same cell', async () => {
    const broadcastSpy = jest.fn();
    const chunkManager = new ChunkManager('testgame', CHUNK_SIZE, createZeroMineCellGenerator(), undefined, undefined, broadcastSpy);
    chunkManager.addPendingFill('1_0', { localX: 0, localY: 0 });
    chunkManager.addPendingFill('1_0', { localX: 0, localY: 0 });
    const fills = chunkManager.pendingFills.get('1_0')!;
    expect(fills.length).toBe(1);
    // No broadcast expected for just adding pending fills, so we do not check broadcastSpy here
  });

  it('does not process pending fills for inactive chunks', async () => {
    const broadcastSpy = jest.fn();
    const chunkManager = new ChunkManager('testgame', CHUNK_SIZE, createZeroMineCellGenerator(), undefined, undefined, broadcastSpy);
    chunkManager.addPendingFill('2_0', { localX: 0, localY: 0 });
    const chunk = chunkManager.getChunk(2, 0);
    expect(chunk.getTile(0, 0)?.revealed).toBe(false);
    expect(chunkManager.pendingFills.get('2_0')?.length).toBe(1);
    // No broadcast expected for just adding pending fills, so we do not check broadcastSpy here
  });

  it('flood fill propagates into active right neighbor chunk and reveals its cells', async () => {
    const broadcastSpy = jest.fn();
    const activeChunks = new Set(['0_0', '1_0']);
    const hasActiveSubscribers = (gameId: string, chunkX: number, chunkY: number) =>
      activeChunks.has(`${chunkX}_${chunkY}`);
    const chunkManager = new ChunkManager(
      'testgame',
      CHUNK_SIZE,
      (x, y) => ({ x, y, isMine: false, adjacentMines: 0, revealed: false, flagged: false }),
      hasActiveSubscribers,
      undefined,
      broadcastSpy
    );
    await chunkManager.revealAndPropagate(CHUNK_SIZE - 1, 0);
    const chunk00 = chunkManager.getChunk(0, 0);
    const chunk10 = chunkManager.getChunk(1, 0);
    for (let y = 0; y < CHUNK_SIZE; y++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        expect(chunk00.getTile(x, y)?.revealed).toBe(true);
        expect(chunk10.getTile(x, y)?.revealed).toBe(true);
      }
    }
    expect(chunkManager.pendingFills.has('1_0')).toBe(false);
    expect(broadcastSpy).toHaveBeenCalled();
    const broadcastedChunkIds = broadcastSpy.mock.calls.map(call => call[0].id);
    expect(broadcastedChunkIds).toContain('0_0');
    expect(broadcastedChunkIds).toContain('1_0');
  });

  it('flood fill propagates into multiple active neighbors and reveals their cells', async () => {
    const broadcastSpy = jest.fn();
    const activeChunks = new Set(['0_0', '1_0', '0_1']);
    const hasActiveSubscribers = (gameId: string, chunkX: number, chunkY: number) =>
      activeChunks.has(`${chunkX}_${chunkY}`);
    const chunkManager = new ChunkManager(
      'testgame',
      CHUNK_SIZE,
      (x, y) => ({ x, y, isMine: false, adjacentMines: 0, revealed: false, flagged: false }),
      hasActiveSubscribers,
      undefined,
      broadcastSpy
    );
    await chunkManager.revealAndPropagate(CHUNK_SIZE - 1, CHUNK_SIZE - 1); // bottom-right corner
    const chunk00 = chunkManager.getChunk(0, 0);
    const chunk10 = chunkManager.getChunk(1, 0);
    const chunk01 = chunkManager.getChunk(0, 1);
    for (let y = 0; y < CHUNK_SIZE; y++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        expect(chunk00.getTile(x, y)?.revealed).toBe(true);
        expect(chunk10.getTile(x, y)?.revealed).toBe(true);
        expect(chunk01.getTile(x, y)?.revealed).toBe(true);
      }
    }
    expect(chunkManager.pendingFills.has('1_0')).toBe(false);
    expect(chunkManager.pendingFills.has('0_1')).toBe(false);
    expect(broadcastSpy).toHaveBeenCalled();
    const broadcastedChunkIds = broadcastSpy.mock.calls.map(call => call[0].id);
    expect(broadcastedChunkIds).toContain('0_0');
    expect(broadcastedChunkIds).toContain('1_0');
    expect(broadcastedChunkIds).toContain('0_1');
  });

  it('flood fill does not propagate into inactive neighbor chunk (pending fill remains)', async () => {
    const broadcastSpy = jest.fn();
    const activeChunks = new Set(['0_0']);
    const hasActiveSubscribers = (gameId: string, chunkX: number, chunkY: number) =>
      activeChunks.has(`${chunkX}_${chunkY}`);
    const chunkManager = new ChunkManager(
      'testgame',
      CHUNK_SIZE,
      (x, y) => ({ x, y, isMine: false, adjacentMines: 0, revealed: false, flagged: false }),
      hasActiveSubscribers,
      undefined,
      broadcastSpy
    );
    await chunkManager.revealAndPropagate(CHUNK_SIZE - 1, 0);
    const chunk00 = chunkManager.getChunk(0, 0);
    for (let y = 0; y < CHUNK_SIZE; y++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        expect(chunk00.getTile(x, y)?.revealed).toBe(true);
      }
    }
    expect(chunkManager.pendingFills.has('1_0')).toBe(true);
    expect(broadcastSpy).toHaveBeenCalled();
    const broadcastedChunkIds = broadcastSpy.mock.calls.map(call => call[0].id);
    expect(broadcastedChunkIds).toContain('0_0');
  });

  it('should broadcast chunk update when cells are revealed', async () => {
    const broadcastSpy = jest.fn();
    const chunkManager = new ChunkManager(
      'testgame',
      CHUNK_SIZE,
      (x, y) => ({ x, y, isMine: false, adjacentMines: 0, revealed: false, flagged: false }),
      undefined, // hasActiveSubscribers
      undefined, // processAndBroadcastChunk
      broadcastSpy
    );
    await chunkManager.revealAndPropagate(0, 0);
    expect(broadcastSpy).toHaveBeenCalled();
    // Optionally, check which chunks were broadcast
    const broadcastedChunkIds = broadcastSpy.mock.calls.map(call => call[0].id);
    expect(broadcastedChunkIds).toContain('0_0');
  });
}); 