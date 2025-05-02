/**
 * @fileoverview Service responsible for managing scores across the game.
 * Centralizes score calculation logic based on game events like revealing cells,
 * flagging mines, and hitting mines. Handles broadcasting score updates to clients
 * and special scoring scenarios like bonuses for multiple reveals.
 */

import { EventBus } from '../infrastructure/eventBus/EventBus';
import { SocketEventMap } from '../infrastructure/network/socketEvents';
import { GameStateService } from './gameStateService';
import { GameUpdateService } from './gameUpdateService';
import { Cell, GameState, Player, ScoringConfig } from '../domain/types';

// Define types for score-related events
export interface ScoreEventData {
  gameId: string;
  playerId: string;
  scoreDelta: number;
  reason: string;
}

export interface RevealCellsEvent {
  gameId: string;
  playerId: string;
  cells: Cell[];
}

export interface MineHitEvent {
  gameId: string;
  playerId: string;
}

export interface FlagToggleEvent {
  gameId: string;
  playerId: string;
  isPlacingFlag: boolean;
}

export class ScoreService {
  constructor(
    private eventBus: EventBus<SocketEventMap>,
    private gameStateService: GameStateService,
    private gameUpdateService: GameUpdateService
  ) {
    // We could subscribe to events here if needed
    // For now, we'll expose methods to be called by PlayerActionService
  }

  /**
   * Calculate and update score for revealing cells
   * 
   * @param gameId The game ID
   * @param playerId The player ID
   * @param revealedCells Array of cells that were revealed
   * @param reason Custom reason to display (defaults to 'Reveal Cells')
   * @returns The calculated score delta
   */
  public handleCellReveal(
    gameId: string,
    playerId: string,
    revealedCells: Cell[],
    reason: string = 'Reveal Cells'
  ): number {
    const gameState = this.gameStateService.getGame(gameId);
    if (!gameState || !gameState.players[playerId]) {
      console.error(`Cannot update score: Game ${gameId} or player ${playerId} not found.`);
      return 0;
    }

    const player = gameState.players[playerId];
    
    // Calculate score increase based on the number of cells revealed
    const scoreDelta = this.calculateRevealScore(revealedCells, gameState.scoringConfig);
    
    // Update player score
    this.updatePlayerScore(gameState, player, scoreDelta);
    
    // Send score update to clients
    this.gameUpdateService.sendScoreUpdate(
      gameId,
      playerId,
      player.score,
      scoreDelta,
      reason
    );
    
    return scoreDelta;
  }

  /**
   * Calculate and update score for a mine hit
   * 
   * @param gameId The game ID
   * @param playerId The player ID
   * @param reason Custom reason to display (defaults to 'Hit Mine')
   * @returns The calculated score delta (negative for penalty)
   */
  public handleMineHit(
    gameId: string,
    playerId: string,
    reason: string = 'Hit Mine'
  ): number {
    const gameState = this.gameStateService.getGame(gameId);
    if (!gameState || !gameState.players[playerId]) {
      console.error(`Cannot update score: Game ${gameId} or player ${playerId} not found.`);
      return 0;
    }

    const player = gameState.players[playerId];
    
    // Calculate penalty for hitting a mine (negative value)
    const scoreDelta = -gameState.scoringConfig.mineHitPenalty;
    
    // Update player score
    this.updatePlayerScore(gameState, player, scoreDelta);
    
    // Send score update to clients
    this.gameUpdateService.sendScoreUpdate(
      gameId,
      playerId,
      player.score,
      scoreDelta,
      reason
    );
    
    return scoreDelta;
  }

  /**
   * Calculate and update score for toggling a flag
   * 
   * @param gameId The game ID
   * @param playerId The player ID
   * @param isPlacingFlag True if placing a flag, false if removing
   * @returns The calculated score delta
   */
  public handleFlagToggle(
    gameId: string,
    playerId: string,
    isPlacingFlag: boolean
  ): number {
    const gameState = this.gameStateService.getGame(gameId);
    if (!gameState || !gameState.players[playerId]) {
      console.error(`Cannot update score: Game ${gameId} or player ${playerId} not found.`);
      return 0;
    }

    const player = gameState.players[playerId];
    
    // Calculate score change based on flag action
    let scoreDelta: number;
    let reason: string;
    
    if (isPlacingFlag) {
      // Adding a flag
      scoreDelta = gameState.scoringConfig.flagPlacePoints;
      reason = 'Place Flag';
    } else {
      // Removing a flag
      scoreDelta = gameState.scoringConfig.flagRemovePoints;
      reason = 'Remove Flag';
    }
    
    // Update player score
    this.updatePlayerScore(gameState, player, scoreDelta);
    
    // Send score update to clients
    this.gameUpdateService.sendScoreUpdate(
      gameId,
      playerId,
      player.score,
      scoreDelta,
      reason
    );
    
    return scoreDelta;
  }

  /**
   * Calculate score for revealing cells based on game rules
   * 
   * @param cells The revealed cells
   * @param scoringConfig The game's scoring configuration
   * @returns The calculated score delta
   */
  private calculateRevealScore(cells: Cell[], scoringConfig: ScoringConfig): number {
    // Basic rule: award points for each revealed cell
    return cells.length * scoringConfig.numberRevealPoints;
    
    // Future enhancements:
    // - Give bonus points for revealing cells with higher adjacentMines values
    // - Give combo bonus for revealing many cells at once
    // - Implement streak bonuses for consecutive successful moves
  }

  /**
   * Update a player's score, ensuring it never goes below zero
   * 
   * @param gameState The game state
   * @param player The player to update
   * @param scoreDelta The score change
   */
  private updatePlayerScore(gameState: GameState, player: Player, scoreDelta: number): void {
    // Ensure score never goes below zero
    player.score = Math.max(0, player.score + scoreDelta);
  }
}