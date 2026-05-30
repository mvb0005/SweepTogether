/**
 * Unit Tests for PlayerActionService - Chord Click Functionality
 * 
 * These tests focus on the handleChordClick function which processes player requests
 * to perform chord clicks in the infinite Minesweeper world.
 * 
 * A chord click is when a player clicks on a revealed numbered cell where the
 * number of adjacent flagged cells equals the cell's number, causing all adjacent
 * non-flagged cells to be revealed.
 * 
 * Test Coverage:
 * - Basic cases: 
 *   - Successfully chord clicking to reveal multiple cells
 *   - Chord clicking that reveals a mine (game over scenario)
 *   - Chord clicking with insufficient flags (no cells revealed)
 * - Edge cases:
 *   - Locked out player (action blocked)
 *   - Lockout period expiration (player unlocked)
 *   - Non-existent game (error handled)
 *   - Non-existent player (gracefully handled)
 *   - Error during chord click call (error handled)
 * 
 * Each test verifies:
 * 1. Correct calls to gridLogic.chordClick
 * 2. Proper state updates via GameStateService
 * 3. Appropriate client notifications via GameUpdateService
 * 4. Score calculations and player status management
 */

import { PlayerActionService } from '../../application/playerActionService';
import { GameStateService } from '../../application/gameStateService';
import { GameUpdateService } from '../../application/gameUpdateService';
import { ScoreService } from '../../application/scoreService';
import { EventBus } from '../../infrastructure/eventBus/EventBus';
import { SocketEventMap } from '../../infrastructure/network/socketEvents';
import { Cell, GameState, PlayerStatus, Player } from '../../domain/types';
import { CHUNK_SIZE } from '../../types/chunkTypes';

