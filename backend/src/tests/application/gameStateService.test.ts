import { GameStateService } from '../../application/gameStateService';
import { GameConfig, PlayerStatus, Cell, GameState } from '../../domain/types';
import { WorldGenerator } from '../../domain/worldGenerator';
import { ChunkManager } from '../../domain/ChunkManager';
import { IChunkManager, CHUNK_SIZE } from '../../types/chunkTypes';
import { SpatialHashGrid } from '../../domain/spatialHashGrid';

jest.mock('../../infrastructure/persistence/db', () => ({
    getGameRepository: () => ({ createOrLoad: jest.fn().mockResolvedValue('12345') }),
    getChunkRepository: () => ({
        ensure: jest.fn().mockResolvedValue(undefined),
        getOrAddPlayerIndex: jest.fn().mockResolvedValue(0),
        revealCells: jest.fn().mockResolvedValue(undefined),
        setFlagged: jest.fn().mockResolvedValue(undefined),
        load: jest.fn().mockResolvedValue(null),
    }),
    getPendingFillsRepository: () => ({
        loadAll: jest.fn().mockResolvedValue(new Map()),
        save: jest.fn().mockResolvedValue(undefined),
        delete: jest.fn().mockResolvedValue(undefined),
    }),
}));

// Mock WorldGenerator and ChunkManager
jest.mock('../../domain/worldGenerator');
jest.mock('../../domain/ChunkManager', () => {
    const MockedChunkManager = jest.fn().mockImplementation(() => {
        return {
            initializeBoard: jest.fn(),
            getChunk: jest.fn(),
            loadChunk: jest.fn(),
            ensureChunksAroundPlayer: jest.fn(),
            getLoadedChunks: jest.fn().mockReturnValue([]),
            getChunkKey: jest.fn((x: number, y: number) => `${x},${y}`),
            pendingFills: new Map(),
            convertGlobalToChunkLocalCoordinates: jest.fn(),
            revealTile: jest.fn(),
            flagTile: jest.fn(),
            chordTile: jest.fn(),
        };
    });
    return { ChunkManager: MockedChunkManager };
});

const MockedWorldGenerator = WorldGenerator as jest.MockedClass<typeof WorldGenerator>;
const MockedChunkManager = ChunkManager as jest.MockedClass<typeof ChunkManager>;

