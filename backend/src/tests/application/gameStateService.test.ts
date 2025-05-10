import { GameStateService } from '../../application/gameStateService';
import { GameConfig, PlayerStatus, Cell } from '../../domain/types';
import { WorldGenerator } from '../../domain/worldGenerator';
import { BoardManager } from '../../domain/BoardManager';
import { IBoardManager, CHUNK_SIZE } from '../../types/chunkTypes';
import { SpatialHashGrid } from '../../domain/spatialHashGrid';

// Mock WorldGenerator and BoardManager
jest.mock('../../domain/worldGenerator'); // Corrected path
jest.mock('../../domain/BoardManager', () => {
    const MockedBoardManager = jest.fn().mockImplementation((gameId, boardConfig, gameStateService, eventBus, worldGenerator) => {
        return {
            gameId: gameId,
            boardConfig: boardConfig,
            gameStateService: gameStateService,
            eventBus: eventBus,
            worldGenerator: worldGenerator,
            initializeBoard: jest.fn(),
            getChunk: jest.fn(),
            loadChunk: jest.fn(),
            ensureChunksAroundPlayer: jest.fn(),
            getLoadedChunks: jest.fn().mockReturnValue([]),
            getChunkKey: jest.fn((x, y) => `${x},${y}`),
            spatialGrid: { 
                getCellsInBounds: jest.fn().mockReturnValue([]),
                set: jest.fn(),
                get: jest.fn(),
                delete: jest.fn(),
                clear: jest.fn()
            },
            convertGlobalToChunkLocalCoordinates: jest.fn(),
            revealTile: jest.fn(), 
            flagTile: jest.fn(),
            chordTile: jest.fn(),
        };
    });
    return { BoardManager: MockedBoardManager };
});

