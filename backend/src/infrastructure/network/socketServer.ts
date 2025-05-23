// Socket.IO server implementation
import { Server as SocketIOServer, Socket } from 'socket.io';
import { getInitializedServices } from '../../application/services';
import { BoardStateUpdatePayload, GameConfig, LeaderboardCategory, LeaderboardMetric, PlayerStatus } from '../../domain/types';
import { CHUNK_SIZE } from '../../types/chunkTypes';
import { IChunk } from '../../types/chunkTypes';
import { Cell } from '../../domain/types';

// Active game sessions and player connections
interface ActiveSessions {
  // Map of game ID to connected player socket IDs
  [gameId: string]: {
    [playerId: string]: string; // playerId -> socketId
  };
}

// Socket ID to player info mapping
interface SocketPlayers {
  [socketId: string]: {
    gameId: string;
    playerId: string;
  };
}

/**
 * Sets up the Socket.IO server with all event handlers
 */
export function setupSocketServer(io: SocketIOServer): void {
  // Track active sessions
  const activeSessions: ActiveSessions = {};
  
  // Map socket IDs to player info for quick lookup
  const socketPlayers: SocketPlayers = {};
  
  // Get services
  const serviceRegistry = getInitializedServices(io);
  const { gameStateService, eventBus, leaderboardService } = serviceRegistry;


  io.on('connection', (socket: Socket) => {
    console.log(`New connection: ${socket.id}`);

    /**
     * Handle game creation
     */
    socket.on('createGame', async (data: { gameConfig: GameConfig, username?: string, gameId?: string }) => {
      console.log(`Creating game with data: ${JSON.stringify(data)}`);
      try {
        const { gameConfig, username = 'Anonymous', gameId: requestedGameId } = data;
        // Use requested game ID if provided, otherwise generate one
        const gameId = requestedGameId || "game_" + Date.now();
        const playerId = username;
        
        // Check if game already exists
        if (gameStateService.gameExists(gameId)) {
          throw new Error(`Game with ID ${gameId} already exists`);
        }

        gameStateService.createGame(gameId, gameConfig);
        gameStateService.addPlayer(gameId, playerId, username);
        activeSessions[gameId] = { [playerId]: socket.id };
        socketPlayers[socket.id] = { gameId, playerId };
        socket.join(gameId);
        const gameState = gameStateService.getGame(gameId);
        socket.emit('gameCreated', {
          gameId,
          playerId,
          boardConfig: gameConfig,
          players: gameState?.players || {}
        });
      } catch (error) {
        console.error('Error creating game:', error);
        socket.emit('error', {
          message: 'Failed to create game',
          details: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    /**
     * Handle joining an existing game
     */
    socket.on('joinGame', async (data: { gameId: string, username?: string }) => {
      try {
        const { gameId, username = 'Anonymous' } = data;
        const gameExists = gameStateService.gameExists(gameId);
        if (!gameExists) {
          // If game doesn't exist, create it with default config
          const defaultConfig: GameConfig = {
            isInfiniteWorld: true,
            rows: 16,
            cols: 16,
            mines: 40
          };
          gameStateService.createGame(gameId, defaultConfig);
        }
        
        const playerId = username;
        gameStateService.addPlayer(gameId, playerId, username);
        if (!activeSessions[gameId]) activeSessions[gameId] = {};
        activeSessions[gameId][playerId] = socket.id;
        socketPlayers[socket.id] = { gameId, playerId };
        socket.join(gameId);
        const gameState = gameStateService.getGame(gameId);
        console.log(`Player ${playerId} joined game ${gameId}`);
        socket.emit('gameJoined', {
          gameId,
          playerId,
          players: gameState?.players || {}
        });
        socket.to(gameId).emit('playerJoined', {
          gameId,
          playerId,
          username,
          players: gameState?.players || {}
        });
      } catch (error) {
        console.error('Error joining game:', error);
        socket.emit('error', {
          message: 'Failed to join game',
          details: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    /**
     * Handle player reconnection
     */
    socket.on('reconnect', async (data: { gameId: string, playerId: string }) => {
      try {
        const { gameId, playerId } = data;
        const gameExists = gameStateService.gameExists(gameId);
        if (!gameExists) throw new Error(`Game not found: ${gameId}`);
        const gameState = gameStateService.getGame(gameId);
        if (!gameState?.players[playerId]) throw new Error(`Player not found in game: ${playerId}`);
        if (!activeSessions[gameId]) activeSessions[gameId] = {};
        activeSessions[gameId][playerId] = socket.id;
        socketPlayers[socket.id] = { gameId, playerId };
        socket.join(gameId);
        gameStateService.setPlayerStatus(gameId, playerId, PlayerStatus.ACTIVE);
        socket.emit('gameState', gameState);
        socket.to(gameId).emit('playerReconnected', {
          gameId,
          playerId,
          players: gameState?.players || {}
        });
      } catch (error) {
        console.error('Error reconnecting:', error);
        socket.emit('error', {
          message: 'Failed to reconnect',
          details: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    /**
     * Handle reveal tile action
     */
    socket.on('revealTile', async (data: { gameId: string, playerId: string, x: number, y: number }) => {
      try {
        console.log(`[revealTile] socket.rooms=${Array.from(socket.rooms).join(', ').toString()}`);

        const { gameId, playerId, x, y } = data;
        validatePlayer(socket.id, gameId, playerId);
        // Get the board manager for this game
        const chunkManager = gameStateService.getChunkManager(gameId);
        
        // Calculate which chunk this cell belongs to
        const chunkX = Math.floor(x / CHUNK_SIZE);
        const chunkY = Math.floor(y / CHUNK_SIZE);
        const chunkRoom = `${gameId}_chunk_${chunkX}_${chunkY}`;

        // Emit event for PlayerActionService
        eventBus.publish('revealTile', { gameId, socketId: playerId, x, y });

        // Get the updated chunk data
        const chunk = chunkManager.getChunk(chunkX, chunkY);
        if (chunk) {
          // Filter cell data to only send mine info for revealed cells
          const filteredTiles = chunk.tiles.map(row => 
            row.map(cell => ({
              x: cell.x,
              y: cell.y,
              revealed: cell.revealed,
              flagged: cell.flagged,
              ...(cell.revealed && {
                isMine: cell.isMine,
                adjacentMines: cell.adjacentMines
              })
            }))
          );

          // Broadcast the updated chunk data to all clients in the chunk room
          io.to(chunkRoom).emit('chunkData', {
            gameId,
            chunkX,
            chunkY,
            tiles: filteredTiles
          });
        }
      } catch (error) {
        console.error('Error revealing tile:', error);
        socket.emit('error', {
          message: 'Failed to reveal tile',
          details: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    /**
     * Handle flag tile action
     */
    socket.on('flagTile', async (data: { gameId: string, playerId: string, x: number, y: number }) => {
      try {
        const { gameId, playerId, x, y } = data;
        validatePlayer(socket.id, gameId, playerId);
        
        // Get the board manager for this game
        const chunkManager = gameStateService.getChunkManager(gameId);
        
        // Calculate which chunk this cell belongs to
        const chunkX = Math.floor(x / CHUNK_SIZE);
        const chunkY = Math.floor(y / CHUNK_SIZE);
        const chunkRoom = `${gameId}_chunk_${chunkX}_${chunkY}`;

        // Emit event for PlayerActionService
        eventBus.publish('flagTile', { gameId, socketId: playerId, x, y });

        // Get the updated chunk data
        const chunk = chunkManager.getChunk(chunkX, chunkY);
        if (chunk) {
          // Filter cell data to only send mine info for revealed cells
          const filteredTiles = chunk.tiles.map(row => 
            row.map(cell => ({
              x: cell.x,
              y: cell.y,
              revealed: cell.revealed,
              flagged: cell.flagged,
              ...(cell.revealed && {
                isMine: cell.isMine,
                adjacentMines: cell.adjacentMines
              })
            }))
          );

          // Broadcast the updated chunk data to all clients in the chunk room
          io.to(chunkRoom).emit('chunkData', {
            gameId,
            chunkX,
            chunkY,
            tiles: filteredTiles
          });
        }
      } catch (error) {
        console.error('Error flagging tile:', error);
        socket.emit('error', {
          message: 'Failed to flag tile',
          details: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    /**
     * Handle chord click action
     */
    socket.on('chordClick', async (data: { gameId: string, playerId: string, x: number, y: number }) => {
      try {
        const { gameId, playerId, x, y } = data;
        validatePlayer(socket.id, gameId, playerId);
        
        // Get the board manager for this game
        const chunkManager = gameStateService.getChunkManager(gameId);
        
        // Calculate which chunk this cell belongs to
        const chunkX = Math.floor(x / CHUNK_SIZE);
        const chunkY = Math.floor(y / CHUNK_SIZE);
        const chunkRoom = `${gameId}_chunk_${chunkX}_${chunkY}`;

        // Emit event for PlayerActionService
        eventBus.publish('chordClick', { gameId, socketId: playerId, x, y });

        // Get the updated chunk data
        const chunk = chunkManager.getChunk(chunkX, chunkY);
        if (chunk) {
          // Filter cell data to only send mine info for revealed cells
          const filteredTiles = chunk.tiles.map(row => 
            row.map(cell => ({
              x: cell.x,
              y: cell.y,
              revealed: cell.revealed,
              flagged: cell.flagged,
              ...(cell.revealed && {
                isMine: cell.isMine,
                adjacentMines: cell.adjacentMines
              })
            }))
          );

          // Broadcast the updated chunk data to all clients in the chunk room
          io.to(chunkRoom).emit('chunkData', {
            gameId,
            chunkX,
            chunkY,
            tiles: filteredTiles
          });
        }
      } catch (error) {
        console.error('Error performing chord click:', error);
        socket.emit('error', {
          message: 'Failed to perform chord click',
          details: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    /**
     * Handle request for leaderboard data
     */
    socket.on('requestLeaderboard', async (data: { category: LeaderboardCategory, metric: LeaderboardMetric, limit?: number }) => {
      try {
        const { category, metric, limit = 10 } = data;
        
        // Get leaderboard data
        const leaderboardData = await leaderboardService.getLeaderboard(
          category,
          metric,
          limit
        );
        
        // Send leaderboard data to client
        socket.emit('leaderboardData', leaderboardData);
        
      } catch (error) {
        console.error('Error fetching leaderboard:', error);
        socket.emit('error', {
          message: 'Failed to fetch leaderboard',
          details: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    /**
     * Handle chunk subscription
     */
    socket.on('subscribeToChunk', async (data: { gameId: string, chunkX: number, chunkY: number, playerId?: string }) => {
      try {
        const { gameId, chunkX, chunkY } = data;
        console.log(`[subscribeToChunk] gameId=${gameId}, chunk=(${chunkX},${chunkY}), socket=${socket.id}`);
        const gameExists = gameStateService.gameExists(gameId);
        if (!gameExists) {
          throw new Error(`Game not found: ${gameId}`);
        }

        // Get the board manager for this game
        const chunkManager = gameStateService.getChunkManager(gameId);
        
        // Get the chunk data
        const chunk = chunkManager.getChunk(chunkX, chunkY);
        if (!chunk) {
          throw new Error(`Chunk not found at (${chunkX}, ${chunkY})`);
        }

        // Join the chunk-specific room for updates
        const chunkRoom = `${gameId}_chunk_${chunkX}_${chunkY}`;
        socket.join(chunkRoom);

        // Emit playerJoinedChunk to everyone in the chunk room
        let playerId = data.playerId || socketPlayers[socket.id]?.playerId || socket.handshake.query.playerId || socket.id;
        io.to(chunkRoom).emit('playerJoinedChunk', {
          gameId,
          chunkX,
          chunkY,
          playerId
        });

        console.log(`[subscribeToChunk] socket.rooms=${socket.rooms}`);
        // Process all pending fills for all chunks until clean (back-and-forth propagation)
        const visited = new Set<string>();
        let dirtyFound;
        do {
          dirtyFound = false;
          for (const [pendingChunkId, fills] of chunkManager.pendingFills.entries()) {
            if (fills.length > 0) {
              await chunkManager.processPendingFillsForChunk(pendingChunkId, visited);
              dirtyFound = true;
            }
          }
        } while (dirtyFound);

        // After processing, broadcast the updated chunk to all subscribers
        const filteredTiles = chunk.tiles.map(row =>
          row.map(cell => ({
            x: cell.x,
            y: cell.y,
            revealed: cell.revealed,
            flagged: cell.flagged,
            ...(cell.revealed && {
              isMine: cell.isMine,
              adjacentMines: cell.adjacentMines
            })
          }))
        );

        // Send the initial chunk data
        socket.emit('chunkData', {
          gameId,
          chunkX,
          chunkY,
          tiles: filteredTiles
        });

      } catch (error) {
        console.error('Error subscribing to chunk:', error);
        socket.emit('error', {
          message: 'Failed to subscribe to chunk',
          details: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    /**
     * Handle disconnection
     */
    socket.on('disconnect', async () => {
      console.log(`Client disconnected: ${socket.id}`);
      
      // Check if this socket was associated with a player
      const playerInfo = socketPlayers[socket.id];
      if (playerInfo) {
        const { gameId, playerId } = playerInfo;
        
        try {
          gameStateService.setPlayerStatus(gameId, playerId, PlayerStatus.LOCKED_OUT);
          
          // Update tracking
          if (activeSessions[gameId]) {
            delete activeSessions[gameId][playerId];
            
            // If no more players in this game, consider cleanup
            if (Object.keys(activeSessions[gameId]).length === 0) {
              delete activeSessions[gameId];
              // Consider game archiving/cleanup here
            }
          }
          
          // Remove socket to player mapping
          delete socketPlayers[socket.id];
          
          // Notify other players in the game
          socket.to(gameId).emit('playerDisconnected', {
            gameId,
            playerId
          });
        } catch (error) {
          console.error('Error handling disconnect:', error);
        }
      }
    });

    // Helper function to validate player
    function validatePlayer(socketId: string, gameId: string, playerId: string): void {
      const playerInfo = socketPlayers[socketId];
      if (!playerInfo) {
        throw new Error('Socket not associated with any player');
      }
      if (playerInfo.gameId !== gameId || playerInfo.playerId !== playerId) {
        console.error(`Player ID mismatch: ${playerInfo.playerId} vs ${playerId}`);
        throw new Error('Player ID mismatch');
      }
    }
  });

  // Set up event listeners to broadcast game updates to clients
  setupEventListeners(io);
}

/**
 * Set up listeners for game events to broadcast to clients
 */
function setupEventListeners(io: SocketIOServer): void {
  // // Listen for board updates and broadcast to game room
  // EventEmitter.on('BOARD_UPDATE', (event: BoardStateUpdatePayload) => {
  //   io.to(event.gameId).emit('boardUpdate', {
  //     gameId: event.gameId,
  //     cells: event.cells
  //   });
  // });

  // // Listen for score updates and broadcast to game room
  // EventEmitter.on('SCORE_UPDATE', (event) => {
  //   io.to(event.gameId).emit('scoreUpdate', {
  //     gameId: event.gameId,
  //     playerId: event.playerId,
  //     newScore: event.newScore,
  //     scoreDelta: event.scoreDelta,
  //     reason: event.reason
  //   });
  // });

  // // Listen for game over events and broadcast to game room
  // EventEmitter.on('GAME_OVER', (event) => {
  //   io.to(event.gameId).emit('gameOver', {
  //     gameId: event.gameId,
  //     winner: event.winner,
  //     mines: event.mines,
  //     reason: event.reason
  //   });
  // });
  
  // // Listen for leaderboard updates and broadcast to relevant rooms/clients
  // EventEmitter.on('LEADERBOARD_UPDATE', (event) => {
  //   // Broadcast to all connected clients
  //   io.emit('leaderboardUpdate', {
  //     category: event.category,
  //     metric: event.metric,
  //     entries: event.entries
  //   });
  // });
}