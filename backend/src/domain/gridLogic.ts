import { Cell, CellState, Coordinates, GameConfig, GameState, MineReveal as MineFlagReveal } from './types'; // Renamed MineReveal import
import { GetCellFunction } from './game';

// --- Constants ---
const DIRECTIONS = [
    { dx: -1, dy: -1 }, { dx: 0, dy: -1 }, { dx: 1, dy: -1 },
    { dx: -1, dy: 0 }, { dx: 1, dy: 0 },
    { dx: -1, dy: 1 }, { dx: 0, dy: 1 }, { dx: 1, dy: 1 },
];

// --- Helper Function ---

/**
 * Derives the CellState enum from a Cell object's boolean flags.
 * @param cell The cell object.
 * @returns The corresponding CellState.
 */
function getCellState(cell: Cell | null): CellState {
    if (!cell) return CellState.HIDDEN; // Or handle null differently?
    if (cell.revealed) {
        return cell.isMine ? CellState.REVEALED_MINE : CellState.REVEALED;
    }
    if (cell.flagged) {
        return CellState.FLAGGED;
    }
    return CellState.HIDDEN;
}

// --- New Type for Mine Hit Result ---

/**
 * Represents the result when a player reveals a mine.
 */
export interface MineHitResult {
    hitMine: Cell; // The specific mine cell that was hit
    // Potentially add other info like adjacent mines revealed by the hit later
}

// --- Core Board Logic (Coordinate-Based) ---

/**
 * Gets the state of adjacent cells for a given coordinate.
 * Uses the provided getCell function to retrieve cell data.
 * @param gameState The current game state.
 * @param x The x-coordinate.
 * @param y The y-coordinate.
 * @param getCell Function to retrieve cell state (handles generation/cache).
 * @returns A promise resolving to an array of adjacent cells.
 */
async function getAdjacentCells(
    gameState: GameState,
    x: number,
    y: number,
    getCell: GetCellFunction
): Promise<Cell[]> {
    const adjacentCells: Cell[] = [];
    for (const dir of DIRECTIONS) {
        const adjX = x + dir.dx;
        const adjY = y + dir.dy;
        const cell = await getCell(gameState, adjX, adjY);
        if (cell) {
            adjacentCells.push(cell);
        }
    }
    return adjacentCells;
}

/**
 * Reveals a cell and potentially triggers flood fill or mine hit.
 * This function is now asynchronous as getting cell data might involve generation.
 * @param gameState The current game state.
 * @param x The x-coordinate to reveal.
 * @param y The y-coordinate to reveal.
 * @param getCell Function to retrieve cell state.
 * @returns A promise resolving to an array of revealed cells (including flood fill results) or a MineHitResult object if a mine was hit.
 */
export async function revealCell(
    gameState: GameState,
    x: number,
    y: number,
    getCell: GetCellFunction
): Promise<Cell[] | MineHitResult> { // Updated return type
    const cell = await getCell(gameState, x, y);
    const cellState = getCellState(cell);

    if (!cell || cellState !== CellState.HIDDEN) {
        return []; // Cannot reveal non-existent or already revealed/flagged cells
    }

    if (cell.isMine) {
        // Mark the hit mine as revealed
        const revealedMineCell: Cell = { ...cell, revealed: true, flagged: false };
        // Return MineHitResult object
        return { hitMine: revealedMineCell }; // Updated return object
    }

    const revealedCells: Cell[] = [];
    const queue: Coordinates[] = [{ x, y }];
    const visited: Set<string> = new Set();
    visited.add(`${x},${y}`);

    while (queue.length > 0 && revealedCells.length < 1000) {
        console.log(`Queue length: ${queue.length}`); // Debugging line
        const currentCoords = queue.shift()!;
        const currentCell = await getCell(gameState, currentCoords.x, currentCoords.y);
        const currentCellState = getCellState(currentCell);

        // Check if cell is valid for processing *before* revealing
        if (!currentCell || currentCellState !== CellState.HIDDEN || currentCell.isMine) {
            continue;
        }

        // Reveal the current cell
        const revealedCell: Cell = { ...currentCell, revealed: true, flagged: false };
        revealedCells.push(revealedCell);

        // *** Important Change: Only add neighbors to queue if current cell has 0 adjacent mines ***
        if (revealedCell.adjacentMines === 0) {
            // Continue flood fill to neighbors
            for (const dir of DIRECTIONS) {
                const nextX = currentCoords.x + dir.dx;
                const nextY = currentCoords.y + dir.dy;
                const coordKey = `${nextX},${nextY}`;

                if (!visited.has(coordKey)) {
                    // Check the neighbor cell state *before* adding to queue
                    const neighborCell = await getCell(gameState, nextX, nextY);
                    const neighborState = getCellState(neighborCell);
                    // Only queue hidden neighbors
                    if (neighborCell && neighborState === CellState.HIDDEN) {
                        visited.add(coordKey);
                        queue.push({ x: nextX, y: nextY });
                    }
                }
            }
        } // End of check for adjacentMines === 0
    }

    return revealedCells;
}

