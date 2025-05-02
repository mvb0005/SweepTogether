/**
 * @fileoverview Service responsible for tracking player rankings across games.
 * Manages leaderboards for different metrics (highest score, most mines found, etc.)
 * and time periods (all-time, daily, weekly). Handles persistence of leaderboard
 * data and broadcasting updates to clients.
 */

import { EventBus } from '../infrastructure/eventBus/EventBus';
import { SocketEventMap } from '../infrastructure/network/socketEvents';
import { GameStateService } from './gameStateService';
import { GameUpdateService } from './gameUpdateService';
import { ScoreService, ScoreEventData } from './scoreService';
import { Collection } from 'mongodb';
import {
  LeaderboardCategory,
  LeaderboardMetric,
  LeaderboardEntry,
  LeaderboardData,
  LeaderboardRequestPayload,
  LeaderboardResponsePayload,
  LeaderboardUpdatePayload,
} from '../domain/types';
import { LeaderboardDocument, getLeaderboardsCollection } from '../infrastructure/persistence/db';

// Default number of entries to return for leaderboard requests
const DEFAULT_LEADERBOARD_LIMIT = 10;

// Define statistics tracked per player for leaderboard calculations
interface PlayerStats {
  playerId: string;
  username: string;
  highestScore: number;
  totalMinesFound: number;
  totalCellsRevealed: number;
  gamesWon: number;
  gamesPlayed: number;
}

export class LeaderboardService {
  private readonly leaderboardsCollection: Collection<LeaderboardDocument>;
  // Track current player statistics for easier updates
  private readonly playerStats: Map<string, PlayerStats> = new Map();
  // Cache for leaderboard data to minimize database access
  private readonly leaderboardCache: Map<string, LeaderboardData> = new Map();

  constructor(
    private eventBus: EventBus<SocketEventMap>,
    private gameStateService: GameStateService,
    private gameUpdateService: GameUpdateService,
    private scoreService: ScoreService
  ) {
    this.leaderboardsCollection = getLeaderboardsCollection();
    this.initialize();

    // Subscribe to score update events
    this.eventBus.subscribe('scoreUpdate', (payload) => {
      this.handleScoreUpdate(payload as unknown as ScoreEventData); // Cast for type safety
    });

    // Subscribe to game over events to track wins
    this.eventBus.subscribe('gameOver', (payload) => {
      const gameOverPayload = payload as { gameId: string, winner?: string };
      if (gameOverPayload.winner) {
        this.recordGameWin(gameOverPayload.gameId, gameOverPayload.winner);
      }
    });

    // Subscribe to leaderboard requests
    this.eventBus.subscribe('getLeaderboard', (payload) => {
      const request = payload as LeaderboardRequestPayload & { socketId: string };
      this.handleLeaderboardRequest(request);
    });
  }

  /**
   * Initialize the leaderboard service by loading existing data
   */
  private async initialize(): Promise<void> {
    try {
      // Load all leaderboard documents from the database
      const leaderboardDocs = await this.leaderboardsCollection.find({}).toArray();
      
      // Populate cache with existing leaderboard data
      for (const doc of leaderboardDocs) {
        const cacheKey = this.getCacheKey(doc.category, doc.metric);
        this.leaderboardCache.set(cacheKey, {
          category: doc.category,
          metric: doc.metric,
          entries: doc.entries
        });
      }
      
      console.log(`Initialized LeaderboardService with ${leaderboardDocs.length} leaderboard categories.`);
    } catch (error) {
      console.error('Failed to initialize leaderboard service:', error);
    }
  }

  /**
   * Handle a score update event by updating relevant leaderboards
   */
  public async handleScoreUpdate(data: ScoreEventData): Promise<void> {
    try {
      const { gameId, playerId, scoreDelta, reason } = data;
      
      // Get game state and player information
      const gameState = this.gameStateService.getGame(gameId);
      if (!gameState || !gameState.players[playerId]) {
        console.error(`Cannot update leaderboard: Game ${gameId} or player ${playerId} not found.`);
        return;
      }
      
      const player = gameState.players[playerId];
      
      // Get or create player stats
      let stats = this.playerStats.get(playerId);
      if (!stats) {
        stats = {
          playerId,
          username: player.username,
          highestScore: player.score,
          totalMinesFound: 0,
          totalCellsRevealed: 0,
          gamesWon: 0,
          gamesPlayed: 1 // Assume they're playing if we get a score update
        };
        this.playerStats.set(playerId, stats);
      } else {
        // Update highest score if current score is higher
        if (player.score > stats.highestScore) {
          stats.highestScore = player.score;
        }
      }
      
      // Update statistics based on the reason for the score change
      if (reason.includes('Reveal') && !reason.includes('Mine')) {
        // For regular cell reveals, estimate cells revealed from score delta and scoring config
        const cellsRevealed = scoreDelta / gameState.scoringConfig.numberRevealPoints;
        stats.totalCellsRevealed += cellsRevealed;
      } else if (reason === 'Hit Mine') {
        // No specific action for hitting mines
      } else if (reason === 'Place Flag' && gameState.scoringConfig.flagPlacePoints > 0) {
        // Count flags placed if they give points (assuming they're placed on mines)
        stats.totalMinesFound++;
      }
      
      // Update leaderboards with new player stats
      await this.updateLeaderboards(playerId, gameId);
    } catch (error) {
      console.error('Error updating leaderboard from score event:', error);
    }
  }

