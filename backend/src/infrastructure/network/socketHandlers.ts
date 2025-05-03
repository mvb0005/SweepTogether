import { Server, Socket } from 'socket.io';
import { 
  Coordinates,
  ErrorPayload,
  ViewportUpdatePayload // Keep necessary types used by handlers/emitError
} from '../../domain/types';
import { EventBus } from '../eventBus/EventBus';
import { SocketEventName, SocketEventMap } from './socketEvents';

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
 * Register WebSocket event handlers for a socket, delegating logic to EventBus.
 * 
 * @param io - The Socket.IO server instance
 * @param socket - The socket to set up handlers for
 * @param eventBus - The event bus instance
 */
export function registerSocketHandlers(
  io: Server,
  socket: Socket,
  eventBus: EventBus<SocketEventMap>
) {
  console.log(`New client connected: ${socket.id}`);

  // Dynamically register handlers for only the events with subscribers
  const eventNames = eventBus.getSubscribedEventNames();
  for (const eventName of eventNames) {
    console.log(`Event received: ${eventName}`, eventName);
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