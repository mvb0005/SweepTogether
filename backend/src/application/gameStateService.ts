/**
 * @fileoverview Service responsible for managing the in-memory state of active games.
 * It holds the collection of active GameState objects, provides methods for accessing
 * and modifying game state (e.g., getting a game by ID, updating player data, modifying board state),
 * and interacts with the persistence layer (GameRepository) to load and save game state
 * and potentially board chunks for infinite worlds.
 */

import path from 'path';
import { GameState, Cell, Coordinates, PointData, GameConfig, PlayerStatus } from '../domain/types';
import {
  DEFAULT_SPAWN_X,
  DEFAULT_SPAWN_Y,
  canMoveNow,
  playerColorFromId,
  validateMoveInput,
} from '../domain/playerMovement';
import { SpatialHashGrid } from '../domain/spatialHashGrid';
import { WorldGenerator } from '../domain/worldGenerator';
import { ChunkManager } from '../domain/ChunkManager';
import { IChunkManager, CHUNK_SIZE, ChunkPersistenceLoader } from '../types/chunkTypes';
import { GetCellFunction } from '../domain/game';
import { Server as SocketIOServer } from 'socket.io';
import { IChunk } from '../types/chunkTypes';
import { getGameRepository, getChunkRepository, getPendingFillsRepository } from '../infrastructure/persistence/db';
import { ChunkRepository, chunkDocBuffer, ChunkDocument } from '../infrastructure/persistence/chunkRepository';
import {
  ChunkWireData,
  emptyChunkWire,
  invalidateChunkWireCache,
  serializeChunkWire,
  serializeChunkWireFromBuffers,
} from './chunkWire';
import { FillCoordinator, InMemoryFillCoordinator } from './fillCoordinator';
import {
  adjacentMinesAt,
  canRevealAt,
  cellIndex,
  getChunkBuffers,
  HIDDEN_CELL,
  isCellHidden,
  revealCellAt,
  revealIndices,
} from '../domain/chunkBuffers';

export { serializeChunk, serializeChunkWire } from './chunkWire';

// Load the Rust native chunk generator if available. Falls back gracefully to
// the JS WorldGenerator so development without a compiled addon still works.
type NativeGenerateFn = (chunkX: number, chunkY: number, chunkSize: number, seed: string) => Buffer;
type NativeBatchFn = (coords: number[][], chunkSize: number, seed: string) => Buffer[];
interface NativeFloodFillChunk {
    chunkX: number;
    chunkY: number;
    mines: Buffer;
    revealed: Buffer;
    flagged: Buffer;
}
interface NativeFloodFillResult {
    revealedCount: number;
    capped: boolean;
    reveals: Array<{ chunkX: number; chunkY: number; indices: number[] }>;
    pendingFills: Array<{ chunkX: number; chunkY: number; localX: number; localY: number }>;
    continuation: number[][];
}
type NativeFloodFillFn = (opts: {
    chunkSize: number;
    maxReveals: number;
    revealValue: number;
    hiddenRevealed: number;
    hiddenFlagged: number;
    seeds: number[][];
    subscribed: number[][];
    chunks: NativeFloodFillChunk[];
}) => NativeFloodFillResult;
type NativeFloodFillAsyncFn = (opts: {
    chunkSize: number;
    maxReveals: number;
    revealValue: number;
    hiddenRevealed: number;
    hiddenFlagged: number;
    seeds: number[][];
    subscribed: number[][];
    chunks: NativeFloodFillChunk[];
}) => Promise<NativeFloodFillResult>;
interface NativeAddon {
    generateChunk: NativeGenerateFn;
    generateChunksBatch: NativeBatchFn;
    floodFillNative?: NativeFloodFillFn;
    floodFillNativeAsync?: NativeFloodFillAsyncFn;
}
let nativeAddon: NativeAddon | null = null;
try {
    const nativePath = path.join(__dirname, '../../native/index.node');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    nativeAddon = require(nativePath) as NativeAddon;
    const fillParts: string[] = [];
    if (nativeAddon.floodFillNativeAsync) fillParts.push('async fill');
    else if (nativeAddon.floodFillNative) fillParts.push('fill');
    const fillLabel = fillParts.length > 0 ? ` + ${fillParts.join(', ')}` : '';
    console.log(`[GameStateService] Rust native addon loaded (chunk gen${fillLabel})`);
} catch {
    console.warn('[GameStateService] Rust native chunk generator not found — falling back to JS WorldGenerator');
}

// Define a reasonable cell size for the spatial hash grid chunks
const SPATIAL_GRID_CELL_SIZE = 16;

/** Max flood-fill seeds processed per async drain pass (avoids one 8s BFS). */
const MAX_FILL_SEEDS_PER_DRAIN = 256;
/** Max cells revealed per BFS run; remainder is re-queued for the next pass. */
const MAX_FILL_REVEALS_PER_RUN = 50_000;
/** Max seeds re-queued when a fill pass hits the reveal cap. */
const MAX_FILL_CONTINUATION_SEEDS = 256;
/** Max pending fill coordinates queued per game. */
const MAX_FILL_QUEUE_POINTS = 10_000;
const MAX_PENDING_FILL_CHUNKS = 256;
const MAX_PENDING_FILL_SEEDS_PER_CHUNK = 32;
const WORLD_PLAYER_ID = '__world__';
const BFS_YIELD_EVERY_STEPS = 2000;

