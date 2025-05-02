import { Server, Socket } from 'socket.io';
import { 
  Board, 
  GameConfig, 
  GameState, 
  RevealTilePayload, 
  FlagTilePayload,
  GameStatePayload,
  GameOverPayload,
  ErrorPayload,
  PlayerStatus,
  ScoreUpdatePayload,
  PlayerStatusUpdatePayload,
  MineRevealedPayload,
  ViewportUpdatePayload,
  PlayerViewportUpdatePayload,
  ViewportState,
  ClientCell
} from './types';
import { 
  getBoardStateForClient, 
  revealTile, 
  toggleFlag, 
  checkWinCondition, 
  createGame,
  processReadyMineReveals,
  DEFAULT_SCORING_CONFIG,
  isPlayerLockedOut
} from './game';
import { generateRandomName } from './utils';

/**
 * Map of all active games, accessible by all handler functions
 */
export const games = new Map<string, GameState>();

/**
 * Temporary store for game configurations requested by tests before join
 */
export const pendingGameConfigs = new Map<string, GameConfig & { initialBoard?: null }>();

/**
 * Default game configuration values
 */
export const DEFAULT_CONFIG: GameConfig = { 
  rows: 10, 
  cols: 10, 
  mines: 15 
};

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
 * Set interval for processing pending mine reveals
 */
const mineRevealTimers = new Map<string, NodeJS.Timeout>();

/**
 * Processes any pending mine reveals that are ready to be shown to players.
 * This is called periodically by a timer for each active game.
 * 
 * @param gameId - The ID of the game to process
 * @param io - The Socket.IO server instance
 */
function processMineReveals(gameId: string, io: Server): void {
  const gameState = games.get(gameId);
  if (!gameState || gameState.gameOver) {
    // If game is over or doesn't exist, clear the timer
    const timer = mineRevealTimers.get(gameId);
    if (timer) {
      clearInterval(timer);
      mineRevealTimers.delete(gameId);
    }
    return;
  }
  
  // Process any ready mine reveals
  const processedReveals = processReadyMineReveals(gameState);
  
  if (processedReveals.length > 0) {
    console.log(`Processed ${processedReveals.length} mine reveals for game ${gameId}`);
    
    // Emit state update with newly revealed mines
    const clientBoardState = getBoardStateForClient(gameState.board);
    
    const gameStatePayload: GameStatePayload = {
      boardState: clientBoardState,
      boardConfig: gameState.boardConfig,
      players: gameState.players,
      pendingReveals: gameState.pendingReveals,
      gameOver: gameState.gameOver,
      winner: gameState.winner,
      message: `${processedReveals.length} mine${processedReveals.length > 1 ? 's' : ''} revealed!`
    };
    
    io.to(gameId).emit('gameState', gameStatePayload);
    
    // Emit individual mine reveal events with details
    processedReveals.forEach(reveal => {
      // Map player positions to points awarded based on position
      const revealedBy = reveal.players.map(player => {
        let points = 0;
        if (player.position === 1) points = gameState.scoringConfig.firstPlacePoints;
        else if (player.position === 2) points = gameState.scoringConfig.secondPlacePoints;
        else if (player.position === 3) points = gameState.scoringConfig.thirdPlacePoints;
        
        return {
          playerId: player.playerId,
          position: player.position,
          points
        };
      });
      
      const mineRevealPayload: MineRevealedPayload = {
        row: reveal.row,
        col: reveal.col,
        revealedBy
      };
      
      io.to(gameId).emit('mineRevealed', mineRevealPayload);
    });
    
    // Check win condition after reveals processed
    if (checkWinCondition(gameState)) {
      handleGameWin(gameId, null, io); // No specific winner for team effort
    }
  }
  
  // Check and update any players whose lockout has expired
  Object.values(gameState.players).forEach(player => {
    if (player.status === PlayerStatus.LOCKED_OUT && 
        player.lockedUntil && player.lockedUntil <= Date.now()) {
      // Update player status to active
      player.status = PlayerStatus.ACTIVE;
      player.lockedUntil = undefined;
      
      // Notify clients
      const statusUpdatePayload: PlayerStatusUpdatePayload = {
        playerId: player.id,
        status: PlayerStatus.ACTIVE
      };
      
      io.to(gameId).emit('playerStatusUpdate', statusUpdatePayload);
    }
  });
}

