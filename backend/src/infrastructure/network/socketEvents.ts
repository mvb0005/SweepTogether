import {
  JoinGamePayload,
  RevealTilePayload,
  FlagTilePayload,
  ChordClickPayload,
  ViewportUpdatePayload
} from '../../domain/types';

export type SocketEventMap = {
  joinGame: JoinGamePayload & { socketId: string };
  revealTile: RevealTilePayload & { gameId: string; socketId: string };
  flagTile: FlagTilePayload & { gameId: string; socketId: string };
  chordClick: ChordClickPayload & { gameId: string; socketId: string };
  updateViewport: ViewportUpdatePayload & { gameId: string; socketId: string };
  playerDisconnected: { socketId: string };
};

export type SocketEventName = keyof SocketEventMap;

export interface SocketEvent<T extends SocketEventName = SocketEventName> {
  name: T;
  payload: SocketEventMap[T];
}
