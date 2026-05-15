export const CHUNK_SIZE = 32;
export const GAME_ID = 'default';

// ── Client → Server ───────────────────────────────────────────────────────────

export type ClientMessage =
  | { type: 'join';        playerId: string }
  | { type: 'subscribe';   chunkX: number; chunkY: number }
  | { type: 'unsubscribe'; chunkX: number; chunkY: number }
  | { type: 'reveal';      worldX: number; worldY: number }
  | { type: 'flag';        worldX: number; worldY: number }
  | { type: 'chord';       worldX: number; worldY: number };

// ── Server → Client ───────────────────────────────────────────────────────────

export type ServerMessage =
  | { type: 'joined';     playerId: string }
  | { type: 'chunkState'; chunkX: number; chunkY: number; cells: CellState[] }
  | { type: 'chunkDelta'; chunkX: number; chunkY: number; revealed?: RevealedCell[]; flagged?: FlaggedCell[]; unflagged?: number[] }
  | { type: 'mineHit';    worldX: number; worldY: number }
  | { type: 'error';      message: string };

// ── Cell types (wire format) ──────────────────────────────────────────────────

export interface CellState {
  index: number;          // localY * CHUNK_SIZE + localX
  isMine: boolean;
  adjacentMines: number;
  revealedBy?: string;    // present ⟹ revealed
  flaggedBy?: string;     // present ⟹ flagged
}

export interface RevealedCell {
  index: number;
  isMine: boolean;
  adjacentMines: number;
  playerId: string;
}

export interface FlaggedCell {
  index: number;
  playerId: string;
}

// ── Chunk DO RPC types ────────────────────────────────────────────────────────

export interface ChunkStateResponse {
  chunkX: number;
  chunkY: number;
  cells: CellState[];
}

// Broadcast from Chunk DO → Session DO
export interface ChunkDelta {
  chunkX: number;
  chunkY: number;
  revealed?: RevealedCell[];
  flagged?: FlaggedCell[];
  unflagged?: number[];
  mineHit?: { worldX: number; worldY: number };
}

// Shared Env interface (no class refs to avoid circular imports)
export interface Env {
  SESSION_DO: DurableObjectNamespace;
  CHUNK_DO:   DurableObjectNamespace;
}