/**
 * Handles game win condition, notifying all clients and updating game state.
 * 
 * @param gameId - The ID of the game
 * @param winnerId - The ID of the winning player (if applicable)
 * @param io - The Socket.IO server instance 
 */
function handleGameWin(gameId: string, winnerId: string | null, io: Server): void {
  const gameState = games.get(gameId);
  if (!gameState) return;
  
  gameState.gameOver = true;
  if (winnerId) {
    gameState.winner = winnerId;
  }
  
  // Get winner(s) information
  let winMessage = "";
  if (winnerId) {
    winMessage = `Player ${winnerId} won the game!`;
  } else {
    // If no specific winner, find top scorers
    const playersByScore = Object.values(gameState.players)
      .sort((a, b) => b.score - a.score);
    
    if (playersByScore.length > 0) {
      const topPlayer = playersByScore[0];
      const topScore = topPlayer.score;
      
      // Get all players with the top score
      const winners = playersByScore.filter(p => p.score === topScore);
      
      if (winners.length === 1) {
        winMessage = `Game complete! ${topPlayer.username || topPlayer.id} wins with ${topScore} points!`;
        gameState.winner = topPlayer.id;
      } else {
        const winnerNames = winners.map(p => p.username || p.id).join(', ');
        winMessage = `Game complete! Tie between ${winnerNames} with ${topScore} points!`;
      }
    } else {
      winMessage = "Game complete!";
    }
  }
  
  // Emit win event to all players
  const finalBoardState = getBoardStateForClient(gameState.board);
  const gameOverPayload: GameOverPayload = {
    boardState: finalBoardState,
    message: winMessage,
    winner: gameState.winner
  };
  
  io.to(gameId).emit('gameOver', gameOverPayload);
  console.log(`Game won in game ${gameId}: ${winMessage}`);
  
  // Clear the mine reveal timer
  const timer = mineRevealTimers.get(gameId);
  if (timer) {
    clearInterval(timer);
    mineRevealTimers.delete(gameId);
  }
}

/**
 * Handle a player joining a game
 * 
 * @param socket - The socket of the connecting player
 * @param gameId - The ID of the game to join
 * @param io - The Socket.IO server instance
 */
export function handleJoinGame(socket: Socket, gameId: string, io: Server): void {
  // Validate gameId format
  if (typeof gameId !== 'string' || gameId.trim().length === 0) {
    emitError(socket, 'Invalid game ID format. Must be a non-empty string.');
    console.log(`Player ${socket.id} failed to join: Invalid gameId format ('${gameId}')`);
    return;
  }
  
  const trimmedGameId = gameId.trim();
  console.log(`Player ${socket.id} attempting to join game: ${trimmedGameId}`);

  let gameState = games.get(trimmedGameId);
  
  // If game doesn't exist, create it
  if (!gameState) {
    console.log(`Game ${trimmedGameId} not found. Checking for pending config.`);
    const pendingConfig = pendingGameConfigs.get(trimmedGameId);
    
    let configToUse: GameConfig;
    
    if (pendingConfig) {
      console.log(`Using pending configuration for game ${trimmedGameId}:`, pendingConfig);
      configToUse = { 
        rows: pendingConfig.rows, 
        cols: pendingConfig.cols, 
        mines: pendingConfig.mines, 
        mineLocations: pendingConfig.mineLocations 
      };
      pendingGameConfigs.delete(trimmedGameId);
    } else {
      console.log(`No pending configuration found for ${trimmedGameId}. Using defaults.`);
      configToUse = { ...DEFAULT_CONFIG };
    }
    
    gameState = createGame(trimmedGameId, configToUse);
    games.set(trimmedGameId, gameState);
    console.log(`Game ${trimmedGameId} created with config:`, configToUse);
    
    // Start a timer to process mine reveals for this game
    const timer = setInterval(() => {
      processMineReveals(trimmedGameId, io);
    }, 1000); // Check every second
    
    mineRevealTimers.set(trimmedGameId, timer);
  } else {
    console.log(`Game ${trimmedGameId} found. Joining existing game.`);
  }

  // Add player to the game state with proper initialization and a fun random name
  const randomPlayerName = generateRandomName();
  gameState.players[socket.id] = { 
    id: socket.id, 
    score: 0,
    status: PlayerStatus.ACTIVE,
    username: randomPlayerName
  };

  console.log(`Assigned name "${randomPlayerName}" to player ${socket.id}`);

  // Store gameId on the socket
  socket.data.gameId = trimmedGameId;

  // Join the Socket.IO room
  socket.join(trimmedGameId);
  console.log(`Player ${socket.id} joined room: ${trimmedGameId}`);

  // Send the current game state only to the joining player
  const clientBoardState = getBoardStateForClient(gameState.board);
  console.log(`Emitting initial gameState to ${socket.id} for game ${trimmedGameId}`);
  
  const payload: GameStatePayload = {
    boardState: clientBoardState,
    boardConfig: gameState.boardConfig,
    players: gameState.players,
    pendingReveals: gameState.pendingReveals,
    gameOver: gameState.gameOver,
    winner: gameState.winner,
    message: `Joined game ${trimmedGameId}`
  };
  
  socket.emit('gameState', payload);

  // Broadcast player list update to others
  socket.to(trimmedGameId).emit('playerUpdate', gameState.players);
  console.log(`Broadcasting playerUpdate to room ${trimmedGameId}`);
}

