import { Server, Socket } from 'socket.io';
import {
  ErrorPayload,
  GameConfig
} from '../../domain/types';
import { CHUNK_SIZE } from '../../types/chunkTypes';
import { EventBus } from '../eventBus/EventBus';
import { SocketEventMap } from './socketEvents';
import { GameStateService, serializeChunk } from '../../application/gameStateService';
import { getPendingFillsRepository } from '../persistence/db';

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
        await gameStateService.createGame(gameId, defaultConfig);
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

      // getChunk loads from MongoDB on cache miss (async, persistence-aware)
      const chunk = await chunkManager.getChunk(chunkX, chunkY);

      // Join the chunk room
      const chunkRoom = `${gameId}_chunk_${chunkX}_${chunkY}`;
      socket.join(chunkRoom);

      // Process pending fills using the global BFS so back-propagation into
      // already-loaded neighbouring chunks works correctly.
      const chunkId = `${chunkX}_${chunkY}`;
      const fills = chunkManager.pendingFills.get(chunkId) ?? [];
      if (fills.length > 0) {
        chunkManager.pendingFills.delete(chunkId);
        try { await getPendingFillsRepository().delete(gameId, chunkId); } catch {}
        for (const fill of fills) {
          const globalX = chunkX * CHUNK_SIZE + fill.localX;
          const globalY = chunkY * CHUNK_SIZE + fill.localY;
          await gameStateService.runGlobalFloodFill(gameId, globalX, globalY, socket.id);
        }
      }

      socket.emit('chunkData', serializeChunk(chunk, gameId));
    } catch (error) {
      console.error('[subscribeToChunk] Error:', error);
      socket.emit('error', {
        message: 'Failed to subscribe to chunk',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // --- subscribeToChunks (bulk) ---
  // Joins all requested chunk rooms, then streams chunk data back to the client one
  // chunk at a time — already-cached chunks arrive immediately, uncached chunks are
  // built sequentially with event-loop yields between each so other clients aren't
  // blocked. Flood fills run after all chunks are loaded.
  socket.on('subscribeToChunks', async (data: { gameId: string; chunks: { chunkX: number; chunkY: number }[] }) => {
    const t0 = performance.now();
    const { gameId } = data;
    if (!gameStateService.gameExists(gameId)) {
      socket.emit('error', { message: `Game not found: ${gameId}` });
      return;
    }

    // Join all chunk rooms upfront so live broadcasts arrive even during build.
    for (const { chunkX, chunkY } of data.chunks) {
      socket.join(`${gameId}_chunk_${chunkX}_${chunkY}`);
    }

    const chunkManager = gameStateService.getChunkManager(gameId);
    const allFillPoints: { x: number; y: number }[] = [];

    // Stream chunks back as they're ready; collect pending fills along the way.
    await gameStateService.streamChunks(gameId, data.chunks, (chunk) => {
      const [chunkX, chunkY] = chunk.id.split('_').map(Number);
      socket.emit('chunkData', serializeChunk(chunk, gameId));
      const fills = chunkManager.pendingFills.get(chunk.id) ?? [];
      if (fills.length > 0) {
        chunkManager.pendingFills.delete(chunk.id);
        getPendingFillsRepository().delete(gameId, chunk.id).catch(() => {});
        for (const fill of fills) {
          allFillPoints.push({ x: chunkX * CHUNK_SIZE + fill.localX, y: chunkY * CHUNK_SIZE + fill.localY });
        }
      }
    });

    const streamMs = (performance.now() - t0).toFixed(1);

    // Enqueue flood fills — serialised per game so concurrent subscriptions
    // don't run competing BFS loops over the same open region.
    if (allFillPoints.length > 0) {
      gameStateService.enqueueFill(gameId, allFillPoints, socket.id);
    }

    console.log(`[subscribeToChunks] chunks=${data.chunks.length} fills=${allFillPoints.length} stream=${streamMs}ms socket=${socket.id}`);
  });

  // --- unsubscribeFromChunk (single, kept for compat) ---
  socket.on('unsubscribeFromChunk', (data: { gameId: string; chunkX: number; chunkY: number }) => {
    socket.leave(`${data.gameId}_chunk_${data.chunkX}_${data.chunkY}`);
  });

  // --- unsubscribeFromChunks (bulk) ---
  socket.on('unsubscribeFromChunks', (data: { gameId: string; chunks: { chunkX: number; chunkY: number }[] }) => {
    for (const { chunkX, chunkY } of data.chunks) {
      socket.leave(`${data.gameId}_chunk_${chunkX}_${chunkY}`);
    }
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