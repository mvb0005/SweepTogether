import { Board, Cell, ClientCell, GameConfig, GameState, MineReveal, Player, PlayerStatus, Players, ScoringConfig } from './types';
import { calculateAdjacentMines, createBoardWithFixedMines, generateBoard } from './board';
import { initializeWorldGenerator } from './worldGenerator'; // Import the initializer

/**
 * Default scoring configuration values.
 */
export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  firstPlacePoints: 5,
  secondPlacePoints: 3, 
  thirdPlacePoints: 1,
  numberRevealPoints: 1,
  pointsPerAdjacentMine: 1,
  mineHitPenalty: 10,
  lockoutDurationMs: 100, // 100 milliseconds lockout
  mineRevealDelayMs: 5000   // 5 seconds delay before showing a mine to all
}

/**
 * Creates a representation of the board suitable for sending to clients.
 * Hides information about unrevealed cells for game integrity.
 * 
 * @param currentBoard - The current full board state on the server
 * @returns A client-safe board representation
 */
export function getBoardStateForClient(currentBoard: Board): ClientCell[][] {
  return currentBoard.map(row =>
    row.map(cell => {
      if (cell.revealed) {
        return {
          revealed: true,
          flagged: cell.flagged,
          isMine: cell.isMine,
          adjacentMines: cell.adjacentMines,
        };
      } else {
        // Only send revealed and flagged status for hidden cells
        return {
          revealed: false,
          flagged: cell.flagged, // Send flag status even if hidden
        };
      }
    })
  );
}

/**
 * Creates a new game state with the given configuration.
 * Initializes the infinite world generator with the game ID as the seed.
 * 
 * @param gameId - The ID of the game
 * @param config - The configuration for the game
 * @param scoringConfig - Optional custom scoring configuration
 * @returns A new game state
 */
export function createGame(
  gameId: string, 
  config: GameConfig, 
  scoringConfig: Partial<ScoringConfig> = {}
): GameState {
  // Initialize the infinite world generator with the gameId as the seed
  // This ensures any logic using the infinite generator is seeded correctly for this game
  initializeWorldGenerator(gameId);

  const board = config.mineLocations
    ? createBoardWithFixedMines(config)
    : generateBoard(config.rows, config.cols);
  
  // Merge default scoring config with any provided custom values
  const finalScoringConfig: ScoringConfig = {
    ...DEFAULT_SCORING_CONFIG,
    ...scoringConfig
  };
  
  return {
    board,
    players: {},
    boardConfig: config,
    scoringConfig: finalScoringConfig,
    mineReveals: [],
    pendingReveals: [],
    gameOver: false
  };
}

/**
 * Performs a flood fill operation starting from a given cell.
 * Reveals all connected cells with 0 adjacent mines.
 * 
 * @param row - Starting row
 * @param col - Starting column
 * @param board - The game board
 * @param config - Game configuration
 * @param visitedSet - Set of visited cell coordinates
 */
export function floodFill(
  row: number, 
  col: number, 
  board: Board, 
  config: GameConfig, 
  visitedSet: Set<string>
): void {
  const key = `${row},${col}`;
  
  // Check boundaries and if already visited
  if (row < 0 || row >= config.rows || col < 0 || col >= config.cols || visitedSet.has(key)) {
    return;
  }
  
  visitedSet.add(key); // Mark as visited early
  const cell = board[row][col];

  // Don't process flagged cells
  if (cell.flagged) {
    return;
  }

  // If already revealed, check if it's a zero to continue fill, but don't re-reveal
  if (cell.revealed) {
    if (cell.adjacentMines === 0 && !cell.isMine) {
      // Continue flood fill to neighbors
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          floodFill(row + dr, col + dc, board, config, visitedSet);
        }
      }
    }
    return;
  }

  // Reveal the cell since it wasn't revealed before
  cell.revealed = true;

  // If it's a mine, stop (shouldn't happen if called correctly)
  if (cell.isMine) {
    console.warn(`Flood fill revealed a mine at (${row}, ${col}). This shouldn't happen if started correctly.`);
    return;
  }

  // If it's a blank cell (0 adjacent mines), continue flood fill to neighbors
  if (cell.adjacentMines === 0) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        floodFill(row + dr, col + dc, board, config, visitedSet);
      }
    }
  }
}

