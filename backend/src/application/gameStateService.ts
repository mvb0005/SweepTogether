/**
 * @fileoverview Service responsible for managing the in-memory state of active games.
 * It holds the collection of active GameState objects, provides methods for accessing
 * and modifying game state (e.g., getting a game by ID, updating player data, modifying board state),
 * and interacts with the persistence layer (GameRepository) to load and save game state
 * and potentially board chunks for infinite worlds.
 */

import { GameState, Cell, Coordinates, PointData, GameConfig, PlayerStatus } from '../domain/types';
import { SpatialHashGrid } from '../domain/spatialHashGrid';
import { initializeWorldGenerator, isMine, getCellValue } from '../domain/worldGenerator';
import { GetCellFunction } from '../domain/game';

// Define a reasonable cell size for the spatial hash grid chunks
const SPATIAL_GRID_CELL_SIZE = 16;

export class GameStateService {
    private games: Map<string, GameState> = new Map();
    // Cache world generators initialized per game seed
    private worldGeneratorsInitialized: Set<string> = new Set();

    /**
     * Get the game state for a given gameId.
     */
    getGame(gameId: string): GameState | undefined {
        return this.games.get(gameId);
    }

    /**
     * Set or update the game state for a given gameId.
     * Initializes SpatialGrid and WorldGenerator for new infinite games.
     */
    setGame(gameId: string, state: GameState): void {
        // Initialize grid/generator if it's a new infinite game
        console.log(`Initializing spatial grid for infinite game: ${gameId}`);
        state.spatialGrid = new SpatialHashGrid<PointData>(SPATIAL_GRID_CELL_SIZE);
        // Ensure world generator is seeded for this game

        if (!state?.boardConfig) {
            state = {
                ...state,
                boardConfig: {
                    isInfiniteWorld: true,
                    rows: 0,
                    cols: 0,
                    mines: 0,
                    // Add other default board config properties if needed
                },
            }
        }
        state.boardConfig.isInfiniteWorld = true; // Assuming all games are infinite for now
        this.ensureWorldGeneratorInitialized(gameId);
        this.games.set(gameId, state);
    }

    /**
     * Remove a game from memory and clear associated caches/state.
     */
    removeGame(gameId: string): void {
        this.games.delete(gameId);
        this.worldGeneratorsInitialized.delete(gameId);
        // Potentially add cleanup for worldGenerator caches if they become game-specific
        // Currently, initializeWorldGenerator clears the shared cache, which might
        // not be ideal if multiple games run concurrently in one process.
        // Consider refactoring worldGenerator to encapsulate state per seed.
    }

    /**
     * Get all active game IDs.
     */
    getAllGameIds(): string[] {
        return Array.from(this.games.keys());
    }

    /**
     * Ensures the world generator is initialized for the given game seed.
     * This is crucial before calling isMine or getCellValue.
     */
    private ensureWorldGeneratorInitialized(gameId: string): void {
        // WARNING: Current worldGenerator uses a shared global state (rng, noise2D, caches).
        // Calling initializeWorldGenerator resets this state. This is NOT suitable
        // for multiple concurrent games in the same process. It needs refactoring
        // to encapsulate state per gameId/seed if concurrency is required.
        // For now, we assume one game or sequential games, or accept cache clearing.
        if (!this.worldGeneratorsInitialized.has(gameId)) {
            console.warn(`Initializing world generator for game ${gameId}. Concurrent games might interfere.`);
            initializeWorldGenerator(gameId);
            this.worldGeneratorsInitialized.add(gameId);
        }
    }