/**
 * Handle a reveal tile action from a player
 * 
 * @param socket - The socket of the player revealing the tile
 * @param data - The payload containing coordinates to reveal (either row/col or x/y)
 * @param io - The Socket.IO server instance
 */
export function handleRevealTile(socket: Socket, data: unknown, io: Server): void {
  // Validate data type and structure
  if (typeof data !== 'object' || data === null) {
    emitError(socket, 'Invalid revealTile data format. Expected either { row: number, col: number } or { x: number, y: number }.');
    return;
  }

  // Check for associated gameId
  const gameId = socket.data.gameId;
  if (typeof gameId !== 'string') {
    emitError(socket, 'Cannot reveal tile: Not associated with a game. Please join a game first.');
    return;
  }

  // Check if we have either row/col or x/y coordinates
  let row: number;
  let col: number;

  // Handle both coordinate formats
  if (typeof (data as any).row === 'number' && typeof (data as any).col === 'number') {
    // Traditional row/col format
    row = (data as RevealTilePayload).row!;
    col = (data as RevealTilePayload).col!;
    console.log(`Received traditional row/col coordinates: (${row}, ${col})`);
  } else if (typeof (data as any).x === 'number' && typeof (data as any).y === 'number') {
    // New x/y format for infinite world
    row = (data as any).y; // Map y to row
    col = (data as any).x; // Map x to col
    console.log(`Received x/y coordinates: (${col}, ${row}) mapped to row/col: (${row}, ${col})`);
  } else {
    emitError(socket, 'Invalid coordinate format. Expected either { row: number, col: number } or { x: number, y: number }.');
    return;
  }

  // Validate coordinate values are integers
  if (!Number.isInteger(row) || !Number.isInteger(col)) {
    emitError(socket, 'Invalid coordinates. Values must be integers.');
    return;
  }

  // Retrieve game state
  const gameState = games.get(gameId);
  if (!gameState) {
    emitError(socket, `Cannot reveal tile: Game ${gameId} not found on server.`);
    return;
  }

  // Don't allow actions if game is over
  if (gameState.gameOver) {
    emitError(socket, 'Cannot reveal tile: Game is already over.');
    return;
  }
  
  // Check if player is locked out
  const player = gameState.players[socket.id];
  if (player && isPlayerLockedOut(player)) {
    const lockedUntil = new Date(player.lockedUntil!).toISOString();
    emitError(socket, `Cannot reveal tile: You are locked out until ${lockedUntil}`);
    
    // Emit updated player status
    const statusUpdatePayload: PlayerStatusUpdatePayload = {
      playerId: player.id,
      status: player.status,
      lockedUntil: player.lockedUntil
    };
    
    io.to(gameId).emit('playerStatusUpdate', statusUpdatePayload);
    return;
  }

  console.log(`revealTile event received for game ${gameId}:`, { row, col });

  // Perform the reveal action
  const result = revealTile(row, col, gameState, socket.id);
  
  if (!result.success) {
    if (result.message) {
      emitError(socket, result.message);
    }
    
    // If player status was updated (e.g., lockout status checked), emit update
    if (result.playerUpdated) {
      const player = gameState.players[socket.id];
      const statusUpdatePayload: PlayerStatusUpdatePayload = {
        playerId: socket.id,
        status: player.status,
        lockedUntil: player.lockedUntil
      };
      
      io.to(gameId).emit('playerStatusUpdate', statusUpdatePayload);
    }
    
    return;
  }

  // Check if a mine was hit
  if (result.mineHit) {
    // Emit score update for the penalty
    const player = gameState.players[socket.id];
    const scoreUpdatePayload: ScoreUpdatePayload = {
      playerId: socket.id,
      newScore: player.score,
      scoreDelta: -gameState.scoringConfig.mineHitPenalty,
      reason: "Hit a mine"
    };
    
    io.to(gameId).emit('scoreUpdate', scoreUpdatePayload);
    
    // Emit player status update for lockout
    const statusUpdatePayload: PlayerStatusUpdatePayload = {
      playerId: socket.id,
      status: PlayerStatus.LOCKED_OUT,
      lockedUntil: player.lockedUntil
    };
    
    io.to(gameId).emit('playerStatusUpdate', statusUpdatePayload);
    
    // Handle game over case
    if (result.gameOver) {
      gameState.gameOver = true;
      
      const finalBoardState = getBoardStateForClient(gameState.board);
      const playerName = gameState.players[socket.id]?.username || socket.id;
      const gameOverPayload: GameOverPayload = {
        boardState: finalBoardState,
        message: `Game over! ${playerName} hit a mine!`,
        winner: undefined
      };
      
      io.to(gameId).emit('gameOver', gameOverPayload);
      console.log(`Game over in game ${gameId}: Player ${socket.id} hit a mine`);
      
      // Clear the mine reveal timer
      const timer = mineRevealTimers.get(gameId);
      if (timer) {
        clearInterval(timer);
        mineRevealTimers.delete(gameId);
      }
      
      return;
    }
    
    // If not game over, just emit the updated game state with the hit mine
    const clientBoardState = getBoardStateForClient(gameState.board);
    const playerName = gameState.players[socket.id]?.username || socket.id;
    const mineHitPayload: GameStatePayload = {
      boardState: clientBoardState,
      boardConfig: gameState.boardConfig,
      players: gameState.players,
      pendingReveals: gameState.pendingReveals,
      gameOver: gameState.gameOver,
      winner: gameState.winner,
      message: `${playerName} hit a mine and is locked out!`
    };
    
    io.to(gameId).emit('gameState', mineHitPayload);
    console.log(`Player ${socket.id} hit a mine in game ${gameId} and is locked out`);
    
    return;
  }
  
  // Check if numbered cells were revealed and emit score updates
  if (result.visitedCells && result.visitedCells.size > 0) {
    // Check for numbered cells that were revealed
    let totalPointsAwarded = 0;
    let highestNumber = 0;
    
    result.visitedCells.forEach(coordKey => {
      const [cellRow, cellCol] = coordKey.split(',').map(Number);
      const cell = gameState.board[cellRow][cellCol];
      
      // Only count numbered cells (cells with adjacent mines > 0)
      if (cell.revealed && !cell.isMine && cell.adjacentMines > 0) {
        // Calculate points based on scoring config, safely handling optional property
        const pointsPerAdjacent = gameState.scoringConfig.pointsPerAdjacentMine || 0;
        const points = gameState.scoringConfig.numberRevealPoints + 
                      (cell.adjacentMines * pointsPerAdjacent);
        totalPointsAwarded += points;
        
        // Track highest number for the reason message
        if (cell.adjacentMines > highestNumber) {
          highestNumber = cell.adjacentMines;
        }
      }
    });
    
    // Only emit if points were awarded
    if (totalPointsAwarded > 0) {
      const player = gameState.players[socket.id];
      
      // Update the player's score first
      player.score += totalPointsAwarded;
      
      const reason = highestNumber > 0 ? 
        `Revealed ${result.visitedCells.size} cells including a ${highestNumber}` : 
        `Revealed ${result.visitedCells.size} cells`;
      
      const scoreUpdatePayload: ScoreUpdatePayload = {
        playerId: socket.id,
        newScore: player.score,
        scoreDelta: totalPointsAwarded,
        reason: reason
      };
      
      io.to(gameId).emit('scoreUpdate', scoreUpdatePayload);
    }
  }
  
  // Handle safe mine reveal if applicable
  if (result.mineReveal) {
    // Handle score updates for mine reveal
    result.mineReveal.players.forEach(playerInfo => {
      if (playerInfo.playerId === socket.id) {
        let points = 0;
        let position = "";
        
        if (playerInfo.position === 1) {
          points = gameState.scoringConfig.firstPlacePoints;
          position = "1st";
        } else if (playerInfo.position === 2) {
          points = gameState.scoringConfig.secondPlacePoints;
          position = "2nd";
        } else if (playerInfo.position === 3) {
          points = gameState.scoringConfig.thirdPlacePoints;
          position = "3rd";
        }
        
        if (points > 0) {
          // Update the player's score first
          gameState.players[socket.id].score += points;
          
          const scoreUpdatePayload: ScoreUpdatePayload = {
            playerId: socket.id,
            newScore: gameState.players[socket.id].score,
            scoreDelta: points,
            reason: `Placed ${position} in revealing a mine`
          };
          
          io.to(gameId).emit('scoreUpdate', scoreUpdatePayload);
        }
      }
    });
  }

  // Check if the game was won by revealing all cells
  if (result.gameOver) {
    gameState.gameOver = true;
    handleGameWin(gameId, socket.id, io);
    return;
  }

  // Check for win condition (all non-mine cells revealed)
  if (checkWinCondition(gameState)) {
    handleGameWin(gameId, socket.id, io);
    return;
  }

  // Broadcast updated game state
  const updatedClientBoardState = getBoardStateForClient(gameState.board);
  console.log(`Broadcasting updated gameState to room ${gameId} after reveal`);
  
  const gameStatePayload: GameStatePayload = {
    boardState: updatedClientBoardState,
    boardConfig: gameState.boardConfig,
    players: gameState.players,
    pendingReveals: gameState.pendingReveals,
    gameOver: gameState.gameOver,
    winner: gameState.winner
  };
  
  io.to(gameId).emit('gameState', gameStatePayload);
}