/**
 * Updates the player's score and status based on game actions.
 * 
 * @param gameState - The current game state
 * @param playerId - The ID of the player to update
 * @param scoreChange - The number of points to add (or subtract if negative)
 * @param reason - The reason for the score change (for events and logging)
 * @param lockOut - Whether to lock out the player (for penalties)
 * @returns The updated player object
 */
export function updatePlayerScore(
  gameState: GameState,
  playerId: string,
  scoreChange: number,
  reason: string,
  lockOut: boolean = false
): Player {
  const player = gameState.players[playerId];
  if (!player) {
    throw new Error(`Player ${playerId} not found in game state`);
  }
  
  // Update score
  player.score += scoreChange;
  
  // Apply lockout if needed
  if (lockOut) {
    player.status = PlayerStatus.LOCKED_OUT;
    player.lockedUntil = Date.now() + gameState.scoringConfig.lockoutDurationMs;
  }
  
  return player;
}

/**
 * Checks if a player is currently locked out.
 * Also updates the player's status if the lockout period has expired.
 * 
 * @param player - The player to check
 * @returns Whether the player is currently locked out
 */
export function isPlayerLockedOut(player: Player): boolean {
  if (player.status !== PlayerStatus.LOCKED_OUT) {
    return false;
  }
  
  // Check if lockout has expired
  if (player.lockedUntil && player.lockedUntil <= Date.now()) {
    player.status = PlayerStatus.ACTIVE;
    player.lockedUntil = undefined;
    return false;
  }
  
  return true;
}

/**
 * Records or updates a safe mine reveal by a player who flagged it correctly.
 * 
 * @param gameState - The current game state
 * @param row - The row of the mine
 * @param col - The column of the mine
 * @param playerId - The ID of the player who flagged the mine
 * @returns The mine reveal object, or undefined if not applicable
 */
export function recordSafeMineReveal(
  gameState: GameState,
  row: number,
  col: number,
  playerId: string
): MineReveal | undefined {
  const { board, mineReveals } = gameState;
  
  // Check if coordinates are valid
  if (!board[row] || !board[row][col]) {
    return undefined;
  }
  
  const cell = board[row][col];
  
  // Only mines can be recorded for safe reveals
  if (!cell.isMine) {
    return undefined;
  }
  
  // Find if this mine already has a reveal record
  let mineReveal = mineReveals.find(r => r.row === row && r.col === col);
  
  // If no existing record, create a new one
  if (!mineReveal) {
    mineReveal = {
      row,
      col,
      players: [],
      revealed: false
    };
    gameState.mineReveals.push(mineReveal);
  }
  
  // Check if this player already contributed
  if (mineReveal.players.some(p => p.playerId === playerId)) {
    return mineReveal;
  }
  
  // Add player contribution
  const position = mineReveal.players.length + 1;
  mineReveal.players.push({
    playerId: playerId,
    position,
    timestamp: Date.now()
  });
  
  // Award points based on position
  let points = 0;
  if (position === 1) {
    points = gameState.scoringConfig.firstPlacePoints;
  } else if (position === 2) {
    points = gameState.scoringConfig.secondPlacePoints;
  } else if (position === 3) {
    points = gameState.scoringConfig.thirdPlacePoints;
  }
  
  if (points > 0) {
    updatePlayerScore(
      gameState, 
      playerId, 
      points, 
      `Placed ${position}${position === 1 ? 'st' : position === 2 ? 'nd' : 'rd'} in revealing mine at (${row}, ${col})`
    );
  }
  
  // Check if we should schedule this mine for reveal to all players
  if (position === 3) {
    // All three positions filled, schedule for immediate reveal
    scheduleMineFinalReveal(gameState, mineReveal);
  } else if (position === 1) {
    // First reveal, schedule with delay
    scheduleMineFinalReveal(gameState, mineReveal, gameState.scoringConfig.mineRevealDelayMs);
  }
  
  return mineReveal;
}

