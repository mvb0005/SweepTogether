import { Server, Socket } from 'socket.io';
import {
  ErrorPayload,
  GameConfig
} from '../../domain/types';
import { CHUNK_SIZE } from '../../types/chunkTypes';
import { EventBus } from '../eventBus/EventBus';
import { SocketEventMap } from './socketEvents';
import { GameStateService } from '../../application/gameStateService';
import { ChunkWireData, invalidateChunkWireCache, serializeChunkWire } from '../../application/chunkWire';
import { ChunkManager } from '../../domain/ChunkManager';
import { telemetryService } from '../../application/telemetryService';
import { TelemetryBatchPayload } from '../../types/telemetryTypes';
import { getPendingFillsRepository } from '../persistence/db';

const CHUNK_SUB_DEBOUNCE_MS = 50;

interface PendingChunkSubs {
  gameId: string;
  chunks: Map<string, { chunkX: number; chunkY: number }>;
  timer: ReturnType<typeof setTimeout> | null;
  processing: boolean;
}

const pendingChunkSubsBySocket = new Map<string, PendingChunkSubs>();

function getPendingSubs(socketId: string, gameId: string): PendingChunkSubs {
  let state = pendingChunkSubsBySocket.get(socketId);
  if (!state) {
    state = { gameId, chunks: new Map(), timer: null, processing: false };
    pendingChunkSubsBySocket.set(socketId, state);
  }
  return state;
}

function clearPendingSubs(socketId: string): void {
  const state = pendingChunkSubsBySocket.get(socketId);
  if (state?.timer) clearTimeout(state.timer);
  pendingChunkSubsBySocket.delete(socketId);
}

const MAX_SUBSCRIBE_FILL_SEEDS = 300;
const EVICT_DEBOUNCE_MS = 400;
const evictTimersByGame = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleEvictUnsubscribed(gameStateService: GameStateService, gameId: string): void {
  const existing = evictTimersByGame.get(gameId);
  if (existing) clearTimeout(existing);
  evictTimersByGame.set(gameId, setTimeout(() => {
    evictTimersByGame.delete(gameId);
    gameStateService.evictUnsubscribedChunksAsync(gameId).catch(err => {
      console.error('[subscribeToChunks] evict failed:', err);
    });
  }, EVICT_DEBOUNCE_MS));
}

function collectFillPoints(
  chunkManager: ChunkManager,
  gameId: string,
  chunkX: number,
  chunkY: number,
  maxTake?: number,
): { x: number; y: number }[] {
  const chunkId = `${chunkX}_${chunkY}`;
  const fills = chunkManager.pendingFills.get(chunkId) ?? [];
  if (fills.length === 0) return [];
  const takeCount = maxTake !== undefined ? Math.min(maxTake, fills.length) : fills.length;
  const taken = fills.splice(0, takeCount);
  if (fills.length === 0) {
    chunkManager.pendingFills.delete(chunkId);
    getPendingFillsRepository().delete(gameId, chunkId).catch(() => {});
  } else {
    chunkManager.pendingFills.set(chunkId, fills);
    getPendingFillsRepository().save(gameId, chunkId, fills).catch(() => {});
  }
  return taken.map(fill => ({
    x: chunkX * CHUNK_SIZE + fill.localX,
    y: chunkY * CHUNK_SIZE + fill.localY,
  }));
}