/**
 * Handle a flag tile action from a player
 * 
 * @param socket - The socket of the player flagging the tile
 * @param data - The payload containing coordinates to flag (either row/col or x/y)
 * @param io - The Socket.IO server instance
 */
export function handleFlagTile(socket: Socket, data: unknown, io: Server): void {
  // Validate data type and structure
  if (typeof data !== 'object' || data === null) {
    emitError(socket, 'Invalid flagTile data format. Expected either { row: number, col: number } or { x: number, y: number }.');
    return;
  }
  
  // Check if we have either row/col or x/y coordinates
  let row: number;
  let col: number;

  // Handle both coordinate formats
  if (typeof (data as any).row === 'number' && typeof (data as any).col === 'number') {
    // Traditional row/col format
    row = (data as FlagTilePayload).row!;
    col = (data as FlagTilePayload).col!;
    console.log(`Received traditional row/col coordinates: (${row}, ${col})`);
  } else if (typeof (data as any).x === 'number' && typeof (data as any).y === 'number') {
    // New x/y format for infinite world
    row = (data as any).y; // Map y to row
    col = (data as any).x; // Map x to col
    console.log(`Received x/y coordinates: (${col}, ${row}) mapped to row/col: (${row}, ${col})`);
  } else {
    emitError(socket, 'Invalid coordinate format. Expected either { row: number, col: number } or { x: number, y: number }.');
    return;
  }

  // Validate coordinate values are integers
  if (!Number.isInteger(row) || !Number.isInteger(col)) {
    emitError(socket, 'Invalid coordinates. Row and column must be integers.');
    return;
  }

  // Check for associated gameId
  const gameId = socket.data.gameId;
  if (typeof gameId !== 'string') {
    emitError(socket, 'Cannot flag tile: Not associated with a game. Please join a game first.');
    return;
  }

  // Retrieve game state
  const gameState = games.get(gameId);
  if (!gameState) {
    emitError(socket, `Cannot flag tile: Game ${gameId} not found on server.`);
    return;
  }
  
  // Don't allow actions if game is over
  if (gameState.gameOver) {
    emitError(socket, 'Cannot flag tile: Game is already over.');
    return;
  }
  
  // Check if player is locked out
  const player = gameState.players[socket.id];
  if (player && isPlayerLockedOut(player)) {
    const lockedUntil = new Date(player.lockedUntil!).toISOString();
    emitError(socket, `Cannot flag tile: You are locked out until ${lockedUntil}`);
    
    // Emit updated player status
    const statusUpdatePayload: PlayerStatusUpdatePayload = {
      playerId: player.id,
      status: player.status,
      lockedUntil: player.lockedUntil
    };
    
    io.to(gameId).emit('playerStatusUpdate', statusUpdatePayload);
    return;
  }

  console.log(`flagTile event received for game ${gameId}:`, { row, col });

  // Toggle flag on the cell with updated function signature
  const result = toggleFlag(row, col, gameState, socket.id);
  
  if (!result.success) {
    if (result.message) {
      emitError(socket, result.message);
    }
    
    // If player status was updated, emit update
    if (result.playerUpdated) {
      const player = gameState.players[socket.id];
      const statusUpdatePayload: PlayerStatusUpdatePayload = {
        playerId: socket.id,
        status: player.status,
        lockedUntil: player.lockedUntil
      };
      
      io.to(gameId).emit('playerStatusUpdate', statusUpdatePayload);
    }
    
    return;
  }
  
  // Handle score update if this was a correct mine flag
  if (result.mineReveal) {
    // Find this player's contribution
    const playerContribution = result.mineReveal.players.find(p => p.playerId === socket.id);
    if (playerContribution) {
      let points = 0;
      let position = "";
      
      if (playerContribution.position === 1) {
        points = gameState.scoringConfig.firstPlacePoints;
        position = "1st";
      } else if (playerContribution.position === 2) {
        points = gameState.scoringConfig.secondPlacePoints;
        position = "2nd";
      } else if (playerContribution.position === 3) {
        points = gameState.scoringConfig.thirdPlacePoints;
        position = "3rd";
      }
      
      if (points > 0) {
        // Update the player's score first
        gameState.players[socket.id].score += points;
        
        const scoreUpdatePayload: ScoreUpdatePayload = {
          playerId: socket.id,
          newScore: gameState.players[socket.id].score,
          scoreDelta: points,
          reason: `Placed ${position} in revealing a mine`
        };
        
        io.to(gameId).emit('scoreUpdate', scoreUpdatePayload);
      }
    }
  }

  // Check if the game was won by flagging all mines
  if (result.gameWon) {
    gameState.gameOver = true;
    handleGameWin(gameId, socket.id, io);
    return;
  }

  // Emit update to the room
  const updatedClientBoardState = getBoardStateForClient(gameState.board);
  const gameStatePayload: GameStatePayload = {
    boardState: updatedClientBoardState,
    boardConfig: gameState.boardConfig,
    players: gameState.players,
    pendingReveals: gameState.pendingReveals,
    gameOver: gameState.gameOver,
    winner: gameState.winner
  };
  
  io.to(gameId).emit('gameState', gameStatePayload);
  console.log(`Cell (${row}, ${col}) flagged status in game ${gameId}: ${result.isFlagged}`);
}