/**
 * Schedules a mine to be fully revealed to all players after a delay.
 * 
 * @param gameState - The current game state
 * @param mineReveal - The mine reveal to schedule
 * @param delayMs - Optional delay override (default is 0 for immediate)
 */
export function scheduleMineFinalReveal(
  gameState: GameState,
  mineReveal: MineReveal,
  delayMs: number = 0
): void {
  // Only schedule if not already scheduled
  if (mineReveal.revealTimestamp) {
    return;
  }
  
  // Set the timestamp when the mine will be revealed
  mineReveal.revealTimestamp = Date.now() + delayMs;
  
  // Add to pending reveals list if not already there
  const alreadyPending = gameState.pendingReveals.some(
    coord => coord.row === mineReveal.row && coord.col === mineReveal.col
  );
  
  if (!alreadyPending) {
    gameState.pendingReveals.push({
      row: mineReveal.row,
      col: mineReveal.col
    });
  }
}

/**
 * Processes all pending mine reveals that are ready to be shown.
 * Call this function periodically to reveal mines whose time has come.
 * 
 * @param gameState - The current game state
 * @returns Array of mine reveals that were processed
 */
export function processReadyMineReveals(gameState: GameState): MineReveal[] {
  const now = Date.now();
  const readyReveals: MineReveal[] = [];
  
  // Find all mine reveals that are ready
  gameState.mineReveals.forEach(mineReveal => {
    if (!mineReveal.revealed && 
        mineReveal.revealTimestamp && 
        mineReveal.revealTimestamp <= now) {
      
      // Mark the mine as revealed on the board
      const { row, col } = mineReveal;

      // Make sure row and col exist and are in bounds before accessing
      if (typeof row === 'number' && typeof col === 'number' &&
        gameState.board[row] && gameState.board[row][col]) {
        gameState.board[row][col].revealed = true;
      }
      
      // Mark the reveal as completed
      mineReveal.revealed = true;
      readyReveals.push(mineReveal);
    }
  });
  
  // Remove processed reveals from pending list
  if (readyReveals.length > 0) {
    gameState.pendingReveals = gameState.pendingReveals.filter(pending => {
      return !readyReveals.some(
        reveal => reveal.row === pending.row && reveal.col === pending.col
      );
    });
  }
  
  return readyReveals;
}

/**
 * Handles a player hitting a mine directly, applying penalty and lockout.
 * 
 * @param gameState - The current game state
 * @param playerId - The ID of the player who hit the mine
 * @param row - The row of the mine that was hit
 * @param col - The column of the mine that was hit
 * @returns The updated player object
 */
export function handleMineHit(
  gameState: GameState,
  playerId: string,
  row: number, 
  col: number
): Player {
  return updatePlayerScore(
    gameState,
    playerId,
    -gameState.scoringConfig.mineHitPenalty,
    `Hit a mine at (${row}, ${col})`,
    true // Apply lockout
  );
}

/**
 * Reveals a tile on the board.
 * Implements core reveal logic including flood fill and chord clicking.
 * Also handles scoring and penalties.
 * 
 * @param row - Row of the cell to reveal
 * @param col - Column of the cell to reveal
 * @param gameState - Current game state
 * @param playerId - ID of the player making the action
 * @returns Information about the reveal action result
 */
