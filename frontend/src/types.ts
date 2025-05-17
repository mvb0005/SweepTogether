// Basic types for the frontend game state

export interface CellState {
  x: number;
  y: number;
  revealed: boolean;
  flagged: boolean;
  isMine?: boolean; // Note: Server might not send this until game over
  adjacentMines?: number; // Using same property name as backend
}

// Adding coordinate types for infinite world mode
export interface Coordinates {
  x: number;
  y: number;
}

export interface ViewportState {
  center: { x: number; y: number };
  width: number;
  height: number;
  scale: number;
  panStart?: { x: number; y: number };
}

export type BoardState = CellState[][];

export interface Player {
  id: string;
  score: number;
  username?: string; // Changed from name to username to match backend
  isLocked?: boolean;
  lockedUntil?: number; // Timestamp
  status?: string; // Player status from backend (ACTIVE, LOCKED_OUT, etc.)
  viewport?: ViewportState; // Add viewport information to player
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

// --- Chunk-based Board Types ---
export interface ChunkCoords {
  x: number;
  y: number;
}

export interface Chunk {
  coords: ChunkCoords;
  cells: CellState[][]; // 2D array of cells within the chunk
  isLoading?: boolean; // For frontend loading state
}

export type ChunkMap = Record<string, Chunk>;

// Utility to convert coords to a string key
export const chunkCoordsToKey = (coords: ChunkCoords): string => {
  return `${coords.x}_${coords.y}`;
};

export const keyToChunkCoords = (key: string): ChunkCoords => {
  const [x, y] = key.split('_').map(Number);
  return { x, y };
};

// --- Chunk Subscription Socket Payloads ---
export interface SubscribeChunksPayload {
  chunks: ChunkCoords[];
}

export interface UnsubscribeChunksPayload {
  chunks: ChunkCoords[];
}

export interface ChunkUpdatePayload {
  chunk: Chunk;
}
