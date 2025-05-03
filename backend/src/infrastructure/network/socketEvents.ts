import {
  JoinGamePayload,
  RevealTilePayload,
  FlagTilePayload,
  ChordClickPayload,
  ViewportUpdatePayload,
  LeaderboardRequestPayload,
  LeaderboardResponsePayload,
  LeaderboardUpdatePayload,
  ScoreUpdatePayload,
  GameOverPayload
} from '../../domain/types';

export type SocketEventMap = {
  joinGame: JoinGamePayload & { socketId: string };
  revealTile: RevealTilePayload & { gameId: string; socketId: string };
  flagTile: FlagTilePayload & { gameId: string; socketId: string };
  chordClick: ChordClickPayload & { gameId: string; socketId: string };
  updateViewport: ViewportUpdatePayload & { gameId: string; socketId: string };
  playerDisconnected: { socketId: string };
  // Leaderboard events
  getLeaderboard: LeaderboardRequestPayload & { socketId: string };
  leaderboardData: LeaderboardResponsePayload;
  leaderboardUpdate: LeaderboardUpdatePayload;
  // Game events
  scoreUpdate: ScoreUpdatePayload & { gameId: string };
  gameOver: GameOverPayload & { gameId: string };
};

export type SocketEventName = keyof SocketEventMap;

export interface SocketEvent<T extends SocketEventName = SocketEventName> {
  name: T;
  payload: SocketEventMap[T];
}

// Socket.IO event names
export const socketEvents = {
  // Connection events
  CONNECTION: 'connection',
  DISCONNECT: 'disconnect',
  CONNECTION_ESTABLISHED: 'connectionEstablished',

  // Game lifecycle events
  CREATE_GAME: 'createGame',
  GAME_CREATED: 'gameCreated',
  JOIN_GAME: 'joinGame',
  GAME_JOINED: 'gameJoined',
  PLAYER_JOINED: 'playerJoined',
  PLAYER_LEFT: 'playerLeft',
  GAME_STATE: 'gameState',
  GAME_OVER: 'gameOver',

  // Player actions
  REVEAL_TILE: 'revealTile',
  FLAG_TILE: 'flagTile',
  CHORD_CLICK: 'chordClick',

  // Game updates
  BOARD_UPDATE: 'boardUpdate',
  SCORE_UPDATE: 'scoreUpdate',

  // Leaderboard
  GET_LEADERBOARD: 'getLeaderboard',
  LEADERBOARD_DATA: 'leaderboardData',
  LEADERBOARD_UPDATED: 'leaderboardUpdated',

  // Error handling
  ERROR: 'error'
};

// Define event payload types for TypeScript
export interface SocketEventPayloads {
  // Connection events
  [socketEvents.CONNECTION_ESTABLISHED]: { socketId: string };

  // Game lifecycle events
  [socketEvents.CREATE_GAME]: { rows: number, cols: number, mines: number, isInfiniteWorld: boolean };
  [socketEvents.GAME_CREATED]: { gameId: string, boardConfig: any };
  [socketEvents.JOIN_GAME]: { gameId: string, username: string };
  [socketEvents.GAME_JOINED]: { gameId: string, playerId: string, username: string };
  [socketEvents.PLAYER_JOINED]: { gameId: string, playerId: string, username: string };
  [socketEvents.PLAYER_LEFT]: { gameId: string, playerId: string, username: string };
  [socketEvents.GAME_STATE]: { gameId: string, cells: any[], players: any[], scores: any };
  [socketEvents.GAME_OVER]: { gameId: string, winner?: string, minePositions: any[] };

  // Player actions
  [socketEvents.REVEAL_TILE]: { gameId: string, x: number, y: number };
  [socketEvents.FLAG_TILE]: { gameId: string, x: number, y: number };
  [socketEvents.CHORD_CLICK]: { gameId: string, x: number, y: number };

  // Game updates
  [socketEvents.BOARD_UPDATE]: { gameId: string, cells: any[] };
  [socketEvents.SCORE_UPDATE]: { gameId: string, playerId: string, score: number };

  // Leaderboard
  [socketEvents.GET_LEADERBOARD]: { category: string, metric: string, limit?: number };
  [socketEvents.LEADERBOARD_DATA]: { category: string, metric: string, entries: any[] };
  [socketEvents.LEADERBOARD_UPDATED]: { category: string, metric: string, entries: any[] };

  // Error handling
  [socketEvents.ERROR]: { message: string, code: string };
}