function globalToLocal(gx: number, gy: number) {
  return {
    chunkCoordinate: { x: Math.floor(gx / CHUNK_SIZE), y: Math.floor(gy / CHUNK_SIZE) },
    localCoordinate: {
      x: ((gx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE,
      y: ((gy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE,
    },
  };
}

function tileMapFromCells(cells: Cell[]): Map<string, Cell> {
  const map = new Map<string, Cell>();
  for (const cell of cells) map.set(`${cell.x},${cell.y}`, cell);
  return map;
}

function createMockChunkManager(cells: Cell[]) {
  const tiles = tileMapFromCells(cells);
  return {
    convertGlobalToChunkLocalCoordinates: jest.fn(globalToLocal),
    getChunk: jest.fn().mockImplementation(async (_cx: number, _cy: number) => ({
      getTile: (lx: number, ly: number) => tiles.get(`${lx},${ly}`),
      setTile: jest.fn((lx: number, ly: number, cell: Cell) => {
        tiles.set(`${lx},${ly}`, cell);
      }),
    })),
  };
}

describe('PlayerActionService - Chord Click', () => {
  // Mock objects
  let mockEventBus: jest.Mocked<EventBus<SocketEventMap>>;
  let mockGameStateService: jest.Mocked<Partial<GameStateService>> & {
    runGlobalFloodFill: jest.Mock;
    getChunkManager: jest.Mock;
  };
  let mockGameUpdateService: jest.Mocked<Partial<GameUpdateService>>;
    let mockScoreService: jest.Mocked<Partial<ScoreService>>;
  let playerActionService: PlayerActionService;
  
  // Common test data
  const gameId = 'test-game-id';
  const socketId = 'test-socket-id';
  const mockGame: GameState = {
    gameId,
    players: {},
    gameOver: false,
    mineReveals: [],
    pendingReveals: [],
    boardConfig: {
      rows: 10,
      cols: 10,
      mines: 10,
      isInfiniteWorld: true
    },
    scoringConfig: {
      firstPlacePoints: 5,
      secondPlacePoints: 3,
      thirdPlacePoints: 1,
      numberRevealPoints: 10,
      mineHitPenalty: 100,
      lockoutDurationMs: 5000,
      mineRevealDelayMs: 3000,
      flagPlacePoints: 2,  // Points for placing a flag
      flagRemovePoints: 0  // Points for removing a flag
    },
    spatialGrid: {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn()
    } as any
  };
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Set up mock objects
    mockEventBus = {
      subscribe: jest.fn(),
      publish: jest.fn()
    } as any;
    
    mockGameStateService = {
      getGame: jest.fn().mockReturnValue(mockGame),
      getCell: jest.fn(),
      updateGridCell: jest.fn(),
      updateGridCells: jest.fn(),
      runGlobalFloodFill: jest.fn().mockResolvedValue({ revealedCells: [], pendingFills: new Set() }),
      getChunkManager: jest.fn(),
    };
    
    mockGameUpdateService = {
      sendError: jest.fn(),
      sendPlayerStatusUpdate: jest.fn(),
      sendScoreUpdate: jest.fn(),
      sendTileUpdate: jest.fn(),
      sendTilesUpdate: jest.fn()
    };

      mockScoreService = {
          handleCellReveal: jest.fn().mockReturnValue(30),
          handleMineHit: jest.fn().mockReturnValue(-100),
          handleFlagToggle: jest.fn()
      };

    // Initialize the service with mocks
    playerActionService = new PlayerActionService(
      mockEventBus,
      mockGameStateService as any,
        mockGameUpdateService as any,
        mockScoreService as any
    );
  });
  
  describe('handleChordClick', () => {
    // Extract the bound handler function from the event subscription
    let handleChordClick: (payload: SocketEventMap['chordClick']) => Promise<void>;
    
    beforeEach(() => {
      // Get the bound handler function
      handleChordClick = mockEventBus.subscribe.mock.calls.find(
        call => call[0] === 'chordClick'
      )?.[1] as (payload: SocketEventMap['chordClick']) => Promise<void>;
      
      // Set up base game state with an active player
      const testPlayer: Player = {
        id: socketId,
        username: 'Test Player',
        status: PlayerStatus.ACTIVE,
        score: 0
      };
      
      mockGame.players = {
        [socketId]: testPlayer
      };
    });
    
    it('should successfully reveal multiple cells with chord click', async () => {
      const x = 5, y = 5;
      const revealedCells: Cell[] = [
        { x: 4, y: 4, isMine: false, adjacentMines: 1, revealed: true, flagged: false },
        { x: 6, y: 6, isMine: false, adjacentMines: 2, revealed: true, flagged: false },
        { x: 4, y: 6, isMine: false, adjacentMines: 0, revealed: true, flagged: false },
      ];

      mockGameStateService.getChunkManager.mockReturnValue(createMockChunkManager([
        { x: 5, y: 5, isMine: false, adjacentMines: 1, revealed: true, flagged: false },
        { x: 4, y: 4, isMine: false, adjacentMines: 0, revealed: false, flagged: true },
        { x: 4, y: 6, isMine: false, adjacentMines: 0, revealed: false, flagged: false },
      ]) as any);
      mockGameStateService.runGlobalFloodFill.mockResolvedValue({
        revealedCells,
        pendingFills: new Set(),
      });

      await handleChordClick({ gameId, socketId, x, y });

      expect(mockGameStateService.runGlobalFloodFill).toHaveBeenCalledWith(gameId, 4, 6, socketId);
      expect(mockScoreService.handleCellReveal).toHaveBeenCalledWith(
        gameId,
        socketId,
        revealedCells,
        'Chord Click Reveal',
      );
      expect(mockGameUpdateService.sendTilesUpdate).toHaveBeenCalledWith(
        gameId,
        [
          expect.objectContaining({ x: 4, y: 4, revealed: true, adjacentMines: 1 }),
          expect.objectContaining({ x: 6, y: 6, revealed: true, adjacentMines: 2 }),
          expect.objectContaining({ x: 4, y: 6, revealed: true, adjacentMines: 0 }),
        ],
      );
    });

    it('should handle revealing a mine with chord click', async () => {
      const x = 5, y = 5;
      const hitMineCell: Cell = {
        x: 6,
        y: 6,
        isMine: true,
        adjacentMines: 0,
        revealed: true,
        flagged: false,
      };

      mockGameStateService.getChunkManager.mockReturnValue(createMockChunkManager([
        { x: 5, y: 5, isMine: false, adjacentMines: 1, revealed: true, flagged: false },
        { x: 4, y: 4, isMine: false, adjacentMines: 0, revealed: false, flagged: true },
        { x: 6, y: 6, isMine: true, adjacentMines: 0, revealed: false, flagged: false },
      ]) as any);

      await handleChordClick({ gameId, socketId, x, y });

      expect(mockGameStateService.runGlobalFloodFill).not.toHaveBeenCalled();
      expect(mockGameUpdateService.sendPlayerStatusUpdate).toHaveBeenCalledWith(
        gameId,
        socketId,
        PlayerStatus.LOCKED_OUT,
        expect.any(Number),
      );
      expect(mockScoreService.handleMineHit).toHaveBeenCalledWith(
        gameId,
        socketId,
        'Hit Mine (Chord Click)',
      );
      expect(mockGameStateService.updateGridCell).toHaveBeenCalledWith(
        gameId,
        hitMineCell,
      );
      expect(mockGameUpdateService.sendTileUpdate).toHaveBeenCalledWith(
        gameId,
        expect.objectContaining({
          x: 6,
          y: 6,
          revealed: true,
          isMine: true,
        }),
      );
    });

    it('should do nothing when chord click does not reveal any cells', async () => {
      const x = 5, y = 5;

      mockGameStateService.getChunkManager.mockReturnValue(createMockChunkManager([
        { x: 5, y: 5, isMine: false, adjacentMines: 2, revealed: true, flagged: false },
        { x: 4, y: 4, isMine: false, adjacentMines: 0, revealed: false, flagged: true },
        { x: 4, y: 6, isMine: false, adjacentMines: 0, revealed: false, flagged: false },
      ]) as any);

      await handleChordClick({ gameId, socketId, x, y });

      expect(mockGameStateService.runGlobalFloodFill).not.toHaveBeenCalled();
      expect(mockScoreService.handleCellReveal).not.toHaveBeenCalled();
      expect(mockGameUpdateService.sendTilesUpdate).not.toHaveBeenCalled();
    });
    
    it('should not allow action when player is locked out', async () => {
      // Arrange
      const x = 5, y = 5;
      
      // Set player status to locked out
      mockGame.players[socketId].status = PlayerStatus.LOCKED_OUT;
      mockGame.players[socketId].lockedUntil = Date.now() + 5000; // Locked for 5 more seconds
      
      // Act
      await handleChordClick({ gameId, socketId, x, y });
      
      // Assert
      // Should not run flood fill
      expect(mockGameStateService.runGlobalFloodFill).not.toHaveBeenCalled();
    });

    it('should unlock player if lockout period has expired', async () => {
      const x = 5, y = 5;
      const revealedCell: Cell = {
        x: 4,
        y: 6,
        isMine: false,
        adjacentMines: 0,
        revealed: true,
        flagged: false,
      };

      mockGame.players[socketId].status = PlayerStatus.LOCKED_OUT;
      mockGame.players[socketId].lockedUntil = Date.now() - 1000;

      mockGameStateService.getChunkManager.mockReturnValue(createMockChunkManager([
        { x: 5, y: 5, isMine: false, adjacentMines: 1, revealed: true, flagged: false },
        { x: 4, y: 4, isMine: false, adjacentMines: 0, revealed: false, flagged: true },
        { x: 4, y: 6, isMine: false, adjacentMines: 0, revealed: false, flagged: false },
      ]) as any);
      mockGameStateService.runGlobalFloodFill.mockResolvedValue({
        revealedCells: [revealedCell],
        pendingFills: new Set(),
      });

      await handleChordClick({ gameId, socketId, x, y });

      expect(mockGameUpdateService.sendPlayerStatusUpdate).toHaveBeenCalledWith(
        gameId,
        socketId,
        PlayerStatus.ACTIVE,
      );
      expect(mockGameStateService.runGlobalFloodFill).toHaveBeenCalled();
    });
    
    it('should handle gracefully when game is not found', async () => {
      // Arrange
      const x = 5, y = 5;
      
      // Mock getGame to return undefined (game not found)
      (mockGameStateService.getGame as jest.Mock).mockReturnValueOnce(undefined);
      
      // Act
      await handleChordClick({ gameId, socketId, x, y });
      
      // Assert
      // Should send error
      expect(mockGameUpdateService.sendError).toHaveBeenCalledWith(
        socketId,
        'Game not found.'
      );
      
      // Should not run flood fill
      expect(mockGameStateService.runGlobalFloodFill).not.toHaveBeenCalled();
    });

    it('should handle gracefully when player is not found in game', async () => {
      const x = 5, y = 5;
      const nonExistentSocketId = 'non-existent-socket-id';

      await handleChordClick({ gameId, socketId: nonExistentSocketId, x, y });

      expect(mockGameStateService.runGlobalFloodFill).not.toHaveBeenCalled();
    });

    it('should handle error during chord click', async () => {
      const x = 5, y = 5;

      mockGameStateService.getChunkManager.mockImplementation(() => {
        throw new Error('Test error');
      });

      await handleChordClick({ gameId, socketId, x, y });

      expect(mockGameUpdateService.sendError).toHaveBeenCalledWith(
        socketId,
        'Failed to perform chord click',
      );
    });
  });
});