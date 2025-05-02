import { Server, Socket } from 'socket.io';
import {
    GameState, GameConfig, Player, Players, ClientCell, Cell, Coordinates,
    RevealTilePayload, FlagTilePayload, ChordClickPayload, ViewportUpdatePayload,
    ScoreUpdatePayload, PlayerStatusUpdatePayload, PlayerViewportUpdatePayload, MineRevealedPayload, ErrorPayload, GameOverPayload, GameStatePayload, PlayerStatus, MineReveal, ViewportState, ScoringConfig, DEFAULT_SCORING_CONFIG, PointData, MineRevealPlayerContribution
} from '../domain/types';
import {
    addPlayerToGame, removePlayerFromGame, checkPlayerLockout
} from '../domain/game';
import { initializeWorldGenerator, getCellValue as getWorldCellValue } from '../domain/worldGenerator';
import { SpatialHashGrid, Bounds } from '../domain/spatialHashGrid';
import { GameRepository } from '../infrastructure/persistence/types';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';

// Define GetCellFunction type locally or import if defined elsewhere suitable
type GetCellFunction = (gameState: GameState, x: number, y: number) => Promise<Cell | null>;

// Constants
const GAME_LOOP_INTERVAL = 1000; // ms
const INFINITE_GRID_CHUNK_SIZE = 16; // Example chunk size

// In-memory stores (consider if these should be managed differently, e.g., via repository for active games list)
const activeGames = new Map<string, GameState>();
const gameEmitters = new Map<string, EventEmitter>();

// Helper functions
function getGameEmitter(gameId: string): EventEmitter {
    if (!gameEmitters.has(gameId)) {
        gameEmitters.set(gameId, new EventEmitter());
    }
    return gameEmitters.get(gameId)!;
}

function emitToPlayer(io: Server, playerId: string, event: string, payload: any) {
    io.to(playerId).emit(event, payload);
}

// --- GameService Class ---

export class GameService {
    private io: Server | null = null;
    private gameRepository: GameRepository;
    private gameLoopIntervals: Map<string, NodeJS.Timeout> = new Map();

    constructor(gameRepository: GameRepository) {
        this.gameRepository = gameRepository;
    }

    setIoServer(io: Server): void {
        this.io = io;
    }

    private ensureIoServer(): Server {
        if (!this.io) {
            throw new Error("Socket.IO server instance has not been set in GameService.");
        }
        return this.io;
    }

    // --- Game Lifecycle ---

    async createGame(config: Partial<GameConfig> = {}, scoringConfig: Partial<ScoringConfig> = {}): Promise<GameState> {
        const gameId = uuidv4();
        console.log(`Creating game ${gameId}...`);

        const finalConfig: GameConfig = {
            rows: config.rows ?? 0, // Default to 0 for infinite
            cols: config.cols ?? 0, // Default to 0 for infinite
            mines: config.mines ?? 0, // Default to 0 for infinite (density handled by world gen)
            isInfiniteWorld: config.isInfiniteWorld ?? true,
            mineLocations: config.mineLocations, // Only relevant for fixed boards
        };

        const finalScoringConfig: ScoringConfig = {
            ...DEFAULT_SCORING_CONFIG,
            ...scoringConfig
        };

        initializeWorldGenerator(gameId); // Assuming this uses gameId as seed or identifier

        let spatialGrid: SpatialHashGrid<PointData> | undefined = undefined;
        if (finalConfig.isInfiniteWorld) {
            // Correct instantiation using PointData generic and single cellSize argument
            spatialGrid = new SpatialHashGrid<PointData>(INFINITE_GRID_CHUNK_SIZE);
        }

        const initialGameState: GameState = {
            gameId,
            boardConfig: finalConfig,
            scoringConfig: finalScoringConfig,
            players: {},
            mineReveals: [],
            pendingReveals: [],
            gameOver: false,
            spatialGrid: spatialGrid,
        };

        activeGames.set(gameId, initialGameState);
        getGameEmitter(gameId); // Setup event emitter for this game
        this.startGameLoop(gameId);

        // Save initial game metadata (without grid state)
        await this.gameRepository.saveGame({
            gameId: initialGameState.gameId,
            boardConfig: initialGameState.boardConfig,
            scoringConfig: initialGameState.scoringConfig,
            players: {}, // Initially no players persisted here
            mineReveals: [],
            pendingReveals: [],
            gameOver: false,
        });

        console.log(`Game ${gameId} created successfully.`);
        return initialGameState;
    }

