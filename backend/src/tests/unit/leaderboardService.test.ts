import { EventBus } from '../../infrastructure/eventBus/EventBus';
import { SocketEventMap } from '../../infrastructure/network/socketEvents';
import { GameStateService } from '../../application/gameStateService';
import { GameUpdateService } from '../../application/gameUpdateService';
import { ScoreService } from '../../application/scoreService';
import { LeaderboardService } from '../../application/leaderboardService';
import { 
  LeaderboardCategory, 
  LeaderboardMetric, 
  GameState, 
  PlayerStatus, 
  DEFAULT_SCORING_CONFIG 
} from '../../domain/types';
import { Collection } from 'mongodb';

// Mock database module first, before using mockCollection
jest.mock('../../infrastructure/persistence/db', () => {
  // Create a mock collection to be returned by getLeaderboardsCollection
  const mockCol = {
    find: jest.fn(() => ({
      toArray: jest.fn().mockResolvedValue([])
    })),
    findOne: jest.fn(),
    updateOne: jest.fn().mockResolvedValue({ acknowledged: true })
  };
  
  return {
    getLeaderboardsCollection: jest.fn().mockReturnValue(mockCol)
  };
});

// Now get a reference to the mock collection for assertions
const mockCollection = jest.requireMock('../../infrastructure/persistence/db').getLeaderboardsCollection();

