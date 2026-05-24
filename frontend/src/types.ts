export interface CellState {
  x: number;
  y: number;
  revealed: boolean;
  flagged: boolean;
  isMine?: boolean;
  adjacentMines?: number;
}

export interface Coordinates {
  x: number;
  y: number;
}

export interface ViewportState {
  center: { x: number; y: number };
  width: number;
  height: number;
  scale: number;
}

export interface Player {
  id: string;
  username: string;
  score: number;
  isLocked?: boolean;
}

export interface LeaderboardEntry {
  playerId: string;
  username: string;
  score: number;
}

export interface ChunkCoords {
  x: number;
  y: number;
}

export interface Chunk {
  coords: ChunkCoords;
  cells: CellState[][];
}

export type ChunkMap = Record<string, Chunk>;

export const chunkCoordsToKey = (coords: ChunkCoords): string =>
  `${coords.x}_${coords.y}`;
