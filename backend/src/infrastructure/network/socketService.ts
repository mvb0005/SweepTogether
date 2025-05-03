import { Server, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { 
  gameStateService, 
  playerActionService,
  scoreService,
  gameUpdateService,
  leaderboardService,
  eventBus
} from '../../application/services';
import {
  GameConfig,
  LeaderboardCategory,
  LeaderboardMetric,
  PlayerStatus
} from '../../domain/types';
import { socketEvents } from './socketEvents';

// Interface for tracking active player connections
interface ActivePlayer {
  socketId: string;
  gameId: string;
  playerId: string;
  username: string;
}

// Track active connections
const activePlayers: Map<string, ActivePlayer> = new Map();
const gameRooms: Map<string, Set<string>> = new Map(); // gameId -> Set of socketIds

export function initializeSocketServer(io: Server): void {
  // Set up connection handler
  io.on('connection', (socket: Socket) => {
    console.log(`Client connected: ${socket.id}`);

    // Handle disconnection
    socket.on('disconnect', () => {
      handleDisconnect(socket);
    });

    // Register event handlers
    registerGameEvents(socket);
    registerPlayerEvents(socket);
    registerLeaderboardEvents(socket);

    // Notify client they're connected
    socket.emit('connectionEstablished', { socketId: socket.id });
  });

  // Subscribe to game events to broadcast updates
  subscribeToGameEvents(io);
}

function handleDisconnect(socket: Socket): void {
  console.log(`Client disconnected: ${socket.id}`);
  
  const player = activePlayers.get(socket.id);
  if (player) {
    // Update player status to offline
    gameStateService.updatePlayerStatus(
      player.gameId, 
      player.playerId, 
      PlayerStatus.OFFLINE
    );
    
    // Emit player left event to game room
    socket.to(player.gameId).emit(socketEvents.PLAYER_LEFT, {
      gameId: player.gameId,
      playerId: player.playerId,
      username: player.username
    });
    
    // Remove from tracking
    activePlayers.delete(socket.id);
    
    // Remove from game room
    const gameRoom = gameRooms.get(player.gameId);
    if (gameRoom) {
      gameRoom.delete(socket.id);
      if (gameRoom.size === 0) {
        gameRooms.delete(player.gameId);
      }
    }
    
    // Leave socket.io room
    socket.leave(player.gameId);
  }
}

function registerGameEvents(socket: Socket): void {
  // Create a new game
  socket.on(socketEvents.CREATE_GAME, (data: { rows: number, cols: number, mines: number, isInfiniteWorld: boolean }) => {
    try {
      // Validate input
      const { rows, cols, mines, isInfiniteWorld } = data;
      
      if (!rows || !cols || !mines) {
        socket.emit(socketEvents.ERROR, { 
          message: 'Invalid game configuration',
          code: 'INVALID_CONFIG'
        });
        return;
      }
      
      // Create game config
      const gameConfig: GameConfig = {
        rows,
        cols,
        mines,
        isInfiniteWorld
      };
      
      // Create new game
      const game = gameStateService.createGame(gameConfig);
      
      // Respond with game info
      socket.emit(socketEvents.GAME_CREATED, {
        gameId: game.gameId,
        boardConfig: gameConfig
      });
      
      console.log(`Game created: ${game.gameId}`);
    } catch (error) {
      console.error('Error creating game:', error);
      socket.emit(socketEvents.ERROR, { 
        message: 'Failed to create game',
        code: 'GAME_CREATION_FAILED'
      });
    }
  });
  
  // Join an existing game
  socket.on(socketEvents.JOIN_GAME, (data: { gameId: string, username: string }) => {
    try {
      const { gameId, username } = data;
      
      if (!gameId || !username) {
        socket.emit(socketEvents.ERROR, { 
          message: 'Game ID and username are required',
          code: 'INVALID_JOIN_REQUEST'
        });
        return;
      }
      
      // Check if game exists
      const game = gameStateService.getGame(gameId);
      if (!game) {
        socket.emit(socketEvents.ERROR, { 
          message: 'Game not found',
          code: 'GAME_NOT_FOUND'
        });
        return;
      }
      
      // Add player to game
      const playerId = gameStateService.addPlayer(gameId, username, socket.id);
      
      // Join socket to game room
      socket.join(gameId);
      
      // Track player connection
      activePlayers.set(socket.id, {
        socketId: socket.id,
        gameId,
        playerId,
        username
      });
      
      // Track game room membership
      if (!gameRooms.has(gameId)) {
        gameRooms.set(gameId, new Set());
      }
      gameRooms.get(gameId)?.add(socket.id);
      
      // Emit success event to the joining player
      socket.emit(socketEvents.GAME_JOINED, {
        gameId,
        playerId,
        username
      });
      
      // Broadcast player joined event to other players in the room
      socket.to(gameId).emit(socketEvents.PLAYER_JOINED, {
        gameId,
        playerId,
        username
      });
      
      // Send initial game state to the new player
      const visibleCells = gameStateService.getVisibleCells(gameId);
      const playerScores = scoreService.getAllPlayerScores(gameId);
      
      socket.emit(socketEvents.GAME_STATE, {
        gameId,
        cells: visibleCells,
        players: Object.values(game.players).map(p => ({
          id: p.id,
          username: p.username,
          status: p.status
        })),
        scores: playerScores
      });
      
      console.log(`Player ${playerId} (${username}) joined game ${gameId}`);
    } catch (error) {
      console.error('Error joining game:', error);
      socket.emit(socketEvents.ERROR, { 
        message: 'Failed to join game',
        code: 'GAME_JOIN_FAILED'
      });
    }
  });
}

function registerPlayerEvents(socket: Socket): void {
  // Handle reveal tile action
  socket.on(socketEvents.REVEAL_TILE, (data: { gameId: string, x: number, y: number }) => {
    try {
      const { gameId, x, y } = data;
      
      // Validate player is in the game
      const player = activePlayers.get(socket.id);
      if (!player || player.gameId !== gameId) {
        socket.emit(socketEvents.ERROR, { 
          message: 'You are not in this game',
          code: 'NOT_IN_GAME'
        });
        return;
      }
      
      // Handle the reveal action
      playerActionService.handleRevealTile(gameId, player.playerId, x, y);
      
      // Note: The result will be broadcast through event subscriptions
    } catch (error) {
      console.error('Error revealing tile:', error);
      socket.emit(socketEvents.ERROR, { 
        message: 'Failed to reveal tile',
        code: 'REVEAL_FAILED'
      });
    }
  });
  
  // Handle flag tile action
  socket.on(socketEvents.FLAG_TILE, (data: { gameId: string, x: number, y: number }) => {
    try {
      const { gameId, x, y } = data;
      
      // Validate player is in the game
      const player = activePlayers.get(socket.id);
      if (!player || player.gameId !== gameId) {
        socket.emit(socketEvents.ERROR, { 
          message: 'You are not in this game',
          code: 'NOT_IN_GAME'
        });
        return;
      }
      
      // Handle the flag action
      playerActionService.handleFlagTile(gameId, player.playerId, x, y);
      
      // Note: The result will be broadcast through event subscriptions
    } catch (error) {
      console.error('Error flagging tile:', error);
      socket.emit(socketEvents.ERROR, { 
        message: 'Failed to flag tile',
        code: 'FLAG_FAILED'
      });
    }
  });
  
  // Handle chord click action
  socket.on(socketEvents.CHORD_CLICK, (data: { gameId: string, x: number, y: number }) => {
    try {
      const { gameId, x, y } = data;
      
      // Validate player is in the game
      const player = activePlayers.get(socket.id);
      if (!player || player.gameId !== gameId) {
        socket.emit(socketEvents.ERROR, { 
          message: 'You are not in this game',
          code: 'NOT_IN_GAME'
        });
        return;
      }
      
      // Handle the chord click action
      playerActionService.handleChordClick(gameId, player.playerId, x, y);
      
      // Note: The result will be broadcast through event subscriptions
    } catch (error) {
      console.error('Error performing chord click:', error);
      socket.emit(socketEvents.ERROR, { 
        message: 'Failed to perform chord click',
        code: 'CHORD_CLICK_FAILED'
      });
    }
  });
}

function registerLeaderboardEvents(socket: Socket): void {
  // Get leaderboard data
  socket.on(socketEvents.GET_LEADERBOARD, async (data: { 
    category: LeaderboardCategory, 
    metric: LeaderboardMetric,
    limit?: number 
  }) => {
    try {
      const { category, metric, limit = 10 } = data;
      
      // Get leaderboard data
      const leaderboard = await leaderboardService.getLeaderboard(category, metric, limit);
      
      // Send response
      socket.emit(socketEvents.LEADERBOARD_DATA, leaderboard);
    } catch (error) {
      console.error('Error getting leaderboard:', error);
      socket.emit(socketEvents.ERROR, { 
        message: 'Failed to get leaderboard data',
        code: 'LEADERBOARD_ERROR'
      });
    }
  });
}

function subscribeToGameEvents(io: Server): void {
  // Subscribe to board updates
  eventBus.subscribe('boardUpdated', (data) => {
    const { gameId, cells } = data;
    io.to(gameId).emit(socketEvents.BOARD_UPDATE, { gameId, cells });
  });
  
  // Subscribe to score updates
  eventBus.subscribe('scoreUpdated', (data) => {
    const { gameId, playerId, score } = data;
    io.to(gameId).emit(socketEvents.SCORE_UPDATE, { gameId, playerId, score });
  });
  
  // Subscribe to game over events
  eventBus.subscribe('gameOver', (data) => {
    const { gameId, winner, minePositions } = data;
    io.to(gameId).emit(socketEvents.GAME_OVER, { 
      gameId, 
      winner, 
      minePositions 
    });
  });
  
  // Subscribe to leaderboard updates
  eventBus.subscribe('leaderboardUpdated', (data) => {
    const { category, metric, entries } = data;
    io.emit(socketEvents.LEADERBOARD_UPDATED, { 
      category, 
      metric, 
      entries 
    });
  });
}

// Export for testing purposes
export function setupSocketHandlers(io: Server): Server {
  initializeSocketServer(io);
  return io;
}