export function revealTile(
  row: number,
  col: number,
  gameState: GameState,
  playerId: string
): { 
  success: boolean; 
  mineHit: boolean; 
  message?: string; 
  visitedCells?: Set<string>;
  playerUpdated?: boolean;
  mineReveal?: MineReveal;
  gameOver?: boolean;
} {
  const { board, boardConfig, players } = gameState;
  
  // Check if player exists
  const player = players[playerId];
  if (!player) {
    return { 
      success: false, 
      mineHit: false, 
      message: `Player ${playerId} not found in game.` 
    };
  }
  
  // Check if player is locked out
  if (isPlayerLockedOut(player)) {
    return { 
      success: false, 
      mineHit: false, 
      message: `Player ${playerId} is locked out until ${new Date(player.lockedUntil!).toISOString()}.`,
      playerUpdated: true
    };
  }
  
  // Check if coordinates are valid
  if (row < 0 || row >= boardConfig.rows || col < 0 || col >= boardConfig.cols) {
    return { 
      success: false, 
      mineHit: false, 
      message: `Invalid coordinates (${row}, ${col}). Out of bounds for ${boardConfig.rows}x${boardConfig.cols} board.` 
    };
  }

  const targetCell = board[row][col];
  const visited = new Set<string>();

  // Handle chord click (clicking on a revealed numbered cell)
  if (targetCell.revealed && targetCell.adjacentMines > 0) {
    let adjacentFlags = 0;
    let adjacentRevealedMines = 0;
    const neighborsToRevealCoords: { r: number, c: number }[] = [];
    const flaggedMines: { r: number, c: number }[] = [];

    // Count flags, revealed mines, and collect cells to potentially reveal
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = row + dr;
        const nc = col + dc;

        if (nr >= 0 && nr < boardConfig.rows && nc >= 0 && nc < boardConfig.cols) {
          const neighbor = board[nr][nc];
          // Count flagged cells
          if (neighbor.flagged) {
            adjacentFlags++;
            // Track flagged cells that are actually mines (for scoring)
            if (neighbor.isMine) {
              flaggedMines.push({ r: nr, c: nc });
            }
          }
          // Count revealed mines
          else if (neighbor.revealed && neighbor.isMine) {
            adjacentRevealedMines++;
          }
          // Collect hidden, non-flagged neighbors
          if (!neighbor.revealed && !neighbor.flagged) {
            neighborsToRevealCoords.push({ r: nr, c: nc });
          }
        }
      }
    }

    // If flag count + revealed mines matches the cell number, reveal neighbors
    if (adjacentFlags + adjacentRevealedMines === targetCell.adjacentMines) {
      let mineHit = false;
      let mineHitLocation: { r: number, c: number } | null = null;
      let mineReveal: MineReveal | undefined;

      // Process neighbors: Call floodFill for zeros, reveal others directly
      for (const { r, c } of neighborsToRevealCoords) {
        const neighborCell = board[r][c];
        const neighborKey = `${r},${c}`;

        // Skip if already processed by a previous flood fill in this operation
        if (visited.has(neighborKey)) {
          continue;
        }

        // For zero cells, trigger flood fill
        if (neighborCell.adjacentMines === 0 && !neighborCell.isMine) {
          floodFill(r, c, board, boardConfig, visited);
        }
        // For non-zero cells, reveal directly
        else {
          if (!visited.has(neighborKey)) {
            neighborCell.revealed = true;
            visited.add(neighborKey);
            if (neighborCell.isMine) {
              mineHit = true;
              mineHitLocation = { r, c };
            }
          }
        }
      }

      // Handle safe mine reveals through correct flags
      if (!mineHit && flaggedMines.length > 0) {
        for (const { r, c } of flaggedMines) {
          const safeReveal = recordSafeMineReveal(gameState, r, c, playerId);
          if (safeReveal && !mineReveal) {
            mineReveal = safeReveal;
          }
        }
      }

      // Handle mine hit (player clicked a number but had incorrect flags)
      if (mineHit && mineHitLocation) {
        handleMineHit(gameState, playerId, mineHitLocation.r, mineHitLocation.c);
        
        // Reveal the entire board when a mine is hit
        revealAllMines(board);
        
        return { 
          success: true, 
          mineHit: true, 
          message: `Player ${playerId} hit a mine via chord click! Game over!`,
          visitedCells: visited,
          playerUpdated: true,
          gameOver: true
        };
      }
      
      return { 
        success: true, 
        mineHit: false, 
        visitedCells: visited,
        playerUpdated: flaggedMines.length > 0,
        mineReveal
      };
    } else {
      return { 
        success: false, 
        mineHit: false, 
        message: `Chord click invalid: Flag count (${adjacentFlags}) does not match cell number (${targetCell.adjacentMines}).` 
      };
    }
  } 
  // Handle clicks on already revealed cells
  else if (targetCell.revealed) {
    return { 
      success: false, 
      mineHit: false,
      message: `Cell already revealed`
    };
  } 
  // Handle clicks on flagged cells
  else if (targetCell.flagged) {
    return { 
      success: false, 
      mineHit: false,
      message: `Cannot reveal flagged cell`
    };
  }
  // Standard reveal (direct click on hidden, non-flagged cell)
  else {
    if (targetCell.isMine) {
      targetCell.revealed = true;
      visited.add(`${row},${col}`);
      handleMineHit(gameState, playerId, row, col);
      
      // Schedule this mine to be revealed to all players after a delay
      let mineReveal = gameState.mineReveals.find(r => r.row === row && r.col === col);
      if (!mineReveal) {
        mineReveal = {
          row,
          col,
          players: [],
          revealed: false
        };
        gameState.mineReveals.push(mineReveal);
      }
      scheduleMineFinalReveal(gameState, mineReveal, gameState.scoringConfig.mineRevealDelayMs);
      
      // Reveal the entire board when a mine is hit
      revealAllMines(board);
      
      return { 
        success: true, 
        mineHit: true, 
        message: `Player ${playerId} hit a mine! Game over!`,
        visitedCells: visited,
        playerUpdated: true,
        mineReveal,
        gameOver: true
      };
    } else {
      // Use flood fill to reveal empty areas
      floodFill(row, col, board, boardConfig, visited);
      
      // Award points for revealing numbered tiles
      // We need to check all cells that were revealed during this action
      let totalPointsAwarded = 0;
      visited.forEach(coordKey => {
        const [cellRow, cellCol] = coordKey.split(',').map(Number);
        const cell = board[cellRow][cellCol];
        
        // Only count numbered cells (cells with adjacent mines > 0)
        if (cell.revealed && !cell.isMine && cell.adjacentMines > 0) {
          // Calculate points based on scoring config, safely handling optional property
          const pointsPerAdjacent = gameState.scoringConfig.pointsPerAdjacentMine || 0;
          const points = gameState.scoringConfig.numberRevealPoints + 
                        (cell.adjacentMines * pointsPerAdjacent);
          totalPointsAwarded += points;
        }
      });
      
      // Update player score
      if (totalPointsAwarded > 0) {
        updatePlayerScore(
          gameState,
          playerId,
          totalPointsAwarded,
          `Revealed numbered cells`
        );
      }
      
      // Check if this reveal completed the game by revealing all non-mine cells
      let allNonMinesRevealed = true;
      for (const row of board) {
        for (const cell of row) {
          if (!cell.isMine && !cell.revealed) {
            allNonMinesRevealed = false;
            break;
          }
        }
        if (!allNonMinesRevealed) break;
      }
      
      // If all non-mine cells are revealed, the game is won
      if (allNonMinesRevealed) {
        // Reveal all mines (they would be flagged in a win)
        revealAllMines(board);
        return { 
          success: true, 
          mineHit: false, 
          visitedCells: visited,
          playerUpdated: totalPointsAwarded > 0,
          gameOver: true
        };
      }
      
      return { 
        success: true, 
        mineHit: false, 
        visitedCells: visited,
        playerUpdated: totalPointsAwarded > 0
      };
    }
  }
}