/**
 * Handle player disconnection
 * 
 * @param socket - The socket of the disconnecting player
 * @param io - The Socket.IO server instance
 */
export function handleDisconnect(socket: Socket, io: Server): void {
  console.log('User disconnected:', socket.id);
  
  const gameId = socket.data.gameId;
  if (!gameId) {
    console.log(`Disconnect: Player ${socket.id} was not in a game.`);
    return;
  }
  
  const gameState = games.get(gameId);
  if (!gameState) {
    console.log(`Disconnect: Game ${gameId} not found for player ${socket.id}, maybe already deleted.`);
    return;
  }
  
  console.log(`Removing player ${socket.id} from game ${gameId}`);
  delete gameState.players[socket.id];

  if (Object.keys(gameState.players).length === 0) {
    console.log(`Game ${gameId} is empty. Keeping game state.`);
  } else {
    console.log(`Broadcasting updated player list to room ${gameId} after disconnect`);
    io.to(gameId).emit('playerUpdate', gameState.players);
  }
}

/**
 * Setup all WebSocket event handlers for a socket
 * 
 * @param io - The Socket.IO server instance
 * @param socket - The socket to set up handlers for
 */
export function setupSocketHandlers(io: Server, socket: Socket): void {
  console.log('A user connected:', socket.id);
  
  socket.on('joinGame', (gameId: string) => handleJoinGame(socket, gameId, io));
  socket.on('revealTile', (data: unknown) => handleRevealTile(socket, data, io));
  socket.on('flagTile', (data: unknown) => handleFlagTile(socket, data, io));
  socket.on('chordClick', (data: unknown) => handleChordClick(socket, data, io));
  socket.on('updateViewport', (data: unknown) => handleViewportUpdate(socket, data, io));
  socket.on('disconnect', () => handleDisconnect(socket, io));
  
  // Could add additional handlers for chat, player name setting, etc.
}

