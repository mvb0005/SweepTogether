import ioClient, { Socket as ClientSocketType } from 'socket.io-client';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { AddressInfo } from 'net';
import { connectToDatabase, disconnectFromDatabase } from '../../infrastructure/persistence/db';
import { setupSocketServer } from '../../infrastructure/network/socketServer';
import { GameConfig, Cell } from '../../domain/types';
import { socketEvents } from '../../domain/constants';

describe('Socket.IO Full Integration Test', () => {
  let httpServer: ReturnType<typeof createServer>;
  let socketServer: SocketIOServer;
  let serverPort: number;
  let clientSocket1: ClientSocketType;
  let clientSocket2: ClientSocketType;

  beforeAll(async () => {
    // Connect to database (use test database)
    process.env.DB_NAME = 'minesweeper_test';
    await connectToDatabase();

    // Create HTTP server
    httpServer = createServer();

    // Create Socket.IO server
    socketServer = setupSocketServer(httpServer);

    // Start server on random port
    httpServer.listen(() => {
      const address = httpServer.address() as AddressInfo;
      serverPort = address.port;
    });
  });

  afterAll(async () => {
    // Cleanup
    socketServer.close();
    httpServer.close();
    await disconnectFromDatabase();
  });

  beforeEach(() => {
    // Create new client sockets before each test
    clientSocket1 = ioClient(`http://localhost:${serverPort}`, {
      autoConnect: false,
      reconnection: false,
    });
    clientSocket2 = ioClient(`http://localhost:${serverPort}`, {
      autoConnect: false,
      reconnection: false,
    });
  });

  afterEach(() => {
    // Disconnect client sockets
    if (clientSocket1.connected) {
      clientSocket1.disconnect();
    }
    if (clientSocket2.connected) {
      clientSocket2.disconnect();
    }
  });

  test('should create a game and allow a player to join', (done) => {
    clientSocket1.connect();
    clientSocket1.on('connect', () => {
      clientSocket1.emit(socketEvents.CREATE_GAME, {
        gameConfig: { rows: 10, cols: 10, mines: 10, isInfiniteWorld: false },
        username: 'Player1',
      });

      clientSocket1.on(socketEvents.GAME_CREATED, (response: any) => {
        expect(response).toHaveProperty('gameId');
        expect(response).toHaveProperty('playerId');
        expect(response).toHaveProperty('boardConfig');
        done();
      });
    });
  });

  test('should allow two players to join the same game', (done) => {
    let gameId: string;

    clientSocket1.connect();
    clientSocket1.on('connect', () => {
      clientSocket1.once(socketEvents.GAME_CREATED, (response: any) => {
        gameId = response.gameId;

        clientSocket2.connect();
        clientSocket2.on('connect', () => {
          clientSocket2.emit(socketEvents.JOIN_GAME, { gameId, username: 'Player2' });

          clientSocket2.on(socketEvents.GAME_JOINED, (response: any) => {
            expect(response.gameId).toBe(gameId);
            expect(response).toHaveProperty('playerId');
            expect(response).toHaveProperty('players');
            expect(Object.keys(response.players).length).toBe(2); // Player1 and Player2
            done();
          });
        });
      });

      clientSocket1.emit(socketEvents.CREATE_GAME, {
        gameConfig: { rows: 10, cols: 10, mines: 10, isInfiniteWorld: false },
        username: 'Player1',
      });
    });
  });

  test('should notify existing players when a new player joins', (done) => {
    let gameId: string;
    let player1Id: string;

    clientSocket1.connect();
    clientSocket1.on('connect', () => {
      clientSocket1.once(socketEvents.GAME_CREATED, (response: any) => {
        gameId = response.gameId;
        player1Id = response.playerId;

        clientSocket1.once(socketEvents.GAME_JOINED, (response1: any) => {
          expect(response1.gameId).toBe(gameId);
          expect(response1.playerId).not.toBe(player1Id); // Should be Player 2's ID
          expect(Object.keys(response1.players).length).toBe(2);

          clientSocket2.once(socketEvents.GAME_JOINED, (response2: any) => {
            // Verify Player 2 also received the correct join info
            expect(response2.gameId).toBe(gameId);
            expect(response2.playerId).not.toBe(player1Id);
            expect(Object.keys(response2.players).length).toBe(2);
            done();
          });
        });

        clientSocket2.connect();
        clientSocket2.on('connect', () => {
          clientSocket2.emit(socketEvents.JOIN_GAME, { gameId, username: 'Player2' });
        });
      });

      clientSocket1.emit(socketEvents.CREATE_GAME, {
        gameConfig: { rows: 10, cols: 10, mines: 10, isInfiniteWorld: false },
        username: 'Player1',
      });
    });
  });

  test('should handle revealTile action and broadcast boardUpdate', (done) => {
    let gameId: string;
    let playerId: string;

    clientSocket1.on(socketEvents.BOARD_UPDATE, (update: any) => {
      expect(update.gameId).toBe(gameId);
      expect(update).toHaveProperty('cells');
      expect(Array.isArray(update.cells)).toBe(true);
      expect(update.cells.length).toBeGreaterThan(0);
      done();
    });

    clientSocket1.connect();
    clientSocket1.on('connect', () => {
      clientSocket1.once(socketEvents.GAME_CREATED, (response: any) => {
        gameId = response.gameId;
        playerId = response.playerId;
        clientSocket1.emit(socketEvents.REVEAL_TILE, { gameId, playerId, x: 0, y: 0 });
      });
      clientSocket1.emit(socketEvents.CREATE_GAME, {
        gameConfig: { rows: 10, cols: 10, mines: 10, isInfiniteWorld: false },
        username: 'Player1',
      });
    });
  });

  test('should handle flagTile action and broadcast boardUpdate', (done) => {
    let gameId: string;
    let playerId: string;

    clientSocket1.on(socketEvents.BOARD_UPDATE, (update: any) => {
      expect(update.gameId).toBe(gameId);
      expect(update).toHaveProperty('cells');
      expect(Array.isArray(update.cells)).toBe(true);
      // Find the flagged cell in the update
      const flaggedCell = update.cells.find(
        (cell: Cell) => cell.x === 2 && cell.y === 2
      );
      expect(flaggedCell).toBeDefined();
      expect(flaggedCell.flagged).toBe(true);
      done();
    });

    clientSocket1.connect();
    clientSocket1.on('connect', () => {
      clientSocket1.once(socketEvents.GAME_CREATED, (response: any) => {
        gameId = response.gameId;
        playerId = response.playerId;
        clientSocket1.emit(socketEvents.FLAG_TILE, { gameId, playerId, x: 2, y: 2 });
      });
      clientSocket1.emit(socketEvents.CREATE_GAME, {
        gameConfig: { rows: 10, cols: 10, mines: 10, isInfiniteWorld: false },
        username: 'Player1',
      });
    });
  });

  test('should handle chordClick action and broadcast boardUpdate', (done) => {
    let gameId: string;
    let playerId: string;

    // Connect, create game, reveal a non-mine cell (e.g., 0,0), then chord click it
    clientSocket1.connect();
    clientSocket1.on('connect', () => {
      clientSocket1.once(socketEvents.GAME_CREATED, (response: any) => {
        gameId = response.gameId;
        playerId = response.playerId;

        // Listen for the update after the chord click
        clientSocket1.once(socketEvents.BOARD_UPDATE, (update: any) => {
          // This update should be from the chord click
          expect(update.gameId).toBe(gameId);
          expect(update).toHaveProperty('cells');
          expect(Array.isArray(update.cells)).toBe(true);
          // Depending on the board, multiple cells might be revealed
          expect(update.cells.length).toBeGreaterThan(0);
          done();
        });

        // First, reveal a tile (assuming 0,0 is safe in this test setup)
        // We need to wait for this reveal's update before chording
        clientSocket1.once(socketEvents.BOARD_UPDATE, () => {
          // Now perform the chord click on the revealed tile
          clientSocket1.emit(socketEvents.CHORD_CLICK, { gameId, playerId, x: 0, y: 0 });
        });
        clientSocket1.emit(socketEvents.REVEAL_TILE, { gameId, playerId, x: 0, y: 0 });

      });
      clientSocket1.emit(socketEvents.CREATE_GAME, {
        gameConfig: { rows: 10, cols: 10, mines: 1, isInfiniteWorld: false }, // Low mines for easier testing
        username: 'Player1',
      });
    });
  });

  test('should handle leaderboard requests', (done) => {
    const category = 'test_category';
    clientSocket1.on(socketEvents.LEADERBOARD_DATA, (data: any) => {
      expect(data).toHaveProperty('category');
      expect(data.category).toBe(category);
      expect(data).toHaveProperty('scores');
      expect(Array.isArray(data.scores)).toBe(true);
      done();
    });

    clientSocket1.connect();
    clientSocket1.on('connect', () => {
      clientSocket1.emit(socketEvents.GET_LEADERBOARD, { category });
    });
  });

  // Add more tests for disconnect, errors, game over, etc.
});