    async loadGame(gameId: string): Promise<GameState | null> {
        if (activeGames.has(gameId)) {
            return activeGames.get(gameId)!;
        }

        console.log(`Loading game ${gameId} from repository...`);
        const gameData = await this.gameRepository.findGameById(gameId);

        if (!gameData) {
            console.log(`Game ${gameId} not found in repository.`);
            return null;
        }

        // Reconstruct the GameState from persisted data
        const gameState: GameState = {
            gameId: gameData.gameId!,
            boardConfig: gameData.boardConfig!,
            scoringConfig: gameData.scoringConfig!,
            players: gameData.players || {},
            mineReveals: gameData.mineReveals || [],
            pendingReveals: gameData.pendingReveals || [],
            gameOver: gameData.gameOver || false,
            winner: gameData.winner,
            spatialGrid: gameData.boardConfig?.isInfiniteWorld
                ? new SpatialHashGrid<PointData>(INFINITE_GRID_CHUNK_SIZE)
                : undefined,
        };

        activeGames.set(gameId, gameState);
        getGameEmitter(gameId);
        this.startGameLoop(gameId);
        console.log(`Game ${gameId} loaded successfully.`);
        return gameState;
    }

    // --- Player Management ---

    async joinGame(gameId: string, playerId: string, username?: string): Promise<void> {
        const io = this.ensureIoServer();
        let gameState: GameState | undefined | null = activeGames.get(gameId);
        if (!gameState) {
            gameState = await this.loadGame(gameId);
            if (!gameState) {
                emitToPlayer(io, playerId, 'error', { message: `Game ${gameId} not found.` } as ErrorPayload);
                throw new Error(`Game ${gameId} not found.`);
            }
        }

        if (gameState.gameOver) {
            emitToPlayer(io, playerId, 'error', { message: `Game ${gameId} is already over.` } as ErrorPayload);
            throw new Error(`Game ${gameId} is already over.`);
        }

        const finalUsername = username || `Player_${playerId.substring(0, 4)}`;
        const updatedState: GameState = addPlayerToGame(gameState, playerId, finalUsername);
        activeGames.set(gameId, updatedState);

        console.log(`Player ${playerId} (${finalUsername}) joined game ${gameId}`);

        await this.gameRepository.saveGame(updatedState);

        await this.sendInitialGameState(playerId, updatedState);

        io.to(gameId).except(playerId).emit('playerJoined', {
            playerId: playerId,
            username: finalUsername,
            score: updatedState.players[playerId]?.score ?? 0,
            status: updatedState.players[playerId]?.status ?? PlayerStatus.ACTIVE
        });
    }

    async disconnectPlayer(playerId: string): Promise<void> {
        const io = this.ensureIoServer();
        let gameId: string | null = null;
        let gameState: GameState | null = null;

        for (const [id, state] of activeGames.entries()) {
            if (state.players[playerId]) {
                gameId = id;
                gameState = state;
                break;
            }
        }

        if (!gameId || !gameState) {
            console.log(`Player ${playerId} disconnected but was not found in an active game.`);
            return;
        }

        console.log(`Player ${playerId} leaving game ${gameId}`);

        const updatedState: GameState = removePlayerFromGame(gameState, playerId);
        activeGames.set(gameId, updatedState);

        await this.gameRepository.saveGame(updatedState);

        io.to(gameId).emit('playerLeft', { playerId: playerId });

        if (Object.keys(updatedState.players).length === 0) {
            console.log(`Game ${gameId} is empty. Stopping loop and potentially cleaning up.`);
            this.stopGameLoop(gameId);
        }
    }

