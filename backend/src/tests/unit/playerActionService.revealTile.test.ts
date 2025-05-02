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
const mockedGridLogic = gridLogic as jest.Mocked<typeof gridLogic>;

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
      flagPlacePoints: 2,     // Points for placing a flag
      flagRemovePoints: 0     // Points for removing a flag
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
      updateGridCells: jest.fn()
    };
    
    mockGameUpdateService = {
      sendError: jest.fn(),
      sendPlayerStatusUpdate: jest.fn(),
      sendScoreUpdate: jest.fn(),
      sendTileUpdate: jest.fn(),
      sendTilesUpdate: jest.fn()
    };
    
    // Create proper Jest mock for ScoreService
    mockScoreService = {
      handleCellReveal: jest.fn(),
      handleMineHit: jest.fn(),
      handleFlagToggle: jest.fn()
    } as unknown as jest.Mocked<ScoreService>;

    // Set return values for the mock functions
    mockScoreService.handleCellReveal.mockReturnValue(10); // Default return for single cell reveal
    mockScoreService.handleMineHit.mockReturnValue(-100); // Default return for mine hit

    // Initialize the service with mocks
    playerActionService = new PlayerActionService(
      mockEventBus,
      mockGameStateService as any,
      mockGameUpdateService as any,
      mockScoreService
    );
  });
  
  describe('handleRevealTile', () => {
    // Extract the bound handler function from the event subscription
    let handleRevealTile: (payload: SocketEventMap['revealTile']) => Promise<void>;
    
    beforeEach(() => {
      // Get the bound handler function
      handleRevealTile = mockEventBus.subscribe.mock.calls.find(
        call => call[0] === 'revealTile'
      )?.[1] as (payload: SocketEventMap['revealTile']) => Promise<void>;
      
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
    
    it('should reveal a non-mine cell successfully', async () => {
      // Arrange
      const x = 5, y = 5;
      const revealedCell: Cell = {
        x, y,
        isMine: false,
        adjacentMines: 2,
        revealed: true,
        flagged: false
      };
      
      // Mock gridLogic.revealCell to return an array with one non-mine cell
      mockedGridLogic.revealCell.mockResolvedValue([revealedCell]);
      
      // Act
      await handleRevealTile({ gameId, socketId, x, y });
      
      // Assert
      // Check if revealCell was called with the right parameters
      expect(mockedGridLogic.revealCell).toHaveBeenCalledWith(
        mockGame,
        x,
        y,
        mockGameStateService.getCell
      );
      
      // Check if game state was updated
      expect(mockGameStateService.updateGridCells).toHaveBeenCalledWith(
        gameId,
        [revealedCell]
      );
      
      // Check if score service was called
      expect(mockScoreService.handleCellReveal).toHaveBeenCalledWith(
        gameId,
        socketId,
        [revealedCell]
      );
      
      // Check if tile update was sent
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
      // Arrange
      const x = 5, y = 5;
      const hitMineCell: Cell = {
        x, y,
        isMine: true,
        adjacentMines: 0,
        revealed: true,
        flagged: false
      };
      
      // Mock revealCell to return a MineHitResult
      mockedGridLogic.revealCell.mockResolvedValue({ hitMine: hitMineCell });
      
      // Act
      await handleRevealTile({ gameId, socketId, x, y });
      
      // Assert
      // Check if revealCell was called
      expect(mockedGridLogic.revealCell).toHaveBeenCalled();
      
      // Check if player status was updated to locked out
      expect(mockGameUpdateService.sendPlayerStatusUpdate).toHaveBeenCalledWith(
        gameId,
        socketId,
        PlayerStatus.LOCKED_OUT,
        expect.any(Number) // lockoutUntil timestamp
      );
      
      // Check if score service was called
      expect(mockScoreService.handleMineHit).toHaveBeenCalledWith(
        gameId,
        socketId
      );
      
      // Check if mine cell was updated
      expect(mockGameStateService.updateGridCell).toHaveBeenCalledWith(
        gameId,
        hitMineCell
      );
      
      // Check if tile update was sent with mine data
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
      // Arrange
      const x = 5, y = 5;
      // Create multiple cells for flood fill simulation
      const floodFillCells: Cell[] = [
        { x: 5, y: 5, isMine: false, adjacentMines: 0, revealed: true, flagged: false },
        { x: 4, y: 5, isMine: false, adjacentMines: 0, revealed: true, flagged: false },
        { x: 6, y: 5, isMine: false, adjacentMines: 0, revealed: true, flagged: false },
        { x: 5, y: 4, isMine: false, adjacentMines: 1, revealed: true, flagged: false },
        { x: 5, y: 6, isMine: false, adjacentMines: 0, revealed: true, flagged: false }
      ];
      
      // Mock revealCell to return multiple cells (flood fill)
      mockedGridLogic.revealCell.mockResolvedValue(floodFillCells);
      mockScoreService.handleCellReveal.mockReturnValue(50); // 5 cells * 10 points
      
      // Act
      await handleRevealTile({ gameId, socketId, x, y });
      
      // Assert
      // Check if revealCell was called
      expect(mockedGridLogic.revealCell).toHaveBeenCalled();
      
      // Check if all cells were updated
      expect(mockGameStateService.updateGridCells).toHaveBeenCalledWith(
        gameId,
        floodFillCells
      );
      
      // Check if score service was called with all cells
      expect(mockScoreService.handleCellReveal).toHaveBeenCalledWith(
        gameId,
        socketId,
        floodFillCells
      );
      
      // Check if updates for all tiles were sent
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
      // Arrange
      const x = 5, y = 5;
      
      // Mock revealCell to return an empty array (nothing to reveal)
      mockedGridLogic.revealCell.mockResolvedValue([]);
      
      // Act
      await handleRevealTile({ gameId, socketId, x, y });
      
      // Assert
      expect(mockedGridLogic.revealCell).toHaveBeenCalled();
      
      // None of the update methods should be called
      expect(mockGameStateService.updateGridCells).not.toHaveBeenCalled();
      expect(mockGameUpdateService.sendScoreUpdate).not.toHaveBeenCalled();
      expect(mockGameUpdateService.sendTilesUpdate).not.toHaveBeenCalled();
    });
    
    it('should not allow action when player is locked out', async () => {
      // Arrange
      const x = 5, y = 5;
      
      // Set player status to locked out
      mockGame.players[socketId].status = PlayerStatus.LOCKED_OUT;
      mockGame.players[socketId].lockedUntil = Date.now() + 5000; // Locked for 5 more seconds
      
      // Act
      await handleRevealTile({ gameId, socketId, x, y });
      
      // Assert
      // Should not call revealCell
      expect(mockedGridLogic.revealCell).not.toHaveBeenCalled();
    });
    
    it('should unlock player if lockout period has expired', async () => {
      // Arrange
      const x = 5, y = 5;
      const revealedCell: Cell = {
        x, y,
        isMine: false,
        adjacentMines: 2,
        revealed: true,
        flagged: false
      };
      
      // Set player status to locked out but with expired lock time
      mockGame.players[socketId].status = PlayerStatus.LOCKED_OUT;
      mockGame.players[socketId].lockedUntil = Date.now() - 1000; // Lock expired 1 second ago
      
      // Mock revealCell to return a non-mine cell
      mockedGridLogic.revealCell.mockResolvedValue([revealedCell]);
      
      // Act
      await handleRevealTile({ gameId, socketId, x, y });
      
      // Assert
      // Player status should be updated to ACTIVE
      expect(mockGameUpdateService.sendPlayerStatusUpdate).toHaveBeenCalledWith(
        gameId,
        socketId,
        PlayerStatus.ACTIVE
      );
      
      // revealCell should be called after player is unlocked
      expect(mockedGridLogic.revealCell).toHaveBeenCalled();
    });
    
    it('should handle gracefully when game is not found', async () => {
      // Arrange
      const x = 5, y = 5;
      
      // Mock getGame to return undefined (game not found)
      (mockGameStateService.getGame as jest.Mock).mockReturnValueOnce(undefined);
      
      // Act
      await handleRevealTile({ gameId, socketId, x, y });
      
      // Assert
      // Should send error
      expect(mockGameUpdateService.sendError).toHaveBeenCalledWith(
        socketId,
        'Game not found.'
      );
      
      // Should not call revealCell
      expect(mockedGridLogic.revealCell).not.toHaveBeenCalled();
    });
    
    it('should handle gracefully when player is not found in game', async () => {
      // Arrange
      const x = 5, y = 5;
      const nonExistentSocketId = 'non-existent-socket-id';
      
      // Act
      await handleRevealTile({ gameId, socketId: nonExistentSocketId, x, y });
      
      // Assert
      // Should not call revealCell
      expect(mockedGridLogic.revealCell).not.toHaveBeenCalled();
    });
    
    it('should handle error during revealCell call', async () => {
      // Arrange
      const x = 5, y = 5;
      
      // Mock revealCell to throw an error
      mockedGridLogic.revealCell.mockRejectedValue(new Error('Test error'));
      
      // Act
      await handleRevealTile({ gameId, socketId, x, y });
      
      // Assert
      // Should send error
      expect(mockGameUpdateService.sendError).toHaveBeenCalledWith(
        socketId,
        'Failed to reveal tile'
      );
    });
  });
});