const MockedWorldGenerator = WorldGenerator as jest.MockedClass<typeof WorldGenerator>;
const MockedBoardManager = BoardManager as jest.MockedClass<typeof BoardManager>;

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
        MockedBoardManager.mockClear();
        // Mock the getCellValue for any WorldGenerator instance
        MockedWorldGenerator.prototype.getCellValue = jest.fn().mockImplementation((x, y) => {
            // Default mock behavior: no mines, all cells are 0
            return 0;
        });
        MockedWorldGenerator.prototype.isMine = jest.fn().mockReturnValue(false);
    });

    describe('Game Creation and Retrieval', () => {
        it('should create a new game with initial state', () => {
            gameStateService.createGame(gameId1, mockGameConfig);
            const game = gameStateService.getGame(gameId1);

            expect(game).toBeDefined();
            expect(game?.gameId).toBe(gameId1);
            expect(game?.boardConfig).toEqual(mockGameConfig);
            expect(game?.players).toEqual({});
            expect(game?.gameOver).toBe(false);
            expect(game?.spatialGrid).toBeInstanceOf(SpatialHashGrid);
            expect(MockedWorldGenerator).toHaveBeenCalledWith(gameId1);
            expect(MockedBoardManager).toHaveBeenCalledTimes(1);
        });

        it('should throw an error if creating a game that already exists', () => {
            gameStateService.createGame(gameId1, mockGameConfig);
            expect(() => gameStateService.createGame(gameId1, mockGameConfig)).toThrow(
                `Game with ID ${gameId1} already exists.`
            );
        });

        it('should retrieve an existing game', () => {
            gameStateService.createGame(gameId1, mockGameConfig);
            const game = gameStateService.getGame(gameId1);
            expect(game).toBeDefined();
        });

        it('should return undefined for a non-existent game', () => {
            const game = gameStateService.getGame('nonExistentGame');
            expect(game).toBeUndefined();
        });

        it('should confirm a game exists', () => {
            gameStateService.createGame(gameId1, mockGameConfig);
            expect(gameStateService.gameExists(gameId1)).toBe(true);
            expect(gameStateService.gameExists('nonExistentGame')).toBe(false);
        });

        it('should get all game IDs', () => {
            gameStateService.createGame(gameId1, mockGameConfig);
            gameStateService.createGame(gameId2, mockGameConfig);
            const ids = gameStateService.getAllGameIds();
            expect(ids).toContain(gameId1);
            expect(ids).toContain(gameId2);
            expect(ids.length).toBe(2);
        });

        it('should remove a game and its associated instances', () => {
            gameStateService.createGame(gameId1, mockGameConfig);
            gameStateService.getBoardManager(gameId1);

            gameStateService.removeGame(gameId1);
            expect(gameStateService.getGame(gameId1)).toBeUndefined();
            expect(MockedWorldGenerator).toHaveBeenCalledTimes(1);
            expect(MockedBoardManager).toHaveBeenCalledTimes(1);

            const newBm = gameStateService.getBoardManager(gameId1);
            expect(newBm).toBeDefined();
            expect(MockedWorldGenerator).toHaveBeenCalledTimes(2);
            expect(MockedBoardManager).toHaveBeenCalledTimes(2);
        });
    });

    describe('BoardManager and WorldGenerator Management', () => {
        it('should return an existing BoardManager or create a new one', () => {
            const bm1 = gameStateService.getBoardManager(gameId1);
            expect(bm1).toBeDefined();
            expect(MockedWorldGenerator).toHaveBeenCalledWith(gameId1);
            expect(MockedBoardManager).toHaveBeenCalledTimes(1);
            expect(MockedBoardManager).toHaveBeenCalledWith(
                mockGameConfig,
                expect.any(Function),
                gameId1
            );

            const bm2 = gameStateService.getBoardManager(gameId1);
            expect(bm2).toBe(bm1);
            expect(MockedWorldGenerator).toHaveBeenCalledTimes(1);
            expect(MockedBoardManager).toHaveBeenCalledTimes(1);
        });

        it('should create different BoardManager instances for different game IDs', () => {
            const bm1 = gameStateService.getBoardManager(gameId1);
            const bm2 = gameStateService.getBoardManager(gameId2);

            expect(bm1).not.toBe(bm2);
            expect(MockedWorldGenerator).toHaveBeenCalledWith(gameId1);
            expect(MockedWorldGenerator).toHaveBeenCalledWith(gameId2);
            expect(MockedWorldGenerator).toHaveBeenCalledTimes(2);
            expect(MockedBoardManager).toHaveBeenCalledTimes(2);
        });

        it('cellGenerator passed to BoardManager should use the correct WorldGenerator', () => {
            const mockCellValueGame1 = jest.fn().mockReturnValue(1);
            const mockCellValueGame2 = jest.fn().mockReturnValue(2);

            MockedWorldGenerator
                .mockImplementationOnce(function(this: WorldGenerator, seed: string) {
                    this.getCellValue = mockCellValueGame1;
                    this.isMine = jest.fn().mockReturnValue(false);
                    return this;
                } as any)
                .mockImplementationOnce(function(this: WorldGenerator, seed: string) {
                    this.getCellValue = mockCellValueGame2;
                    this.isMine = jest.fn().mockReturnValue(false);
                    return this;
                } as any);

            // Clear mocks specifically for this test to ensure call count is predictable
            MockedBoardManager.mockClear();

            const bm1 = gameStateService.getBoardManager(gameId1);
            // First call to BoardManager constructor is at index 0
            const cellGenerator1 = MockedBoardManager.mock.calls[0] && MockedBoardManager.mock.calls[0][1];
            if (cellGenerator1) {
                const cell1 = cellGenerator1(10, 20);
                expect(mockCellValueGame1).toHaveBeenCalledWith(10, 20);
                expect(cell1.adjacentMines).toBe(1);
            } else {
                throw new Error("cellGenerator1 was not found");
            }

            const bm2 = gameStateService.getBoardManager(gameId2);
            // Second call to BoardManager constructor is at index 1
            const cellGenerator2 = MockedBoardManager.mock.calls[1] && MockedBoardManager.mock.calls[1][1];
            if (cellGenerator2) {
                const cell2 = cellGenerator2(30, 40);
                expect(mockCellValueGame2).toHaveBeenCalledWith(30, 40);
                expect(cell2.adjacentMines).toBe(2);
            } else {
                throw new Error("cellGenerator2 was not found");
            }
        });
    });

    describe('Cell State Management (getCell, updateGridCells, updateGridCell)', () => {
        beforeEach(() => {
            gameStateService.createGame(gameId1, mockGameConfig);
        });

        it('getCell should return correct cell state (non-mine)', async () => {
            MockedWorldGenerator.prototype.getCellValue = jest.fn().mockReturnValue(3);
            MockedWorldGenerator.prototype.isMine = jest.fn().mockReturnValue(false);

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
            expect(MockedWorldGenerator.prototype.getCellValue).toHaveBeenCalledWith(5, 5);
        });

        it('getCell should return correct cell state (mine)', async () => {
            MockedWorldGenerator.prototype.getCellValue = jest.fn().mockReturnValue('M');
            MockedWorldGenerator.prototype.isMine = jest.fn().mockReturnValue(true);

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
            expect(MockedWorldGenerator.prototype.getCellValue).toHaveBeenCalledWith(7, 7);
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

        it('should correctly update cell revealed and flagged status via updateGridCell', () => {
            const gameId = 'testGameUpdateCell';
            const boardConfig: GameConfig = { isInfiniteWorld: true, rows: 5, cols: 5, mines: 1 };
            gameStateService.createGame(gameId, boardConfig);
            const boardManager = gameStateService.getBoardManager(gameId) as BoardManager; // Changed cast

            const cellToUpdate: Cell = { x: 1, y: 1, isMine: false, adjacentMines: 0, revealed: true, flagged: false };
            gameStateService.updateGridCell(gameId, cellToUpdate);

            expect((boardManager as any).spatialGrid.get(1, 1)).toEqual({ revealed: true, flagged: false });
        });

        it('should correctly update multiple cells via updateGridCells', () => {
            const gameId = 'testGameUpdateCells';
            const boardConfig: GameConfig = { isInfiniteWorld: true, rows: 5, cols: 5, mines: 1 };
            gameStateService.createGame(gameId, boardConfig);
            const boardManager = gameStateService.getBoardManager(gameId) as BoardManager; // Changed cast

            const cellsToUpdate: Cell[] = [
                { x: 1, y: 1, isMine: false, adjacentMines: 0, revealed: true, flagged: false },
                { x: 2, y: 2, isMine: false, adjacentMines: 0, revealed: false, flagged: true },
            ];
            gameStateService.updateGridCells(gameId, cellsToUpdate);

            expect((boardManager as any).spatialGrid.get(1, 1)).toEqual({ revealed: true, flagged: false });
            expect((boardManager as any).spatialGrid.get(2, 2)).toEqual({ revealed: false, flagged: true });
        });

        it('should remove a game and its associated WorldGenerator and BoardManager', () => {
            const gameId = 'gameToRemove';
            gameStateService.createGame(gameId, { isInfiniteWorld: true, rows: 10, cols: 10, mines: 10 });
            expect(gameStateService.gameExists(gameId)).toBe(true);
            const bm = gameStateService.getBoardManager(gameId);
            expect(bm).toBeDefined();
            const wg = gameStateService['worldGenerators'].get(gameId);
            expect(wg).toBeDefined();

            gameStateService.removeGame(gameId);
            expect(gameStateService.gameExists(gameId)).toBe(false);
            expect(gameStateService['worldGenerators'].has(gameId)).toBe(false);
            expect(gameStateService['boardManagers'].has(gameId)).toBe(false);

            const newBmAttempt = gameStateService.getBoardManager(gameId);
            expect(newBmAttempt).toBeDefined();
            expect(newBmAttempt).not.toBe(bm);
            const newWgAttempt = gameStateService['worldGenerators'].get(gameId);
            expect(newWgAttempt).toBeDefined();
        });
    });

    describe('Player Management', () => {
        const playerId1 = 'player1';
        const username1 = 'UserOne';

        beforeEach(() => {
            gameStateService.createGame(gameId1, mockGameConfig);
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

    describe('getCellsInChunk', () => {
        it('should return cells from the spatial grid for the given chunk coordinates', () => {
            const gameId = 'game1';
            const chunkX = 0;
            const chunkY = 0;
            const mockCells: Cell[] = [{ x: 0, y: 0, isMine: false, revealed: false, adjacentMines: 0, flagged: false }];
            
            const mockGameState = {
                boardConfig: { isInfiniteWorld: true, CHUNK_SIZE },
            } as unknown as GameState; // Cast for simplicity in test
            (gameStateService.getGame as jest.Mock).mockReturnValue(mockGameState);

            const mockBoardConfig = { CHUNK_SIZE: 16, isInfiniteWorld: true };
            const mockBMInstance = {
                boardConfig: mockBoardConfig,
                spatialGrid: { 
                    getCellsInBounds: jest.fn().mockReturnValue(mockCells)
                }
            };
            (gameStateService.getBoardManager as jest.Mock).mockReturnValue(mockBMInstance);

            const result = gameStateService.getCellsInChunk(gameId, chunkX, chunkY);

            expect(gameStateService.getBoardManager).toHaveBeenCalledWith(gameId);
            const expectedBounds = {
                minX: chunkX * CHUNK_SIZE,
                minY: chunkY * CHUNK_SIZE,
                maxX: (chunkX + 1) * CHUNK_SIZE - 1,
                maxY: (chunkY + 1) * CHUNK_SIZE - 1,
            };
            expect(mockBMInstance.spatialGrid.getCellsInBounds).toHaveBeenCalledWith(expectedBounds);
            expect(result).toEqual(mockCells);
        });

        it('should return an empty array if BoardManager is not found', () => {
            const gameId = 'game1';
            const chunkX = 0;
            const chunkY = 0;
            (gameStateService.getBoardManager as jest.Mock).mockReturnValue(null);

            const result = gameStateService.getCellsInChunk(gameId, chunkX, chunkY);
            expect(result).toEqual([]);
        });

        it('should return an empty array if spatialGrid is not on BoardManager', () => {
            const gameId = 'game1';
            const chunkX = 0;
            const chunkY = 0;
            const mockBMInstance = {
                boardConfig: { CHUNK_SIZE: 16, isInfiniteWorld: true },
            };
            (gameStateService.getBoardManager as jest.Mock).mockReturnValue(mockBMInstance);
        
            const result = gameStateService.getCellsInChunk(gameId, chunkX, chunkY);
            expect(result).toEqual([]);
        });
    });
});
