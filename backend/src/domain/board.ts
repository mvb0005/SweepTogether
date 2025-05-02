import { Cell, Board, GameConfig } from './types';
import { SpatialHashGrid } from './spatialHashGrid';
import { getCellValue, isMine } from './worldGenerator';

export class BoardImpl {
    readonly width: number;
    readonly height: number;
    readonly mineCount: number;
    private grid: Cell[][];
    private minePositions: Set<string>;
    private spatialGrid: SpatialHashGrid<Cell>;
    revealedCells: number = 0;
    totalNonMineCells: number;

    constructor(width: number, height: number, mineCount: number) {
        this.width = width;
        this.height = height;
        this.mineCount = mineCount;
        this.grid = [];
        this.minePositions = new Set();
        this.spatialGrid = new SpatialHashGrid<Cell>(width, height, 1);
        this.totalNonMineCells = width * height - mineCount;

        if (mineCount >= width * height) {
            throw new Error("Mine count cannot be equal to or greater than the total number of cells.");
        }

        this.initializeBoard();
        this.placeMines();
        this.calculateAdjacentMines();
    }

    initializeBoard(): void {
        // Initialize the board with empty cells
        for (let r = 0; r < this.height; r++) {
            this.grid[r] = [];
            for (let c = 0; c < this.width; c++) {
                const cell: Cell = {
                    isMine: false,
                    adjacentMines: 0,
                    revealed: false,
                    flagged: false
                };
                this.grid[r][c] = cell;
                this.spatialGrid.add(cell, c, r);
            }
        }
    }

    placeMines(): void {
        // Place mines randomly
        let minesPlaced = 0;
        while (minesPlaced < this.mineCount) {
            const r = Math.floor(Math.random() * this.height);
            const c = Math.floor(Math.random() * this.width);
            const key = `${r},${c}`;
            
            if (!this.minePositions.has(key)) {
                this.minePositions.add(key);
                this.grid[r][c].isMine = true;
                minesPlaced++;
            }
        }
    }

    calculateAdjacentMines(): void {
        // Calculate adjacent mines for each cell
        for (let r = 0; r < this.height; r++) {
            for (let c = 0; c < this.width; c++) {
                if (this.grid[r][c].isMine) continue;
                
                let count = 0;
                for (let dr = -1; dr <= 1; dr++) {
                    for (let dc = -1; dc <= 1; dc++) {
                        if (dr === 0 && dc === 0) continue;
                        
                        const nr = r + dr;
                        const nc = c + dc;
                        if (nr >= 0 && nr < this.height && 
                            nc >= 0 && nc < this.width && 
                            this.grid[nr][nc].isMine) {
                            count++;
                        }
                    }
                }
                this.grid[r][c].adjacentMines = count;
            }
        }
    }
}

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
 * Requires initializeWorldGenerator to have been called previously.
 * 
 * @param rows - Number of rows for the initial view
 * @param cols - Number of columns for the initial view
 * @returns A new game board
 */
export function generateBoard(rows: number, cols: number): Board {
    const board: Cell[][] = [];

    // Create the initial board structure
    for (let r = 0; r < rows; r++) {
        board[r] = [];
        for (let c = 0; c < cols; c++) {
            const cellValue = getCellValue(r, c);
            board[r][c] = {
                revealed: false,
                flagged: false,
                isMine: cellValue === 'M',
                adjacentMines: cellValue === 'M' ? 0 : cellValue,
            };
        }
    }

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
    const board: Cell[][] = Array(config.rows).fill(null).map(() =>
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