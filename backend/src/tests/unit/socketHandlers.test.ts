import { Server, Socket } from 'socket.io';
import { InMemoryEventBus } from '../../infrastructure/eventBus/InMemoryEventBus';
import { registerSocketHandlers } from '../../infrastructure/network/socketHandlers';
import { SocketEventMap } from '../../infrastructure/network/socketEvents';

describe('Socket Handler Integration', () => {
  let mockSocket: any;
  let eventBus: InMemoryEventBus<SocketEventMap>;
  let mockGameStateService: any;
  let received: any;

  beforeEach(() => {
    mockSocket = {
      id: 'socket-abc',
      data: {},
      on: jest.fn(),
      emit: jest.fn(),
      join: jest.fn(),
      leave: jest.fn(),
      to: jest.fn().mockReturnThis(),
    };
    eventBus = new InMemoryEventBus<SocketEventMap>();
    mockGameStateService = {
      gameExists: jest.fn().mockReturnValue(false),
      createGame: jest.fn().mockResolvedValue(undefined),
      addPlayer: jest.fn(),
      getGame: jest.fn().mockReturnValue({ players: {} }),
    };
    received = undefined;
  });

  it('should emit gameJoined when joinGame fires', async () => {
    registerSocketHandlers({} as Server, mockSocket as unknown as Socket, eventBus, mockGameStateService);
    const joinHandler = mockSocket.on.mock.calls.find((call: string[]) => call[0] === 'joinGame')[1];
    await joinHandler({ gameId: 'game42', username: 'Bob' });
    expect(mockSocket.emit).toHaveBeenCalledWith('gameJoined', expect.objectContaining({
      gameId: 'game42',
      playerId: 'socket-abc',
    }));
  });

  it('should publish playerDisconnected event on disconnect', () => {
    eventBus.subscribe('playerDisconnected', (payload) => {
      received = payload;
    });
    registerSocketHandlers({} as Server, mockSocket as unknown as Socket, eventBus, mockGameStateService);
    const disconnectHandler = mockSocket.on.mock.calls.find((call: string[]) => call[0] === 'disconnect')[1];
    disconnectHandler();
    expect(received).toEqual({ socketId: 'socket-abc' });
  });

  it('should attach gameId from socket.data if not present in payload', () => {
    eventBus.subscribe('revealTile', (payload) => {
      received = payload;
    });
    mockSocket.data.gameId = 'game99';
    registerSocketHandlers({} as Server, mockSocket as unknown as Socket, eventBus, mockGameStateService);
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
