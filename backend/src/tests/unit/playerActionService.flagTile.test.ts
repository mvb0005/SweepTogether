/**
 * Unit Tests for PlayerActionService - Flag Tile Functionality
 * 
 * These tests focus on the handleFlagTile function which processes player requests
 * to flag or unflag cells in the infinite Minesweeper world.
 * 
 * Test Coverage:
 * - Basic cases: 
 *   - Successfully flagging a cell
 *   - Successfully unflagging a previously flagged cell
 * - Edge cases:
 *   - Attempting to flag an already revealed cell (no action taken)
 *   - Locked out player (action blocked)
 *   - Lockout period expiration (player unlocked)
 *   - Non-existent game (error handled)
 *   - Non-existent player (gracefully handled)
 *   - Error during toggleFlag call (error handled)
 * 
 * Each test verifies:
 * 1. Correct calls to gridLogic.toggleFlag
 * 2. Proper state updates via GameStateService
 * 3. Appropriate client notifications via GameUpdateService
 * 4. Score calculations and player status management
 */

import { PlayerActionService } from '../../application/playerActionService';
import { GameStateService } from '../../application/gameStateService';
import { GameUpdateService } from '../../application/gameUpdateService';
import { EventBus } from '../../infrastructure/eventBus/EventBus';
import { SocketEventMap } from '../../infrastructure/network/socketEvents';
import { Cell, GameState, PlayerStatus, Player } from '../../domain/types';
import * as gridLogic from '../../domain/gridLogic';

// Mock dependencies
jest.mock('../../domain/gridLogic');
const mockedGridLogic = gridLogic as jest.Mocked<typeof gridLogic>;

