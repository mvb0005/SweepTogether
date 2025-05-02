import { ScoreService } from '../../application/scoreService';
import { GameStateService } from '../../application/gameStateService';
import { GameUpdateService } from '../../application/gameUpdateService';
import { EventBus } from '../../infrastructure/eventBus/EventBus';
import { SocketEventMap } from '../../infrastructure/network/socketEvents';
import { Cell, GameState, PlayerStatus, Player } from '../../domain/types';

describe('ScoreService', () => {
  // Mock objects
  let mockEventBus: jest.Mocked<EventBus<SocketEventMap>>;
  let mockGameStateService: jest.Mocked<Partial<GameStateService>>;
  let mockGameUpdateService: jest.Mocked<Partial<GameUpdateService>>;
  let scoreService: ScoreService;
  
  // Common test data
  const gameId = 'test-game-id';
  const playerId = 'test-player-id';
  const mockGame: Partial<GameState> = {
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
    }
    // Omit spatialGrid property completely since we don't need it for these tests
  };
  
  const mockPlayer: Player = {
    id: playerId,
    username: 'Test Player',
    score: 0,
    status: PlayerStatus.ACTIVE
  };

  beforeEach(() => {
    // Setup mocks
    mockEventBus = {
      publish: jest.fn(),
      subscribe: jest.fn(),
      unsubscribe: jest.fn(),
      getSubscribedEventNames: jest.fn()
    };
    
    mockGameStateService = {
      getGame: jest.fn().mockReturnValue({ ...mockGame, players: { [playerId]: { ...mockPlayer } } }),
      updateGridCell: jest.fn(),
      updateGridCells: jest.fn(),
      getCell: jest.fn()
    };
    
    mockGameUpdateService = {
      sendError: jest.fn(),
      sendPlayerStatusUpdate: jest.fn(),
      sendScoreUpdate: jest.fn(),
      sendTileUpdate: jest.fn(),
      sendTilesUpdate: jest.fn()
    };
    
    // Instantiate the service with mocked dependencies
    scoreService = new ScoreService(
      mockEventBus as any,
      mockGameStateService as any,
      mockGameUpdateService as any
    );
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('handleCellReveal', () => {
    it('should correctly calculate and update score for revealing cells', () => {
      // Arrange
      const revealedCells: Cell[] = [
        { x: 1, y: 1, isMine: false, adjacentMines: 1, revealed: true, flagged: false },
        { x: 1, y: 2, isMine: false, adjacentMines: 2, revealed: true, flagged: false }
      ];
      
      // Act
      const scoreDelta = scoreService.handleCellReveal(gameId, playerId, revealedCells);
      
      // Assert
      // Validate score calculation (2 cells * 10 points = 20)
      expect(scoreDelta).toBe(20);
      
      // Verify it called the gameUpdateService to send the score update
      expect(mockGameUpdateService.sendScoreUpdate).toHaveBeenCalledWith(
        gameId,
        playerId,
        20, // new score
        20, // score delta
        'Reveal Cells'
      );
    });

    it('should use custom reason if provided', () => {
      // Arrange
      const revealedCells: Cell[] = [
        { x: 1, y: 1, isMine: false, adjacentMines: 1, revealed: true, flagged: false }
      ];
      const customReason = 'Custom Reason';
      
      // Act
      scoreService.handleCellReveal(gameId, playerId, revealedCells, customReason);
      
      // Assert
      expect(mockGameUpdateService.sendScoreUpdate).toHaveBeenCalledWith(
        gameId,
        playerId,
        10, // new score
        10, // score delta
        customReason
      );
    });

    it('should handle empty cell array', () => {
      // Arrange
      const revealedCells: Cell[] = [];
      
      // Act
      const scoreDelta = scoreService.handleCellReveal(gameId, playerId, revealedCells);
      
      // Assert
      expect(scoreDelta).toBe(0);
      expect(mockGameUpdateService.sendScoreUpdate).toHaveBeenCalledWith(
        gameId,
        playerId,
        0, // new score
        0, // score delta
        'Reveal Cells'
      );
    });

    it('should handle non-existent game gracefully', () => {
      // Arrange
      mockGameStateService.getGame = jest.fn().mockReturnValue(undefined);
      const revealedCells: Cell[] = [
        { x: 1, y: 1, isMine: false, adjacentMines: 1, revealed: true, flagged: false }
      ];
      
      // Act
      const scoreDelta = scoreService.handleCellReveal(gameId, playerId, revealedCells);
      
      // Assert
      expect(scoreDelta).toBe(0);
      expect(mockGameUpdateService.sendScoreUpdate).not.toHaveBeenCalled();
    });
  });

  describe('handleMineHit', () => {
    it('should correctly apply penalty for hitting a mine', () => {
      // Act
      const scoreDelta = scoreService.handleMineHit(gameId, playerId);
      
      // Assert
      // Verify penalty calculation (negative penalty amount)
      expect(scoreDelta).toBe(-100);
      
      // Verify it called the gameUpdateService to send the score update
      expect(mockGameUpdateService.sendScoreUpdate).toHaveBeenCalledWith(
        gameId,
        playerId,
        0, // new score (0 after penalty)
        -100, // score delta
        'Hit Mine'
      );
    });

    it('should use custom reason if provided', () => {
      // Arrange
      const customReason = 'Hit Mine During Chord Click';
      
      // Act
      scoreService.handleMineHit(gameId, playerId, customReason);
      
      // Assert
      expect(mockGameUpdateService.sendScoreUpdate).toHaveBeenCalledWith(
        gameId,
        playerId,
        0, // new score
        -100, // score delta
        customReason
      );
    });

    it('should ensure score never goes below zero', () => {
      // Arrange
      const playerWithScore: Player = {
        ...mockPlayer,
        score: 50
      };
      mockGameStateService.getGame = jest.fn().mockReturnValue({ 
        ...mockGame, 
        players: { [playerId]: playerWithScore } 
      });
      
      // Act
      const scoreDelta = scoreService.handleMineHit(gameId, playerId);
      
      // Assert
      expect(scoreDelta).toBe(-100);
      expect(mockGameUpdateService.sendScoreUpdate).toHaveBeenCalledWith(
        gameId,
        playerId,
        0, // new score (0, not -50)
        -100, // score delta
        'Hit Mine'
      );
    });
  });

  describe('handleFlagToggle', () => {
    it('should correctly update score for placing a flag', () => {
      // Act
      const scoreDelta = scoreService.handleFlagToggle(gameId, playerId, true);
      
      // Assert
      // Verify score calculation for placing a flag
      expect(scoreDelta).toBe(2);
      
      // Verify it called the gameUpdateService to send the score update
      expect(mockGameUpdateService.sendScoreUpdate).toHaveBeenCalledWith(
        gameId,
        playerId,
        2, // new score
        2, // score delta
        'Place Flag'
      );
    });

    it('should correctly update score for removing a flag', () => {
      // Act
      const scoreDelta = scoreService.handleFlagToggle(gameId, playerId, false);
      
      // Assert
      // Verify score calculation for removing a flag
      expect(scoreDelta).toBe(0);
      
      // Verify it called the gameUpdateService to send the score update
      expect(mockGameUpdateService.sendScoreUpdate).toHaveBeenCalledWith(
        gameId,
        playerId,
        0, // new score
        0, // score delta
        'Remove Flag'
      );
    });
  });
});