/**
 * Toggles the flag state of a cell.
 * This function is now asynchronous.
 * @param gameState The current game state.
 * @param x The x-coordinate.
 * @param y The y-coordinate.
 * @param getCell Function to retrieve cell state.
 * @returns A promise resolving to the updated cell or null if no change occurred.
 */
export async function toggleFlag(
    gameState: GameState,
    x: number,
    y: number,
    getCell: GetCellFunction
): Promise<Cell | null> {
    const cell = await getCell(gameState, x, y);
    const cellState = getCellState(cell);

    if (!cell || cellState === CellState.REVEALED || cellState === CellState.REVEALED_MINE) {
        return null; // Cannot flag revealed cells
    }

    const newFlaggedState = !cell.flagged;
    const updatedCell: Cell = { ...cell, flagged: newFlaggedState };

    // Note: We return the updated cell state, but the actual update
    // needs to happen in the GameState via the service layer (e.g., saving to SpatialHashGrid).
    return updatedCell;
}

/**
 * Performs a chord click (revealing neighbors of a revealed number cell).
 * This function is now asynchronous.
 * @param gameState The current game state.
 * @param x The x-coordinate of the revealed number cell.
 * @param y The y-coordinate of the revealed number cell.
 * @param getCell Function to retrieve cell state.
 * @returns A promise resolving to an array of newly revealed cells or a MineHitResult object if a mine was hit.
 */
export async function chordClick(
    gameState: GameState,
    x: number,
    y: number,
    getCell: GetCellFunction
): Promise<Cell[] | MineHitResult> { // Updated return type
    const centerCell = await getCell(gameState, x, y);
    const centerState = getCellState(centerCell);

    // Can only chord on a revealed cell with adjacent mines
    if (!centerCell || centerState !== CellState.REVEALED || centerCell.adjacentMines === 0) {
        return [];
    }

    const adjacentCells = await getAdjacentCells(gameState, x, y, getCell);
    const adjacentFlags = adjacentCells.filter(cell => getCellState(cell) === CellState.FLAGGED).length;

    // If the number of adjacent flags matches the cell's number, reveal hidden neighbors
    if (adjacentFlags === centerCell.adjacentMines) {
        let combinedResult: Cell[] = [];
        for (const adjCell of adjacentCells) {
            const adjState = getCellState(adjCell);
            if (adjState === CellState.HIDDEN) {
                // Recursively call revealCell for each hidden neighbor
                const revealResult = await revealCell(gameState, adjCell.x, adjCell.y, getCell);
                if ('hitMine' in revealResult) {
                    // If revealCell hits a mine during chording, return immediately
                    return revealResult;
                }
                // Type assertion needed because TS knows revealResult could be MineHitResult here
                combinedResult = combinedResult.concat(revealResult as Cell[]);
            }
        }
        return combinedResult;
    }

    return []; // Number of flags doesn't match, do nothing
}