/**
 * Toggles the flag status of a cell.
 * Enhanced version that handles scoring when flagging mines correctly.
 * 
 * @param row - Row of the cell to flag/unflag
 * @param col - Column of the cell to flag/unflag
 * @param gameState - Current game state
 * @param playerId - ID of the player making the action
 * @returns Information about the flag action result
 */
export function toggleFlag(
  row: number, 
  col: number, 
  gameState: GameState,
  playerId: string
): { 
  success: boolean; 
  message?: string; 
  isFlagged?: boolean;
  playerUpdated?: boolean;
  mineReveal?: MineReveal;
  gameWon?: boolean;
} {
  const { board, boardConfig, players } = gameState;
  
  // Check if player exists
  const player = players[playerId];
  if (!player) {
    return { 
      success: false, 
      message: `Player ${playerId} not found in game.` 
    };
  }
  
  // Check if player is locked out
  if (isPlayerLockedOut(player)) {
    return { 
      success: false, 
      message: `Player ${playerId} is locked out until ${new Date(player.lockedUntil!).toISOString()}.`,
      playerUpdated: true
    };
  }
  
  // Check if coordinates are valid
  if (row < 0 || row >= boardConfig.rows || col < 0 || col >= boardConfig.cols) {
    return { 
      success: false, 
      message: `Invalid coordinates (${row}, ${col}). Out of bounds for ${boardConfig.rows}x${boardConfig.cols} board.` 
    };
  }

  const targetCell = board[row][col];

  // Cannot flag revealed cells
  if (targetCell.revealed) {
    return { 
      success: false, 
      message: `Cannot flag revealed cell` 
    };
  }

  // Toggle flag status
  const newFlagState = !targetCell.flagged;
  targetCell.flagged = newFlagState;
  
  let mineReveal: MineReveal | undefined;
  let gameWon = false;
  
  // If the player just flagged a mine correctly, record a mine reveal
  if (newFlagState && targetCell.isMine) {
    mineReveal = recordSafeMineReveal(gameState, row, col, playerId);
    
    // Check if all mines are now flagged correctly
    let allMinesFlagged = true;
    let allNonMinesRevealed = true;
    
    // Check all cells in the board
    for (const boardRow of board) {
      for (const cell of boardRow) {
        if (cell.isMine && !cell.flagged) {
          allMinesFlagged = false;
        }
        if (!cell.isMine && !cell.revealed) {
          allNonMinesRevealed = false;
        }
      }
    }
    
    // If all mines are flagged and all non-mines are revealed, the game is won
    if (allMinesFlagged && allNonMinesRevealed) {
      gameWon = true;
      // Reveal entire board
      revealAllMines(board);
    }
  }
  
  return { 
    success: true, 
    isFlagged: newFlagState,
    playerUpdated: mineReveal !== undefined,
    mineReveal,
    gameWon
  };
}