  /**
   * Record a game win for a player
   */
  public async recordGameWin(gameId: string, playerId: string): Promise<void> {
    try {
      // Get or create player stats
      let stats = this.playerStats.get(playerId);
      if (!stats) {
        const gameState = this.gameStateService.getGame(gameId);
        if (!gameState || !gameState.players[playerId]) {
          console.error(`Cannot record win: Game ${gameId} or player ${playerId} not found.`);
          return;
        }
        
        const player = gameState.players[playerId];
        stats = {
          playerId,
          username: player.username,
          highestScore: player.score,
          totalMinesFound: 0,
          totalCellsRevealed: 0,
          gamesWon: 1,
          gamesPlayed: 1
        };
        this.playerStats.set(playerId, stats);
      } else {
        // Update games won count
        stats.gamesWon++;
      }
      
      // Update leaderboards with new player stats
      await this.updateLeaderboards(playerId, gameId);
    } catch (error) {
      console.error('Error recording game win:', error);
    }
  }

  /**
   * Update all leaderboards for a specific player
   */
  private async updateLeaderboards(playerId: string, gameId: string): Promise<void> {
    try {
      const stats = this.playerStats.get(playerId);
      if (!stats) {
        return;
      }

      // Get the current date for timestamp and date-based leaderboards
      const now = new Date();
      
      // Get the start of today, this week for date-based leaderboards
      const startOfToday = new Date(now);
      startOfToday.setHours(0, 0, 0, 0);
      
      const startOfWeek = new Date(now);
      startOfWeek.setHours(0, 0, 0, 0);
      startOfWeek.setDate(now.getDate() - now.getDay()); // Start of week (Sunday)
      
      // Update all-time leaderboards
      await this.updateLeaderboardForMetric(LeaderboardCategory.ALL_TIME, LeaderboardMetric.HIGHEST_SCORE, stats, gameId);
      await this.updateLeaderboardForMetric(LeaderboardCategory.ALL_TIME, LeaderboardMetric.MOST_MINES_FOUND, stats, gameId);
      await this.updateLeaderboardForMetric(LeaderboardCategory.ALL_TIME, LeaderboardMetric.MOST_CELLS_REVEALED, stats, gameId);
      await this.updateLeaderboardForMetric(LeaderboardCategory.ALL_TIME, LeaderboardMetric.MOST_GAMES_WON, stats, gameId);
      
      // Update daily leaderboards
      await this.updateLeaderboardForMetric(LeaderboardCategory.DAILY, LeaderboardMetric.HIGHEST_SCORE, stats, gameId);
      
      // Update weekly leaderboards
      await this.updateLeaderboardForMetric(LeaderboardCategory.WEEKLY, LeaderboardMetric.HIGHEST_SCORE, stats, gameId);
    } catch (error) {
      console.error('Error updating leaderboards:', error);
    }
  }

