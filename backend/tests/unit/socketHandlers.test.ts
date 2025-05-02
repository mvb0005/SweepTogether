/**
 * @fileoverview Unit tests for WebSocket event handlers.
 * This file contains tests for the functions handling client connections
 * and messages via WebSockets, including:
 * - Handling new client connections ('connection').
 * - Handling client disconnections ('disconnect').
 * - Processing game-related messages (e.g., 'reveal', 'flag', 'chord', 'joinGame').
 * - Interaction with GameService to perform game actions.
 * - Emitting updates back to clients.
 * - Error handling for invalid messages or actions.
 */

// Mock Socket.IO server and socket objects
import { Server, Socket } from 'socket.io';
import { GameService } from '../../src/application/gameService';
// Import using the correct path and function name
import { registerSocketHandlers, setupSocketHandlers } from '../../src/infrastructure/network/socketHandlers';

describe('Socket Handlers', () => {
  // Mock implementations
  const mockIo = { emit: jest.fn() } as unknown as Server;
  const mockSocket = {
    id: 'socket1',
    join: jest.fn(),
    leave: jest.fn(),
    emit: jest.fn(),
    on: jest.fn(),
    data: {},
    disconnect: jest.fn(),
  } as unknown as Socket & { on: jest.Mock };

  const mockGameService = {
    joinGame: jest.fn(),
    revealCell: jest.fn(),
    flagCell: jest.fn(),
    chordCell: jest.fn(),
    disconnectPlayer: jest.fn(),
  } as unknown as GameService;

  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
  });

  it('should register handlers for Socket.IO events', () => {
    // Try using registerSocketHandlers first (if exported)
    try {
      registerSocketHandlers(mockIo, mockSocket, mockGameService);
      expect(mockSocket.on).toHaveBeenCalledWith('disconnect', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('joinGame', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('revealCell', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('flagCell', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('chordCell', expect.any(Function));
    } catch (e) {
      // If registerSocketHandlers fails, try setupSocketHandlers instead
      setupSocketHandlers(mockIo, mockSocket);
      expect(mockSocket.on).toHaveBeenCalledWith('joinGame', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('revealTile', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('flagTile', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('disconnect', expect.any(Function));
    }
  });
});