/**
 * Handle a chord click action from a player
 * 
 * @param socket - The socket of the player making the chord click
 * @param data - The payload containing coordinates to chord click (either row/col or x/y)
 * @param io - The Socket.IO server instance
 */
export function handleChordClick(socket: Socket, data: unknown, io: Server): void {
  // Validate data type and structure
  if (typeof data !== 'object' || data === null) {
    emitError(socket, 'Invalid chordClick data format. Expected either { row: number, col: number } or { x: number, y: number }.');
    return;
  }

  // Check if we have either row/col or x/y coordinates
  let row: number;
  let col: number;

  // Handle both coordinate formats
  if (typeof (data as any).row === 'number' && typeof (data as any).col === 'number') {
    // Traditional row/col format
    row = (data as RevealTilePayload).row!;
    col = (data as RevealTilePayload).col!;
    console.log(`Received traditional row/col coordinates: (${row}, ${col})`);
  } else if (typeof (data as any).x === 'number' && typeof (data as any).y === 'number') {
    // New x/y format for infinite world
    row = (data as any).y; // Map y to row
    col = (data as any).x; // Map x to col
    console.log(`Received x/y coordinates: (${col}, ${row}) mapped to row/col: (${row}, ${col})`);
  } else {
    emitError(socket, 'Invalid coordinate format. Expected either { row: number, col: number } or { x: number, y: number }.');
    return;
  }

  // Validate row/col values are integers
  if (!Number.isInteger(row) || !Number.isInteger(col)) {
    emitError(socket, 'Invalid coordinates. Row and column must be integers.');
    return;
  }

  // Check for associated gameId
  const gameId = socket.data.gameId;
  if (typeof gameId !== 'string') {
    emitError(socket, 'Cannot chord click: Not associated with a game. Please join a game first.');
    return;
  }

  // Retrieve game state
  const gameState = games.get(gameId);
  if (!gameState) {
    emitError(socket, `Cannot chord click: Game ${gameId} not found on server.`);
    return;
  }

  // Don't allow actions if game is over
  if (gameState.gameOver) {
    emitError(socket, 'Cannot chord click: Game is already over.');
    return;
  }

  // Check if player is locked out
  const player = gameState.players[socket.id];
  if (player && isPlayerLockedOut(player)) {
    const lockedUntil = new Date(player.lockedUntil!).toISOString();
    emitError(socket, `Cannot chord click: You are locked out until ${lockedUntil}`);

    // Emit updated player status
    const statusUpdatePayload: PlayerStatusUpdatePayload = {
      playerId: player.id,
      status: player.status,
      lockedUntil: player.lockedUntil
    };

    io.to(gameId).emit('playerStatusUpdate', statusUpdatePayload);
    return;
  }

  console.log(`chordClick event received for game ${gameId}:`, { row, col });

  // Get the clicked cell
  if (row < 0 || row >= gameState.board.length ||
    col < 0 || col >= gameState.board[0].length) {
    emitError(socket, 'Invalid coordinates: Out of bounds.');
    return;
  }

  const cell = gameState.board[row][col];

  // Rest of the code remains unchanged
  // ...existing code...
}