    // --- Game Actions ---
    async revealCell(gameId: string, playerId: string, coordinates: Coordinates): Promise<void> {
        const io = this.ensureIoServer();
        const gameState = activeGames.get(gameId);
        if (!this.validateAction(io, gameId, playerId, gameState)) return;

        console.log(`Player ${playerId} revealing tile at (${coordinates.x}, ${coordinates.y}) in game ${gameId}`);

        const player = gameState!.players[playerId];
        const now = Date.now();
        const { isLocked } = checkPlayerLockout(player, now);
        if (isLocked) {
            emitToPlayer(io, playerId, 'error', { message: "You are currently locked out." } as ErrorPayload);
            return;
        }

        const cell = await this.getCell(gameState!, coordinates.x, coordinates.y);
        if (!cell || cell.revealed || cell.flagged) {
            return;
        }

        let updatedState = { ...gameState! };
        const updatedCells: (Cell & Coordinates)[] = [];
        const scoreUpdates: ScoreUpdatePayload[] = [];
        let statusUpdate: PlayerStatusUpdatePayload | null = null;
        let mineRevealsToAdd: MineReveal[] = [];
        let gameOver = false;
        let winner: string | undefined = undefined;

        if (cell.isMine) {
            console.log(`Player ${playerId} hit a mine at (${coordinates.x}, ${coordinates.y})`);
            const penalty = updatedState.scoringConfig.mineHitPenalty;
            const newScore = Math.max(0, player.score - penalty);
            const scoreDelta = newScore - player.score;

            scoreUpdates.push({
                playerId,
                newScore,
                scoreDelta,
                reason: 'Hit Mine'
            });

            const lockoutEnd = now + updatedState.scoringConfig.lockoutDurationMs;
            statusUpdate = {
                playerId,
                status: PlayerStatus.LOCKED_OUT,
                lockedUntil: lockoutEnd
            };

            if (updatedState.spatialGrid) {
                const pointData: PointData = { revealed: true };
                updatedState.spatialGrid.set(coordinates.x, coordinates.y, pointData);
                updatedCells.push({ ...cell, ...coordinates, revealed: true });
                this.persistChunkContaining(updatedState.gameId, updatedState.spatialGrid, coordinates.x, coordinates.y);
            }
        } else {
            const revealQueue: Coordinates[] = [coordinates];
            const visited = new Set<string>([`${coordinates.x},${coordinates.y}`]);

            while (revealQueue.length > 0) {
                const currentCoords = revealQueue.shift()!;
                const currentCell = await this.getCell(updatedState, currentCoords.x, currentCoords.y);

                if (!currentCell || currentCell.revealed || currentCell.flagged || currentCell.isMine) {
                    continue;
                }

                if (updatedState.spatialGrid) {
                    const pointData: PointData = { revealed: true };
                    updatedState.spatialGrid.set(currentCoords.x, currentCoords.y, pointData);
                    updatedCells.push({ ...currentCell, ...currentCoords, revealed: true });
                }

                if (currentCell.adjacentMines > 0) {
                    const points = updatedState.scoringConfig.numberRevealPoints;
                }

                if (currentCell.adjacentMines === 0) {
                    for (let dx = -1; dx <= 1; dx++) {
                        for (let dy = -1; dy <= 1; dy++) {
                            if (dx === 0 && dy === 0) continue;
                            const nextX = currentCoords.x + dx;
                            const nextY = currentCoords.y + dy;
                            const key = `${nextX},${nextY}`;
                            if (!visited.has(key)) {
                                revealQueue.push({ x: nextX, y: nextY });
                                visited.add(key);
                            }
                        }
                    }
                }
            }
            if (updatedState.spatialGrid) {
                const affectedChunkIds = new Set<string>();
                updatedCells.forEach(uc => affectedChunkIds.add(updatedState.spatialGrid!.getChunkIdForCoords(uc.x, uc.y)));
                affectedChunkIds.forEach(chunkId => {
                    const chunkData = updatedState.spatialGrid!.getChunkData(chunkId);
                    if (chunkData) {
                        this.gameRepository.saveChunk(updatedState.gameId, chunkId, chunkData);
                    }
                });
            }

            const numberCellsRevealed = updatedCells.filter(c => !c.isMine && c.adjacentMines > 0).length;
            if (numberCellsRevealed > 0) {
                const points = numberCellsRevealed * updatedState.scoringConfig.numberRevealPoints;
                const newScore = player.score + points;
                scoreUpdates.push({
                    playerId,
                    newScore,
                    scoreDelta: points,
                    reason: 'Reveal Number(s)'
                });
            }
        }

        if (statusUpdate) {
            updatedState = this.applyPlayerStatusUpdate(updatedState, statusUpdate);
            this.emitPlayerStatusUpdate(gameId, statusUpdate);
        }
        scoreUpdates.forEach(su => {
            updatedState = this.applyScoreUpdate(updatedState, su);
            this.emitScoreUpdate(gameId, su);
        });

        if (gameOver) {
            updatedState = { ...updatedState, gameOver: true, winner: winner };
            this.handleGameOver(gameId, updatedState);
        }

        activeGames.set(gameId, updatedState);
        await this.gameRepository.saveGame(updatedState);

        if (updatedCells.length > 0) {
            const clientUpdates = updatedCells.map((cell: Cell & Coordinates) => ({
                x: cell.x,
                y: cell.y,
                ...this.convertToClientCell(cell)
            }));
            io.to(gameId).emit('tilesUpdate', clientUpdates);
        }
    }

