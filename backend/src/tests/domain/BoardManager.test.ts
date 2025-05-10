import { BoardManager } from '../../domain/BoardManager';
import { Chunk } from '../../domain/Chunk';
import { CHUNK_SIZE } from '../../types/chunkTypes';
import { IChunk } from '../../types/chunkTypes';

// Mock the Chunk class
jest.mock('../../domain/Chunk');

const MockedChunk = Chunk as jest.MockedClass<typeof Chunk>;

describe('BoardManager', () => {
  let boardManager: BoardManager;
  const defaultCellGenerator = expect.any(Function); // Placeholder for the default generator

  beforeEach(() => {
    MockedChunk.mockClear();
    boardManager = new BoardManager(CHUNK_SIZE, defaultCellGenerator);
  });

  describe('constructor', () => {
    it('should initialize correctly', () => {
      expect(boardManager).toBeDefined();
      const chunk = boardManager.getChunk(0, 0);
      expect(MockedChunk).toHaveBeenCalledTimes(1);
      expect(chunk).toBeInstanceOf(MockedChunk);
    });
  });

  describe('getChunkId', () => {
    it('should return the correct chunk ID string', () => {
      expect(boardManager.getChunkId(0, 0)).toBe('0_0');
      expect(boardManager.getChunkId(1, 2)).toBe('1_2');
      expect(boardManager.getChunkId(-1, -5)).toBe('-1_-5');
    });
  });

  describe('convertGlobalToChunkCoordinates', () => {
    it('should convert global coordinates to chunk coordinates correctly', () => {
      expect(boardManager.convertGlobalToChunkCoordinates(0, 0)).toEqual({ x: 0, y: 0 });
      expect(boardManager.convertGlobalToChunkCoordinates(15, 15)).toEqual({ x: 0, y: 0 });
      expect(boardManager.convertGlobalToChunkCoordinates(16, 0)).toEqual({ x: 1, y: 0 });
      expect(boardManager.convertGlobalToChunkCoordinates(0, 16)).toEqual({ x: 0, y: 1 });
      expect(boardManager.convertGlobalToChunkCoordinates(31, 31)).toEqual({ x: 1, y: 1 });
      expect(boardManager.convertGlobalToChunkCoordinates(32, 32)).toEqual({ x: 2, y: 2 });
      expect(boardManager.convertGlobalToChunkCoordinates(-1, -1)).toEqual({ x: -1, y: -1 });
      expect(boardManager.convertGlobalToChunkCoordinates(-16, -16)).toEqual({ x: -1, y: -1 });
      expect(boardManager.convertGlobalToChunkCoordinates(-17, -17)).toEqual({ x: -2, y: -2 });
    });
  });

  describe('convertGlobalToChunkLocalCoordinates', () => {
    it('should convert global coordinates to chunk and local coordinates correctly', () => {
      expect(boardManager.convertGlobalToChunkLocalCoordinates(0, 0)).toEqual({
        chunkCoordinate: { x: 0, y: 0 },
        localCoordinate: { x: 0, y: 0 },
      });
      expect(boardManager.convertGlobalToChunkLocalCoordinates(15, 15)).toEqual({
        chunkCoordinate: { x: 0, y: 0 },
        localCoordinate: { x: 15, y: 15 },
      });
      expect(boardManager.convertGlobalToChunkLocalCoordinates(16, 0)).toEqual({
        chunkCoordinate: { x: 1, y: 0 },
        localCoordinate: { x: 0, y: 0 },
      });
      expect(boardManager.convertGlobalToChunkLocalCoordinates(31, 15)).toEqual({
        chunkCoordinate: { x: 1, y: 0 },
        localCoordinate: { x: 15, y: 15 },
      });
      expect(boardManager.convertGlobalToChunkLocalCoordinates(0, 16)).toEqual({
        chunkCoordinate: { x: 0, y: 1 },
        localCoordinate: { x: 0, y: 0 },
      });
      expect(boardManager.convertGlobalToChunkLocalCoordinates(-1, -1)).toEqual({
        chunkCoordinate: { x: -1, y: -1 },
        localCoordinate: { x: 15, y: 15 },
      });
      expect(boardManager.convertGlobalToChunkLocalCoordinates(-16, -16)).toEqual({
        chunkCoordinate: { x: -1, y: -1 },
        localCoordinate: { x: 0, y: 0 },
      });
      expect(boardManager.convertGlobalToChunkLocalCoordinates(-17, -17)).toEqual({
        chunkCoordinate: { x: -2, y: -2 },
        localCoordinate: { x: 15, y: 15 },
      });
    });
  });

  describe('convertChunkLocalToGlobalCoordinates', () => {
    it('should convert chunk and local coordinates to global coordinates correctly', () => {
      expect(boardManager.convertChunkLocalToGlobalCoordinates(0, 0, 0, 0)).toEqual({ x: 0, y: 0 });
      expect(boardManager.convertChunkLocalToGlobalCoordinates(0, 0, 15, 15)).toEqual({ x: 15, y: 15 });
      expect(boardManager.convertChunkLocalToGlobalCoordinates(1, 0, 0, 0)).toEqual({ x: 16, y: 0 });
      expect(boardManager.convertChunkLocalToGlobalCoordinates(1, 0, 15, 15)).toEqual({ x: 31, y: 15 });
      expect(boardManager.convertChunkLocalToGlobalCoordinates(-1, -1, 0, 0)).toEqual({ x: -16, y: -16 });
      expect(boardManager.convertChunkLocalToGlobalCoordinates(-1, -1, 15, 15)).toEqual({ x: -1, y: -1 });
    });
  });

  describe('getChunk', () => {
    it('should return an existing chunk or create a new one if it does not exist', () => {
      const createdChunk = boardManager.getChunk(0, 0);
      expect(createdChunk).toBeInstanceOf(MockedChunk);
      expect(MockedChunk).toHaveBeenCalledWith(0, 0, CHUNK_SIZE, defaultCellGenerator);

      const retrievedChunk = boardManager.getChunk(0, 0);
      expect(retrievedChunk).toBe(createdChunk);
      expect(MockedChunk).toHaveBeenCalledTimes(1);
    });
  });

  describe('getChunkById', () => {
    it('should return an existing chunk by its ID after it has been created', () => {
      const createdChunk = boardManager.getChunk(0, 0);
      const chunkId = boardManager.getChunkId(0, 0);
      const retrievedChunk = boardManager.getChunkById(chunkId);
      expect(retrievedChunk).toBe(createdChunk);
    });
  });

  describe('propagateFillToNeighbor', () => {
    let sourceChunk: Chunk;
    let sourceChunkId: string;

    beforeEach(() => {
      sourceChunkId = boardManager.getChunkId(0, 0);
      sourceChunk = boardManager.getChunk(0, 0) as jest.Mocked<IChunk>;
      MockedChunk.mockClear();
    });

    it('should create a neighbor chunk if it does not exist and add pending fill', () => {
      const neighborChunkX = 1;
      const neighborChunkY = 0;
      const entryLocalX = 0;
      const entryLocalY = 5;
      const hint = 0;

      const mockAddPendingFill = jest.fn();
      const mockNeighborChunkInstance = {
        addPendingFill: mockAddPendingFill,
        id: boardManager.getChunkId(neighborChunkX, neighborChunkY),
      } as unknown as jest.Mocked<IChunk>;

      MockedChunk.mockImplementationOnce(() => mockNeighborChunkInstance);

      boardManager.propagateFillToNeighbor(sourceChunkId, neighborChunkX, neighborChunkY, entryLocalX, entryLocalY, hint);

      expect(MockedChunk).toHaveBeenCalledTimes(1);
      expect(MockedChunk).toHaveBeenCalledWith(neighborChunkX, neighborChunkY, CHUNK_SIZE, defaultCellGenerator);

      const retrievedNeighbor = boardManager.getChunkById(boardManager.getChunkId(neighborChunkX, neighborChunkY));
      expect(retrievedNeighbor).toBe(mockNeighborChunkInstance);

      expect(mockAddPendingFill).toHaveBeenCalledTimes(1);
      expect(mockAddPendingFill).toHaveBeenCalledWith(entryLocalX, entryLocalY, hint);
    });

    it('should use an existing neighbor chunk and add pending fill', () => {
      const neighborChunkX = 0;
      const neighborChunkY = 1;
      const entryLocalX = 5;
      const entryLocalY = 0;
      const hint = 1;

      const mockAddPendingFill = jest.fn();
      const existingNeighborChunkInstance = {
        addPendingFill: mockAddPendingFill,
        id: boardManager.getChunkId(neighborChunkX, neighborChunkY),
      } as unknown as jest.Mocked<IChunk>;

      MockedChunk.mockImplementationOnce(() => existingNeighborChunkInstance);
      boardManager.getChunk(neighborChunkX, neighborChunkY);
      MockedChunk.mockClear();

      boardManager.propagateFillToNeighbor(sourceChunkId, neighborChunkX, neighborChunkY, entryLocalX, entryLocalY, hint);

      expect(MockedChunk).not.toHaveBeenCalled();
      expect(mockAddPendingFill).toHaveBeenCalledTimes(1);
      expect(mockAddPendingFill).toHaveBeenCalledWith(entryLocalX, entryLocalY, hint);
    });

    it('should not propagate back to the source chunk if fromChunkId matches target chunkId', () => {
      const entryLocalX = 0;
      const entryLocalY = 0;
      const hint = 0;

      const mockAddPendingFillOnSource = jest.fn();
      (sourceChunk as any).addPendingFill = mockAddPendingFillOnSource;

      boardManager.propagateFillToNeighbor(sourceChunkId, 0, 0, entryLocalX, entryLocalY, hint);

      expect(MockedChunk).not.toHaveBeenCalled();
      expect(mockAddPendingFillOnSource).not.toHaveBeenCalled();
    });
  });
});
