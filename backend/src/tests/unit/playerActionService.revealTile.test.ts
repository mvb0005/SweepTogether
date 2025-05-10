/**
 * Unit Tests for PlayerActionService
 * 
 * These tests focus on the handleRevealTile function which processes player requests
 * to reveal cells in the infinite Minesweeper world.
 * 
 * Test Coverage:
 * - Basic case: Successfully revealing a non-mine cell
 * - Mine hit case: Revealing a mine, verifying player lockout, score deduction, and notifications
 * - Flood fill case: Revealing a zero-adjacent-mines cell, triggering multiple cell reveals
 * - Edge cases:
 *   - Already revealed cell (no action taken)
 *   - Locked out player (action blocked)
 *   - Lockout period expiration (player unlocked)
 *   - Non-existent game (error handled)
 *   - Non-existent player (gracefully handled)
 *   - Error during reveal call (error handled)
 * 
 * Each test verifies:
 * 1. Correct calls to gridLogic.revealCell
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
import { Cell, GameState, PlayerStatus, GameConfig, ScoringConfig, Player } from '../../domain/types';
import * as gridLogic from '../../domain/gridLogic';

// Mock dependencies
jest.mock('../../domain/gridLogic');
jest.mock('../../application/scoreService');

// Define mock instances for Chunk and BoardManager
const mockChunkInstance = {
  revealCell: jest.fn(),
  flagCell: jest.fn(),
  chordCell: jest.fn(),
  getCell: jest.fn(),
  getTile: jest.fn(),
  addPendingFill: jest.fn(), // Added addPendingFill
};

const mockBoardManagerInstance = {
  revealTile: jest.fn(),
  flagTile: jest.fn(),
  chordTile: jest.fn(),
  convertGlobalToChunkLocalCoordinates: jest.fn(),
  getChunk: jest.fn().mockReturnValue(mockChunkInstance),
};

describe('PlayerActionService', () => {
  // Mock objects
  let mockEventBus: jest.Mocked<EventBus<SocketEventMap>>;
  let mockGameStateService: jest.Mocked<Partial<GameStateService>>;
  let mockGameUpdateService: jest.Mocked<Partial<GameUpdateService>>;
  let mockScoreService: jest.Mocked<ScoreService>;
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
      flagPlacePoints: 2,
      flagRemovePoints: 0
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

    // Explicitly reset methods on our plain mock objects
    mockBoardManagerInstance.revealTile.mockReset();
    mockBoardManagerInstance.flagTile.mockReset();
    mockBoardManagerInstance.chordTile.mockReset();
    mockBoardManagerInstance.convertGlobalToChunkLocalCoordinates.mockReset();
    mockBoardManagerInstance.getChunk.mockReset().mockReturnValue(mockChunkInstance);
    mockChunkInstance.revealCell.mockReset();
    mockChunkInstance.flagCell.mockReset();
    mockChunkInstance.chordCell.mockReset();
    mockChunkInstance.getCell.mockReset();
    mockChunkInstance.getTile.mockReset().mockResolvedValue({ x: 0, y: 0, isMine: false, revealed: false, flagged: false, adjacentMines: 0 });
    mockChunkInstance.addPendingFill.mockReset(); // Added reset for addPendingFill

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
      getBoardManager: jest.fn().mockReturnValue(mockBoardManagerInstance),
      setPlayerStatus: jest.fn(),
    };
    
    mockGameUpdateService = {
      sendError: jest.fn(),
      sendPlayerStatusUpdate: jest.fn(),
      sendScoreUpdate: jest.fn(),
      sendTileUpdate: jest.fn(),
      sendTilesUpdate: jest.fn()
    };
    
    mockScoreService = {
      handleCellReveal: jest.fn(),
      handleMineHit: jest.fn(),
      handleFlagToggle: jest.fn()
    } as unknown as jest.Mocked<ScoreService>;

    mockScoreService.handleCellReveal.mockReturnValue(10);
    mockScoreService.handleMineHit.mockReturnValue(-100);

    playerActionService = new PlayerActionService(
      mockEventBus,
      mockGameStateService as any,
      mockGameUpdateService as any,
      mockScoreService
    );
  });
  
  describe('handleRevealTile', () => {
    let handleRevealTile: (payload: SocketEventMap['revealTile']) => Promise<void>;
    
    beforeEach(() => {
      handleRevealTile = mockEventBus.subscribe.mock.calls.find(
        call => call[0] === 'revealTile'
      )?.[1] as (payload: SocketEventMap['revealTile']) => Promise<void>;
      
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
    
    it('should reveal a non-mine cell successfully', async () => {
      const x = 5, y = 5;
      const revealedCell: Cell = {
        x, y,
        isMine: false,
        adjacentMines: 2,
        revealed: true,
        flagged: false
      };
      
      mockBoardManagerInstance.convertGlobalToChunkLocalCoordinates.mockReturnValue({
        chunkCoordinate: { x: 0, y: 0 },
        localCoordinate: { x: 5, y: 5 }
      });
      mockChunkInstance.revealCell.mockResolvedValue([revealedCell]);
      
      await handleRevealTile({ gameId, socketId, x, y });
      
      expect(mockBoardManagerInstance.convertGlobalToChunkLocalCoordinates).toHaveBeenCalledWith(x, y);
      expect(mockBoardManagerInstance.getChunk).toHaveBeenCalledWith(0, 0);
      expect(mockChunkInstance.revealCell).toHaveBeenCalledWith(5, 5, false);
      expect(mockGameStateService.updateGridCells).toHaveBeenCalledWith(
        gameId,
        [revealedCell]
      );
      expect(mockScoreService.handleCellReveal).toHaveBeenCalledWith(
        gameId,
        socketId,
        [revealedCell]
      );
      expect(mockGameUpdateService.sendTilesUpdate).toHaveBeenCalledWith(
        gameId,
        [expect.objectContaining({ 
          x,
          y,
          revealed: true,
          adjacentMines: 2
        })]
      );
    });
    
    it('should handle revealing a mine cell correctly', async () => {
      const x = 5, y = 5;
      const hitMineCell: Cell = {
        x, y,
        isMine: true,
        adjacentMines: 0,
        revealed: true,
        flagged: false
      };
      
      mockBoardManagerInstance.convertGlobalToChunkLocalCoordinates.mockReturnValue({
        chunkCoordinate: { x: 0, y: 0 },
        localCoordinate: { x: 5, y: 5 }
      });
      mockChunkInstance.revealCell.mockResolvedValue({ hitMine: hitMineCell });
      
      await handleRevealTile({ gameId, socketId, x, y });
      
      expect(mockBoardManagerInstance.convertGlobalToChunkLocalCoordinates).toHaveBeenCalledWith(x, y);
      expect(mockBoardManagerInstance.getChunk).toHaveBeenCalledWith(0, 0);
      expect(mockChunkInstance.revealCell).toHaveBeenCalledWith(5, 5, false);
      expect(mockGameUpdateService.sendPlayerStatusUpdate).toHaveBeenCalledWith(
        gameId,
        socketId,
        PlayerStatus.LOCKED_OUT,
        expect.any(Number)
      );
      expect(mockScoreService.handleMineHit).toHaveBeenCalledWith(
        gameId,
        socketId
      );
      expect(mockGameStateService.updateGridCell).toHaveBeenCalledWith(
        gameId,
        hitMineCell
      );
      expect(mockGameUpdateService.sendTileUpdate).toHaveBeenCalledWith(
        gameId,
        expect.objectContaining({
          x,
          y,
          revealed: true,
          isMine: true
        })
      );
    });
    
    it('should handle flood fill when revealing a cell with 0 adjacentMines', async () => {
      const x = 5, y = 5;
      const floodFillCells: Cell[] = [
        { x: 5, y: 5, isMine: false, adjacentMines: 0, revealed: true, flagged: false },
        { x: 4, y: 5, isMine: false, adjacentMines: 0, revealed: true, flagged: false },
        { x: 6, y: 5, isMine: false, adjacentMines: 0, revealed: true, flagged: false },
        { x: 5, y: 4, isMine: false, adjacentMines: 1, revealed: true, flagged: false },
        { x: 5, y: 6, isMine: false, adjacentMines: 0, revealed: true, flagged: false }
      ];
      
      mockBoardManagerInstance.convertGlobalToChunkLocalCoordinates.mockReturnValue({
        chunkCoordinate: { x: 0, y: 0 },
        localCoordinate: { x: 5, y: 5 }
      });
      mockChunkInstance.revealCell.mockResolvedValue(floodFillCells);
      mockScoreService.handleCellReveal.mockReturnValue(50);
      
      await handleRevealTile({ gameId, socketId, x, y });
      
      expect(mockBoardManagerInstance.convertGlobalToChunkLocalCoordinates).toHaveBeenCalledWith(x, y);
      expect(mockBoardManagerInstance.getChunk).toHaveBeenCalledWith(0, 0);
      expect(mockChunkInstance.revealCell).toHaveBeenCalledWith(5, 5, false);
      expect(mockGameStateService.updateGridCells).toHaveBeenCalledWith(
        gameId,
        floodFillCells
      );
      expect(mockScoreService.handleCellReveal).toHaveBeenCalledWith(
        gameId,
        socketId,
        floodFillCells
      );
      expect(mockGameUpdateService.sendTilesUpdate).toHaveBeenCalledWith(
        gameId,
        expect.arrayContaining([
          expect.objectContaining({ x: 5, y: 5 }),
          expect.objectContaining({ x: 4, y: 5 }),
          expect.objectContaining({ x: 6, y: 5 }),
          expect.objectContaining({ x: 5, y: 4 }),
          expect.objectContaining({ x: 5, y: 6 })
        ])
      );
    });
    
    it('should do nothing when revealing an already revealed cell', async () => {
      const x = 5, y = 5;
      
      mockBoardManagerInstance.convertGlobalToChunkLocalCoordinates.mockReturnValue({
        chunkCoordinate: { x: 0, y: 0 },
        localCoordinate: { x: 5, y: 5 }
      });
      mockChunkInstance.revealCell.mockResolvedValue([]);
      
      await handleRevealTile({ gameId, socketId, x, y });
      
      expect(mockBoardManagerInstance.convertGlobalToChunkLocalCoordinates).toHaveBeenCalledWith(x, y);
      expect(mockBoardManagerInstance.getChunk).toHaveBeenCalledWith(0, 0);
      expect(mockChunkInstance.revealCell).toHaveBeenCalledWith(5, 5, false);
      expect(mockGameStateService.updateGridCells).not.toHaveBeenCalled();
      expect(mockGameUpdateService.sendScoreUpdate).not.toHaveBeenCalled();
      expect(mockGameUpdateService.sendTilesUpdate).not.toHaveBeenCalled();
    });
    
    it('should not allow action when player is locked out', async () => {
      const x = 5, y = 5;
      
      mockGame.players[socketId].status = PlayerStatus.LOCKED_OUT;
      mockGame.players[socketId].lockedUntil = Date.now() + 5000;
      
      await handleRevealTile({ gameId, socketId, x, y });
      
      expect(mockBoardManagerInstance.convertGlobalToChunkLocalCoordinates).not.toHaveBeenCalled();
      expect(mockChunkInstance.revealCell).not.toHaveBeenCalled();
    });
    
    it('should unlock player if lockout period has expired', async () => {
      const x = 5, y = 5;
      const revealedCell: Cell = {
        x, y,
        isMine: false,
        adjacentMines: 2,
        revealed: true,
        flagged: false
      };
      
      mockGame.players[socketId].status = PlayerStatus.LOCKED_OUT;
      mockGame.players[socketId].lockedUntil = Date.now() - 1000;
      
      mockBoardManagerInstance.convertGlobalToChunkLocalCoordinates.mockReturnValue({
        chunkCoordinate: { x: 0, y: 0 },
        localCoordinate: { x: 5, y: 5 }
      });
      mockChunkInstance.revealCell.mockResolvedValue([revealedCell]);
      
      await handleRevealTile({ gameId, socketId, x, y });
      
      expect(mockGameUpdateService.sendPlayerStatusUpdate).toHaveBeenCalledWith(
        gameId,
        socketId,
        PlayerStatus.ACTIVE
      );
      expect(mockBoardManagerInstance.convertGlobalToChunkLocalCoordinates).toHaveBeenCalledWith(x, y);
      expect(mockBoardManagerInstance.getChunk).toHaveBeenCalledWith(0, 0);
      expect(mockChunkInstance.revealCell).toHaveBeenCalledWith(5, 5, false);
    });
    
    it('should handle gracefully when game is not found', async () => {
      const x = 5, y = 5;
      
      (mockGameStateService.getGame as jest.Mock).mockReturnValueOnce(undefined);
      
      await handleRevealTile({ gameId, socketId, x, y });
      
      expect(mockGameUpdateService.sendError).toHaveBeenCalledWith(
        socketId,
        'Game not found.'
      );
      expect(mockBoardManagerInstance.convertGlobalToChunkLocalCoordinates).not.toHaveBeenCalled();
      expect(mockChunkInstance.revealCell).not.toHaveBeenCalled();
    });
    
    it('should handle gracefully when player is not found in game', async () => {
      const x = 5, y = 5;
      const nonExistentSocketId = 'non-existent-socket-id';
      
      await handleRevealTile({ gameId, socketId: nonExistentSocketId, x, y });
      
      expect(mockBoardManagerInstance.convertGlobalToChunkLocalCoordinates).not.toHaveBeenCalled();
      expect(mockChunkInstance.revealCell).not.toHaveBeenCalled();
    });
    
    it('should handle error during revealCell call if boardManager.getChunk returns undefined', async () => {
      const x = 5, y = 5;
      mockBoardManagerInstance.convertGlobalToChunkLocalCoordinates.mockReturnValue({
        chunkCoordinate: { x: 0, y: 0 },
        localCoordinate: { x: 5, y: 5 }
      });
      mockBoardManagerInstance.getChunk.mockReturnValueOnce(undefined as any);

      await handleRevealTile({ gameId, socketId, x, y });

      expect(mockGameUpdateService.sendError).toHaveBeenCalledWith(
        socketId,
        'Internal server error: Target chunk not found.' // Corrected error message
      );
      expect(mockChunkInstance.revealCell).not.toHaveBeenCalled();
    });
    
    it('should handle error during chunk.revealCell call', async () => {
      const x = 5, y = 5;
      
      mockBoardManagerInstance.convertGlobalToChunkLocalCoordinates.mockReturnValue({
        chunkCoordinate: { x: 0, y: 0 },
        localCoordinate: { x: 5, y: 5 }
      });
      mockChunkInstance.revealCell.mockRejectedValue(new Error('Chunk reveal error'));
      
      await handleRevealTile({ gameId, socketId, x, y });
      
      expect(mockGameUpdateService.sendError).toHaveBeenCalledWith(
        socketId,
        'Failed to reveal tile.'
      );
    });
  });
});