    async flagCell(gameId: string, playerId: string, coordinates: Coordinates): Promise<void> {
        const io = this.ensureIoServer();
        const gameState = activeGames.get(gameId);
        if (!this.validateAction(io, gameId, playerId, gameState)) return;

        console.log(`Player ${playerId} flagging tile at (${coordinates.x}, ${coordinates.y}) in game ${gameId}`);

        const player = gameState!.players[playerId];
        const now = Date.now();
        const { isLocked } = checkPlayerLockout(player, now);
        if (isLocked) {
            emitToPlayer(io, playerId, 'error', { message: "You are currently locked out." } as ErrorPayload);
            return;
        }

        const cell = await this.getCell(gameState!, coordinates.x, coordinates.y);
        if (!cell || cell.revealed) {
            return;
        }

        let updatedState = { ...gameState! };
        const currentFlaggedState = cell.flagged;
        const newFlaggedState = !currentFlaggedState;
        let scoreUpdates: ScoreUpdatePayload[] = [];
        let updatedMineReveal: MineReveal | null = null;

        if (updatedState.spatialGrid) {
            const pointData: PointData = { ...updatedState.spatialGrid.get(coordinates.x, coordinates.y), flagged: newFlaggedState };
            updatedState.spatialGrid.set(coordinates.x, coordinates.y, pointData);
            this.persistChunkContaining(updatedState.gameId, updatedState.spatialGrid, coordinates.x, coordinates.y);
        }

        const updatedCell: Cell & Coordinates = { ...cell, ...coordinates, flagged: newFlaggedState };

        if (cell.isMine && newFlaggedState) {
            const revealIndex = updatedState.mineReveals.findIndex(mr => mr.x === coordinates.x && mr.y === coordinates.y);
            let mineReveal: MineReveal;

            if (revealIndex > -1) {
                mineReveal = { ...updatedState.mineReveals[revealIndex] };
                if (!mineReveal.players.some(p => p.playerId === playerId)) {
                    mineReveal.players.push({ playerId, position: 0, timestamp: now, points: 0 });
                }
            } else {
                mineReveal = {
                    x: coordinates.x,
                    y: coordinates.y,
                    players: [{ playerId, position: 0, timestamp: now, points: 0 }],
                    revealed: false,
                    revealTimestamp: undefined
                };
            }

            mineReveal.players.sort((a, b) => a.timestamp - b.timestamp);

            let scoreChanged = false;
            mineReveal.players = mineReveal.players.map((p, index) => {
                const position = index + 1;
                let points = 0;
                if (position === 1) points = updatedState.scoringConfig.firstPlacePoints;
                else if (position === 2) points = updatedState.scoringConfig.secondPlacePoints;
                else if (position === 3) points = updatedState.scoringConfig.thirdPlacePoints;

                if (p.position !== position || p.points !== points) {
                    if (p.playerId === playerId && points > 0 && p.points === 0) {
                        const playerToUpdate = updatedState.players[p.playerId];
                        const newScore = playerToUpdate.score + points;
                        scoreUpdates.push({ playerId: p.playerId, newScore, scoreDelta: points, reason: `Flag Mine (Pos ${position})` });
                        scoreChanged = true;
                    }
                    return { ...p, position, points };
                }
                return p;
            });

            if (!mineReveal.revealTimestamp && mineReveal.players.length > 0) {
                mineReveal.revealTimestamp = now + updatedState.scoringConfig.mineRevealDelayMs;
                if (!updatedState.pendingReveals.some(pr => pr.x === coordinates.x && pr.y === coordinates.y)) {
                    updatedState = { ...updatedState, pendingReveals: [...updatedState.pendingReveals, coordinates] };
                }
            }

            if (revealIndex > -1) {
                updatedState.mineReveals[revealIndex] = mineReveal;
            } else {
                updatedState.mineReveals.push(mineReveal);
            }
            updatedMineReveal = mineReveal;
        }

        scoreUpdates.forEach(su => {
            updatedState = this.applyScoreUpdate(updatedState, su);
            this.emitScoreUpdate(gameId, su);
        });

        activeGames.set(gameId, updatedState);
        await this.gameRepository.saveGame(updatedState);

        const clientCell = this.convertToClientCell(updatedCell);
        io.to(gameId).emit('tileUpdate', { x: coordinates.x, y: coordinates.y, ...clientCell });
    }

