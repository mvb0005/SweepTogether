import { Server, Socket } from 'socket.io';
import { 
  Coordinates,
  ErrorPayload,
  ViewportUpdatePayload // Keep necessary types used by handlers/emitError
} from '../../domain/types';
import { GameService } from '../../application/gameService'; // Import GameService

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
 * Register WebSocket event handlers for a socket, delegating logic to GameService.
 * 
 * @param io - The Socket.IO server instance
 * @param socket - The socket to set up handlers for
 * @param gameService - The game service instance
 */
export function registerSocketHandlers(io: Server, socket: Socket, gameService: GameService) {
    console.log(`New client connected: ${socket.id}`);

    // Store io instance for potential use within gameService (alternative to passing it everywhere)
    // Consider if gameService should manage emissions internally or return data for handlers to emit.
    // For now, let gameService handle emissions by passing io.
    gameService.setIoServer(io); 

    socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
        try {
            gameService.disconnectPlayer(socket.id);
        } catch (error: any) {
            // Disconnect should generally not fail critically, but log if it does
            console.error(`Error during disconnect cleanup for ${socket.id}: ${error.message}`);
        }
    });

    socket.on('joinGame', (data: { gameId: string; playerName?: string }) => {
        // Basic validation before calling service
        if (!data || typeof data.gameId !== 'string' || data.gameId.trim().length === 0) {
            emitError(socket, 'Invalid game ID provided.');
            return;
        }
        const playerName = typeof data.playerName === 'string' && data.playerName.trim().length > 0 
                           ? data.playerName.trim() 
                           : undefined; // Let service assign default name if needed

        try {
            console.log(`Join game request from ${socket.id} for game ${data.gameId} (Player: ${playerName || 'Default'})`);
            // Associate gameId with socket for context, service might handle this too
            socket.data.gameId = data.gameId.trim(); 
            socket.join(data.gameId.trim()); // Join the Socket.IO room
            gameService.joinGame(data.gameId.trim(), socket.id, playerName);
        } catch (error: any) {
            console.error(`Error joining game ${data.gameId}: ${error.message}`);
            emitError(socket, `Failed to join game: ${error.message}`);
            // Leave room if join failed in service? Service should handle state consistency.
            socket.leave(data.gameId.trim()); 
            delete socket.data.gameId;
        }
    });

    // Generic handler for actions requiring coordinates and gameId
    const handleCoordinateAction = (
        eventName: string, 
        serviceMethod: (gameId: string, playerId: string, coordinates: Coordinates) => void, 
        data: unknown
    ) => {
        const gameId = socket.data.gameId;
        if (typeof gameId !== 'string') {
            emitError(socket, `Cannot perform action '${eventName}': Not associated with a game.`);
            return;
        }
        if (typeof data !== 'object' || data === null) {
             emitError(socket, `Invalid ${eventName} data format. Expected object with coordinates.`);
             return;
        }

        let coordinates: Coordinates | null = null;
        if (typeof (data as any).row === 'number' && typeof (data as any).col === 'number') {
            coordinates = { y: (data as any).row, x: (data as any).col }; // Map row/col to y/x
        } else if (typeof (data as any).x === 'number' && typeof (data as any).y === 'number') {
            coordinates = { x: (data as any).x, y: (data as any).y };
        }

        if (!coordinates || !Number.isInteger(coordinates.x) || !Number.isInteger(coordinates.y)) {
            emitError(socket, `Invalid coordinates for ${eventName}. Expected { row: number, col: number } or { x: number, y: number } with integer values.`);
            return;
        }

        try {
            console.log(`${eventName} request from ${socket.id} for game ${gameId}: ${JSON.stringify(coordinates)}`);
            serviceMethod.call(gameService, gameId, socket.id, coordinates);
        } catch (error: any) {
            console.error(`Error during ${eventName} for game ${gameId}: ${error.message}`);
            // Emit specific error from service if available, otherwise generic
            emitError(socket, `Failed to ${eventName}: ${error.message}`);
        }
    };

    socket.on('revealTile', (data: unknown) => {
        handleCoordinateAction('revealTile', gameService.revealCell, data);
    });

    socket.on('flagTile', (data: unknown) => {
        handleCoordinateAction('flagTile', gameService.flagCell, data);
    });

    socket.on('chordClick', (data: unknown) => {
        handleCoordinateAction('chordClick', gameService.chordCell, data);
    });
    
    socket.on('updateViewport', (data: unknown) => {
        const gameId = socket.data.gameId;
        if (typeof gameId !== 'string') {
            emitError(socket, 'Cannot update viewport: Not associated with a game.');
            return;
        }
        // Validate viewport data structure
        if (typeof data !== 'object' || data === null ||
            typeof (data as any).center !== 'object' ||
            typeof (data as any).center.x !== 'number' ||
            typeof (data as any).center.y !== 'number' ||
            typeof (data as any).width !== 'number' ||
            typeof (data as any).height !== 'number' ||
            ((data as any).zoom !== undefined && typeof (data as any).zoom !== 'number')) 
        {
            emitError(socket, 'Invalid viewport data format. Expected { center: { x, y }, width, height, zoom? }.');
            return;
        }

        const viewportData = data as ViewportUpdatePayload;

        try {
            console.log(`Viewport update from ${socket.id} for game ${gameId}: ${JSON.stringify(viewportData)}`);
            gameService.updatePlayerViewport(gameId, socket.id, viewportData);
        } catch (error: any) {
            console.error(`Error updating viewport for game ${gameId}: ${error.message}`);
            emitError(socket, `Failed to update viewport: ${error.message}`);
        }
    });

    // Add more handlers as needed, delegating to gameService
}