describe('LeaderboardService', () => {
  let eventBus: EventBus<SocketEventMap>;
  let gameStateService: GameStateService;
  let gameUpdateService: GameUpdateService;
  let scoreService: ScoreService;
  let leaderboardService: LeaderboardService;
  
  // Mock game state
  const testGameId = 'test-game-id';
  const testPlayerId = 'test-player-id';
  const testGameState: GameState = {
    gameId: testGameId,
    boardConfig: {
      rows: 10,
      cols: 10,
      mines: 10,
      isInfiniteWorld: false
    },
    scoringConfig: { ...DEFAULT_SCORING_CONFIG },
    players: {
      [testPlayerId]: {
        id: testPlayerId,
        username: 'TestPlayer',
        score: 100,
        status: PlayerStatus.ACTIVE
      }
    },
    mineReveals: [],
    pendingReveals: [],
    gameOver: false
  };
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Set up mocks for services
    eventBus = {
      publish: jest.fn(),
      subscribe: jest.fn(),
      unsubscribe: jest.fn(),
      getSubscribedEventNames: jest.fn().mockReturnValue(['scoreUpdate', 'gameOver', 'getLeaderboard'])
    } as unknown as EventBus<SocketEventMap>;
    
    gameStateService = {
      getGame: jest.fn().mockReturnValue(testGameState),
      createGame: jest.fn(),
      addPlayer: jest.fn(),
      removePlayer: jest.fn()
    } as unknown as GameStateService;
    
    gameUpdateService = {
      sendScoreUpdate: jest.fn(),
      sendToClient: jest.fn(),
      broadcast: jest.fn()
    } as unknown as GameUpdateService;
    
    scoreService = {} as ScoreService;
    
    // Create leaderboard service instance
    leaderboardService = new LeaderboardService(eventBus, gameStateService, gameUpdateService, scoreService);
  });
  
  describe('initialization', () => {
    it('should subscribe to relevant events', () => {
      // Verify event subscriptions
      expect(eventBus.subscribe).toHaveBeenCalledWith('scoreUpdate', expect.any(Function));
      expect(eventBus.subscribe).toHaveBeenCalledWith('gameOver', expect.any(Function));
      expect(eventBus.subscribe).toHaveBeenCalledWith('getLeaderboard', expect.any(Function));
    });
    
    it('should load existing leaderboard data on initialization', async () => {
      // Setup mock data for initialization test
      const mockLeaderboardData = [
        {
          _id: 'all_time_highest_score',
          category: LeaderboardCategory.ALL_TIME,
          metric: LeaderboardMetric.HIGHEST_SCORE,
          entries: [
            {
              playerId: 'player1',
              username: 'Player1',
              score: 1000,
              gamesPlayed: 5,
              updatedAt: new Date()
            }
          ],
          updatedAt: new Date()
        }
      ];
      
      // Mock the find method for this specific test
      (mockCollection.find as jest.Mock).mockReturnValueOnce({
        toArray: jest.fn().mockResolvedValueOnce(mockLeaderboardData)
      });
      
      // Create a new instance to trigger initialization with our mock data
      const newLeaderboardService = new LeaderboardService(eventBus, gameStateService, gameUpdateService, scoreService);
      
      // Allow async initialization to complete
      await new Promise(resolve => setTimeout(resolve, 0));
      
      // Verify the collection was queried
      expect(mockCollection.find).toHaveBeenCalled();
    });
  });
  
  describe('handleScoreUpdate', () => {
    it('should update leaderboard entries when a player scores points', async () => {
      // Setup score update event data
      const scoreEventData = {
        gameId: testGameId,
        playerId: testPlayerId,
        scoreDelta: 50,
        reason: 'Reveal Cells'
      };
      
      // Call the method
      await leaderboardService.handleScoreUpdate(scoreEventData);
      
      // Verify database was updated for highest score
      expect(mockCollection.updateOne).toHaveBeenCalledWith(
        { _id: expect.stringContaining('highest_score') },
        {
          $set: expect.objectContaining({
            category: LeaderboardCategory.ALL_TIME,
            metric: LeaderboardMetric.HIGHEST_SCORE,
            entries: expect.arrayContaining([
              expect.objectContaining({
                playerId: testPlayerId,
                username: 'TestPlayer',
                score: 100, // The current score from the game state
              })
            ]),
          })
        },
        { upsert: true }
      );
      
      // Verify database was updated for cells revealed
      expect(mockCollection.updateOne).toHaveBeenCalledWith(
        { _id: expect.stringContaining('most_cells_revealed') },
        expect.any(Object),
        { upsert: true }
      );
    });
    
    it('should handle flag placement and update mines found metric', async () => {
      // Setup score update event for flag placement
      const scoreEventData = {
        gameId: testGameId,
        playerId: testPlayerId,
        scoreDelta: testGameState.scoringConfig.flagPlacePoints,
        reason: 'Place Flag'
      };
      
      // Call the method
      await leaderboardService.handleScoreUpdate(scoreEventData);
      
      // Verify database was updated for mines found
      expect(mockCollection.updateOne).toHaveBeenCalledWith(
        { _id: expect.stringContaining('most_mines_found') },
        expect.any(Object),
        { upsert: true }
      );
    });
  });
  
  describe('recordGameWin', () => {
    it('should update games won leaderboard when a player wins a game', async () => {
      // Call the method
      await leaderboardService.recordGameWin(testGameId, testPlayerId);
      
      // Verify database was updated for games won
      expect(mockCollection.updateOne).toHaveBeenCalledWith(
        { _id: expect.stringContaining('most_games_won') },
        expect.any(Object),
        { upsert: true }
      );
    });
  });
  
  describe('getLeaderboard', () => {
    it('should retrieve leaderboard data from database if not in cache', async () => {
      // Setup mock data for database response
      const mockDbLeaderboard = {
        _id: 'all_time_highest_score',
        category: LeaderboardCategory.ALL_TIME,
        metric: LeaderboardMetric.HIGHEST_SCORE,
        entries: [
          {
            playerId: 'player1',
            username: 'Player1',
            score: 1000,
            gamesPlayed: 5,
            updatedAt: new Date()
          }
        ],
        updatedAt: new Date()
      };
      
      // Mock findOne to return our test data
      (mockCollection.findOne as jest.Mock).mockResolvedValueOnce(mockDbLeaderboard);
      
      // Call the method
      const result = await leaderboardService.getLeaderboard(
        LeaderboardCategory.ALL_TIME, 
        LeaderboardMetric.HIGHEST_SCORE
      );
      
      // Verify database was queried
      expect(mockCollection.findOne).toHaveBeenCalledWith({ 
        _id: 'all_time_highest_score' 
      });
      
      // Verify result contains expected data
      expect(result).toEqual(expect.objectContaining({
        category: LeaderboardCategory.ALL_TIME,
        metric: LeaderboardMetric.HIGHEST_SCORE,
        entries: expect.arrayContaining([
          expect.objectContaining({
            playerId: 'player1',
            username: 'Player1',
            score: 1000
          })
        ])
      }));
    });
    
    it('should respect the limit parameter when returning entries', async () => {
      // Create mock data with multiple entries
      const mockEntries = Array.from({ length: 20 }, (_, i) => ({
        playerId: `player${i}`,
        username: `Player${i}`,
        score: 1000 - i*10,
        gamesPlayed: 5,
        updatedAt: new Date()
      }));
      
      const mockDbLeaderboard = {
        _id: 'all_time_highest_score',
        category: LeaderboardCategory.ALL_TIME,
        metric: LeaderboardMetric.HIGHEST_SCORE,
        entries: mockEntries,
        updatedAt: new Date()
      };
      
      // Mock findOne to return our test data
      (mockCollection.findOne as jest.Mock).mockResolvedValueOnce(mockDbLeaderboard);
      
      // Request with a limit of 5
      const result = await leaderboardService.getLeaderboard(
        LeaderboardCategory.ALL_TIME,
        LeaderboardMetric.HIGHEST_SCORE,
        5
      );
      
      // Verify only 5 entries are returned
      expect(result.entries.length).toBe(5);
      
      // Verify entries are sorted by score (highest first)
      expect(result.entries[0].score).toBeGreaterThan(result.entries[1].score);
    });
  });
  
  describe('handleLeaderboardRequest', () => {
    it('should get leaderboard data and send it to the requesting client', async () => {
      // Setup mock for getLeaderboard
      const mockLeaderboardData = {
        category: LeaderboardCategory.ALL_TIME,
        metric: LeaderboardMetric.HIGHEST_SCORE,
        entries: [
          {
            playerId: 'player1',
            username: 'Player1',
            score: 1000,
            gamesPlayed: 5,
            updatedAt: new Date()
          }
        ]
      };
      
      // Mock the getLeaderboard method
      jest.spyOn(leaderboardService as any, 'getLeaderboard').mockResolvedValueOnce(mockLeaderboardData);
      
      // Setup request payload
      const requestPayload = {
        category: LeaderboardCategory.ALL_TIME,
        metric: LeaderboardMetric.HIGHEST_SCORE,
        limit: 10,
        socketId: 'requesting-socket-id'
      };
      
      // Call the method
      await leaderboardService.handleLeaderboardRequest(requestPayload);
      
      // Verify client response
      expect(gameUpdateService.sendToClient).toHaveBeenCalledWith(
        'requesting-socket-id',
        'leaderboardData',
        expect.objectContaining({
          category: LeaderboardCategory.ALL_TIME,
          metric: LeaderboardMetric.HIGHEST_SCORE,
          entries: expect.any(Array),
          updatedAt: expect.any(Date)
        })
      );
    });
  });
});