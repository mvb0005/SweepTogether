import { SpatialHashGrid } from './spatialHashGrid';

// --- Basic Coordinates & Cell Types ---

export interface Coordinates {
  x: number;
  y: number;
}

// Represents the minimal data stored per point in the spatial grid (revealed/flagged state)
export interface PointData {
  revealed?: boolean;
  flagged?: boolean;
  // Add other grid-specific state if needed, but keep minimal
}

// Represents the full state of a cell, including inherent properties
export interface Cell {
  x: number; // Added coordinates to the cell itself
  y: number; // Added coordinates to the cell itself
  isMine: boolean;
  adjacentMines: number; // Number of mines in 8 surrounding cells
  revealed: boolean;
  flagged: boolean;
  // Potentially add: revealedByPlayerId?: string;
}

// Enum to represent the visual state, derived from boolean flags
export enum CellState {
  HIDDEN = 'hidden',
  REVEALED = 'revealed',
  FLAGGED = 'flagged',
  REVEALED_MINE = 'revealed_mine' // Special state for a mine hit by the player
}

// Represents the state of a cell sent to the client
// Hides mine locations unless revealed
export interface ClientCell {
  revealed: boolean;
  flagged: boolean;
  isMine?: boolean; // Only sent if revealed
  adjacentMines?: number; // Only sent if revealed and not a mine
}

// --- Game Configuration ---

export interface GameConfig {
  rows: number; // 0 for infinite
  cols: number; // 0 for infinite
  mines: number; // Total mines for fixed board, density factor for infinite?
  isInfiniteWorld: boolean;
  mineLocations?: Coordinates[]; // Predefined mine locations for fixed boards
}

export const DEFAULT_SCORING_CONFIG = {
  firstPlacePoints: 5,
  secondPlacePoints: 3,
  thirdPlacePoints: 1,
  numberRevealPoints: 1,
  mineHitPenalty: 10,
  lockoutDurationMs: 5000, // 5 seconds
  mineRevealDelayMs: 3000, // 3 seconds
  flagPlacePoints: 2,      // Points for placing a flag
  flagRemovePoints: 0,     // Points for removing a flag
};

export interface ScoringConfig {
  firstPlacePoints: number;
  secondPlacePoints: number;
  thirdPlacePoints: number;
  numberRevealPoints: number;
  mineHitPenalty: number;
  lockoutDurationMs: number;
  mineRevealDelayMs: number;
  flagPlacePoints: number; // Points awarded for placing a flag
  flagRemovePoints: number; // Points awarded for removing a flag (can be 0)
}

// --- Player State ---

export enum PlayerStatus {
  ACTIVE = 'active',
  LOCKED_OUT = 'locked_out',
  // DISCONNECTED = 'disconnected' // Maybe handled by presence in Players map
}

export interface ViewportState {
  center: Coordinates;
  width: number; // Viewport width in cells
  height: number; // Viewport height in cells
  zoom: number; // Optional zoom level
}

export interface Player {
  id: string;
  username: string;
  score: number;
  status: PlayerStatus;
  lockedUntil?: number; // Timestamp when lockout ends
  viewport?: ViewportState; // For infinite worlds
}

export type Players = Record<string, Player>;

// --- Game State ---

// Represents a player's contribution to revealing a mine
export interface MineRevealPlayerContribution {
  playerId: string;
  position: number; // 1st, 2nd, 3rd
  timestamp: number;
  points: number; // Points awarded for this position
}

// Represents the state of a mine being revealed
export interface MineReveal {
  x: number;
  y: number;
  players: MineRevealPlayerContribution[];
  revealed: boolean; // True once the reveal delay passes
  revealTimestamp?: number; // Timestamp when it should be revealed
}

// Represents the overall state of a game instance
export interface GameState {
  gameId: string;
  boardConfig: GameConfig;
  scoringConfig: ScoringConfig;
  players: Players;
  mineReveals: MineReveal[]; // Tracks who flagged which mines and when
  pendingReveals: Coordinates[]; // Coordinates of mines flagged but not yet revealed
  gameOver: boolean;
  winner?: string; // Player ID of the winner, if applicable

  // For infinite worlds:
  spatialGrid?: SpatialHashGrid<PointData>;

  // For fixed-size boards (optional, mutually exclusive with spatialGrid?):
  // board?: Cell[][]; // Consider if this is needed if fixed boards aren't the focus
}

// --- Persistence Layer Interface ---