/**
 * Helper function to count adjacent flags
 */
function countAdjacentFlags(board: Board, row: number, col: number): number {
  let count = 0;
  const adjacentDirections = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1], [0, 1],
    [1, -1], [1, 0], [1, 1]
  ];

  for (const [dRow, dCol] of adjacentDirections) {
    const newRow = row + dRow;
    const newCol = col + dCol;

    // Skip if out of bounds
    if (newRow < 0 || newRow >= board.length ||
      newCol < 0 || newCol >= board[0].length) {
      continue;
    }

    if (board[newRow][newCol].flagged) {
      count++;
    }
  }

  return count;
}

/**
 * Handle viewport update from a player
 * 
 * @param socket - The socket of the player sending viewport update
 * @param data - The payload containing viewport data
 * @param io - The Socket.IO server instance
 */
export function handleViewportUpdate(socket: Socket, data: unknown, io: Server): void {
  // Validate data type and structure
  if (typeof data !== 'object' || data === null ||
    typeof (data as any).center !== 'object' ||
    typeof (data as any).width !== 'number' ||
    typeof (data as any).height !== 'number') {
    emitError(socket, 'Invalid viewport data format. Expected { center: { x, y }, width, height, zoom }.');
    return;
  }

  const viewport = data as ViewportUpdatePayload;

  // Validate center coordinates
  if (typeof viewport.center !== 'object' ||
    typeof viewport.center.x !== 'number' ||
    typeof viewport.center.y !== 'number') {
    emitError(socket, 'Invalid viewport center coordinates. Expected { x: number, y: number }.');
    return;
  }

  // Check for associated gameId
  const gameId = socket.data.gameId;
  if (typeof gameId !== 'string') {
    emitError(socket, 'Cannot update viewport: Not associated with a game. Please join a game first.');
    return;
  }

  // Retrieve game state
  const gameState = games.get(gameId);
  if (!gameState) {
    emitError(socket, `Cannot update viewport: Game ${gameId} not found on server.`);
    return;
  }

  // Check if this player exists in the game
  if (!gameState.players[socket.id]) {
    emitError(socket, 'Cannot update viewport: Player not found in game.');
    return;
  }

  console.log(`Viewport update from player ${socket.id} in game ${gameId}:`, viewport);

  // Update the player's viewport in the game state
  gameState.players[socket.id].viewport = {
    center: viewport.center,
    width: viewport.width,
    height: viewport.height,
    zoom: viewport.zoom || 1 // Default zoom to 1 if not provided
  };

  // Broadcast player viewport update to other players in the same game
  const viewportUpdatePayload: PlayerViewportUpdatePayload = {
    playerId: socket.id,
    viewport: {
      center: viewport.center,
      width: viewport.width,
      height: viewport.height,
      zoom: viewport.zoom || 1
    }
  };

  // Only send to other players in the room, not back to sender
  socket.to(gameId).emit('playerViewportUpdate', viewportUpdatePayload);

  // If this is an infinite world game, send back cells relevant to this viewport
  if (gameState.boardConfig.isInfiniteWorld) {
    // We'll implement this logic in the next step
    // This would query the visible cells in the player's viewport
    // and send only the relevant data
    const viewportBoardData = getViewportBoard(gameState, viewport);

    socket.emit('viewportUpdate', {
      boardState: viewportBoardData,
      center: viewport.center
    });
  }
}