// Visited-key for the JS BFS fallback. A string key avoids per-cell BigInt
// allocation/ops (slow) in the hot loop; the native addon is the fast path.
function packCoord(x: number, y: number): string {
    return x + ',' + y;
}

export class GameStateService {
    private games: Map<string, GameState> = new Map();
    // Use a Map to store WorldGenerator instances per gameId (seed)
    private worldGenerators: Map<string, WorldGenerator> = new Map();
    private gameSeeds: Map<string, string> = new Map();
    private chunkManagers: Map<string, IChunkManager> = new Map();
    private io?: SocketIOServer;
    private readonly fillCoordinator: FillCoordinator = new InMemoryFillCoordinator();
    /** Persisted chunk _ids per game — avoids MongoDB round-trips for pure noise chunks. */
    private persistedChunkIds = new Map<string, Set<string>>();
    /** Coalesce concurrent loads of the same chunk (avoids pool stampede). */
    private chunkLoadInflight = new Map<string, Promise<{
        mines?: Uint8Array;
        revealedBuf?: Buffer;
        flaggedBuf?: Buffer;
    } | null>>();

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
        this.gameSeeds.set(gameId, seedStr);
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
                this.io.to(chunkRoom).emit('chunkData', serializeChunkWire(chunk, gameId));
            }
            await processAndBroadcastAllLoadedChunksUntilClean(chunkManager);
        };
        const broadcastChunkUpdate = (chunk: IChunk) => {
            if (!this.io) return;
            const [chunkX, chunkY] = chunk.id.split('_').map(Number);
            const chunkRoom = `${gameId}_chunk_${chunkX}_${chunkY}`;
            invalidateChunkWireCache(chunk);
            this.io.to(chunkRoom).emit('chunkData', serializeChunkWire(chunk, gameId));
        };
        const persistenceLoader: ChunkPersistenceLoader = (chunkX, chunkY) =>
            this.loadChunkFromDb(gameId, chunkX, chunkY);
        const chunkMineGenerator = (chunkX: number, chunkY: number): Uint8Array =>
            worldGen.generateChunkLayout(chunkX, chunkY, CHUNK_SIZE);
        const chunkManager = new ChunkManager(gameId, CHUNK_SIZE, cellGenerator, hasActiveSubscribers, processAndBroadcastChunk, broadcastChunkUpdate, persistenceLoader, chunkMineGenerator);
        this.chunkManagers.set(gameId, chunkManager);

        try {
            const ids = await getChunkRepository().listIds(gameId);
            this.persistedChunkIds.set(gameId, ids);
            if (ids.size > 0) {
                console.log(`[createGame] Indexed ${ids.size} persisted chunks for game ${gameId}`);
            }
        } catch (err) {
            console.error('[createGame] Failed to index persisted chunks:', err);
            this.persistedChunkIds.set(gameId, new Set());
        }

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
    addPlayer(
        gameId: string,
        playerId: string,
        username: string,
        avatarUrl?: string,
        discordUserId?: string,
    ): void {
        const game = this.getGame(gameId);
        if (!game) throw new Error(`Game ${gameId} not found.`);
        if (game.players[playerId]) {
            const existing = game.players[playerId];
            existing.username = username;
            if (avatarUrl) existing.avatarUrl = avatarUrl;
            if (discordUserId) existing.discordUserId = discordUserId;
            return;
        }
        game.players[playerId] = {
            id: playerId,
            username,
            score: 0,
            status: PlayerStatus.ACTIVE,
            x: DEFAULT_SPAWN_X,
            y: DEFAULT_SPAWN_Y,
            color: playerColorFromId(playerId),
            avatarUrl,
            discordUserId,
        };
        this.setGame(gameId, game);
    }

    movePlayer(
        gameId: string,
        playerId: string,
        dx: number,
        dy: number,
    ): { x: number; y: number } | null {
        if (!validateMoveInput(dx, dy)) return null;
        const game = this.getGame(gameId);
        if (!game) return null;
        const player = game.players[playerId];
        if (!player) return null;

        const now = Date.now();
        if (!canMoveNow(player.lastMoveAt, now)) return null;

        player.x += dx;
        player.y += dy;
        player.lastMoveAt = now;
        this.setGame(gameId, game);
        return { x: player.x, y: player.y };
    }

    listPlayerPositions(gameId: string): Array<{
        playerId: string;
        username: string;
        x: number;
        y: number;
        color: string;
        avatarUrl?: string;
        discordUserId?: string;
    }> {
        const game = this.getGame(gameId);
        if (!game) return [];
        return Object.values(game.players).map(p => ({
            playerId: p.id,
            username: p.username,
            x: p.x,
            y: p.y,
            color: p.color,
            avatarUrl: p.avatarUrl,
            discordUserId: p.discordUserId,
        }));
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

    private ensureNoiseMines(
        generatedMap: Map<string, Uint8Array>,
        chunkX: number,
        chunkY: number,
        gameId: string,
        seed: string,
    ): Uint8Array {
        const key = `${chunkX}_${chunkY}`;
        const existing = generatedMap.get(key);
        if (existing) return existing;
        const mines = this.getWorldGenerator(gameId, seed).generateChunkLayout(chunkX, chunkY, CHUNK_SIZE);
        generatedMap.set(key, mines);
        return mines;
    }

    private resolveChunkMines(
        doc: ChunkDocument | undefined,
        chunkX: number,
        chunkY: number,
        generatedMap: Map<string, Uint8Array>,
        gameId: string,
        seed: string,
    ): Uint8Array | undefined {
        const custom = doc ? ChunkRepository.decodeMines(doc) : undefined;
        if (custom) return custom;
        return this.ensureNoiseMines(generatedMap, chunkX, chunkY, gameId, seed);
    }

    /**
     * Streams chunks to the caller one at a time as they are built, yielding the
     * event loop between each uncached chunk so other requests can be serviced.
     * Already-cached chunks are delivered synchronously before the DB round-trip.
     * Only chunks known to exist in MongoDB are queried; pure noise chunks are generated locally.
     */
    async streamChunks(
        gameId: string,
        coords: { chunkX: number; chunkY: number }[],
        onChunk: (wire: ChunkWireData) => void,
    ): Promise<void> {
        const chunkManager = this.getChunkManager(gameId) as ChunkManager;
        const persisted = this.persistedChunkIds.get(gameId) ?? new Set<string>();

        const uncached: { chunkX: number; chunkY: number }[] = [];
        let memoryHits = 0;
        for (const { chunkX, chunkY } of coords) {
            const cached = chunkManager.getChunkById(chunkManager.getChunkId(chunkX, chunkY));
            if (cached) {
                onChunk(serializeChunkWire(cached, gameId));
                memoryHits++;
            } else {
                uncached.push({ chunkX, chunkY });
            }
        }
        if (uncached.length === 0) return;

        const dbCoords = uncached.filter(c => persisted.has(`${gameId}_${c.chunkX}_${c.chunkY}`));

        const tDb = performance.now();
        const docsMap = dbCoords.length > 0
            ? await getChunkRepository().loadMany(gameId, dbCoords)
            : new Map<string, ChunkDocument>();
        const dbMs = (performance.now() - tDb).toFixed(1);

        const needGeneration: { chunkX: number; chunkY: number }[] = [];
        let noiseCacheHits = 0;
        for (const coord of uncached) {
            if (docsMap.has(`${gameId}_${coord.chunkX}_${coord.chunkY}`)) continue;
            if (chunkManager.hasDeferredChunk(coord.chunkX, coord.chunkY)) continue;
            if (chunkManager.hasNoiseMines(coord.chunkX, coord.chunkY)) {
                noiseCacheHits++;
                continue;
            }
            needGeneration.push(coord);
        }

        const seed = this.gameSeeds.get(gameId) ?? gameId;
        const tGen = performance.now();
        const generatedMap = new Map<string, Uint8Array>();
        if (needGeneration.length > 0) {
            const worldGen = this.getWorldGenerator(gameId, seed);
            for (const c of needGeneration) {
                generatedMap.set(
                    `${c.chunkX}_${c.chunkY}`,
                    worldGen.generateChunkLayout(c.chunkX, c.chunkY, CHUNK_SIZE),
                );
                await new Promise<void>(resolve => setImmediate(resolve));
            }
            chunkManager.registerNoiseChunks(
                needGeneration.map(c => ({
                    chunkX: c.chunkX,
                    chunkY: c.chunkY,
                    mines: generatedMap.get(`${c.chunkX}_${c.chunkY}`)!,
                })),
            );
        }
        const genMs = (performance.now() - tGen).toFixed(1);

        const preloadBatch: Array<{
            chunkX: number;
            chunkY: number;
            mines?: Uint8Array;
            revealedBuf?: Buffer;
            flaggedBuf?: Buffer;
        }> = [];

        for (const { chunkX, chunkY } of uncached) {
            const doc = docsMap.get(`${gameId}_${chunkX}_${chunkY}`);
            const mustBuild = chunkManager.hasPendingFills(chunkX, chunkY);

            if (mustBuild) {
                preloadBatch.push({
                    chunkX,
                    chunkY,
                    mines: this.resolveChunkMines(doc, chunkX, chunkY, generatedMap, gameId, seed),
                    revealedBuf: doc ? chunkDocBuffer(doc.revealed) : undefined,
                    flaggedBuf: doc ? chunkDocBuffer(doc.flagged) : undefined,
                });
                continue;
            }

            if (doc) {
                continue;
            }

            if (!generatedMap.has(`${chunkX}_${chunkY}`)) {
                preloadBatch.push({ chunkX, chunkY });
            }
        }

        const tBuild = performance.now();
        chunkManager.preloadMany(preloadBatch);
        const buildMs = (performance.now() - tBuild).toFixed(1);

        let built = 0;
        let deferred = 0;
        let noise = 0;
        for (const { chunkX, chunkY } of uncached) {
            const chunkId = chunkManager.getChunkId(chunkX, chunkY);
            const builtChunk = chunkManager.getChunkById(chunkId);
            if (builtChunk) {
                onChunk(serializeChunkWire(builtChunk, gameId));
                built++;
                continue;
            }

            const doc = docsMap.get(`${gameId}_${chunkX}_${chunkY}`);
            if (doc) {
                onChunk(serializeChunkWireFromBuffers(
                    gameId,
                    chunkX,
                    chunkY,
                    chunkDocBuffer(doc.revealed),
                    chunkDocBuffer(doc.flagged),
                    this.resolveChunkMines(doc, chunkX, chunkY, generatedMap, gameId, seed),
                ));
                deferred++;
            } else {
                onChunk(emptyChunkWire(gameId, chunkX, chunkY));
                noise++;
            }
        }

        console.log(
            `[streamChunks] cached=${memoryHits + noiseCacheHits} built=${built} deferred=${deferred} noise=${noise} ` +
            `noiseCache=${noiseCacheHits} db=${dbMs}ms queried=${dbCoords.length} build=${buildMs}ms gen=${genMs}ms`
        );
    }

    private markChunkPersisted(gameId: string, chunkX: number, chunkY: number): void {
        let ids = this.persistedChunkIds.get(gameId);
        if (!ids) {
            ids = new Set();
            this.persistedChunkIds.set(gameId, ids);
        }
        ids.add(`${gameId}_${chunkX}_${chunkY}`);
    }

    /** Load persisted chunk state; skips Mongo for known-noise chunks and coalesces concurrent loads. */
    private loadChunkFromDb(
        gameId: string,
        chunkX: number,
        chunkY: number,
    ): Promise<{ mines?: Uint8Array; revealedBuf?: Buffer; flaggedBuf?: Buffer } | null> {
        const docId = `${gameId}_${chunkX}_${chunkY}`;
        const persisted = this.persistedChunkIds.get(gameId);
        if (persisted && !persisted.has(docId)) {
            return Promise.resolve(null);
        }

        const inflight = this.chunkLoadInflight.get(docId);
        if (inflight) return inflight;

        const loadPromise = (async () => {
            const doc = await getChunkRepository().load(gameId, chunkX, chunkY);
            if (!doc) {
                persisted?.delete(docId);
                return null;
            }
            this.markChunkPersisted(gameId, chunkX, chunkY);
            return {
                mines: ChunkRepository.decodeMines(doc),
                revealedBuf: chunkDocBuffer(doc.revealed),
                flaggedBuf: chunkDocBuffer(doc.flagged),
            };
        })();

        this.chunkLoadInflight.set(docId, loadPromise);
        void loadPromise.finally(() => {
            if (this.chunkLoadInflight.get(docId) === loadPromise) {
                this.chunkLoadInflight.delete(docId);
            }
        });

        return loadPromise;
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

        this.fillCoordinator.pushSeeds(gameId, points, MAX_FILL_QUEUE_POINTS);
        if (!this.fillCoordinator.tryAcquire(gameId)) return;

        setImmediate(() => this.drainFillQueue(gameId, playerId));
    }

    evictUnsubscribedChunks(gameId: string): number {
        void this.evictUnsubscribedChunksAsync(gameId);
        return 0;
    }

    async evictUnsubscribedChunksAsync(gameId: string): Promise<number> {
        const cm = this.chunkManagers.get(gameId) as ChunkManager | undefined;
        if (!cm) return 0;

        const chunkRepo = getChunkRepository();
        let syncedCells = 0;
        let syncedChunks = 0;

        for (const chunkId of [...cm.chunks.keys()]) {
            const [chunkX, chunkY] = chunkId.split('_').map(Number);
            if (cm.hasActiveSubscribers(gameId, chunkX, chunkY)) continue;
            if ((cm.pendingFills.get(chunkId)?.length ?? 0) > 0) continue;

            const chunk = cm.chunks.get(chunkId);
            if (!chunk) continue;

            const { revealedBuf, flaggedBuf, hasPersistedState } = cm.extractChunkBuffers(chunk);
            if (hasPersistedState) {
                try {
                    const result = await chunkRepo.syncChunkState(
                        gameId, chunkX, chunkY, revealedBuf, flaggedBuf, WORLD_PLAYER_ID,
                    );
                    if (result.revealed > 0 || result.flagged > 0) {
                        syncedCells += result.revealed;
                        syncedChunks++;
                        this.markChunkPersisted(gameId, chunkX, chunkY);
                    }
                } catch (err) {
                    console.error(`[persist] evict-sync failed for ${chunkId}:`, err);
                }
            }
        }

        this.prunePendingFills(gameId, cm);
        const evicted = cm.releaseUnsubscribedChunks();
        if (syncedCells > 0 || evicted > 0) {
            console.log(
                `[persist] game=${gameId} evict-sync chunks=${syncedChunks} cells=${syncedCells} ` +
                `released=${evicted} pending=${cm.pendingFills.size}`,
            );
        }
        return evicted;
    }

    private prunePendingFills(gameId: string, cm: ChunkManager): void {
        const fillsRepo = getPendingFillsRepository();

        for (const [chunkId, entries] of cm.pendingFills) {
            if (entries.length > MAX_PENDING_FILL_SEEDS_PER_CHUNK) {
                entries.splice(0, entries.length - MAX_PENDING_FILL_SEEDS_PER_CHUNK);
            }
        }

        for (const chunkId of [...cm.pendingFills.keys()]) {
            const [chunkX, chunkY] = chunkId.split('_').map(Number);
            const subscribed = cm.hasActiveSubscribers(gameId, chunkX, chunkY);
            const materialized = cm.getChunkById(chunkId) !== undefined;
            if (subscribed || materialized) continue;
            cm.pendingFills.delete(chunkId);
            void fillsRepo.delete(gameId, chunkId);
        }

        if (cm.pendingFills.size <= MAX_PENDING_FILL_CHUNKS) return;

        const excess = cm.pendingFills.size - MAX_PENDING_FILL_CHUNKS;
        const dropKeys = [...cm.pendingFills.keys()].slice(0, excess);
        for (const chunkId of dropKeys) {
            cm.pendingFills.delete(chunkId);
            void fillsRepo.delete(gameId, chunkId);
        }
    }

    private addPendingFillSeed(
        cm: ChunkManager,
        chunkId: string,
        localX: number,
        localY: number,
        pendingFills: Set<string>,
        cs: number,
    ): void {
        pendingFills.add(chunkId);
        let fills = cm.pendingFills.get(chunkId);
        if (!fills) {
            fills = [];
            cm.pendingFills.set(chunkId, fills);
        }
        const localIdx = localY * cs + localX;
        for (let i = 0; i < fills.length; i++) {
            if (fills[i].localY * cs + fills[i].localX === localIdx) return;
        }
        if (fills.length >= MAX_PENDING_FILL_SEEDS_PER_CHUNK) return;
        fills.push({ localX, localY });
    }

    private async drainFillQueue(gameId: string, playerId?: string): Promise<void> {
        const points = this.fillCoordinator.takeBatch(gameId, MAX_FILL_SEEDS_PER_DRAIN);
        if (points.length === 0) {
            this.fillCoordinator.release(gameId);
            return;
        }

        try {
            await this.runBulkFloodFill(gameId, points, playerId);
        } catch (err) {
            console.error('[fills] error:', err);
        }

        if (this.fillCoordinator.hasPending(gameId)) {
            setImmediate(() => this.drainFillQueue(gameId, playerId));
        } else {
            this.fillCoordinator.release(gameId);
            await this.evictUnsubscribedChunksAsync(gameId);
        }
    }

    private listSubscribedChunkCoords(gameId: string): { chunkX: number; chunkY: number }[] {
        if (!this.io) return [];
        const prefix = `${gameId}_chunk_`;
        const out: { chunkX: number; chunkY: number }[] = [];
        for (const room of this.io.sockets.adapter.rooms.keys()) {
            if (!room.startsWith(prefix)) continue;
            const [chunkX, chunkY] = room.slice(prefix.length).split('_').map(Number);
            if (Number.isFinite(chunkX) && Number.isFinite(chunkY)) out.push({ chunkX, chunkY });
        }
        return out;
    }

    private ensureMaterializedForPoints(
        cm: ChunkManager,
        gameId: string,
        points: { x: number; y: number }[],
        cs: number,
    ): void {
        for (const { x, y } of points) {
            const chunkX = Math.floor(x / cs);
            const chunkY = Math.floor(y / cs);
            if (!cm.hasActiveSubscribers(gameId, chunkX, chunkY)) continue;
            cm.ensureMaterialized(chunkX, chunkY);
        }
    }

    private toMineBuffer(mines: Uint8Array): Buffer {
        return Buffer.from(mines);
    }

    private buildNativeFillPayload(
        gameId: string,
        cm: ChunkManager,
        startPoints: { x: number; y: number }[],
        cs: number,
    ): {
        subscribed: { chunkX: number; chunkY: number }[];
        chunks: NativeFloodFillChunk[];
    } | null {
        this.ensureMaterializedForPoints(cm, gameId, startPoints, cs);

        const subscribed = this.listSubscribedChunkCoords(gameId);
        if (subscribed.length === 0) return null;

        const nativeChunks: NativeFloodFillChunk[] = [];
        for (const { chunkX, chunkY } of subscribed) {
            const bufs = cm.snapshotForFill(chunkX, chunkY);
            if (!bufs?.mines?.length) continue;
            nativeChunks.push({
                chunkX,
                chunkY,
                mines: this.toMineBuffer(bufs.mines),
                revealed: bufs.revealed,
                flagged: bufs.flagged,
            });
        }
        if (nativeChunks.length === 0) return null;
        return { subscribed, chunks: nativeChunks };
    }

    private applyNativeReveals(
        cm: ChunkManager,
        cs: number,
        reveals: Array<{ chunkX: number; chunkY: number; indices: number[] }>,
        revealedByChunk: Map<string, { localX: number; localY: number }[]>,
        updatedChunkIds: Set<string>,
    ): number {
        let count = 0;
        for (const { chunkX, chunkY, indices } of reveals) {
            if (indices.length === 0) continue;
            const chunkId = cm.getChunkId(chunkX, chunkY);
            const chunk = cm.ensureMaterialized(chunkX, chunkY);
            if (!chunk) continue;
            const bufs = getChunkBuffers(chunk);
            if (!bufs) continue;

            const toReveal = indices.filter(idx => isCellHidden(bufs.revealed, idx));
            if (toReveal.length === 0) continue;

            revealIndices(chunk, toReveal, cs);
            updatedChunkIds.add(chunkId);
            count += toReveal.length;

            let list = revealedByChunk.get(chunkId);
            if (!list) {
                list = [];
                revealedByChunk.set(chunkId, list);
            }
            for (const idx of toReveal) {
                list.push({ localX: idx % cs, localY: Math.floor(idx / cs) });
            }
        }
        return count;
    }

    private async runNativeFloodFill(
        startPoints: { x: number; y: number }[],
        cs: number,
        payload: { subscribed: { chunkX: number; chunkY: number }[]; chunks: NativeFloodFillChunk[] },
    ): Promise<{ result: NativeFloodFillResult; async: boolean; bfsMs: number } | null> {
        const opts = {
            chunkSize: cs,
            maxReveals: MAX_FILL_REVEALS_PER_RUN,
            revealValue: 0,
            hiddenRevealed: HIDDEN_CELL,
            hiddenFlagged: HIDDEN_CELL,
            seeds: startPoints.map(p => [p.x, p.y]),
            subscribed: payload.subscribed.map(c => [c.chunkX, c.chunkY]),
            chunks: payload.chunks,
        };

        const t0 = performance.now();
        try {
            if (nativeAddon?.floodFillNativeAsync) {
                const result = await nativeAddon.floodFillNativeAsync(opts);
                return { result, async: true, bfsMs: performance.now() - t0 };
            }
            if (nativeAddon?.floodFillNative) {
                const result = nativeAddon.floodFillNative(opts);
                return { result, async: false, bfsMs: performance.now() - t0 };
            }
        } catch (err) {
            console.warn('[fills] native flood fill failed, falling back to JS:', err);
        }
        return null;
    }

    private async tryNativeBulkFloodFill(
        gameId: string,
        cm: ChunkManager,
        startPoints: { x: number; y: number }[],
        cs: number,
    ): Promise<{
        revealedByChunk: Map<string, { localX: number; localY: number }[]>;
        revealedCount: number;
        pendingFills: Set<string>;
        capped: boolean;
        continuation: { x: number; y: number }[];
        bfsMs: number;
        engine: string;
    } | null> {
        if (!nativeAddon?.floodFillNative && !nativeAddon?.floodFillNativeAsync) return null;

        let payload;
        try {
            payload = this.buildNativeFillPayload(gameId, cm, startPoints, cs);
        } catch (err) {
            console.warn('[fills] native payload build failed, falling back to JS:', err);
            return null;
        }
        if (!payload) return null;

        const nativeRun = await this.runNativeFloodFill(startPoints, cs, payload);
        if (!nativeRun) return null;

        const { result, async, bfsMs } = nativeRun;
        const engine = async ? 'rust-async' : 'rust';

        const revealedByChunk = new Map<string, { localX: number; localY: number }[]>();
        const updatedChunkIds = new Set<string>();
        const revealedCount = this.applyNativeReveals(cm, cs, result.reveals, revealedByChunk, updatedChunkIds);

        if (revealedCount === 0 && startPoints.length > 0) {
            return null;
        }

        const pendingFills = new Set<string>();
        for (const pf of result.pendingFills) {
            const chunkId = cm.getChunkId(pf.chunkX, pf.chunkY);
            pendingFills.add(chunkId);
            this.addPendingFillSeed(cm, chunkId, pf.localX, pf.localY, pendingFills, cs);
        }

        const continuation = result.continuation
            .filter(pair => pair.length >= 2)
            .slice(0, MAX_FILL_CONTINUATION_SEEDS)
            .map(pair => ({ x: pair[0], y: pair[1] }));

        return {
            revealedByChunk,
            revealedCount,
            pendingFills,
            capped: result.capped,
            continuation,
            bfsMs,
            engine,
        };
    }

    private async jsBulkFloodFill(
        gameId: string,
        cm: ChunkManager,
        startPoints: { x: number; y: number }[],
        cs: number,
    ): Promise<{
        revealedByChunk: Map<string, { localX: number; localY: number }[]>;
        revealedCount: number;
        pendingFills: Set<string>;
        capped: boolean;
        continuation: { x: number; y: number }[];
        bfsMs: number;
        engine: string;
    }> {
        const chunks = cm.chunks;
        const revealedByChunk = new Map<string, { localX: number; localY: number }[]>();
        let revealedCount = 0;
        const visited = new Set<string>();
        const pendingFills = new Set<string>();
        const updatedChunkIds = new Set<string>();
        const t0 = performance.now();

        const getChunk = (cx: number, cy: number): IChunk | null => {
            const chunkId = cm.getChunkId(cx, cy);
            let chunk = chunks.get(chunkId);
            if (chunk) return chunk;
            if (!cm.hasActiveSubscribers(gameId, cx, cy)) return null;
            try {
                chunk = cm.materializeChunk(cx, cy);
                return chunk;
            } catch {
                return null;
            }
        };

        const recordReveal = (chunkId: string, lx: number, ly: number) => {
            revealedCount++;
            let list = revealedByChunk.get(chunkId);
            if (!list) {
                list = [];
                revealedByChunk.set(chunkId, list);
            }
            list.push({ localX: lx, localY: ly });
            updatedChunkIds.add(chunkId);
        };

        const queueX: number[] = [];
        const queueY: number[] = [];
        let head = 0;

        const tryEnqueue = (gx: number, gy: number): void => {
            const key = packCoord(gx, gy);
            if (visited.has(key)) return;
            visited.add(key);

            const cx = Math.floor(gx / cs);
            const cy = Math.floor(gy / cs);
            const lx = gx - cx * cs;
            const ly = gy - cy * cs;
            const chunkId = cm.getChunkId(cx, cy);
            if (!chunks.has(chunkId)) {
                if (!cm.hasActiveSubscribers(gameId, cx, cy)) {
                    this.addPendingFillSeed(cm, chunkId, lx, ly, pendingFills, cs);
                    return;
                }
                const chunk = getChunk(cx, cy);
                if (!chunk) {
                    this.addPendingFillSeed(cm, chunkId, lx, ly, pendingFills, cs);
                    return;
                }
            }

            const chunk = chunks.get(chunkId);
            if (!chunk) {
                this.addPendingFillSeed(cm, chunkId, lx, ly, pendingFills, cs);
                return;
            }
            const bufs = getChunkBuffers(chunk);
            if (!bufs || !canRevealAt(bufs, cellIndex(lx, ly, cs))) return;

            queueX.push(gx);
            queueY.push(gy);
        };

        for (const { x, y } of startPoints) {
            tryEnqueue(x, y);
        }

        let steps = 0;
        let capped = false;
        while (head < queueX.length) {
            if (++steps % BFS_YIELD_EVERY_STEPS === 0) await new Promise<void>(r => setImmediate(r));
            if (revealedCount >= MAX_FILL_REVEALS_PER_RUN) {
                capped = true;
                break;
            }

            const x = queueX[head];
            const y = queueY[head];
            head++;

            const cx = Math.floor(x / cs);
            const cy = Math.floor(y / cs);
            const lx = x - cx * cs;
            const ly = y - cy * cs;
            const chunkId = cm.getChunkId(cx, cy);
            const chunk = chunks.get(chunkId);
            if (!chunk) continue;

            if (!revealCellAt(chunk, lx, ly, cs)) continue;
            recordReveal(chunkId, lx, ly);

            const bufs = getChunkBuffers(chunk);
            if (!bufs) continue;
            if (adjacentMinesAt(bufs.mines, cellIndex(lx, ly, cs)) !== 0) continue;

            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    tryEnqueue(x + dx, y + dy);
                }
            }
        }

        const continuation: { x: number; y: number }[] = [];
        if (capped && head < queueX.length) {
            for (let i = head; i < queueX.length && continuation.length < MAX_FILL_CONTINUATION_SEEDS; i++) {
                continuation.push({ x: queueX[i], y: queueY[i] });
            }
        }

        for (const chunkId of updatedChunkIds) {
            const chunk = chunks.get(chunkId);
            if (chunk) invalidateChunkWireCache(chunk);
        }

        return {
            revealedByChunk,
            revealedCount,
            pendingFills,
            capped,
            continuation,
            bfsMs: performance.now() - t0,
            engine: 'js',
        };
    }

    /**
     * Runs a single BFS flood fill seeded from multiple start points.
     * Broadcasts immediately; Mongo persistence runs without blocking the hot path.
     */
    async runBulkFloodFill(
        gameId: string,
        startPoints: { x: number; y: number }[],
        playerId?: string,
    ): Promise<{ revealedCells: Cell[], pendingFills: Set<string> }> {
        const gameState = this.getGame(gameId);
        if (!gameState) throw new Error(`Game not found: ${gameId}`);
        const cm = this.getChunkManager(gameId) as ChunkManager;
        const cs = CHUNK_SIZE;
        const t0 = performance.now();

        this.ensureMaterializedForPoints(cm, gameId, startPoints, cs);

        const nativeResult = await this.tryNativeBulkFloodFill(gameId, cm, startPoints, cs);
        const fillResult = nativeResult ?? await this.jsBulkFloodFill(gameId, cm, startPoints, cs);
        const { revealedByChunk, revealedCount, pendingFills, capped, continuation, bfsMs, engine } = fillResult;
        const updatedChunkIds = new Set(revealedByChunk.keys());
        const afterBfsMs = performance.now() - t0;

        for (const chunkId of updatedChunkIds) {
            const chunk = cm.chunks.get(chunkId);
            if (chunk && cm.broadcastChunkUpdate) {
                cm.broadcastChunkUpdate(chunk);
            }
        }
        const afterBroadcastMs = performance.now() - t0;

        if (capped && continuation.length > 0) {
            setImmediate(() => this.enqueueFill(gameId, continuation, playerId));
        }

        const revealedCells = this.buildRevealedCells(cm, revealedByChunk, cs);
        void this.persistBulkFillResults(gameId, cm, updatedChunkIds, pendingFills, playerId);
        this.prunePendingFills(gameId, cm);

        const totalMs = performance.now() - t0;
        console.log(
            `[fills] engine=${engine} seeds=${startPoints.length} revealed=${revealedCount} ` +
            `chunks=${updatedChunkIds.size} bfs=${bfsMs.toFixed(1)}ms ` +
            `broadcast=${(afterBroadcastMs - afterBfsMs).toFixed(1)}ms total=${totalMs.toFixed(1)}ms` +
            `${capped ? ' capped' : ''}`
        );

        return { revealedCells, pendingFills };
    }

    private buildRevealedCells(
        cm: ChunkManager,
        revealedByChunk: Map<string, { localX: number; localY: number }[]>,
        cs: number,
    ): Cell[] {
        const cells: Cell[] = [];
        for (const [chunkId, locals] of revealedByChunk) {
            const chunk = cm.getChunkById(chunkId);
            const [chunkX, chunkY] = chunkId.split('_').map(Number);
            for (const { localX, localY } of locals) {
                const cell = chunk?.getTile(localX, localY);
                if (cell) {
                    cells.push(cell);
                } else {
                    cells.push({
                        x: chunkX * cs + localX,
                        y: chunkY * cs + localY,
                        revealed: true,
                        flagged: false,
                        isMine: false,
                        adjacentMines: 0,
                    });
                }
            }
        }
        return cells;
    }

    private async persistBulkFillResults(
        gameId: string,
        chunkManager: ChunkManager,
        updatedChunkIds: Set<string>,
        pendingFillChunkIds: Set<string>,
        playerId?: string,
    ): Promise<void> {
        const persistPlayerId = playerId ?? WORLD_PLAYER_ID;
        let cellCount = 0;
        let chunkCount = 0;

        try {
            if (updatedChunkIds.size > 0) {
                const chunkRepo = getChunkRepository();
                await Promise.all([...updatedChunkIds].map(async (chunkId) => {
                    const chunk = chunkManager.getChunkById(chunkId);
                    let revealedBuf: Buffer | undefined;
                    let flaggedBuf: Buffer | undefined;

                    if (chunk) {
                        const extracted = chunkManager.extractChunkBuffers(chunk);
                        if (!extracted.hasPersistedState) return;
                        revealedBuf = extracted.revealedBuf;
                        flaggedBuf = extracted.flaggedBuf;
                    } else {
                        const deferred = chunkManager.getDeferredBuffers(chunkId);
                        if (!deferred?.revealedBuf && !deferred?.flaggedBuf) return;
                        revealedBuf = deferred.revealedBuf ?? Buffer.alloc(CHUNK_SIZE * CHUNK_SIZE, 0xff);
                        flaggedBuf = deferred.flaggedBuf ?? Buffer.alloc(CHUNK_SIZE * CHUNK_SIZE, 0xff);
                    }

                    const [chunkX, chunkY] = chunkId.split('_').map(Number);
                    const result = await chunkRepo.syncChunkState(
                        gameId, chunkX, chunkY, revealedBuf, flaggedBuf, persistPlayerId,
                    );
                    if (result.revealed > 0 || result.flagged > 0) {
                        this.markChunkPersisted(gameId, chunkX, chunkY);
                        cellCount += result.revealed;
                        chunkCount++;
                    }
                }));
            }
            const pendingCount = pendingFillChunkIds.size;
            if (pendingCount > 0) {
                const fillsRepo = getPendingFillsRepository();
                await Promise.all([...pendingFillChunkIds].map(async (chunkId) => {
                    const [chunkX, chunkY] = chunkId.split('_').map(Number);
                    if (!chunkManager.hasActiveSubscribers(gameId, chunkX, chunkY)) return;
                    const entries = chunkManager.pendingFills.get(chunkId) ?? [];
                    if (entries.length === 0) {
                        await fillsRepo.delete(gameId, chunkId);
                        return;
                    }
                    await fillsRepo.save(gameId, chunkId, entries);
                }));
            }
            if (cellCount > 0 || pendingCount > 0) {
                console.log(`[persist] game=${gameId} chunks=${chunkCount} cells=${cellCount} pending=${pendingCount}`);
            }
        } catch (err) {
            console.error('[persist]', err);
        }
    }

    /**
     * Single-origin flood fill — thin wrapper over runBulkFloodFill.
     */
    async runGlobalFloodFill(gameId: string, startX: number, startY: number, playerId?: string): Promise<{ revealedCells: Cell[], pendingFills: Set<string> }> {
        return this.runBulkFloodFill(gameId, [{ x: startX, y: startY }], playerId);
    }
}