  /**
   * Update a specific leaderboard for a category and metric
   */
  private async updateLeaderboardForMetric(
    category: LeaderboardCategory,
    metric: LeaderboardMetric,
    stats: PlayerStats,
    gameId: string
  ): Promise<void> {
    try {
      // Generate cache and document keys
      const cacheKey = this.getCacheKey(category, metric);
      const documentId = this.getDocumentId(category, metric);

      // Determine the score value based on the metric
      let scoreValue = 0;
      switch (metric) {
        case LeaderboardMetric.HIGHEST_SCORE:
          scoreValue = stats.highestScore;
          break;
        case LeaderboardMetric.MOST_MINES_FOUND:
          scoreValue = stats.totalMinesFound;
          break;
        case LeaderboardMetric.MOST_CELLS_REVEALED:
          scoreValue = stats.totalCellsRevealed;
          break;
        case LeaderboardMetric.MOST_GAMES_WON:
          scoreValue = stats.gamesWon;
          break;
      }
      
      // Skip update if score is 0 (no contribution)
      if (scoreValue <= 0) {
        return;
      }

      // Get current leaderboard data from cache or create a new one
      let leaderboardData = this.leaderboardCache.get(cacheKey) || {
        category,
        metric,
        entries: []
      };
      
      // Find existing entry for this player
      const existingEntryIndex = leaderboardData.entries.findIndex(entry => entry.playerId === stats.playerId);
      
      const now = new Date();
      const newEntry: LeaderboardEntry = {
        playerId: stats.playerId,
        username: stats.username,
        score: scoreValue,
        gamesPlayed: stats.gamesPlayed,
        lastGameId: gameId,
        updatedAt: now
      };

      // Update or add the entry
      if (existingEntryIndex >= 0) {
        // Only update if the score is better
        if (scoreValue > leaderboardData.entries[existingEntryIndex].score) {
          leaderboardData.entries[existingEntryIndex] = newEntry;
        }
      } else {
        leaderboardData.entries.push(newEntry);
      }
      
      // Sort entries by score (descending)
      leaderboardData.entries.sort((a, b) => b.score - a.score);
      
      // Limit to top 100 entries to prevent unbounded growth
      if (leaderboardData.entries.length > 100) {
        leaderboardData.entries = leaderboardData.entries.slice(0, 100);
      }
      
      // Update cache
      this.leaderboardCache.set(cacheKey, leaderboardData);
      
      // Persist to database
      await this.leaderboardsCollection.updateOne(
        { _id: documentId },
        {
          $set: {
            category,
            metric,
            entries: leaderboardData.entries,
            updatedAt: now
          }
        },
        { upsert: true }
      );
      
      // Broadcast update to clients if it's in the top entries
      const topEntries = leaderboardData.entries.slice(0, DEFAULT_LEADERBOARD_LIMIT);
      if (topEntries.some(entry => entry.playerId === stats.playerId)) {
        this.broadcastLeaderboardUpdate(category, metric);
      }
    } catch (error) {
      console.error(`Error updating leaderboard for ${category}_${metric}:`, error);
    }
  }

  /**
   * Handle a request for leaderboard data
   */
  public async handleLeaderboardRequest(request: LeaderboardRequestPayload & { socketId: string }): Promise<void> {
    try {
      const { category, metric, limit = DEFAULT_LEADERBOARD_LIMIT, socketId } = request;
      
      // Get leaderboard data
      const leaderboardData = await this.getLeaderboard(category, metric, limit);
      
      // Send response directly to the requesting client
      this.gameUpdateService.sendToClient(socketId, 'leaderboardData', {
        ...leaderboardData,
        updatedAt: new Date()
      });
    } catch (error) {
      console.error('Error handling leaderboard request:', error);
    }
  }

  /**
   * Get leaderboard data for a specific category and metric
   */
  public async getLeaderboard(
    category: LeaderboardCategory,
    metric: LeaderboardMetric,
    limit: number = DEFAULT_LEADERBOARD_LIMIT
  ): Promise<LeaderboardData> {
    try {
      const cacheKey = this.getCacheKey(category, metric);
      
      // Try to get from cache first
      let leaderboardData = this.leaderboardCache.get(cacheKey);
      
      // If not in cache, try to get from database
      if (!leaderboardData) {
        const documentId = this.getDocumentId(category, metric);
        const doc = await this.leaderboardsCollection.findOne({ _id: documentId });
        
        if (doc) {
          leaderboardData = {
            category: doc.category,
            metric: doc.metric,
            entries: doc.entries
          };
          
          // Update cache
          this.leaderboardCache.set(cacheKey, leaderboardData);
        } else {
          // Create empty leaderboard if none exists
          leaderboardData = {
            category,
            metric,
            entries: []
          };
        }
      }
      
      // Return with limit applied
      return {
        ...leaderboardData,
        entries: leaderboardData.entries.slice(0, limit)
      };
    } catch (error) {
      console.error(`Error getting leaderboard for ${category}_${metric}:`, error);
      return {
        category,
        metric,
        entries: []
      };
    }
  }

  /**
   * Broadcast a leaderboard update to all clients
   */
  private async broadcastLeaderboardUpdate(
    category: LeaderboardCategory,
    metric: LeaderboardMetric
  ): Promise<void> {
    try {
      const leaderboardData = await this.getLeaderboard(category, metric);
      
      // Broadcast leaderboard update to all clients
      this.gameUpdateService.broadcast('leaderboardUpdate', {
        ...leaderboardData,
        updatedAt: new Date()
      });
    } catch (error) {
      console.error(`Error broadcasting leaderboard update for ${category}_${metric}:`, error);
    }
  }

  /**
   * Get the cache key for a leaderboard category and metric
   */
  private getCacheKey(category: LeaderboardCategory, metric: LeaderboardMetric): string {
    return `${category}_${metric}`;
  }

  /**
   * Get the document ID for a leaderboard category and metric
   */
  private getDocumentId(category: LeaderboardCategory, metric: LeaderboardMetric): string {
    return `${category}_${metric}`;
  }
}