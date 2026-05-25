/**
 * @fileoverview Service responsible for broadcasting game state updates to clients via Socket.IO.
 * It provides methods to send various game-related events (e.g., tile updates, score changes,
 * player joins/leaves, game over) to specific rooms (games) or individual clients.
 * It encapsulates the Socket.IO server interaction logic for game updates.
 */

import { Server as SocketIOServer } from 'socket.io';
import {
    PlayerStatus,
    ScoreUpdatePayload,
    PlayerStatusUpdatePayload,
    TileUpdatePayload,
    TilesUpdatePayload,
} from '../domain/types';
import { serializeChunkWire, invalidateChunkWireCache } from './chunkWire';
import { GameStateService } from './gameStateService';
import { CHUNK_SIZE } from '../types/chunkTypes';

export class GameUpdateService {
    constructor(
        private readonly io: SocketIOServer,
        private readonly gameStateService: GameStateService
    ) {}

    sendError(socketId: string, message: string, details?: any): void {
        this.io.to(socketId).emit('error', { message, details });
    }

    broadcast<T>(eventName: string, payload: T): void {
        this.io.emit(eventName, payload);
    }

    sendToClient<T>(socketId: string, eventName: string, payload: T): void {
        this.io.to(socketId).emit(eventName, payload);
    }

    sendPlayerStatusUpdate(gameId: string, playerId: string, status: PlayerStatus, lockedUntil?: number): void {
        const payload: PlayerStatusUpdatePayload = { playerId, status, lockedUntil };
        this.io.to(gameId).emit('playerStatusUpdate', payload);
    }

    sendScoreUpdate(gameId: string, playerId: string, newScore: number, scoreDelta: number, reason: string): void {
        const payload: ScoreUpdatePayload = { playerId, newScore, scoreDelta, reason };
        this.io.to(gameId).emit('scoreUpdate', payload);
    }

    // Broadcasts the full updated chunk to all subscribers of that chunk room.
    // Groups tiles by chunk so each affected chunk room gets one chunkData event.
    sendTilesUpdate(gameId: string, tiles: TilesUpdatePayload): void {
        const chunkKeys = new Set(
            tiles.map(t => `${Math.floor(t.x / CHUNK_SIZE)}_${Math.floor(t.y / CHUNK_SIZE)}`)
        );
        const chunkManager = this.gameStateService.getChunkManager(gameId);
        for (const key of chunkKeys) {
            const [chunkX, chunkY] = key.split('_').map(Number);
            const chunk = chunkManager.getChunkById(key);
            if (!chunk) continue;
            invalidateChunkWireCache(chunk);
            this.io.to(`${gameId}_chunk_${chunkX}_${chunkY}`).emit('chunkData', serializeChunkWire(chunk, gameId));
        }
    }

    sendTileUpdate(gameId: string, tile: TileUpdatePayload): void {
        this.sendTilesUpdate(gameId, [tile]);
    }
}

