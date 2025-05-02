import {
  Board, Cell, GameConfig, MineReveal, Player, PlayerStatus,
  Coordinates, ScoreUpdatePayload, PlayerStatusUpdatePayload
} from './types';

// Define GameStateEnum as an enum for runtime usage
export enum GameStateEnum {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED'
}

// Define GameState as an interface for the game state structure
export interface GameState {
  gameId: string;
  state: GameStateEnum;
  players: Record<string, Player>;
  boardConfig: {
    isInfiniteWorld: boolean;
  };
}
import { BoardImpl } from './board';

// --- Type Definition for Cell Retrieval ---

/**
 * Function signature for retrieving a cell's state.
 * Handles fetching from board, spatial grid, or generating if needed.
 */
export type GetCellFunction = (gameState: GameState, x: number, y: number) => Promise<Cell | null>;

// --- Constants ---

export const DEFAULT_SCORING_CONFIG = {
  firstPlacePoints: 10,
  secondPlacePoints: 5,
  thirdPlacePoints: 2,
  numberRevealPoints: 1,
  mineHitPenalty: 50,
  lockoutDurationMs: 5000,
  mineRevealDelayMs: 3000
};

// --- Domain Logic Functions ---

/**
 * Adds a player to the game state.
 * @param gameState The current game state.
 * @param playerId The ID of the player to add.
 * @param username The username for the player.
 * @returns The updated GameState.
 */
export function addPlayerToGame(gameState: GameState, playerId: string, username: string): GameState {
  if (gameState.players[playerId]) {
    console.warn(`Player ${playerId} already in game ${gameState.gameId}.`);
    return gameState;
  }
  
  const newPlayer: Player = {
    id: playerId,
    username: username,
    score: 0,
    status: PlayerStatus.ACTIVE,
    viewport: gameState.boardConfig.isInfiniteWorld ? 
      { center: { x: 0, y: 0 }, width: 20, height: 15, zoom: 1 } : 
      undefined,
  };
  
  return {
    ...gameState,
    players: {
      ...gameState.players,
      [playerId]: newPlayer,
    },
  };
}

/**
 * Removes a player from the game state.
 * @param gameState The current game state.
 * @param playerId The ID of the player to remove.
 * @returns The updated GameState.
 */
export function removePlayerFromGame(gameState: GameState, playerId: string): GameState {
  if (!gameState.players[playerId]) {
    return gameState;
  }
  
  const updatedPlayers = { ...gameState.players };
  delete updatedPlayers[playerId];
  
  return {
    ...gameState,
    players: updatedPlayers
  };
}

/**
 * Checks if a player is currently locked out and updates status if expired.
 * @param player The player object.
 * @param now The current timestamp.
 * @returns Object indicating if locked and the potentially updated player object.
 */
export function checkPlayerLockout(player: Player, now: number = Date.now()): { isLocked: boolean; updatedPlayer: Player } {
  if (player.status !== PlayerStatus.LOCKED_OUT) {
    return { isLocked: false, updatedPlayer: player };
  }

  if (player.lockedUntil && player.lockedUntil <= now) {
    const updatedPlayer = { 
      ...player, 
      status: PlayerStatus.ACTIVE, 
      lockedUntil: undefined 
    };
    return { isLocked: false, updatedPlayer };
  }

  return { isLocked: true, updatedPlayer: player };
}

// ... other existing functions ...

/**
 * The Game class manages game state and board interactions
 */
export class Game {
  readonly id: string;
  readonly config: GameConfig;
  readonly board: BoardImpl;
  players: Map<string, Player>;
  state: GameStateEnum;
  private broadcastUpdate: (gameId: string, state: any) => void;

  constructor(id: string, config: GameConfig, broadcastUpdate: (gameId: string, state: any) => void) {
    this.id = id;
    this.config = config;
    this.board = new BoardImpl(config.rows, config.cols, config.mines);
    this.players = new Map();
    this.state = GameStateEnum.PENDING;
    this.broadcastUpdate = broadcastUpdate;
  }

  // ... existing methods ...
}