/**
 * Reveals all mines on the board.
 * Used when a player hits a mine.
 * 
 * @param board - The game board
 */
export function revealAllMines(board: Board): void {
  board.forEach(row => 
    row.forEach(cell => {
      cell.revealed = true;
    })
  );
}

/**
 * Checks if the game has been won.
 * Game is won when all non-mine cells are revealed.
 * 
 * @param gameState - Current game state
 * @returns Whether the game has been won
 */
export function checkWinCondition(gameState: GameState): boolean {
  const { board } = gameState;
  
  for (const row of board) {
    for (const cell of row) {
      // If there's any non-mine cell that's not revealed, the game is not won
      if (!cell.isMine && !cell.revealed) {
        return false;
      }
    }
  }
  
  return true;
}

/**
 * Awards points to a player for revealing a cell with adjacent mines.
 * Players get points for revealing numbered cells based on scoring config.
 * 
 * @param gameState - The current game state
 * @param playerId - The ID of the player to award points to
 * @param row - The row of the revealed cell
 * @param col - The column of the revealed cell
 * @param cell - The cell that was revealed
 * @returns The score awarded (if any)
 */
export function awardNumberRevealPoints(
  gameState: GameState,
  playerId: string,
  row: number,
  col: number,
  cell: Cell
): number {
  // Only award points for cells with adjacent mines (numbers)
  if (cell.adjacentMines === 0 || cell.isMine) {
    return 0;
  }
  
  const { scoringConfig } = gameState;
  
  // Base points for revealing a numbered cell
  let pointsAwarded = scoringConfig.numberRevealPoints;
  
  // Additional points based on the number of adjacent mines if configured
  if (scoringConfig.pointsPerAdjacentMine) {
    pointsAwarded += (cell.adjacentMines * scoringConfig.pointsPerAdjacentMine);
  }
  
  // Update the player's score
  updatePlayerScore(
    gameState,
    playerId,
    pointsAwarded,
    `Revealed a ${cell.adjacentMines} at (${row}, ${col})`
  );
  
  return pointsAwarded;
}