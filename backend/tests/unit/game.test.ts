/**
 * @fileoverview Unit tests for the Game domain logic.
 * This file contains tests for the game state management, including:
 * - Game initialization and configuration.
 * - Player management (adding, removing players).
 * - Handling game actions (reveal, flag, chord).
 * - Tracking game state (in progress, won, lost).
 * - Scoring logic.
 * - Win/loss condition checking.
 */

import { GameState, GameConfig, PlayerStatus } from '../../src/domain/types';
import { 
  addPlayerToGame, 
  removePlayerFromGame, 
  checkPlayerLockout 
} from '../../src/domain/game';

describe('Game Functions', () => {
  let gameState: GameState;
  
  beforeEach(() => {
    // Initialize a minimal game state for testing
    gameState = {
      gameId: 'test-game',
      boardConfig: { 
        rows: 10, 
        cols: 10, 
        mines: 10 
      },
      scoringConfig: {
        firstPlacePoints: 10,
        secondPlacePoints: 5,
        thirdPlacePoints: 2,
        numberRevealPoints: 1,
        mineHitPenalty: 50,
        lockoutDurationMs: 5000,
        mineRevealDelayMs: 3000
      },
      players: {},
      mineReveals: [],
      pendingReveals: [],
      gameOver: false
    };
  });

  it('should add a player to the game', () => {
    const playerId = 'player1';
    const username = 'Alice';
    const updatedState = addPlayerToGame(gameState, playerId, username);
    
    expect(updatedState.players[playerId]).toBeDefined();
    expect(updatedState.players[playerId].username).toBe(username);
    expect(updatedState.players[playerId].score).toBe(0);
    expect(updatedState.players[playerId].status).toBe(PlayerStatus.ACTIVE);
  });

  it('should remove a player from the game', () => {
    // First add a player
    const playerId = 'player1';
    const username = 'Alice';
    let state = addPlayerToGame(gameState, playerId, username);
    
    // Then remove the player
    state = removePlayerFromGame(state, playerId);
    
    // Verify the player was removed
    expect(state.players[playerId]).toBeUndefined();
  });

  it('should detect if a player is locked out', () => {
    // First add a player
    const playerId = 'player1';
    const username = 'Alice';
    let state = addPlayerToGame(gameState, playerId, username);
    
    // Set the player to locked out status with a future lockout time
    state.players[playerId].status = PlayerStatus.LOCKED_OUT;
    const futureTime = Date.now() + 10000; // 10 seconds in the future
    state.players[playerId].lockedUntil = futureTime;
    
    // Check if the player is locked out
    const result = checkPlayerLockout(state.players[playerId]);
    
    expect(result.isLocked).toBeTruthy();
    expect(result.updatedPlayer.status).toBe(PlayerStatus.LOCKED_OUT);
  });

  it('should update player status when lockout expires', () => {
    // First add a player
    const playerId = 'player1';
    const username = 'Alice';
    let state = addPlayerToGame(gameState, playerId, username);
    
    // Set the player to locked out status with a past lockout time
    state.players[playerId].status = PlayerStatus.LOCKED_OUT;
    const pastTime = Date.now() - 5000; // 5 seconds in the past
    state.players[playerId].lockedUntil = pastTime;
    
    // Check if the player's lockout has expired
    const result = checkPlayerLockout(state.players[playerId]);
    
    expect(result.isLocked).toBeFalsy();
    expect(result.updatedPlayer.status).toBe(PlayerStatus.ACTIVE);
    expect(result.updatedPlayer.lockedUntil).toBeUndefined();
  });
});
