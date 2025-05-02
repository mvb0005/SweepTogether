/**
 * @fileoverview Service responsible for broadcasting game state updates to clients via Socket.IO.
 * It provides methods to send various game-related events (e.g., tile updates, score changes,
 * player joins/leaves, game over) to specific rooms (games) or individual clients.
 * It encapsulates the Socket.IO server interaction logic for game updates.
 */

import {
    PlayerStatus,
    ScoreUpdatePayload,
    PlayerStatusUpdatePayload,
    TileUpdatePayload,
    TilesUpdatePayload,
    ErrorPayload
} from '../domain/types';
import { Cell } from '../domain/types';

export class GameUpdateService {
    // This service will later be connected to Socket.IO for actual broadcasting

    /**
     * Send an error message to a specific client
     */
    sendError(socketId: string, message: string, details?: any): void {
        console.log(`[GameUpdateService] Error to ${socketId}: ${message}`, details);
        // TODO: Implement actual Socket.IO emitting
    }

    /**
     * Send a generic event to all clients
     * 
     * @param eventName The name of the event to broadcast
     * @param payload The data to send with the event
     */
    broadcast<T>(eventName: string, payload: T): void {
        console.log(`[GameUpdateService] Broadcasting ${eventName}:`, payload);
        // TODO: Implement actual Socket.IO broadcasting
    }

    /**
     * Send a generic event to a specific client
     * 
     * @param socketId The ID of the socket to send to
     * @param eventName The name of the event
     * @param payload The data to send with the event
     */
    sendToClient<T>(socketId: string, eventName: string, payload: T): void {
        console.log(`[GameUpdateService] Sending ${eventName} to ${socketId}:`, payload);
        // TODO: Implement actual Socket.IO direct emitting
    }

    /**
     * Update a player's status (e.g., ACTIVE, LOCKED_OUT)
     */
    sendPlayerStatusUpdate(gameId: string, playerId: string, status: PlayerStatus, lockedUntil?: number): void {
        const payload: PlayerStatusUpdatePayload = {
            playerId,
            status,
            lockedUntil
        };
        console.log(`[GameUpdateService] Player status update in game ${gameId}:`, payload);
        // TODO: Implement actual Socket.IO emitting to game room
    }

    /**
     * Update a player's score
     */
    sendScoreUpdate(gameId: string, playerId: string, newScore: number, scoreDelta: number, reason: string): void {
        const payload: ScoreUpdatePayload = {
            playerId,
            newScore,
            scoreDelta,
            reason
        };
        console.log(`[GameUpdateService] Score update in game ${gameId}:`, payload);
        // TODO: Implement actual Socket.IO emitting to game room
    }

    /**
     * Send an update for a single tile
     */
    sendTileUpdate(gameId: string, tile: TileUpdatePayload): void {
        console.log(`[GameUpdateService] Tile update in game ${gameId}: (${tile.x},${tile.y})`);
        // TODO: Implement actual Socket.IO emitting to game room
    }

    /**
     * Send updates for multiple tiles at once (e.g., after a reveal or chord click)
     */
    sendTilesUpdate(gameId: string, tiles: TilesUpdatePayload): void {
        console.log(`[GameUpdateService] Tiles update in game ${gameId}: ${tiles.length} tiles`);
        // TODO: Implement actual Socket.IO emitting to game room
    }
}

