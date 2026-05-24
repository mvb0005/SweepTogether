import { ChunkManager } from '../../domain/ChunkManager';
import { Chunk } from '../../domain/Chunk';
import { CHUNK_SIZE } from '../../types/chunkTypes';
import { IChunk } from '../../types/chunkTypes';

// Mock the Chunk class
jest.mock('../../domain/Chunk');

const MockedChunk = Chunk as jest.MockedClass<typeof Chunk>;

describe('ChunkManager', () => {
  let chunkManager: ChunkManager;
  const defaultCellGenerator = expect.any(Function); // Placeholder for the default generator

  beforeEach(() => {
    MockedChunk.mockClear();
    chunkManager = new ChunkManager('testgame');
  });

  describe('constructor', () => {
    it('should initialize correctly', async () => {
      expect(chunkManager).toBeDefined();
      const chunk = await chunkManager.getChunk(0, 0);
      expect(MockedChunk).toHaveBeenCalledTimes(1);
      expect(chunk).toBeInstanceOf(MockedChunk);
    });
  });

  describe('getChunkId', () => {
    it('should return the correct chunk ID string', () => {
      expect(chunkManager.getChunkId(0, 0)).toBe('0_0');
      expect(chunkManager.getChunkId(1, 2)).toBe('1_2');
      expect(chunkManager.getChunkId(-1, -5)).toBe('-1_-5');
    });
  });

  describe('convertGlobalToChunkCoordinates', () => {
    it('should convert global coordinates to chunk coordinates correctly', () => {
      expect(chunkManager.convertGlobalToChunkCoordinates(0, 0)).toEqual({ x: 0, y: 0 });
      expect(chunkManager.convertGlobalToChunkCoordinates(31, 31)).toEqual({ x: 0, y: 0 }); // last cell of chunk 0
      expect(chunkManager.convertGlobalToChunkCoordinates(32, 0)).toEqual({ x: 1, y: 0 }); // first cell of chunk 1
      expect(chunkManager.convertGlobalToChunkCoordinates(0, 32)).toEqual({ x: 0, y: 1 });
      expect(chunkManager.convertGlobalToChunkCoordinates(63, 63)).toEqual({ x: 1, y: 1 });
      expect(chunkManager.convertGlobalToChunkCoordinates(64, 64)).toEqual({ x: 2, y: 2 });
      expect(chunkManager.convertGlobalToChunkCoordinates(-1, -1)).toEqual({ x: -1, y: -1 });
      expect(chunkManager.convertGlobalToChunkCoordinates(-32, -32)).toEqual({ x: -1, y: -1 }); // first cell of chunk -1
      expect(chunkManager.convertGlobalToChunkCoordinates(-33, -33)).toEqual({ x: -2, y: -2 });
    });
  });

  describe('convertGlobalToChunkLocalCoordinates', () => {
    it('should convert global coordinates to chunk and local coordinates correctly', () => {
      expect(chunkManager.convertGlobalToChunkLocalCoordinates(0, 0)).toEqual({
        chunkCoordinate: { x: 0, y: 0 },
        localCoordinate: { x: 0, y: 0 },
      });
      expect(chunkManager.convertGlobalToChunkLocalCoordinates(31, 31)).toEqual({
        chunkCoordinate: { x: 0, y: 0 },
        localCoordinate: { x: 31, y: 31 },
      });
      expect(chunkManager.convertGlobalToChunkLocalCoordinates(32, 0)).toEqual({
        chunkCoordinate: { x: 1, y: 0 },
        localCoordinate: { x: 0, y: 0 },
      });
      expect(chunkManager.convertGlobalToChunkLocalCoordinates(63, 31)).toEqual({
        chunkCoordinate: { x: 1, y: 0 },
        localCoordinate: { x: 31, y: 31 },
      });
      expect(chunkManager.convertGlobalToChunkLocalCoordinates(0, 32)).toEqual({
        chunkCoordinate: { x: 0, y: 1 },
        localCoordinate: { x: 0, y: 0 },
      });
      expect(chunkManager.convertGlobalToChunkLocalCoordinates(-1, -1)).toEqual({
        chunkCoordinate: { x: -1, y: -1 },
        localCoordinate: { x: 31, y: 31 },
      });
      expect(chunkManager.convertGlobalToChunkLocalCoordinates(-32, -32)).toEqual({
        chunkCoordinate: { x: -1, y: -1 },
        localCoordinate: { x: 0, y: 0 },
      });
      expect(chunkManager.convertGlobalToChunkLocalCoordinates(-33, -33)).toEqual({
        chunkCoordinate: { x: -2, y: -2 },
        localCoordinate: { x: 31, y: 31 },
      });
    });
  });

  describe('convertChunkLocalToGlobalCoordinates', () => {
    it('should convert chunk and local coordinates to global coordinates correctly', () => {
      expect(chunkManager.convertChunkLocalToGlobalCoordinates(0, 0, 0, 0)).toEqual({ x: 0, y: 0 });
      expect(chunkManager.convertChunkLocalToGlobalCoordinates(0, 0, 31, 31)).toEqual({ x: 31, y: 31 });
      expect(chunkManager.convertChunkLocalToGlobalCoordinates(1, 0, 0, 0)).toEqual({ x: 32, y: 0 });
      expect(chunkManager.convertChunkLocalToGlobalCoordinates(1, 0, 31, 31)).toEqual({ x: 63, y: 31 });
      expect(chunkManager.convertChunkLocalToGlobalCoordinates(-1, -1, 0, 0)).toEqual({ x: -32, y: -32 });
      expect(chunkManager.convertChunkLocalToGlobalCoordinates(-1, -1, 31, 31)).toEqual({ x: -1, y: -1 });
    });
  });

  describe('getChunk', () => {
    it('should return an existing chunk or create a new one if it does not exist', async () => {
      const createdChunk = await chunkManager.getChunk(0, 0);
      expect(createdChunk).toBeInstanceOf(MockedChunk);
      expect(MockedChunk).toHaveBeenCalledWith(0, 0, CHUNK_SIZE, expect.any(Function), undefined, expect.any(Function));

      const retrievedChunk = await chunkManager.getChunk(0, 0);
      expect(retrievedChunk).toBe(createdChunk);
      expect(MockedChunk).toHaveBeenCalledTimes(1);
    });
  });

  describe('getChunkById', () => {
    it('should return an existing chunk by its ID after it has been created', async () => {
      const createdChunk = await chunkManager.getChunk(0, 0);
      const chunkId = chunkManager.getChunkId(0, 0);
      const retrievedChunk = chunkManager.getChunkById(chunkId);
      expect(retrievedChunk).toBe(createdChunk);
    });
  });

});
