/**
 * Represents a single cell on the Minesweeper board.
 */
export interface Cell {
  isMine: boolean;
  adjacentMines: number;
  revealed: boolean;
  flagged: boolean;
}

/**
 * Configuration for a game instance.
 */
export interface GameConfig {
    rows: number;
    cols: number;
    mines: number;
    mineLocations?: { row: number, col: number }[]; // Optional predefined mine locations
  isInfiniteWorld?: boolean; // Flag to indicate infinite world mode
}

/**
 * Represents the state of a cell sent to the client.
 * Hides sensitive information for unrevealed cells.
 */
export interface ClientCell {
  revealed: boolean;
  flagged: boolean;
  isMine?: boolean; // Only sent if revealed
  adjacentMines?: number; // Only sent if revealed and not a mine
}

/**
 * Coordinates for the infinite world mode
 */
export interface Coordinates {
  x: number;
  y: number;
}

/**
 * Viewport state for tracking player's view in infinite world
 */
export interface ViewportState {
  center: Coordinates;
  width: number;
  height: number;
  zoom: number;
}

/**
 * Represents the game board as a 2D array of Cells.
 */
export type Board = Cell[][];

/**
 * For infinite world, we use a sparse collection of revealed/flagged cells
 * keyed by coordinate string "x,y"
 */
export interface InfiniteWorldState {
  cells: Map<string, Cell>; // Stores only cells that have been interacted with
}

/**
 * Configuration for game scoring and penalties.
 */
export interface ScoringConfig {
  /** Points awarded for being the first to safely reveal a mine */
  firstPlacePoints: number;
  /** Points awarded for being the second to safely reveal a mine */
  secondPlacePoints: number;
  /** Points awarded for being the third to safely reveal a mine */
  thirdPlacePoints: number;
  /** Points awarded for revealing a numbered tile */
  numberRevealPoints: number;
  /** Additional points per adjacent mine (if enabled) */
  pointsPerAdjacentMine?: number;
  /** Points deducted for hitting a mine directly */
  mineHitPenalty: number;
  /** Lockout duration in milliseconds for hitting a mine */
  lockoutDurationMs: number;
  /** Delay in milliseconds before revealing mine to all players */
  mineRevealDelayMs: number;
}

/**
 * Player status in the game.
 */
export enum PlayerStatus {
  ACTIVE = 'active',
  LOCKED_OUT = 'locked_out'
}

/**
 * Extended player interface with status and lockout information.
 */
export interface Player {
  id: string; // Typically the socket ID
  score: number;
  username?: string; // Optional username
  status: PlayerStatus;
  lockedUntil?: number; // Timestamp when lockout ends (if locked)
  viewport?: ViewportState; // Player's current view in infinite world mode
}

/**
 * A map of player IDs to Player objects.
 */
export interface Players {
  [key: string]: Player;
}

/**
 * Represents a player's contribution to revealing a mine.
 */
export interface MineReveal {
  // For infinite world, we use x, y instead of row, col
  x?: number;
  y?: number;
  row?: number;
  col?: number;
  players: {
    playerId: string;
    position: number; // 1 for first, 2 for second, 3 for third
    timestamp: number;
  }[];
  revealed: boolean; // Whether this mine has been revealed to all players
  revealTimestamp?: number; // When the mine will be revealed to all
}

/**
 * Represents the complete state of a single game instance.
 */
export interface GameState {
    board: Board;
    players: Players;
    boardConfig: GameConfig;
    scoringConfig: ScoringConfig;
    mineReveals: MineReveal[]; // Track progress on each mine's reveal
  pendingReveals: { row?: number, col?: number, x?: number, y?: number }[]; // Mines waiting to be revealed
    gameOver: boolean;
    winner?: string;

  // For infinite world mode:
  infiniteWorldState?: InfiniteWorldState;
}

/**
 * Represents the data structure for revealing a tile.
 */
export interface RevealTilePayload {
  row?: number;
  col?: number;
  // For infinite world:
  x?: number;
  y?: number;
}

/**
 * Represents the data structure for flagging a tile.
 */
export interface FlagTilePayload {
  row?: number;
  col?: number;
  // For infinite world:
  x?: number;
  y?: number;
}

/**
 * Represents the data structure for chord clicking.
 */
export interface ChordClickPayload {
  row?: number;
  col?: number;
  // For infinite world:
  x?: number;
  y?: number;
}

/**
 * Represents the payload for updating a player's viewport.
 */
export interface ViewportUpdatePayload {
  center: Coordinates;
  width: number;
  height: number;
  zoom: number;
}

/**
 * Represents the data structure for joining a game.
 */
export type JoinGamePayload = string; // gameId

/**
 * Represents the payload for the 'gameState' event sent to clients.
 */
export interface GameStatePayload {
    boardState: ClientCell[][];
    boardConfig: GameConfig;
    players: Players;
  pendingReveals: { row?: number, col?: number, x?: number, y?: number }[]; // Mines with pending revelation
    gameOver: boolean;
    winner?: string;
    message?: string; // Optional message (e.g., game over reason)
  playerId?: string; // Player's own ID
}

/**
 * Represents the payload for the 'scoreUpdate' event sent to clients.
 */
export interface ScoreUpdatePayload {
  playerId: string;
  newScore: number;
  scoreDelta: number;
  reason: string;
}

/**
 * Represents the payload for the 'playerStatusUpdate' event sent to clients.
 */
export interface PlayerStatusUpdatePayload {
  playerId: string;
  status: PlayerStatus;
  lockedUntil?: number;
}

/**
 * Represents the payload for the 'playerViewportUpdate' event sent to clients.
 */
export interface PlayerViewportUpdatePayload {
  playerId: string;
  viewport: ViewportState;
}

/**
 * Represents the payload for the 'mineRevealed' event sent to clients.
 */
export interface MineRevealedPayload {
  row?: number;
  col?: number;
  x?: number;
  y?: number;
  revealedBy: {
    playerId: string;
    position: number;
    points: number;
  }[];
}

/**
 * Represents the payload for an error message sent to clients.
 */
export interface ErrorPayload {
  message: string;
}

/**
 * Represents the payload for the 'gameOver' event sent to clients.
 */
export interface GameOverPayload {
  boardState?: ClientCell[][];
  message?: string;
  winner?: string;
}
