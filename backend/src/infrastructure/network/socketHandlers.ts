import { Server, Socket } from 'socket.io';
import {
  ErrorPayload,
  GameConfig
} from '../../domain/types';
import { CHUNK_SIZE } from '../../types/chunkTypes';
import { EventBus } from '../eventBus/EventBus';
import { SocketEventMap } from './socketEvents';
import { GameStateService } from '../../application/gameStateService';

/**
 * Helper function to emit error messages to a client
 *
 * @param socket - The socket to emit the error to
 * @param message - The error message
 */
export function emitError(socket: Socket, message: string): void {
  console.error(`Error for socket ${socket.id}: ${message}`);
  const payload: ErrorPayload = { message };
  socket.emit('error', payload);
}

/**
 * Register WebSocket event handlers for a socket, delegating logic to EventBus
 * and handling joinGame / subscribeToChunk directly.
 *
 * @param io - The Socket.IO server instance
 * @param socket - The socket to set up handlers for
 * @param eventBus - The event bus instance
 * @param gameStateService - The game state service instance
 */
export function registerSocketHandlers(
  io: Server,
  socket: Socket,
  eventBus: EventBus<SocketEventMap>,
  gameStateService: GameStateService
) {
  console.log(`New client connected: ${socket.id}`);

  // --- joinGame ---
  socket.on('joinGame', async (data: { gameId: string; username?: string }) => {
    try {
      const { gameId, username = 'Anonymous' } = data;
      if (!gameStateService.gameExists(gameId)) {
        const defaultConfig: GameConfig = {
          isInfiniteWorld: true,
          rows: 16,
          cols: 16,
          mines: 40,
        };
        gameStateService.createGame(gameId, defaultConfig);
      }
      const playerId = socket.id;
      gameStateService.addPlayer(gameId, playerId, username);
      socket.join(gameId);
      socket.data.gameId = gameId;
      const gameState = gameStateService.getGame(gameId);
      console.log(`[joinGame] Player ${username} (${playerId}) joined game ${gameId}`);
      socket.emit('gameJoined', {
        gameId,
        playerId,
        players: gameState?.players ?? {},
      });
      socket.to(gameId).emit('playerJoined', {
        gameId,
        playerId,
        username,
        players: gameState?.players ?? {},
      });
    } catch (error) {
      console.error('[joinGame] Error:', error);
      socket.emit('error', {
        message: 'Failed to join game',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // --- subscribeToChunk ---
  socket.on('subscribeToChunk', async (data: { gameId: string; chunkX: number; chunkY: number; playerId?: string }) => {
    try {
      const { gameId, chunkX, chunkY } = data;
      console.log(`[subscribeToChunk] gameId=${gameId}, chunk=(${chunkX},${chunkY}), socket=${socket.id}`);
      if (!gameStateService.gameExists(gameId)) {
        throw new Error(`Game not found: ${gameId}`);
      }
      const chunkManager = gameStateService.getChunkManager(gameId);

      // getChunk auto-creates the chunk if it doesn't yet exist
      const chunk = chunkManager.getChunk(chunkX, chunkY);

      // Join the chunk room
      const chunkRoom = `${gameId}_chunk_${chunkX}_${chunkY}`;
      socket.join(chunkRoom);

      // Process pending fills using the global BFS so back-propagation into
      // already-loaded neighbouring chunks works correctly.
      const chunkId = `${chunkX}_${chunkY}`;
      const fills = chunkManager.pendingFills.get(chunkId) ?? [];
      if (fills.length > 0) {
        chunkManager.pendingFills.delete(chunkId);
        for (const fill of fills) {
          const globalX = chunkX * CHUNK_SIZE + fill.localX;
          const globalY = chunkY * CHUNK_SIZE + fill.localY;
          await gameStateService.runGlobalFloodFill(gameId, globalX, globalY);
        }
      }

      // Send the initial chunk data to the subscribing socket
      const filteredTiles = chunk.tiles.map(row =>
        row.map(cell => ({
          x: cell.x,
          y: cell.y,
          revealed: cell.revealed,
          flagged: cell.flagged,
          ...(cell.revealed && {
            isMine: cell.isMine,
            adjacentMines: cell.adjacentMines,
          }),
        }))
      );
      socket.emit('chunkData', { gameId, chunkX, chunkY, tiles: filteredTiles });
    } catch (error) {
      console.error('[subscribeToChunk] Error:', error);
      socket.emit('error', {
        message: 'Failed to subscribe to chunk',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // --- unsubscribeFromChunk ---
  socket.on('unsubscribeFromChunk', (data: { gameId: string; chunkX: number; chunkY: number }) => {
    const { gameId, chunkX, chunkY } = data;
    const chunkRoom = `${gameId}_chunk_${chunkX}_${chunkY}`;
    socket.leave(chunkRoom);
  });

  // Dynamically register handlers for only the events with subscribers
  const eventNames = eventBus.getSubscribedEventNames();
  for (const eventName of eventNames) {
    socket.on(eventName as string, (data: any) => {
      let payload: any = { ...data, socketId: socket.id };
      if ('gameId' in socket.data && !payload.gameId) {
        payload.gameId = socket.data.gameId;
      }
      eventBus.publish(eventName, payload);
    });
  }

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    eventBus.publish('playerDisconnected', { socketId: socket.id });
  });
}