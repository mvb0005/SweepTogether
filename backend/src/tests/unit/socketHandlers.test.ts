import { Server, Socket } from 'socket.io';
import { InMemoryEventBus } from '../../infrastructure/eventBus/InMemoryEventBus';
import { registerSocketHandlers } from '../../infrastructure/network/socketHandlers';
import { SocketEventMap } from '../../infrastructure/network/socketEvents';
import { createServer } from 'http';
import { Server as IOServer } from 'socket.io';
import ClientIO, { Socket as ClientSocket } from 'socket.io-client';

describe('Socket Handler Integration', () => {
  let mockSocket: any;
  let eventBus: InMemoryEventBus<SocketEventMap>;
  let received: any;

  beforeEach(() => {
    // Mock socket with .on, .emit, .data, .id
    mockSocket = {
      id: 'socket-abc',
      data: {},
      on: jest.fn(),
      emit: jest.fn(),
      join: jest.fn(),
      leave: jest.fn(),
    };
    eventBus = new InMemoryEventBus<SocketEventMap>();
    received = undefined;
  });

  it('should publish joinGame event to EventBus with correct payload', () => {
    eventBus.subscribe('joinGame', (payload) => {
      received = payload;
    });
    registerSocketHandlers({} as Server, mockSocket as unknown as Socket, eventBus);
    // Find the handler registered for 'joinGame'
    const joinHandler = mockSocket.on.mock.calls.find((call: string[]) => call[0] === 'joinGame')[1];
    const joinData = { gameId: 'game42', username: 'Bob' };
    joinHandler(joinData);
    expect(received).toMatchObject({
      gameId: 'game42',
      username: 'Bob',
      socketId: 'socket-abc',
    });
  });

  it('should publish playerDisconnected event on disconnect', () => {
    eventBus.subscribe('playerDisconnected', (payload) => {
      received = payload;
    });
    registerSocketHandlers({} as Server, mockSocket as unknown as Socket, eventBus);
    const disconnectHandler = mockSocket.on.mock.calls.find((call: string[]) => call[0] === 'disconnect')[1];
    disconnectHandler();
    expect(received).toEqual({ socketId: 'socket-abc' });
  });

  it('should attach gameId from socket.data if not present in payload', () => {
    eventBus.subscribe('revealTile', (payload) => {
      received = payload;
    });
    mockSocket.data.gameId = 'game99';
    registerSocketHandlers({} as Server, mockSocket as unknown as Socket, eventBus);
    const revealHandler = mockSocket.on.mock.calls.find((call: string[]) => call[0] === 'revealTile')[1];
    revealHandler({ x: 1, y: 2 });
    expect(received).toMatchObject({
      gameId: 'game99',
      x: 1,
      y: 2,
      socketId: 'socket-abc',
    });
  });
});