async function flushChunkSubscriptions(
  socket: Socket,
  gameStateService: GameStateService,
): Promise<void> {
  const state = pendingChunkSubsBySocket.get(socket.id);
  if (!state || state.processing || state.chunks.size === 0) return;

  state.processing = true;
  const { gameId } = state;
  const coords = Array.from(state.chunks.values());
  state.chunks.clear();

  try {
    if (!gameStateService.gameExists(gameId)) {
      socket.emit('error', { message: `Game not found: ${gameId}` });
      return;
    }

    const chunkManager = gameStateService.getChunkManager(gameId) as ChunkManager;
    const t0 = performance.now();

    const cachedBatch: ChunkWireData[] = [];
    const uncachedCoords: { chunkX: number; chunkY: number }[] = [];
    for (const { chunkX, chunkY } of coords) {
      const chunk = chunkManager.getChunkById(`${chunkX}_${chunkY}`);
      if (chunk) {
        cachedBatch.push(serializeChunkWire(chunk, gameId));
      } else {
        uncachedCoords.push({ chunkX, chunkY });
      }
    }

    if (cachedBatch.length > 0) {
      socket.emit('chunksData', cachedBatch);
    }

    const allFillPoints: { x: number; y: number }[] = [];
    let fillBudget = MAX_SUBSCRIBE_FILL_SEEDS;
    let uncachedBatch: ChunkWireData[] = [];

    const tryCollectFills = (chunkX: number, chunkY: number) => {
      if (fillBudget <= 0) return;
      const points = collectFillPoints(chunkManager, gameId, chunkX, chunkY, fillBudget);
      fillBudget -= points.length;
      allFillPoints.push(...points);
    };

    if (uncachedCoords.length > 0) {
      await gameStateService.streamChunks(gameId, uncachedCoords, (wire) => {
        uncachedBatch.push(wire);
      });

        for (const { chunkX, chunkY } of uncachedCoords) {
          const chunkId = `${chunkX}_${chunkY}`;
          if (chunkManager.hasPendingFills(chunkX, chunkY) && !chunkManager.getChunkById(chunkId)) {
            chunkManager.materializeChunk(chunkX, chunkY);
          }
          tryCollectFills(chunkX, chunkY);
        }

      if (uncachedBatch.length > 0) {
        socket.emit('chunksData', uncachedBatch);
      }
    }

    for (const { chunkX, chunkY } of coords) {
      if (fillBudget <= 0) break;
      if (uncachedCoords.some(c => c.chunkX === chunkX && c.chunkY === chunkY)) continue;
      tryCollectFills(chunkX, chunkY);
    }

    if (allFillPoints.length > 0) {
      setImmediate(() => gameStateService.enqueueFill(gameId, allFillPoints, socket.id));
    }

    scheduleEvictUnsubscribed(gameStateService, gameId);

    console.log(
      `[subscribeToChunks] chunks=${coords.length} cached=${cachedBatch.length} uncached=${uncachedCoords.length} fills=${allFillPoints.length} stream=${(performance.now() - t0).toFixed(1)}ms socket=${socket.id}`
    );
  } finally {
    state.processing = false;
    if (state.chunks.size > 0) {
      setImmediate(() => { void flushChunkSubscriptions(socket, gameStateService); });
    }
  }
}

function scheduleChunkSubscription(
  socket: Socket,
  gameId: string,
  chunks: { chunkX: number; chunkY: number }[],
  gameStateService: GameStateService,
): void {
  const state = getPendingSubs(socket.id, gameId);
  state.gameId = gameId;

  for (const { chunkX, chunkY } of chunks) {
    state.chunks.set(`${chunkX}_${chunkY}`, { chunkX, chunkY });
    socket.join(`${gameId}_chunk_${chunkX}_${chunkY}`);
  }

  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    state.timer = null;
    void flushChunkSubscriptions(socket, gameStateService);
  }, CHUNK_SUB_DEBOUNCE_MS);
}

/**
 * Helper function to emit error messages to a client
 */
export function emitError(socket: Socket, message: string): void {
  console.error(`Error for socket ${socket.id}: ${message}`);
  const payload: ErrorPayload = { message };
  socket.emit('error', payload);
}