describe('PlayerActionService - Flag Tile', () => {
  // Mock objects
  let mockEventBus: jest.Mocked<EventBus<SocketEventMap>>;
  let mockGameStateService: jest.Mocked<Partial<GameStateService>>;
  let mockGameUpdateService: jest.Mocked<Partial<GameUpdateService>>;
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
      updateGridCells: jest.fn()
    };
    
    mockGameUpdateService = {
      sendError: jest.fn(),
      sendPlayerStatusUpdate: jest.fn(),
      sendScoreUpdate: jest.fn(),
      sendTileUpdate: jest.fn(),
      sendTilesUpdate: jest.fn()
    };
    
    // Initialize the service with mocks
    playerActionService = new PlayerActionService(
      mockEventBus,
      mockGameStateService as any,
      mockGameUpdateService as any
    );
  });
  
  describe('handleFlagTile', () => {
    // Extract the bound handler function from the event subscription
    let handleFlagTile: (payload: SocketEventMap['flagTile']) => Promise<void>;
    
    beforeEach(() => {
      // Get the bound handler function
      handleFlagTile = mockEventBus.subscribe.mock.calls.find(
        call => call[0] === 'flagTile'
      )?.[1] as (payload: SocketEventMap['flagTile']) => Promise<void>;
      
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
    
    it('should flag a cell successfully', async () => {
      // Arrange
      const x = 5, y = 5;
      const flaggedCell: Cell = {
        x, y,
        isMine: false, // Could be a mine but player doesn't know it yet
        adjacentMines: 2,
        revealed: false,
        flagged: true
      };
      
      // Mock gridLogic.toggleFlag to return a newly flagged cell
      mockedGridLogic.toggleFlag.mockResolvedValue(flaggedCell);
      
      // Act
      await handleFlagTile({ gameId, socketId, x, y });
      
      // Assert
      // Check if toggleFlag was called with the right parameters
      expect(mockedGridLogic.toggleFlag).toHaveBeenCalledWith(
        mockGame,
        x,
        y,
        mockGameStateService.getCell
      );
      
      // Check if game state was updated
      expect(mockGameStateService.updateGridCell).toHaveBeenCalledWith(
        gameId,
        flaggedCell
      );
      
      // Check if score was updated (flagPlacePoints: 2)
      expect(mockGameUpdateService.sendScoreUpdate).toHaveBeenCalledWith(
        gameId,
        socketId,
        2, // New score
        2, // Score delta
        'Place Flag'
      );
      
      // Check if tile update was sent
      expect(mockGameUpdateService.sendTileUpdate).toHaveBeenCalledWith(
        gameId,
        expect.objectContaining({ 
          x,
          y,
          revealed: false,
          flagged: true
        })
      );
    });
    
    it('should unflag a previously flagged cell', async () => {
      // Arrange
      const x = 5, y = 5;
      const unflaggedCell: Cell = {
        x, y,
        isMine: false, // Could be a mine but player doesn't know it yet
        adjacentMines: 2,
        revealed: false,
        flagged: false
      };
      
      // Mock gridLogic.toggleFlag to return a newly unflagged cell
      mockedGridLogic.toggleFlag.mockResolvedValue(unflaggedCell);
      
      // Act
      await handleFlagTile({ gameId, socketId, x, y });
      
      // Assert
      // Check if toggleFlag was called
      expect(mockedGridLogic.toggleFlag).toHaveBeenCalled();
      
      // Check if game state was updated
      expect(mockGameStateService.updateGridCell).toHaveBeenCalledWith(
        gameId,
        unflaggedCell
      );
      
      // Check if score was updated (flagRemovePoints: 0)
      expect(mockGameUpdateService.sendScoreUpdate).toHaveBeenCalledWith(
        gameId,
        socketId,
        0, // New score
        0, // Score delta (no points for unflagging)
        'Remove Flag'
      );
      
      // Check if tile update was sent
      expect(mockGameUpdateService.sendTileUpdate).toHaveBeenCalledWith(
        gameId,
        expect.objectContaining({
          x,
          y,
          revealed: false,
          flagged: false
        })
      );
    });
    
    it('should do nothing when attempting to flag an already revealed cell', async () => {
      // Arrange
      const x = 5, y = 5;
      
      // Mock toggleFlag to return null (no change - can't flag revealed cell)
      mockedGridLogic.toggleFlag.mockResolvedValue(null);
      
      // Act
      await handleFlagTile({ gameId, socketId, x, y });
      
      // Assert
      expect(mockedGridLogic.toggleFlag).toHaveBeenCalled();
      
      // None of the update methods should be called
      expect(mockGameStateService.updateGridCell).not.toHaveBeenCalled();
      expect(mockGameUpdateService.sendScoreUpdate).not.toHaveBeenCalled();
      expect(mockGameUpdateService.sendTileUpdate).not.toHaveBeenCalled();
    });
    
    it('should not allow action when player is locked out', async () => {
      // Arrange
      const x = 5, y = 5;
      
      // Set player status to locked out
      mockGame.players[socketId].status = PlayerStatus.LOCKED_OUT;
      mockGame.players[socketId].lockedUntil = Date.now() + 5000; // Locked for 5 more seconds
      
      // Act
      await handleFlagTile({ gameId, socketId, x, y });
      
      // Assert
      // Should not call toggleFlag
      expect(mockedGridLogic.toggleFlag).not.toHaveBeenCalled();
    });
    
    it('should unlock player if lockout period has expired', async () => {
      // Arrange
      const x = 5, y = 5;
      const flaggedCell: Cell = {
        x, y,
        isMine: false,
        adjacentMines: 2,
        revealed: false,
        flagged: true
      };
      
      // Set player status to locked out but with expired lock time
      mockGame.players[socketId].status = PlayerStatus.LOCKED_OUT;
      mockGame.players[socketId].lockedUntil = Date.now() - 1000; // Lock expired 1 second ago
      
      // Mock toggleFlag to return a flagged cell
      mockedGridLogic.toggleFlag.mockResolvedValue(flaggedCell);
      
      // Act
      await handleFlagTile({ gameId, socketId, x, y });
      
      // Assert
      // Player status should be updated to ACTIVE
      expect(mockGameUpdateService.sendPlayerStatusUpdate).toHaveBeenCalledWith(
        gameId,
        socketId,
        PlayerStatus.ACTIVE
      );
      
      // toggleFlag should be called after player is unlocked
      expect(mockedGridLogic.toggleFlag).toHaveBeenCalled();
    });
    
    it('should handle gracefully when game is not found', async () => {
      // Arrange
      const x = 5, y = 5;
      
      // Mock getGame to return undefined (game not found)
      (mockGameStateService.getGame as jest.Mock).mockReturnValueOnce(undefined);
      
      // Act
      await handleFlagTile({ gameId, socketId, x, y });
      
      // Assert
      // Should send error
      expect(mockGameUpdateService.sendError).toHaveBeenCalledWith(
        socketId,
        'Game not found.'
      );
      
      // Should not call toggleFlag
      expect(mockedGridLogic.toggleFlag).not.toHaveBeenCalled();
    });
    
    it('should handle gracefully when player is not found in game', async () => {
      // Arrange
      const x = 5, y = 5;
      const nonExistentSocketId = 'non-existent-socket-id';
      
      // Act
      await handleFlagTile({ gameId, socketId: nonExistentSocketId, x, y });
      
      // Assert
      // Should not call toggleFlag
      expect(mockedGridLogic.toggleFlag).not.toHaveBeenCalled();
    });
    
    it('should handle error during toggleFlag call', async () => {
      // Arrange
      const x = 5, y = 5;
      
      // Mock toggleFlag to throw an error
      mockedGridLogic.toggleFlag.mockRejectedValue(new Error('Test error'));
      
      // Act
      await handleFlagTile({ gameId, socketId, x, y });
      
      // Assert
      // Should send error
      expect(mockGameUpdateService.sendError).toHaveBeenCalledWith(
        socketId,
        'Failed to flag tile'
      );
    });
  });
});