// Interface for saving/loading game state and grid chunks
export interface GameRepository {
  saveGame(gameState: Partial<GameState> & { gameId: string }): Promise<void>; // Allow partial updates
  findGameById(gameId: string): Promise<Partial<GameState> | null>; // Return potentially partial data
  saveChunk(gameId: string, chunkId: string, chunkData: Map<string, PointData>): Promise<void>;
  findChunk(gameId: string, chunkId: string): Promise<Map<string, PointData> | null>;
  // Add methods for loading all chunks for a game if needed during loadGame
  // findAllChunks?(gameId: string): Promise<Record<string, Map<string, PointData>>>;
}

// --- Socket Payloads (Incoming/Outgoing) ---

// Incoming Payloads (Client -> Server)
export interface JoinGamePayload {
  gameId?: string; // Optional: if joining specific game
  username?: string;
  config?: Partial<GameConfig>; // Optional: if creating a new game
  scoringConfig?: Partial<ScoringConfig>; // Optional: if creating a new game
}

export interface RevealTilePayload extends Coordinates { }
export interface FlagTilePayload extends Coordinates { }
export interface ChordClickPayload extends Coordinates { }
export interface ViewportUpdatePayload extends ViewportState { }

// Outgoing Payloads (Server -> Client)

// Represents the full game state sent to a player on join
export interface GameStatePayload {
  gameId: string;
  // Use Map for infinite boards, Array for fixed boards
  boardState: ClientCell[][] | Map<string, ClientCell>;
  boardConfig: GameConfig;
  scoringConfig: ScoringConfig;
  players: Players;
  pendingReveals: Coordinates[]; // List of mines about to be revealed
  gameOver: boolean;
  winner?: string;
  playerId: string; // The ID of the player receiving this state
}

// Partial board update for viewport changes
export interface BoardStateUpdatePayload {
  boardState: ClientCell[][] | Map<string, ClientCell>;
}

// Update for individual or multiple tiles
export type TileUpdatePayload = (Coordinates & ClientCell);
export type TilesUpdatePayload = TileUpdatePayload[]; // For multiple updates (reveal, chord)

export interface ScoreUpdatePayload {
  playerId: string;
  newScore: number;
  scoreDelta: number;
  reason: string; // e.g., 'Flag Mine (Pos 1)', 'Hit Mine', 'Reveal Number'
}

export interface PlayerStatusUpdatePayload {
  playerId: string;
  status: PlayerStatus;
  lockedUntil?: number;
}

export interface PlayerJoinedPayload extends Player { }
export interface PlayerLeftPayload {
  playerId: string;
}

// Payload when a mine is officially revealed after the delay
export interface MineRevealedPayload {
  x: number;
  y: number;
  revealedBy: MineRevealPlayerContribution[]; // Includes player IDs, positions, and points awarded
}

export interface GameOverPayload {
  winner?: string; // Player ID
  // Could include final scores here too
}

export interface ErrorPayload {
  message: string;
  details?: any;
}

// Payload for player viewport updates (infinite world)
export interface PlayerViewportUpdatePayload {
  playerId: string;
  viewport: ViewportState;
}

// --- Leaderboard Types ---

export enum LeaderboardCategory {
  ALL_TIME = 'all_time',
  DAILY = 'daily',
  WEEKLY = 'weekly'
}

export enum LeaderboardMetric {
  HIGHEST_SCORE = 'highest_score',
  MOST_MINES_FOUND = 'most_mines_found',
  MOST_CELLS_REVEALED = 'most_cells_revealed',
  MOST_GAMES_WON = 'most_games_won'
}

export interface LeaderboardEntry {
  playerId: string;
  username: string;
  score: number;       // Value of the metric (e.g., total score, mines found)
  gamesPlayed: number;
  lastGameId?: string; // The ID of the last game that affected this entry
  updatedAt: Date;    // When this entry was last updated
}

export interface LeaderboardData {
  category: LeaderboardCategory;
  metric: LeaderboardMetric;
  entries: LeaderboardEntry[];
}

export interface LeaderboardUpdatePayload {
  category: LeaderboardCategory;
  metric: LeaderboardMetric;
  entries: LeaderboardEntry[];
  updatedAt: Date;
}

// --- Payload for leaderboard data request and response ---
export interface LeaderboardRequestPayload {
  category: LeaderboardCategory;
  metric: LeaderboardMetric;
  limit?: number;      // Maximum number of entries to return
}

export interface LeaderboardResponsePayload extends LeaderboardData {
  updatedAt: Date;
}
