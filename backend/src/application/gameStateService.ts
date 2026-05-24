/**
 * @fileoverview Service responsible for managing the in-memory state of active games.
 * It holds the collection of active GameState objects, provides methods for accessing
 * and modifying game state (e.g., getting a game by ID, updating player data, modifying board state),
 * and interacts with the persistence layer (GameRepository) to load and save game state
 * and potentially board chunks for infinite worlds.
 */

import { GameState, Cell, Coordinates, PointData, GameConfig, PlayerStatus } from '../domain/types';
import { SpatialHashGrid } from '../domain/spatialHashGrid';
import { WorldGenerator } from '../domain/worldGenerator';
import { ChunkManager } from '../domain/ChunkManager';
import { IChunkManager, CHUNK_SIZE, ChunkPersistenceLoader } from '../types/chunkTypes';
import { GetCellFunction } from '../domain/game';
import { Server as SocketIOServer } from 'socket.io';
import { IChunk } from '../types/chunkTypes';
import { getGameRepository, getChunkRepository, getPendingFillsRepository } from '../infrastructure/persistence/db';
import { ChunkRepository } from '../infrastructure/persistence/chunkRepository';

// Define a reasonable cell size for the spatial hash grid chunks
const SPATIAL_GRID_CELL_SIZE = 16;

/**
 * Serializes a chunk to a compact wire format. Instead of sending all 1024 tile
 * objects, we send only sparse arrays for non-default state. Unrevealed, unflagged
 * cells are omitted — the client reconstructs them as the default state.
 */
export function serializeChunk(chunk: IChunk, gameId: string) {
    const [chunkX, chunkY] = chunk.id.split('_').map(Number);
    const size = chunk.size;
    const revealed: number[] = [];
    const adjMines: number[] = [];
    const revealedMines: number[] = [];
    const flagged: number[] = [];
    for (let ly = 0; ly < size; ly++) {
        for (let lx = 0; lx < size; lx++) {
            const cell = chunk.tiles[ly][lx];
            const idx = ly * size + lx;
            if (cell.revealed) {
                if (cell.isMine) {
                    revealedMines.push(idx);
                } else {
                    revealed.push(idx);
                    adjMines.push(cell.adjacentMines);
                }
            } else if (cell.flagged) {
                flagged.push(idx);
            }
        }
    }
    return { gameId, chunkX, chunkY, size, revealed, adjMines, revealedMines, flagged };
}

export class GameStateService {
    private games: Map<string, GameState> = new Map();
    // Use a Map to store WorldGenerator instances per gameId (seed)
    private worldGenerators: Map<string, WorldGenerator> = new Map();
    private chunkManagers: Map<string, IChunkManager> = new Map(); // Renamed for ChunkManager instances
    private io?: SocketIOServer;

    // Per-game flood fill queue: points that arrived while a fill was running
    // are merged and dispatched as one BFS after the current run finishes.
    private fillQueues  = new Map<string, { x: number; y: number }[]>();
    private fillRunning = new Set<string>();

    constructor(io?: SocketIOServer) {
        console.log('[GameStateService] Constructor called');
        this.io = io;
    }

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
        this.chunkManagers.delete(gameId); // Remove ChunkManager instance
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
    private getWorldGenerator(gameId: string, seed?: string): WorldGenerator {
        if (!this.worldGenerators.has(gameId)) {
            const s = seed ?? gameId;
            console.log(`Creating new WorldGenerator instance for game: ${gameId}, seed: ${s}`);
            this.worldGenerators.set(gameId, new WorldGenerator(s));
        }
        return this.worldGenerators.get(gameId)!;
    }

    /**
     * Gets the ChunkManager instance for the given gameId.
     * Throws if one doesn't exist for the game.
     * @param gameId The game ID.
     * @returns The IChunkManager instance for the game.
     */
    public getChunkManager(gameId: string): IChunkManager {
        const manager = this.chunkManagers.get(gameId);
        if (!manager) {
            throw new Error(`ChunkManager not found for game ${gameId}`);
        }
        return manager;
    }