    async chordCell(gameId: string, playerId: string, coordinates: Coordinates): Promise<void> {
        const io = this.ensureIoServer();
        const gameState = activeGames.get(gameId);
        if (!this.validateAction(io, gameId, playerId, gameState)) return;

        console.log(`Player ${playerId} chord clicking at (${coordinates.x}, ${coordinates.y}) in game ${gameId}`);

        const player = gameState!.players[playerId];
        const now = Date.now();
        const { isLocked } = checkPlayerLockout(player, now);
        if (isLocked) {
            emitToPlayer(io, playerId, 'error', { message: "You are currently locked out." } as ErrorPayload);
            return;
        }

        const centerCell = await this.getCell(gameState!, coordinates.x, coordinates.y);

        if (!centerCell || !centerCell.revealed || centerCell.isMine || centerCell.adjacentMines === 0) {
            return;
        }

        let adjacentFlags = 0;
        const neighborsToReveal: Coordinates[] = [];
        const neighborCells: (Cell & Coordinates)[] = [];

        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                const neighborCoords = { x: coordinates.x + dx, y: coordinates.y + dy };
                const neighborCell = await this.getCell(gameState!, neighborCoords.x, neighborCoords.y);

                if (neighborCell) {
                    neighborCells.push({ ...neighborCell, ...neighborCoords });
                    if (neighborCell.flagged) {
                        adjacentFlags++;
                    }
                    if (!neighborCell.revealed && !neighborCell.flagged) {
                        neighborsToReveal.push(neighborCoords);
                    }
                }
            }
        }

        if (adjacentFlags === centerCell.adjacentMines) {
            let updatedState = { ...gameState! };
            const updatedCells: (Cell & Coordinates)[] = [];
            const scoreUpdates: ScoreUpdatePayload[] = [];
            let statusUpdate: PlayerStatusUpdatePayload | null = null;
            let hitMine = false;

            for (const neighborCoords of neighborsToReveal) {
                const neighborCell = neighborCells.find(nc => nc.x === neighborCoords.x && nc.y === neighborCoords.y);
                if (!neighborCell) continue;

                if (neighborCell.isMine) {
                    hitMine = true;
                    console.log(`Player ${playerId} hit a mine via chord click at (${neighborCoords.x}, ${neighborCoords.y})`);
                    const penalty = updatedState.scoringConfig.mineHitPenalty;
                    const newScore = Math.max(0, player.score - penalty);
                    const scoreDelta = newScore - player.score;
                    scoreUpdates.push({ playerId, newScore, scoreDelta, reason: 'Hit Mine (Chord)' });

                    const lockoutEnd = now + updatedState.scoringConfig.lockoutDurationMs;
                    statusUpdate = { playerId, status: PlayerStatus.LOCKED_OUT, lockedUntil: lockoutEnd };

                    if (updatedState.spatialGrid) {
                        const pointData: PointData = { revealed: true };
                        updatedState.spatialGrid.set(neighborCoords.x, neighborCoords.y, pointData);
                        updatedCells.push({ ...neighborCell, revealed: true });
                    }
                    break;
                } else {
                    if (updatedState.spatialGrid) {
                        const pointData: PointData = { revealed: true };
                        updatedState.spatialGrid.set(neighborCoords.x, neighborCoords.y, pointData);
                        updatedCells.push({ ...neighborCell, revealed: true });

                        if (neighborCell.adjacentMines > 0) {
                            const points = updatedState.scoringConfig.numberRevealPoints;
                            const currentScore = scoreUpdates.reduce((sum, su) => su.playerId === playerId ? su.newScore : sum, player.score);
                            const newScore = currentScore + points;
                            let existingUpdate = scoreUpdates.find(su => su.playerId === playerId);
                            if (existingUpdate) {
                                existingUpdate.scoreDelta += points;
                                existingUpdate.newScore = newScore;
                                existingUpdate.reason += ", Reveal Number(s)";
                            } else {
                                scoreUpdates.push({ playerId, newScore, scoreDelta: points, reason: 'Reveal Number(s) (Chord)' });
                            }
                        }
                    }
                }
            }

            if (updatedCells.length > 0 && updatedState.spatialGrid) {
                const affectedChunkIds = new Set<string>();
                updatedCells.forEach(uc => affectedChunkIds.add(updatedState.spatialGrid!.getChunkIdForCoords(uc.x, uc.y)));
                affectedChunkIds.forEach(chunkId => {
                    const chunkData = updatedState.spatialGrid!.getChunkData(chunkId);
                    if (chunkData) {
                        this.gameRepository.saveChunk(updatedState.gameId, chunkId, chunkData);
                    }
                });
            }

            if (statusUpdate) {
                updatedState = this.applyPlayerStatusUpdate(updatedState, statusUpdate);
                this.emitPlayerStatusUpdate(gameId, statusUpdate);
            }
            scoreUpdates.forEach(su => {
                updatedState = this.applyScoreUpdate(updatedState, su);
                this.emitScoreUpdate(gameId, su);
            });

            activeGames.set(gameId, updatedState);
            await this.gameRepository.saveGame(updatedState);

            const clientUpdates = updatedCells.map((cell: Cell & Coordinates) => ({
                x: cell.x,
                y: cell.y,
                ...this.convertToClientCell(cell)
            }));
            io.to(gameId).emit('tilesUpdate', clientUpdates);
        }
    }

    async updatePlayerViewport(gameId: string, playerId: string, payload: ViewportUpdatePayload): Promise<void> {
        const io = this.ensureIoServer();
        const gameState = activeGames.get(gameId);

        if (!gameState || !gameState.players[playerId] || !gameState.boardConfig.isInfiniteWorld) {
            console.warn(`Viewport update ignored for player ${playerId} in game ${gameId}. State invalid or not infinite.`);
            return;
        }

        const updatedPlayer: Player = {
            ...gameState.players[playerId],
            viewport: {
                center: payload.center,
                width: payload.width,
                height: payload.height,
                zoom: payload.zoom,
            }
        };

        const updatedState: GameState = {
            ...gameState,
            players: {
                ...gameState.players,
                [playerId]: updatedPlayer
            }
        };

        activeGames.set(gameId, updatedState);

        await this.sendBoardStateToPlayer(playerId, updatedState);
    }

    // --- Game Loop Logic ---

    private startGameLoop(gameId: string): void {
        if (this.gameLoopIntervals.has(gameId)) {
            return;
        }
        console.log(`Starting game loop for ${gameId}`);
        const intervalId = setInterval(async () => {
            const gameState = activeGames.get(gameId);
            if (!gameState || gameState.gameOver) {
                this.stopGameLoop(gameId);
                return;
            }

            const now = Date.now();
            let stateChanged = false;
            let updatedState = { ...gameState };

            let playerStatusUpdates: PlayerStatusUpdatePayload[] = [];
            for (const playerId in updatedState.players) {
                const player = updatedState.players[playerId];
                const { isLocked, updatedPlayer } = checkPlayerLockout(player, now);
                if (player !== updatedPlayer) {
                    updatedState = this.applyPlayerStatusUpdate(updatedState, { playerId, status: updatedPlayer.status, lockedUntil: updatedPlayer.lockedUntil });
                    playerStatusUpdates.push({ playerId, status: updatedPlayer.status, lockedUntil: updatedPlayer.lockedUntil });
                    stateChanged = true;
                }
            }

            const revealsToProcess = updatedState.mineReveals.filter(mr => mr.revealTimestamp && mr.revealTimestamp <= now && !mr.revealed);
            const processedReveals: MineReveal[] = [];
            let updatedMineReveals = [...updatedState.mineReveals];
            let updatedPendingReveals = [...updatedState.pendingReveals];

            if (revealsToProcess.length > 0) {
                stateChanged = true;
                revealsToProcess.forEach(reveal => {
                    const index = updatedMineReveals.findIndex(mr => mr.x === reveal.x && mr.y === reveal.y);
                    if (index > -1) {
                        const updatedReveal = { ...updatedMineReveals[index], revealed: true };
                        updatedMineReveals[index] = updatedReveal;
                        processedReveals.push(updatedReveal);

                        updatedPendingReveals = updatedPendingReveals.filter(pr => !(pr.x === reveal.x && pr.y === reveal.y));

                        if (updatedState.spatialGrid) {
                            const currentData = updatedState.spatialGrid.get(reveal.x, reveal.y) || {};
                            if (!currentData.revealed) {
                                updatedState.spatialGrid.set(reveal.x, reveal.y, { ...currentData, revealed: true });
                                this.persistChunkContaining(updatedState.gameId, updatedState.spatialGrid, reveal.x, reveal.y);
                            }
                        }
                    }
                });
                updatedState = { ...updatedState, mineReveals: updatedMineReveals, pendingReveals: updatedPendingReveals };
            }

            if (stateChanged) {
                activeGames.set(gameId, updatedState);
                await this.gameRepository.saveGame(updatedState);

                playerStatusUpdates.forEach(update => this.emitPlayerStatusUpdate(gameId, update));
                processedReveals.forEach(reveal => this.emitMineRevealed(gameId, reveal));
            }

        }, GAME_LOOP_INTERVAL);

        this.gameLoopIntervals.set(gameId, intervalId);
    }

    private stopGameLoop(gameId: string): void {
        if (this.gameLoopIntervals.has(gameId)) {
            console.log(`Stopping game loop for ${gameId}`);
            clearInterval(this.gameLoopIntervals.get(gameId)!);
            this.gameLoopIntervals.delete(gameId);
        }
    }

    // --- Event Emitters ---

    private emitScoreUpdate(gameId: string, payload: ScoreUpdatePayload): void {
        const io = this.ensureIoServer();
        io.to(gameId).emit('scoreUpdate', payload);
    }

    private emitPlayerStatusUpdate(gameId: string, payload: PlayerStatusUpdatePayload): void {
        const io = this.ensureIoServer();
        io.to(gameId).emit('playerStatusUpdate', payload);
    }

    private emitMineRevealed(gameId: string, mineReveal: MineReveal): void {
        const io = this.ensureIoServer();
        const payload: MineRevealedPayload = {
            x: mineReveal.x,
            y: mineReveal.y,
            revealedBy: mineReveal.players
        };
        io.to(gameId).emit('mineRevealed', payload);

        io.to(gameId).emit('tileUpdate', {
            x: mineReveal.x,
            y: mineReveal.y,
            revealed: true,
            isMine: true,
            flagged: false
        });
    }

    private handleGameOver(gameId: string, finalState: GameState): void {
        const io = this.ensureIoServer();
        console.log(`Game ${gameId} is over. Winner: ${finalState.winner || 'None'}`);
        this.stopGameLoop(gameId);
        const payload: GameOverPayload = { winner: finalState.winner };
        io.to(gameId).emit('gameOver', payload);
    }

    // --- State Sending ---

    private async sendInitialGameState(playerId: string, gameState: GameState): Promise<void> {
        const io = this.ensureIoServer();
        const player = gameState.players[playerId];
        if (!player) return;

        const boardState = await this.getClientBoardStateForPlayer(gameState, player);

        const payload: GameStatePayload = {
            gameId: gameState.gameId,
            boardState: boardState,
            boardConfig: gameState.boardConfig,
            scoringConfig: gameState.scoringConfig,
            players: gameState.players,
            pendingReveals: gameState.pendingReveals,
            gameOver: gameState.gameOver,
            winner: gameState.winner,
            playerId: playerId,
        };
        emitToPlayer(io, playerId, 'gameState', payload);
    }

    private async sendBoardStateToPlayer(playerId: string, gameState: GameState): Promise<void> {
        const io = this.ensureIoServer();
        const player = gameState.players[playerId];
        if (!player) return;

        const boardState = await this.getClientBoardStateForPlayer(gameState, player);
        emitToPlayer(io, playerId, 'boardStateUpdate', { boardState });
    }

    private async getClientBoardStateForPlayer(
        gameState: GameState,
        player: Player
    ): Promise<ClientCell[][] | Map<string, ClientCell>> {
        if (!gameState.boardConfig.isInfiniteWorld || !player.viewport || !gameState.spatialGrid) {
            console.warn("getClientBoardStateForPlayer called for non-infinite or invalid state");
            return new Map<string, ClientCell>();
        }

        const { center, width, height } = player.viewport;
        const grid = gameState.spatialGrid;
        const clientState = new Map<string, ClientCell>();

        const halfWidth = Math.ceil(width / 2);
        const halfHeight = Math.ceil(height / 2);
        const bounds: Bounds = {
            minX: Math.floor(center.x - halfWidth),
            minY: Math.floor(center.y - halfHeight),
            maxX: Math.floor(center.x + halfWidth),
            maxY: Math.floor(center.y + halfHeight),
        };

        const pointsInView = grid.queryBounds(bounds);

        for (let y = bounds.minY; y < bounds.maxY; y++) {
            for (let x = bounds.minX; x < bounds.maxX; x++) {
                const cellKey = `${x},${y}`;
                const pointData = grid.get(x, y);

                if (pointData && (pointData.revealed || pointData.flagged)) {
                    const fullCell = await this.getCell(gameState, x, y);
                    if (fullCell) {
                        clientState.set(cellKey, this.convertToClientCell(fullCell));
                    }
                } else {
                    clientState.set(cellKey, {
                        revealed: false,
                        flagged: false,
                    });
                }
            }
        }

        return clientState;
    }

    private getCell: GetCellFunction = async (gameState: GameState, x: number, y: number): Promise<Cell | null> => {
        if (!gameState.boardConfig.isInfiniteWorld) {
            console.warn("Fixed board cell retrieval not implemented in getCell");
            return null;
        }

        const grid = gameState.spatialGrid;
        if (!grid) {
            console.error(`Spatial grid missing for infinite game ${gameState.gameId}`);
            return null;
        }

        const pointData = grid.get(x, y);

        const worldValue = getWorldCellValue(x, y);
        const isMine = worldValue === 'M';
        const adjacentMines = isMine ? 0 : worldValue;

        return {
            isMine: isMine,
            adjacentMines: adjacentMines,
            revealed: pointData?.revealed ?? false,
            flagged: pointData?.flagged ?? false,
        };
    };

    private async persistChunkContaining(gameId: string, grid: SpatialHashGrid<PointData>, x: number, y: number): Promise<void> {
        const chunkId = grid.getChunkIdForCoords(x, y);
        const chunkData = grid.getChunkData(chunkId);
        if (chunkData) {
            try {
                await this.gameRepository.saveChunk(gameId, chunkId, chunkData);
            } catch (error) {
                console.error(`Error persisting chunk ${chunkId} for game ${gameId}:`, error);
            }
        }
    }

    private convertToClientCell(cell: (Cell | PointData) & Partial<Coordinates>): ClientCell {
        const clientCell: ClientCell = {
            revealed: cell.revealed ?? false,
            flagged: cell.flagged ?? false,
        };

        if (clientCell.revealed) {
            if ('isMine' in cell && cell.isMine !== undefined) {
                clientCell.isMine = cell.isMine;
                if (!cell.isMine && 'adjacentMines' in cell && cell.adjacentMines !== undefined) {
                    clientCell.adjacentMines = cell.adjacentMines;
                }
            } else {
                console.warn(`convertToClientCell called with revealed cell missing mine/adjacent info at ${cell.x},${cell.y}. Fetching full cell state might be needed.`);
            }
        }
        return clientCell;
    }

    private applyPlayerStatusUpdate(gameState: GameState, update: PlayerStatusUpdatePayload): GameState {
        const player = gameState.players[update.playerId];
        if (!player) return gameState;
        return {
            ...gameState,
            players: {
                ...gameState.players,
                [player.id]: {
                    ...player,
                    status: update.status,
                    lockedUntil: update.lockedUntil,
                }
            }
        };
    }

    private applyScoreUpdate(gameState: GameState, update: ScoreUpdatePayload): GameState {
        const player = gameState.players[update.playerId];
        if (!player) return gameState;
        return {
            ...gameState,
            players: {
                ...gameState.players,
                [player.id]: { ...player, score: update.newScore }
            }
        };
    }

    private validateAction(io: Server, gameId: string, playerId: string, gameState: GameState | undefined): gameState is GameState {
        if (!gameState) {
            emitToPlayer(io, playerId, 'error', { message: `Game ${gameId} not found.` } as ErrorPayload);
            return false;
        }
        if (gameState.gameOver) {
            emitToPlayer(io, playerId, 'error', { message: `Game ${gameId} is already over.` } as ErrorPayload);
            return false;
        }
        if (!gameState.players[playerId]) {
            emitToPlayer(io, playerId, 'error', { message: `Player ${playerId} not found in game ${gameId}.` } as ErrorPayload);
            return false;
        }
        return true;
    }
}
