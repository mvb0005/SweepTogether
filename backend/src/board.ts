import { Board, Cell, GameConfig } from './types';
import { getCellValue, isMine } from './worldGenerator'; // Import world generator functions

/**
 * Calculates the number of adjacent mines for each cell on the board.
 * Modifies the board in place.
 * 
 * @param board - The game board to calculate adjacent mines for
 */
export function calculateAdjacentMines(board: Board): void {
    const rows = board.length;
    if (rows === 0) return;
    const cols = board[0].length;

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (board[r][c].isMine) {
                board[r][c].adjacentMines = 0;
                continue;
            }
            let count = 0;
            for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) {
                    if (dr === 0 && dc === 0) continue;
                    const nr = r + dr;
                    const nc = c + dc;
                    if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && board[nr][nc].isMine) {
                        count++;
                    }
                }
            }
            board[r][c].adjacentMines = count;
        }
    }
}

/**
 * Generates a new game board based on the infinite world generator.
 * Requires initializeWorldGenerator to have been called previously (e.g., in createGame).
 * 
 * @param rows - Number of rows for the initial view
 * @param cols - Number of columns for the initial view
 * @returns A new game board
 */
export function generateBoard(rows: number, cols: number): Board {
    const board: Board = [];

    // Create the initial board structure based on world generator
    for (let r = 0; r < rows; r++) {
        board[r] = [];
        for (let c = 0; c < cols; c++) {
            const cellValue = getCellValue(r, c); // Use world generator
            board[r][c] = {
                revealed: false,
                flagged: false,
                isMine: cellValue === 'M',
                adjacentMines: cellValue === 'M' ? 0 : cellValue, // Adjacent mines are pre-calculated by getCellValue
            };
        }
    }

    // Note: The old logic for placing a fixed number of mines randomly is removed.
    // The mine placement is now determined by the seeded noise function in worldGenerator.

    // The calculation of adjacent mines is also handled by worldGenerator.getCellValue,
    // so the calculateAdjacentMines function is no longer needed here for this board type.

    return board;
}

/**
 * Creates a board with mines placed at specific locations.
 * 
 * @param config - Game configuration including board dimensions and mine locations
 * @returns A new board with mines placed at the specified locations
 */
export function createBoardWithFixedMines(config: GameConfig): Board {
    if (!config.mineLocations || config.mineLocations.length === 0) {
        return generateBoard(config.rows, config.cols);
    }

    // Initialize empty board
    const board: Board = Array(config.rows).fill(null).map(() =>
        Array(config.cols).fill(null).map(() => ({
            isMine: false, 
            adjacentMines: 0, 
            revealed: false, 
            flagged: false
        }))
    );

    // Place mines according to mineLocations
    config.mineLocations.forEach(loc => {
        if (board[loc.row] && board[loc.row][loc.col]) {
            board[loc.row][loc.col].isMine = true;
        }
    });

    // Calculate adjacent mines based on placed mines
    calculateAdjacentMines(board);

    return board;
}