export function registerSocketHandlers(
  io: Server,
  socket: Socket,
  eventBus: EventBus<SocketEventMap>,
  gameStateService: GameStateService
) {
  console.log(`New client connected: ${socket.id}`);

  socket.on('joinGame', async (data: {
    gameId: string;
    username?: string;
    avatarUrl?: string;
    discordUserId?: string;
  }) => {
    try {
      const { gameId, username = 'Anonymous', avatarUrl, discordUserId } = data;
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
      gameStateService.addPlayer(gameId, playerId, username, avatarUrl, discordUserId);
      socket.join(gameId);
      socket.data.gameId = gameId;
      const gameState = gameStateService.getGame(gameId);
      console.log(`[joinGame] Player ${username} (${playerId}) joined game ${gameId}`);
      socket.emit('gameJoined', {
        gameId,
        playerId,
        players: gameState?.players ?? {},
        playerPositions: gameStateService.listPlayerPositions(gameId),
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

  socket.on('subscribeToChunk', async (data: { gameId: string; chunkX: number; chunkY: number; playerId?: string }) => {
    try {
      const { gameId, chunkX, chunkY } = data;
      if (!gameStateService.gameExists(gameId)) {
        throw new Error(`Game not found: ${gameId}`);
      }
      const chunkManager = gameStateService.getChunkManager(gameId) as ChunkManager;
      const chunk = await chunkManager.getChunk(chunkX, chunkY);
      socket.join(`${gameId}_chunk_${chunkX}_${chunkY}`);

      const fillPoints = collectFillPoints(chunkManager, gameId, chunkX, chunkY);
      if (fillPoints.length > 0) {
        gameStateService.enqueueFill(gameId, fillPoints, socket.id);
      }

      socket.emit('chunkData', serializeChunkWire(chunk, gameId));
    } catch (error) {
      console.error('[subscribeToChunk] Error:', error);
      socket.emit('error', {
        message: 'Failed to subscribe to chunk',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  socket.on('subscribeToChunks', (data: { gameId: string; chunks: { chunkX: number; chunkY: number }[] }) => {
    scheduleChunkSubscription(socket, data.gameId, data.chunks, gameStateService);
  });

  socket.on('movePlayer', (data: { gameId?: string; dx: number; dy: number }) => {
    const gameId = data.gameId ?? (socket.data.gameId as string | undefined);
    if (!gameId) return;
    const playerId = socket.id;
    const result = gameStateService.movePlayer(gameId, playerId, data.dx, data.dy);
    if (!result) return;
    socket.to(gameId).emit('playerMoved', { playerId, x: result.x, y: result.y });
    socket.emit('playerMoved', { playerId, x: result.x, y: result.y });
  });

  socket.on('telemetryEvents', (data: TelemetryBatchPayload) => {
    if (!data?.events?.length) return;
    telemetryService.ingest(data.events);
    telemetryService.logBatch(data.sessionId, data.variant, data.events.length);
    for (const event of data.events) {
      if (event.durationMs === undefined) continue;
      const attrs = event.attrs
        ? ' ' + Object.entries(event.attrs).map(([k, v]) => `${k}=${v}`).join(' ')
        : '';
      console.log(`[telemetry] variant=${event.variant} ${event.name}=${event.durationMs.toFixed(1)}ms${attrs}`);
    }
  });

  socket.on('unsubscribeFromChunk', (data: { gameId: string; chunkX: number; chunkY: number }) => {
    socket.leave(`${data.gameId}_chunk_${data.chunkX}_${data.chunkY}`);
  });

  socket.on('unsubscribeFromChunks', (data: { gameId: string; chunks: { chunkX: number; chunkY: number }[] }) => {
    for (const { chunkX, chunkY } of data.chunks) {
      socket.leave(`${data.gameId}_chunk_${chunkX}_${chunkY}`);
    }
    void gameStateService.evictUnsubscribedChunksAsync(data.gameId);
  });

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
    clearPendingSubs(socket.id);
    const gameId = socket.data.gameId as string | undefined;
    if (gameId) {
      setImmediate(() => {
        void gameStateService.evictUnsubscribedChunksAsync(gameId);
      });
    }
    console.log(`Client disconnected: ${socket.id}`);
    eventBus.publish('playerDisconnected', { socketId: socket.id });
  });
}