    /**
     * Implementation of the GetCellFunction type.
     * Retrieves the full state of a cell by combining generated properties
     * (using the game-specific WorldGenerator) with stored state
     * from the SpatialHashGrid.
     */
    getCell: GetCellFunction = async (gameState: GameState, x: number, y: number): Promise<Cell | null> => {
        // Prefer ChunkManager as the authoritative source — it has correct isMine/adjacentMines
        // (including pregen chunks) and persisted revealed/flagged state loaded from MongoDB.
        const chunkManager = this.chunkManagers.get(gameState.gameId);
        if (chunkManager) {
            const { chunkCoordinate, localCoordinate } = chunkManager.convertGlobalToChunkLocalCoordinates(x, y);
            const chunkId = chunkManager.getChunkId(chunkCoordinate.x, chunkCoordinate.y);
            const chunk = chunkManager.getChunkById(chunkId);
            if (chunk) {
                const tile = chunk.getTile(localCoordinate.x, localCoordinate.y);
                if (tile) return { ...tile };
            }
        }

        // Fallback: chunk not loaded in memory — derive from WorldGenerator + spatialGrid.
        if (!gameState.boardConfig.isInfiniteWorld || !gameState.spatialGrid) {
            return null;
        }
        const generator = this.getWorldGenerator(gameState.gameId);
        const cellValue = generator.getCellValue(x, y);
        const mine = cellValue === 'M';
        const adjacentMines = mine ? 0 : cellValue as number;
        const pointData = gameState.spatialGrid.get(x, y);
        return {
            x,
            y,
            isMine: mine,
            adjacentMines,
            revealed: pointData?.revealed ?? false,
            flagged: pointData?.flagged ?? false,
        };
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
     * Create a new game (or resume from MongoDB) with the given config and ID.
     * Loads the persisted seed so WorldGenerator is deterministic across restarts.
     * Also restores pendingFills from MongoDB.
     */
    async createGame(gameId: string, config: GameConfig): Promise<void> {
        if (this.games.has(gameId)) {
            return;
        }

        // Load or generate a persistent seed for this game
        const seedStr = await getGameRepository().createOrLoad(gameId, config);
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

        // --- ChunkManager setup with socket logic ---
        const worldGen = this.getWorldGenerator(gameId, seedStr);
        const cellGenerator = (globalX: number, globalY: number): Cell => {
            const cellValue = worldGen.getCellValue(globalX, globalY);
            const isMine = cellValue === 'M';
            return {
                x: globalX,
                y: globalY,
                isMine: isMine,
                adjacentMines: isMine ? 0 : cellValue as number,
                revealed: false,
                flagged: false,
            };
        };
        const hasActiveSubscribers = (gameId: string, chunkX: number, chunkY: number) => {
            if (!this.io) return false;
            const chunkRoom = `${gameId}_chunk_${chunkX}_${chunkY}`;
            const room = this.io.sockets.adapter.rooms.get(chunkRoom);
            const size = room ? room.size : 0;
            console.log(`[hasActiveSubscribers] gameId=${gameId}, chunk=(${chunkX},${chunkY}), chunkRoom=${chunkRoom}, size=${size}`);
            return !!room && room.size > 0;
        };
        const processAndBroadcastAllLoadedChunksUntilClean = async (chunkManager: ChunkManager) => {
            let dirtyFound: boolean;
            do {
                dirtyFound = false;
                for (const [chunkId, chunk] of chunkManager.chunks.entries()) {
                    const [chunkX, chunkY] = chunkId.split('_').map(Number);
                    if ((chunkManager.pendingFills.get(chunkId)?.length ?? 0) > 0 && chunkManager.hasActiveSubscribers(chunkManager.gameId, chunkX, chunkY)) {
                        await chunkManager.processAndBroadcastChunk(chunkManager.gameId, chunkX, chunkY);
                        dirtyFound = true;
                    }
                }
            } while (dirtyFound);
        };
        const processAndBroadcastChunk = async (gameId: string, chunkX: number, chunkY: number) => {
            if (!this.io) return;
            const chunkManager = this.getChunkManager(gameId) as unknown as ChunkManager;
            const chunk = await chunkManager.getChunk(chunkX, chunkY);
            const chunkId = chunkManager.getChunkId(chunkX, chunkY);
            while ((chunkManager.pendingFills.get(chunkId)?.length ?? 0) > 0) {
                await chunkManager.processPendingFillsForChunk(chunkId, new Set<string>());
                const chunkRoom = `${gameId}_chunk_${chunkX}_${chunkY}`;
                this.io.to(chunkRoom).emit('chunkData', serializeChunk(chunk, gameId));
            }
            await processAndBroadcastAllLoadedChunksUntilClean(chunkManager);
        };
        const broadcastChunkUpdate = (chunk: IChunk) => {
            if (!this.io) return;
            const [chunkX, chunkY] = chunk.id.split('_').map(Number);
            const chunkRoom = `${gameId}_chunk_${chunkX}_${chunkY}`;
            this.io.to(chunkRoom).emit('chunkData', serializeChunk(chunk, gameId));
        };
        const persistenceLoader: ChunkPersistenceLoader = async (chunkX, chunkY) => {
            const doc = await getChunkRepository().load(gameId, chunkX, chunkY);
            if (!doc) return null;
            return {
                mines: ChunkRepository.decodeMines(doc),
                ...ChunkRepository.decode(doc),
            };
        };
        const chunkManager = new ChunkManager(gameId, CHUNK_SIZE, cellGenerator, hasActiveSubscribers, processAndBroadcastChunk, broadcastChunkUpdate, persistenceLoader);
        this.chunkManagers.set(gameId, chunkManager);

        // Restore persisted pendingFills so cross-chunk flood fills survive restarts
        try {
            const saved = await getPendingFillsRepository().loadAll(gameId);
            for (const [chunkId, entries] of saved) {
                chunkManager.pendingFills.set(chunkId, entries);
            }
            if (saved.size > 0) {
                console.log(`[createGame] Restored ${saved.size} pending fill entries for game ${gameId}`);
            }
        } catch (err) {
            console.error('[createGame] Failed to restore pendingFills:', err);
        }
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

    /**
     * Streams chunks to the caller one at a time as they are built, yielding the
     * event loop between each uncached chunk so other requests can be serviced.
     * Already-cached chunks are delivered synchronously before the DB round-trip.
     * One DB query is used for all uncached chunks regardless of count.
     */
    async streamChunks(
        gameId: string,
        coords: { chunkX: number; chunkY: number }[],
        onChunk: (chunk: IChunk) => void,
    ): Promise<void> {
        const chunkManager = this.getChunkManager(gameId);

        // Deliver already-cached chunks immediately — zero build cost.
        const uncached: { chunkX: number; chunkY: number }[] = [];
        for (const { chunkX, chunkY } of coords) {
            const cached = chunkManager.getChunkById(chunkManager.getChunkId(chunkX, chunkY));
            if (cached) {
                onChunk(cached);
            } else {
                uncached.push({ chunkX, chunkY });
            }
        }
        if (uncached.length === 0) return;

        // One DB round-trip for all uncached chunks.
        const t0 = performance.now();
        const docsMap = await getChunkRepository().loadMany(gameId, uncached);
        const dbMs = (performance.now() - t0).toFixed(1);

        // Build and deliver one chunk at a time, yielding between each so the
        // event loop remains responsive to other clients during a large pan.
        let built = 0;
        for (const { chunkX, chunkY } of uncached) {
            const doc = docsMap.get(`${gameId}_${chunkX}_${chunkY}`);
            const mines = doc ? ChunkRepository.decodeMines(doc) : undefined;
            const { revealedIndices, flaggedIndices } = doc
                ? ChunkRepository.decode(doc)
                : { revealedIndices: new Set<number>(), flaggedIndices: new Set<number>() };
            await chunkManager.preloadMany([{ chunkX, chunkY, mines, revealedIndices, flaggedIndices }]);
            onChunk(chunkManager.getChunkById(chunkManager.getChunkId(chunkX, chunkY))!);
            built++;
            await new Promise<void>(resolve => setImmediate(resolve));
        }
        console.log(`[streamChunks] cached=${coords.length - uncached.length} built=${built} db=${dbMs}ms`);
    }

    /**
     * Enqueues flood fill points for a game. If no fill is currently running,
     * one is started immediately. If one is already running, the points are
     * merged into the queue and dispatched as a single BFS when the current
     * run finishes — preventing concurrent fills from revisiting the same
     * large open region multiple times.
     */
    enqueueFill(gameId: string, points: { x: number; y: number }[], playerId?: string): void {
        if (points.length === 0) return;

        if (!this.fillQueues.has(gameId)) this.fillQueues.set(gameId, []);
        this.fillQueues.get(gameId)!.push(...points);

        if (this.fillRunning.has(gameId)) return; // will be picked up after current run
        this.fillRunning.add(gameId);

        setImmediate(() => this.drainFillQueue(gameId, playerId));
    }

    private async drainFillQueue(gameId: string, playerId?: string): Promise<void> {
        const queue = this.fillQueues.get(gameId);
        if (!queue || queue.length === 0) {
            this.fillRunning.delete(gameId);
            return;
        }

        // Drain all queued points into one merged BFS run.
        const points = queue.splice(0);
        const t0 = performance.now();
        try {
            await this.runBulkFloodFill(gameId, points, playerId);
            console.log(`[fills] ${points.length} points done in ${(performance.now() - t0).toFixed(1)}ms`);
        } catch (err) {
            console.error('[fills] error:', err);
        }

        // If more points arrived while we were running, dispatch another pass.
        const remaining = this.fillQueues.get(gameId);
        if (remaining && remaining.length > 0) {
            setImmediate(() => this.drainFillQueue(gameId, playerId));
        } else {
            this.fillRunning.delete(gameId);
        }
    }

    /**
     * Runs a single BFS flood fill seeded from multiple start points, applying all
     * results and broadcasting each affected chunk exactly once at the end.
     * This is more efficient than calling runGlobalFloodFill per point because
     * overlapping regions are merged into one pass and broadcasts are batched.
     */
    async runBulkFloodFill(
        gameId: string,
        startPoints: { x: number; y: number }[],
        playerId?: string,
    ): Promise<{ revealedCells: Cell[], pendingFills: Set<string> }> {
        const gameState = this.getGame(gameId);
        if (!gameState) throw new Error(`Game not found: ${gameId}`);
        const chunkManager = this.getChunkManager(gameId);
        const revealedCells: Cell[] = [];
        const visited = new Set<string>();
        const pendingFills = new Set<string>();
        const updatedChunkIds = new Set<string>();

        // Seed queue with all start points, deduplicating upfront
        const queue: { x: number; y: number }[] = [];
        for (const { x, y } of startPoints) {
            const key = `${x},${y}`;
            if (!visited.has(key)) { visited.add(key); queue.push({ x, y }); }
        }

        let steps = 0;
        while (queue.length > 0) {
            // Yield every 500 steps so the event loop can handle other requests
            // during large flood fills (e.g. the SweepTogether open region).
            if (++steps % 500 === 0) await new Promise<void>(r => setImmediate(r));

            const { x, y } = queue.shift()!;
            const { chunkCoordinate: cc, localCoordinate: lc } = chunkManager.convertGlobalToChunkLocalCoordinates(x, y);
            const cellChunk = chunkManager.getChunkById(chunkManager.getChunkId(cc.x, cc.y));
            const cell = cellChunk?.getTile(lc.x, lc.y) ?? null;
            if (!cell || cell.revealed || cell.flagged || cell.isMine) continue;

            const revealedCell: Cell = { ...cell, revealed: true, flagged: false };
            revealedCells.push(revealedCell);
            // Update tile in place so later BFS steps read the correct state
            cellChunk!.setTile(lc.x, lc.y, revealedCell);
            updatedChunkIds.add(chunkManager.getChunkId(cc.x, cc.y));

            if (revealedCell.adjacentMines === 0) {
                for (let dx = -1; dx <= 1; dx++) {
                    for (let dy = -1; dy <= 1; dy++) {
                        if (dx === 0 && dy === 0) continue;
                        const nx = x + dx, ny = y + dy;
                        const key = `${nx},${ny}`;
                        if (!visited.has(key)) {
                            visited.add(key);
                            const { chunkCoordinate } = chunkManager.convertGlobalToChunkLocalCoordinates(nx, ny);
                            const chunkId = chunkManager.getChunkId(chunkCoordinate.x, chunkCoordinate.y);
                            if (chunkManager.chunks.has(chunkId)) {
                                queue.push({ x: nx, y: ny });
                            } else {
                                pendingFills.add(chunkId);
                                const { localCoordinate } = chunkManager.convertGlobalToChunkLocalCoordinates(nx, ny);
                                if (!chunkManager.pendingFills.has(chunkId)) chunkManager.pendingFills.set(chunkId, []);
                                chunkManager.pendingFills.get(chunkId)!.push({ localX: localCoordinate.x, localY: localCoordinate.y });
                            }
                        }
                    }
                }
            }
        }

        // Sync spatialGrid
        this.updateGridCells(gameId, revealedCells);

        // Persist revealed cells grouped by chunk
        if (playerId && revealedCells.length > 0) {
            try {
                const chunkRepo = getChunkRepository();
                const byChunk = new Map<string, { chunkX: number; chunkY: number; cells: { localX: number; localY: number }[] }>();
                for (const cell of revealedCells) {
                    const { chunkCoordinate, localCoordinate } = chunkManager.convertGlobalToChunkLocalCoordinates(cell.x, cell.y);
                    const key = `${chunkCoordinate.x}_${chunkCoordinate.y}`;
                    if (!byChunk.has(key)) byChunk.set(key, { chunkX: chunkCoordinate.x, chunkY: chunkCoordinate.y, cells: [] });
                    byChunk.get(key)!.cells.push({ localX: localCoordinate.x, localY: localCoordinate.y });
                }
                for (const { chunkX, chunkY, cells } of byChunk.values()) {
                    await chunkRepo.ensure(gameId, chunkX, chunkY);
                    const playerIndex = await chunkRepo.getOrAddPlayerIndex(gameId, chunkX, chunkY, playerId);
                    await chunkRepo.revealCells(gameId, chunkX, chunkY, cells, playerIndex);
                }
            } catch (err) {
                console.error('[runBulkFloodFill] Failed to persist revealed cells:', err);
            }
        }

        // Persist new pendingFills
        if (pendingFills.size > 0) {
            try {
                const fillsRepo = getPendingFillsRepository();
                for (const chunkId of pendingFills) {
                    const entries = chunkManager.pendingFills.get(chunkId) ?? [];
                    await fillsRepo.save(gameId, chunkId, entries);
                }
            } catch (err) {
                console.error('[runBulkFloodFill] Failed to persist pendingFills:', err);
            }
        }

        // Broadcast each affected chunk exactly once
        for (const chunkId of updatedChunkIds) {
            const chunk = chunkManager.getChunkById(chunkId);
            if (chunk && chunkManager.broadcastChunkUpdate) {
                chunkManager.broadcastChunkUpdate(chunk);
            }
        }

        return { revealedCells, pendingFills };
    }

    /**
     * Single-origin flood fill — thin wrapper over runBulkFloodFill.
     */
    async runGlobalFloodFill(gameId: string, startX: number, startY: number, playerId?: string): Promise<{ revealedCells: Cell[], pendingFills: Set<string> }> {
        return this.runBulkFloodFill(gameId, [{ x: startX, y: startY }], playerId);
    }
}
