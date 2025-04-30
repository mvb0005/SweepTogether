import { Board, Cell, GameConfig } from './types';

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
 * Generates a new Minesweeper board with randomly placed mines.
 * 
 * @param rows - Number of rows in the board
 * @param cols - Number of columns in the board
 * @param minesCount - Number of mines to place on the board
 * @returns A new board with mines placed and adjacent mine counts calculated
 */
export function generateBoard(rows: number, cols: number, minesCount: number): Board {
    // Initialize empty board
    let newBoard: Board = Array(rows).fill(null).map(() => 
        Array(cols).fill(null).map(() => ({ 
            isMine: false, 
            adjacentMines: 0, 
            revealed: false, 
            flagged: false 
        }))
    );

    // Place mines randomly
    let minesPlaced = 0;
    while (minesPlaced < minesCount) {
        const r = Math.floor(Math.random() * rows);
        const c = Math.floor(Math.random() * cols);
        if (!newBoard[r][c].isMine) {
            newBoard[r][c].isMine = true;
            minesPlaced++;
        }
    }

    // Calculate adjacent mines after placing them
    calculateAdjacentMines(newBoard);

    return newBoard;
}

/**
 * Creates a board with mines placed at specific locations.
 * 
 * @param config - Game configuration including board dimensions and mine locations
 * @returns A new board with mines placed at the specified locations
 */
export function createBoardWithFixedMines(config: GameConfig): Board {
    if (!config.mineLocations || config.mineLocations.length === 0) {
        return generateBoard(config.rows, config.cols, config.mines);
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