    /**
     * Implementation of the GetCellFunction type.
     * Retrieves the full state of a cell by combining generated properties
     * with stored state (revealed/flagged) from the SpatialHashGrid.
     * Handles initialization of the world generator.
     */
    getCell: GetCellFunction = async (gameState: GameState, x: number, y: number): Promise<Cell | null> => {
        if (!gameState.boardConfig.isInfiniteWorld || !gameState.spatialGrid) {
            // Handle fixed boards or error if grid is missing for infinite game
            console.error(`Attempted to get cell for non-infinite game or missing grid: ${gameState.gameId}`);
            // TODO: Implement logic for fixed boards if needed
            return null;
        }

        // Ensure the generator is ready for this specific game
        // Note: See warning in ensureWorldGeneratorInitialized about concurrency
        this.ensureWorldGeneratorInitialized(gameState.gameId);

        // 1. Get inherent properties from world generator
        const cellValue = getCellValue(x, y);
        const mine = cellValue === 'M';
        const adjacentMines = mine ? 0 : cellValue; // Adjacent mines count is 0 if it's a mine itself

        // 2. Get revealed/flagged state from spatial grid
        const pointData = gameState.spatialGrid.get(x, y);
        const revealed = pointData?.revealed ?? false;
        const flagged = pointData?.flagged ?? false;

        // 3. Construct the full Cell object
        const cell: Cell = {
            x,
            y,
            isMine: mine,
            adjacentMines: adjacentMines,
            revealed: revealed,
            flagged: flagged,
        };

        return cell;
    }

    /**
     * Updates the state (revealed/flagged) of multiple cells in the spatial grid.
     * @param gameId The ID of the game.
     * @param cellsToUpdate An array of Cell objects with their new state.
     */
    updateGridCells(gameId: string, cellsToUpdate: Cell[]): void {
        const gameState = this.getGame(gameId);
        if (!gameState || !gameState.spatialGrid) {
            console.error(`Cannot update grid cells: Game ${gameId} not found or has no spatial grid.`);
            return;
        }

        for (const cell of cellsToUpdate) {
            const existingData = gameState.spatialGrid.get(cell.x, cell.y) ?? {};
            const newData: PointData = {
                ...existingData,
                revealed: cell.revealed,
                flagged: cell.flagged,
            };
            // Update only if there's meaningful state to store
            if (newData.revealed || newData.flagged) {
                gameState.spatialGrid.set(cell.x, cell.y, newData);
            } else {
                // Remove from grid if it's back to default hidden state
                gameState.spatialGrid.delete(cell.x, cell.y);
            }
        }
        // TODO: Persist chunk changes if necessary
    }

    /**
    * Updates the state (revealed/flagged) of a single cell in the spatial grid.
    * @param gameId The ID of the game.
    * @param cellToUpdate A Cell object with its new state.
    */
    updateGridCell(gameId: string, cellToUpdate: Cell): void {
        this.updateGridCells(gameId, [cellToUpdate]);
    }

    /**
     * Create a new game with the given config and ID.
     */
    createGame(gameId: string, config: GameConfig): void {
        if (this.games.has(gameId)) {
            throw new Error(`Game with ID ${gameId} already exists.`);
        }
        const newGame: GameState = {
            gameId,
            boardConfig: config,
            players: {},
            gameOver: false,
            mineReveals: [],
            pendingReveals: [],
            scoringConfig: {
                firstPlacePoints: 0,
                secondPlacePoints: 0,
                thirdPlacePoints: 0,
                numberRevealPoints: 0,
                mineHitPenalty: 0,
                lockoutDurationMs: 0,
                mineRevealDelayMs: 0,
                flagPlacePoints: 0,
                flagRemovePoints: 0
            },
            spatialGrid: new SpatialHashGrid<PointData>(SPATIAL_GRID_CELL_SIZE),
        };
        this.setGame(gameId, newGame);
    }

    /**
     * Add a player to a game.
     */
    addPlayer(gameId: string, playerId: string, username: string): void {
        const game = this.getGame(gameId);
        if (!game) throw new Error(`Game ${gameId} not found.`);
        if (game.players[playerId]) return; // Already added
        game.players[playerId] = {
            id: playerId,
            username,
            score: 0,
            status: PlayerStatus.ACTIVE, // Default status
            // Add more player fields as needed
        };
        this.setGame(gameId, game);
    }

    /**
     * Check if a game exists.
     */
    gameExists(gameId: string): boolean {
        return this.games.has(gameId);
    }

    /**
     * Set a player's status (active/inactive).
     */
    setPlayerStatus(gameId: string, playerId: string, status: PlayerStatus): void {
        const game = this.getGame(gameId);
        if (!game) throw new Error(`Game ${gameId} not found.`);
        if (!game.players[playerId]) throw new Error(`Player ${playerId} not found in game ${gameId}.`);
        game.players[playerId].status = status;
        this.setGame(gameId, game);
    }
}
