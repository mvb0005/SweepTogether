// Basic types for the frontend game state

export interface CellState {
  isRevealed: boolean;
  isMine: boolean; // Note: Server might not send this until game over
  isFlagged: boolean;
  neighborMineCount: number;
  revealedBy?: string; // Player ID who revealed it
  flaggedBy?: string[]; // Player IDs who flagged it
}

export type BoardState = CellState[][];

export interface Player {
  id: string;
  score: number;
  name: string; // Or other identifying info
  isLocked: boolean;
  lockedUntil?: number; // Timestamp
}

export interface LeaderboardEntry {
  playerId: string;
  name: string;
  score: number;
}

export interface GameState {
  board: BoardState;
  players: Record<string, Player>; // Map player ID to Player object
  leaderboard: LeaderboardEntry[];
  gameOver: boolean;
  winner?: string; // Player ID or null
}

// Types for Socket Payloads (mirroring backend types)
export interface UpdateBoardPayload {
  board: BoardState;
}

export interface UpdatePlayersPayload {
  players: Record<string, Player>;
}

export interface GameOverPayload {
  winner?: string; // Player ID or null
  board: BoardState; // Final board state
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
