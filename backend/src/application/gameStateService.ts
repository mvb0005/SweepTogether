/**
 * @fileoverview Service responsible for managing the in-memory state of active games.
 * It holds the collection of active GameState objects, provides methods for accessing
 * and modifying game state (e.g., getting a game by ID, updating player data, modifying board state),
 * and interacts with the persistence layer (GameRepository) to load and save game state
 * and potentially board chunks for infinite worlds.
 */

import { GameState, Cell, Coordinates, PointData, GameConfig, PlayerStatus } from '../domain/types';
import { SpatialHashGrid } from '../domain/spatialHashGrid';
// Import the WorldGenerator class instead of the old functions
import { WorldGenerator } from '../domain/worldGenerator';
import { GetCellFunction } from '../domain/game';

// Define a reasonable cell size for the spatial hash grid chunks
const SPATIAL_GRID_CELL_SIZE = 16;

export class GameStateService {
    private games: Map<string, GameState> = new Map();
    // Use a Map to store WorldGenerator instances per gameId (seed)
    private worldGenerators: Map<string, WorldGenerator> = new Map();

    /**
     * Get the game state for a given gameId.
     */
    getGame(gameId: string): GameState | undefined {
        return this.games.get(gameId);
    }

    /**
     * Set or update the game state for a given gameId.
     * Initializes SpatialGrid for new infinite games.
     * Note: WorldGenerator is now created on demand via getWorldGenerator.
     */
    setGame(gameId: string, state: GameState): void {
        // Initialize grid if it's a new infinite game and grid doesn't exist
        if (!state.spatialGrid) {
            console.log(`Initializing spatial grid for infinite game: ${gameId}`);
            state.spatialGrid = new SpatialHashGrid<PointData>(SPATIAL_GRID_CELL_SIZE);
        }

        // Ensure boardConfig exists and mark as infinite (temporary assumption)
        if (!state.boardConfig) {
            state = {
                ...state,
                boardConfig: {
                    isInfiniteWorld: true,
                    rows: 0,
                    cols: 0,
                    mines: 0,
                },
            }
        }
        state.boardConfig.isInfiniteWorld = true; // Assuming all games are infinite for now

        // No need to explicitly initialize generator here anymore
        this.games.set(gameId, state);
    }

    /**
     * Remove a game from memory and clear associated generator instance.
     */
    removeGame(gameId: string): void {
        this.games.delete(gameId);
        // Remove the corresponding world generator instance
        this.worldGenerators.delete(gameId);
        console.log(`Removed game ${gameId} and its world generator instance.`);
    }

    /**
     * Get all active game IDs.
     */
    getAllGameIds(): string[] {
        return Array.from(this.games.keys());
    }

    /**
     * Gets the WorldGenerator instance for the given gameId (seed).
     * Creates a new instance if one doesn't exist for the seed.
     * This ensures each game uses its own isolated generator state.
     * @param gameId The game ID, used as the seed for the generator.
     * @returns The WorldGenerator instance for the game.
     */
    private getWorldGenerator(gameId: string): WorldGenerator {
        if (!this.worldGenerators.has(gameId)) {
            console.log(`Creating new WorldGenerator instance for game: ${gameId}`);
            const newGenerator = new WorldGenerator(gameId);
            this.worldGenerators.set(gameId, newGenerator);
        }
        return this.worldGenerators.get(gameId)!;
    }

    /**
     * Implementation of the GetCellFunction type.
     * Retrieves the full state of a cell by combining generated properties
     * (using the game-specific WorldGenerator) with stored state
     * from the SpatialHashGrid.
     */
    getCell: GetCellFunction = async (gameState: GameState, x: number, y: number): Promise<Cell | null> => {
        if (!gameState.boardConfig.isInfiniteWorld || !gameState.spatialGrid) {
            console.error(`Attempted to get cell for non-infinite game or missing grid: ${gameState.gameId}`);
            return null;
        }

        // Get the correct generator instance for this game
        const generator = this.getWorldGenerator(gameState.gameId);

        // 1. Get inherent properties from the game-specific world generator instance
        const cellValue = generator.getCellValue(x, y); // Use instance method
        const mine = cellValue === 'M';
        const adjacentMines = mine ? 0 : cellValue;

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