describe('GameStateService', () => {
    let gameStateService: GameStateService;
    const gameId1 = 'game1';
    const gameId2 = 'game2';
    const mockGameConfig: GameConfig = {
        isInfiniteWorld: true,
        rows: 10, // Not strictly used for infinite, but good for consistency
        cols: 10,
        mines: 10, // Not strictly used for infinite
    };

    beforeEach(() => {
        gameStateService = new GameStateService();
        // Clear all mocks before each test
        MockedWorldGenerator.mockClear();
        MockedChunkManager.mockClear();
        // Mock the getCellValue for any WorldGenerator instance
        MockedWorldGenerator.prototype.getCellValue = jest.fn().mockImplementation((x, y) => {
            // Default mock behavior: no mines, all cells are 0
            return 0;
        });
        MockedWorldGenerator.prototype.isMine = jest.fn().mockReturnValue(false);
    });

    describe('Game Creation and Retrieval', () => {
        it('should create a new game with initial state', async () => {
            await gameStateService.createGame(gameId1, mockGameConfig);
            const game = gameStateService.getGame(gameId1);

            expect(game).toBeDefined();
            expect(game?.gameId).toBe(gameId1);
            expect(game?.boardConfig).toEqual(mockGameConfig);
            expect(game?.players).toEqual({});
            expect(game?.gameOver).toBe(false);
            expect(game?.spatialGrid).toBeInstanceOf(SpatialHashGrid);
            expect(MockedWorldGenerator).toHaveBeenCalledWith('12345');
            expect(MockedChunkManager).toHaveBeenCalledTimes(1);
        });

        it('should not create a duplicate game if one already exists', async () => {
            await gameStateService.createGame(gameId1, mockGameConfig);
            await gameStateService.createGame(gameId1, mockGameConfig);
            expect(MockedChunkManager).toHaveBeenCalledTimes(1);
        });

        it('should retrieve an existing game', async () => {
            await gameStateService.createGame(gameId1, mockGameConfig);
            const game = gameStateService.getGame(gameId1);
            expect(game).toBeDefined();
        });

        it('should return undefined for a non-existent game', () => {
            const game = gameStateService.getGame('nonExistentGame');
            expect(game).toBeUndefined();
        });

        it('should confirm a game exists', async () => {
            await gameStateService.createGame(gameId1, mockGameConfig);
            expect(gameStateService.gameExists(gameId1)).toBe(true);
            expect(gameStateService.gameExists('nonExistentGame')).toBe(false);
        });

        it('should get all game IDs', async () => {
            await gameStateService.createGame(gameId1, mockGameConfig);
            await gameStateService.createGame(gameId2, mockGameConfig);
            const ids = gameStateService.getAllGameIds();
            expect(ids).toContain(gameId1);
            expect(ids).toContain(gameId2);
            expect(ids.length).toBe(2);
        });

        it('should remove a game and its associated instances', async () => {
            await gameStateService.createGame(gameId1, mockGameConfig);
            expect(gameStateService.getChunkManager(gameId1)).toBeDefined();

            gameStateService.removeGame(gameId1);
            expect(gameStateService.getGame(gameId1)).toBeUndefined();
            expect(() => gameStateService.getChunkManager(gameId1)).toThrow();
        });
    });

    describe('Cell State Management (getCell, updateGridCells, updateGridCell)', () => {
        beforeEach(async () => {
            await gameStateService.createGame(gameId1, mockGameConfig);
        });

        it('getCell should return correct cell state (non-mine)', async () => {
            const worldGen = gameStateService['worldGenerators'].get(gameId1)!;
            (worldGen.getCellValue as jest.Mock).mockReturnValue(3);

            const game = gameStateService.getGame(gameId1)!;
            const cell = await gameStateService.getCell(game, 5, 5);

            expect(cell).toEqual({
                x: 5,
                y: 5,
                isMine: false,
                adjacentMines: 3,
                revealed: false,
                flagged: false,
            });
            expect(worldGen.getCellValue).toHaveBeenCalledWith(5, 5);
        });

        it('getCell should return correct cell state (mine)', async () => {
            const worldGen = gameStateService['worldGenerators'].get(gameId1)!;
            (worldGen.getCellValue as jest.Mock).mockReturnValue('M');

            const game = gameStateService.getGame(gameId1)!;
            const cell = await gameStateService.getCell(game, 7, 7);

            expect(cell).toEqual({
                x: 7,
                y: 7,
                isMine: true,
                adjacentMines: 0,
                revealed: false,
                flagged: false,
            });
            expect(worldGen.getCellValue).toHaveBeenCalledWith(7, 7);
        });

        it('getCell should reflect revealed state from spatialGrid', async () => {
            MockedWorldGenerator.prototype.getCellValue = jest.fn().mockReturnValue(1);
            const game = gameStateService.getGame(gameId1)!;
            game.spatialGrid!.set(2, 2, { revealed: true });

            const cell = await gameStateService.getCell(game, 2, 2);
            expect(cell?.revealed).toBe(true);
        });

        it('getCell should reflect flagged state from spatialGrid', async () => {
            MockedWorldGenerator.prototype.getCellValue = jest.fn().mockReturnValue(1);
            const game = gameStateService.getGame(gameId1)!;
            game.spatialGrid!.set(3, 3, { flagged: true });

            const cell = await gameStateService.getCell(game, 3, 3);
            expect(cell?.flagged).toBe(true);
        });

        it('updateGridCell should update a single cell in spatialGrid', () => {
            const game = gameStateService.getGame(gameId1)!;
            const cellToUpdate: Cell = { x: 1, y: 1, isMine: false, adjacentMines: 0, revealed: true, flagged: false };
            gameStateService.updateGridCell(gameId1, cellToUpdate);

            const pointData = game.spatialGrid!.get(1, 1);
            expect(pointData).toEqual({ revealed: true, flagged: false });
        });

        it('updateGridCells should update multiple cells in spatialGrid', () => {
            const game = gameStateService.getGame(gameId1)!;
            const cellsToUpdate: Cell[] = [
                { x: 1, y: 1, isMine: false, adjacentMines: 0, revealed: true, flagged: false },
                { x: 2, y: 2, isMine: false, adjacentMines: 0, revealed: false, flagged: true },
            ];
            gameStateService.updateGridCells(gameId1, cellsToUpdate);

            expect(game.spatialGrid!.get(1, 1)).toEqual({ revealed: true, flagged: false });
            expect(game.spatialGrid!.get(2, 2)).toEqual({ revealed: false, flagged: true });
        });

        it('updateGridCells should remove cell from spatialGrid if not revealed or flagged', () => {
            const game = gameStateService.getGame(gameId1)!;
            gameStateService.updateGridCell(gameId1, { x: 1, y: 1, isMine: false, adjacentMines: 0, revealed: true, flagged: false });
            expect(game.spatialGrid!.get(1, 1)).toBeDefined();

            gameStateService.updateGridCell(gameId1, { x: 1, y: 1, isMine: false, adjacentMines: 0, revealed: false, flagged: false });
            expect(game.spatialGrid!.get(1, 1)).toBeUndefined();
        });

        it('should correctly update cell revealed and flagged status via updateGridCell', async () => {
            const gameId = 'testGameUpdateCell';
            const boardConfig: GameConfig = { isInfiniteWorld: true, rows: 5, cols: 5, mines: 1 };
            await gameStateService.createGame(gameId, boardConfig);
            const game = gameStateService.getGame(gameId)!;

            const cellToUpdate: Cell = { x: 1, y: 1, isMine: false, adjacentMines: 0, revealed: true, flagged: false };
            gameStateService.updateGridCell(gameId, cellToUpdate);

            expect(game.spatialGrid!.get(1, 1)).toEqual({ revealed: true, flagged: false });
        });

        it('should correctly update multiple cells via updateGridCells', async () => {
            const gameId = 'testGameUpdateCells';
            const boardConfig: GameConfig = { isInfiniteWorld: true, rows: 5, cols: 5, mines: 1 };
            await gameStateService.createGame(gameId, boardConfig);
            const game = gameStateService.getGame(gameId)!;

            const cellsToUpdate: Cell[] = [
                { x: 1, y: 1, isMine: false, adjacentMines: 0, revealed: true, flagged: false },
                { x: 2, y: 2, isMine: false, adjacentMines: 0, revealed: false, flagged: true },
            ];
            gameStateService.updateGridCells(gameId, cellsToUpdate);

            expect(game.spatialGrid!.get(1, 1)).toEqual({ revealed: true, flagged: false });
            expect(game.spatialGrid!.get(2, 2)).toEqual({ revealed: false, flagged: true });
        });

        it('should remove a game and its associated WorldGenerator and ChunkManager', async () => {
            const gameId = 'gameToRemove';
            await gameStateService.createGame(gameId, { isInfiniteWorld: true, rows: 10, cols: 10, mines: 10 });
            expect(gameStateService.gameExists(gameId)).toBe(true);
            expect(gameStateService.getChunkManager(gameId)).toBeDefined();
            expect(gameStateService['worldGenerators'].get(gameId)).toBeDefined();

            gameStateService.removeGame(gameId);
            expect(gameStateService.gameExists(gameId)).toBe(false);
            expect(gameStateService['worldGenerators'].has(gameId)).toBe(false);
            expect(gameStateService['chunkManagers'].has(gameId)).toBe(false);
        });
    });

    describe('Player Management', () => {
        const playerId1 = 'player1';
        const username1 = 'UserOne';

        beforeEach(async () => {
            await gameStateService.createGame(gameId1, mockGameConfig);
        });

        it('should add a player to a game', () => {
            gameStateService.addPlayer(gameId1, playerId1, username1);
            const game = gameStateService.getGame(gameId1)!;
            const player = game.players[playerId1];

            expect(player).toBeDefined();
            expect(player.id).toBe(playerId1);
            expect(player.username).toBe(username1);
            expect(player.score).toBe(0);
            expect(player.status).toBe(PlayerStatus.ACTIVE);
        });

        it('should not add a player if they already exist', () => {
            gameStateService.addPlayer(gameId1, playerId1, username1);
            const gameBefore = { ...gameStateService.getGame(gameId1)! };
            gameStateService.addPlayer(gameId1, playerId1, 'AnotherName');
            const gameAfter = gameStateService.getGame(gameId1)!;
            expect(gameAfter.players[playerId1]).toEqual(gameBefore.players[playerId1]);
        });

        it('should throw error when adding player to non-existent game', () => {
            expect(() => gameStateService.addPlayer('nonExistentGame', playerId1, username1)).toThrow(
                'Game nonExistentGame not found.'
            );
        });

        it('should set a player status', () => {
            gameStateService.addPlayer(gameId1, playerId1, username1);
            gameStateService.setPlayerStatus(gameId1, playerId1, PlayerStatus.LOCKED_OUT);
            const game = gameStateService.getGame(gameId1)!;
            expect(game.players[playerId1].status).toBe(PlayerStatus.LOCKED_OUT);
        });

        it('should throw error when setting status for player in non-existent game', () => {
            expect(() => gameStateService.setPlayerStatus('nonExistentGame', playerId1, PlayerStatus.LOCKED_OUT)).toThrow(
                'Game nonExistentGame not found.'
            );
        });

        it('should throw error when setting status for non-existent player', () => {
            expect(() => gameStateService.setPlayerStatus(gameId1, 'nonExistentPlayer', PlayerStatus.LOCKED_OUT)).toThrow(
                `Player nonExistentPlayer not found in game ${gameId1}.`
            );
        });
    });

});

