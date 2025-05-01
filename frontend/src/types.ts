// Basic types for the frontend game state

export interface CellState {
  revealed: boolean;
  flagged: boolean;
  isMine?: boolean; // Note: Server might not send this until game over
  adjacentMines?: number; // Using same property name as backend
}

export type BoardState = CellState[][];

export interface Player {
  id: string;
  score: number;
  username?: string; // Changed from name to username to match backend
  isLocked?: boolean;
  lockedUntil?: number; // Timestamp
  status?: string; // Player status from backend (ACTIVE, LOCKED_OUT, etc.)
}

export interface LeaderboardEntry {
  playerId: string;
  username?: string; // Changed from name to username to match backend
  score: number;
}

export interface GameState {
  board: BoardState;
  players: Record<string, Player>; // Map player ID to Player object
  leaderboard: LeaderboardEntry[];
  gameOver: boolean;
  winner?: string; // Player ID or null
}

// Updated types for Socket Payloads (matching backend)
export interface GameStatePayload {
  boardState: BoardState;
  boardConfig?: { rows: number; cols: number; mines: number };
  players: Record<string, Player>;
  pendingReveals?: any[]; // Backend specific data
  gameOver: boolean;
  winner?: string;
  message?: string;
  playerId?: string; // Server might include the player's ID in responses
}

export interface UpdateBoardPayload {
  board: BoardState;
}

export interface UpdatePlayersPayload {
  players: Record<string, Player>;
}

export interface GameOverPayload {
  boardState?: BoardState; // Changed from 'board' to 'boardState' to match backend
  message?: string;
  winner?: string; // Player ID or null
}

export interface PlayerLockoutPayload {
  playerId: string;
  lockedUntil: number; // Timestamp
}

export interface PlayerUnlockPayload {
  playerId: string;
}

export interface UpdateLeaderboardPayload {
  leaderboard: LeaderboardEntry[];
}

export interface GameJoinedPayload {
    playerId: string;
    gameState: GameState;
}