/**
 * Get the board data for a specific viewport area
 * For infinite world mode, we need to calculate the visible cells
 * 
 * @param gameState - The current game state
 * @param viewport - The viewport to get cells for
 * @returns A 2D array of ClientCell objects representing the visible board area
 */
function getViewportBoard(gameState: GameState, viewport: ViewportState): ClientCell[][] {
  // Create a 2D array representing the visible cells in the viewport
  const result: ClientCell[][] = [];

  // Calculate the bounds of the viewport
  const halfWidth = Math.floor(viewport.width / 2);
  const halfHeight = Math.floor(viewport.height / 2);

  const minX = viewport.center.x - halfWidth;
  const maxX = viewport.center.x + halfWidth;
  const minY = viewport.center.y - halfHeight;
  const maxY = viewport.center.y + halfHeight;

  // For each row in the viewport
  for (let y = minY; y <= maxY; y++) {
    const rowIndex = y - minY;
    result[rowIndex] = [];

    // For each column in the viewport
    for (let x = minX; x <= maxX; x++) {
      const colIndex = x - minX;

      // Initialize with default empty cell
      let cell: ClientCell = {
        revealed: false,
        flagged: false
      };

      // If this is an infinite world, use the world generator to get cell info
      if (gameState.boardConfig.isInfiniteWorld && gameState.infiniteWorldState) {
        const coordKey = `${x},${y}`;
        const cellState = gameState.infiniteWorldState.cells.get(coordKey);

        if (cellState) {
          cell = {
            revealed: cellState.revealed,
            flagged: cellState.flagged
          };

          // Only send mine or adjacent count if cell is revealed
          if (cellState.revealed) {
            if (cellState.isMine) {
              cell.isMine = true;
            } else {
              cell.adjacentMines = cellState.adjacentMines;
            }
          }
        }
      }
      // For standard fixed board, check if the coordinates are within the board bounds
      else if (y >= 0 && y < gameState.board.length && x >= 0 && x < gameState.board[0].length) {
        const boardCell = gameState.board[y][x];

        cell = {
          revealed: boardCell.revealed,
          flagged: boardCell.flagged
        };

        // Only send mine or adjacent count if cell is revealed
        if (boardCell.revealed) {
          if (boardCell.isMine) {
            cell.isMine = true;
          } else {
            cell.adjacentMines = boardCell.adjacentMines;
          }
        }
      }

      result[rowIndex][colIndex] = cell;
    }
  }

  return result;
}