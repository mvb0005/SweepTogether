import { GameStateService } from '../../../application/gameStateService';
import { WorldGenerator } from '../../../domain/worldGenerator';
import { GameState, GameConfig, Cell, PointData, PlayerStatus } from '../../../domain/types';
import { SpatialHashGrid } from '../../../domain/spatialHashGrid';

// Mock WorldGenerator to prevent actual noise generation and control its methods
jest.mock('../../../domain/worldGenerator');

const MockWorldGenerator = WorldGenerator as jest.MockedClass<typeof WorldGenerator>;

const SPATIAL_GRID_CELL_SIZE = 16; // Should match the constant in gameStateService.ts

describe('GameStateService', () => {
    let gameStateService: GameStateService;
    let mockWorldGeneratorInstance: jest.Mocked<WorldGenerator>;

    const GAME_ID_1 = 'game1';
    const GAME_ID_2 = 'game2';
    const PLAYER_ID_1 = 'player1';
    const USERNAME_1 = 'UserOne';

    const initialGameConfig: GameConfig = {
        isInfiniteWorld: true,
        rows: 0, // Not used for infinite
        cols: 0, // Not used for infinite
        mines: 0, // Not used for infinite
    };

    beforeEach(() => {
        MockWorldGenerator.mockClear();
        gameStateService = new GameStateService();
        mockWorldGeneratorInstance = {
            isMine: jest.fn(),
            getCellValue: jest.fn(),
            constructor: jest.fn(), 
        } as unknown as jest.Mocked<WorldGenerator>; 
        MockWorldGenerator.mockImplementation(() => mockWorldGeneratorInstance);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('constructor', () => {
        it('should initialize with an empty games map', () => {
            // @ts-expect-error private property
            expect(gameStateService.games.size).toBe(0);
            // @ts-expect-error private property
            expect(gameStateService.worldGenerators.size).toBe(0);
        });
    });

    describe('getGame / setGame', () => {
        it('should return undefined for a non-existent game', () => {
            expect(gameStateService.getGame('nonExistentId')).toBeUndefined();
        });

        it('should set and get a game state', () => {
            const gameState: GameState = {
                gameId: GAME_ID_1,
                boardConfig: initialGameConfig,
                players: {},
                gameOver: false,
                mineReveals: [],
                pendingReveals: [],
                scoringConfig: {} as any, 
            };
            gameStateService.setGame(GAME_ID_1, gameState);
            const retrievedGame = gameStateService.getGame(GAME_ID_1);
            expect(retrievedGame).toEqual(gameState);
            expect(retrievedGame?.spatialGrid).toBeInstanceOf(SpatialHashGrid);
        });

        it('should initialize spatialGrid for new infinite games', () => {
            const gameState: GameState = {
                gameId: GAME_ID_1,
                boardConfig: { ...initialGameConfig, isInfiniteWorld: true }, 
                players: {},
                gameOver: false,
                mineReveals: [],
                pendingReveals: [],
                scoringConfig: {} as any,
            };
            gameStateService.setGame(GAME_ID_1, gameState);
            const retrievedGame = gameStateService.getGame(GAME_ID_1);
            expect(retrievedGame?.spatialGrid).toBeInstanceOf(SpatialHashGrid);
            // @ts-expect-error private property
            expect(retrievedGame?.spatialGrid.cellSize).toBe(SPATIAL_GRID_CELL_SIZE);
        });

        it('should ensure boardConfig exists and is marked as infinite', () => {
            const gameState: Partial<GameState> = { 
                gameId: GAME_ID_1,
                players: {},
            };
            gameStateService.setGame(GAME_ID_1, gameState as GameState); 
            const retrievedGame = gameStateService.getGame(GAME_ID_1);
            expect(retrievedGame?.boardConfig).toBeDefined();
            expect(retrievedGame?.boardConfig.isInfiniteWorld).toBe(true);
        });
    });

    describe('removeGame', () => {
        it('should remove a game and its world generator', () => {
            const gameState: GameState = { gameId: GAME_ID_1, boardConfig: initialGameConfig, players: {}, gameOver: false, mineReveals: [], pendingReveals: [], scoringConfig: {} as any }; 
            gameStateService.setGame(GAME_ID_1, gameState);
            gameStateService.getCell(gameState, 0, 0);

            // @ts-expect-error private property
            expect(gameStateService.games.has(GAME_ID_1)).toBe(true);
            // @ts-expect-error private property
            expect(gameStateService.worldGenerators.has(GAME_ID_1)).toBe(true);

            gameStateService.removeGame(GAME_ID_1);

            // @ts-expect-error private property
            expect(gameStateService.games.has(GAME_ID_1)).toBe(false);
            // @ts-expect-error private property
            expect(gameStateService.worldGenerators.has(GAME_ID_1)).toBe(false);
        });
    });

    describe('getAllGameIds', () => {
        it('should return an empty array if no games', () => {
            expect(gameStateService.getAllGameIds()).toEqual([]);
        });

        it('should return all game IDs', () => {
            gameStateService.setGame(GAME_ID_1, { gameId: GAME_ID_1, boardConfig: initialGameConfig, players: {}, gameOver: false, mineReveals: [], pendingReveals: [], scoringConfig: {} as any });
            gameStateService.setGame(GAME_ID_2, { gameId: GAME_ID_2, boardConfig: initialGameConfig, players: {}, gameOver: false, mineReveals: [], pendingReveals: [], scoringConfig: {} as any });
            expect(gameStateService.getAllGameIds()).toEqual([GAME_ID_1, GAME_ID_2]);
        });
    });

    describe('getWorldGenerator (private method, tested via getCell)', () => {
        it('should create a new WorldGenerator if one does not exist for the gameId', () => {
            const gameState: GameState = { gameId: GAME_ID_1, boardConfig: initialGameConfig, players: {}, gameOver: false, mineReveals: [], pendingReveals: [], scoringConfig: {} as any }; 
            gameStateService.setGame(GAME_ID_1, gameState);

            gameStateService.getCell(gameState, 0, 0); 

            expect(MockWorldGenerator).toHaveBeenCalledTimes(1);
            expect(MockWorldGenerator).toHaveBeenCalledWith(GAME_ID_1);
            // @ts-expect-error private property
            expect(gameStateService.worldGenerators.get(GAME_ID_1)).toBe(mockWorldGeneratorInstance);
        });

        it('should reuse an existing WorldGenerator for the same gameId', () => {
            const gameState: GameState = { gameId: GAME_ID_1, boardConfig: initialGameConfig, players: {}, gameOver: false, mineReveals: [], pendingReveals: [], scoringConfig: {} as any }; 
            gameStateService.setGame(GAME_ID_1, gameState);

            gameStateService.getCell(gameState, 0, 0); 
            gameStateService.getCell(gameState, 1, 1); 

            expect(MockWorldGenerator).toHaveBeenCalledTimes(1); 
        });
    });

    describe('getCell', () => {
        let testGameState: GameState;

        beforeEach(() => {
            testGameState = {
                gameId: GAME_ID_1,
                boardConfig: { ...initialGameConfig, isInfiniteWorld: true },
                players: {},
                gameOver: false,
                mineReveals: [],
                pendingReveals: [],
                scoringConfig: {} as any,
                spatialGrid: new SpatialHashGrid<PointData>(SPATIAL_GRID_CELL_SIZE),
            };
            gameStateService.setGame(GAME_ID_1, testGameState);
            // @ts-expect-error private property
            gameStateService.worldGenerators.set(GAME_ID_1, mockWorldGeneratorInstance);
        });

        it('should return null for non-infinite game (though current setGame forces infinite)', async () => {
            const finiteGameState = { ...testGameState, boardConfig: { ...testGameState.boardConfig, isInfiniteWorld: false } };
            // @ts-expect-error private property
            gameStateService.games.set(GAME_ID_1, finiteGameState); 
            const cell = await gameStateService.getCell(finiteGameState, 0, 0);
            expect(cell).toBeNull();
        });

        it('should return null if spatialGrid is missing (though current setGame ensures it)', async () => {
            const noGridState = { ...testGameState, spatialGrid: undefined };
            // @ts-expect-error private property
            gameStateService.games.set(GAME_ID_1, noGridState as GameState); 
            const cell = await gameStateService.getCell(noGridState as GameState, 0, 0);
            expect(cell).toBeNull();
        });

        it('should use WorldGenerator.getCellValue to determine mine and adjacentMines', async () => {
            mockWorldGeneratorInstance.getCellValue.mockReturnValue(3); 

            await gameStateService.getCell(testGameState, 1, 1);

            expect(mockWorldGeneratorInstance.getCellValue).toHaveBeenCalledWith(1, 1);
        });

        it('should correctly construct a Cell object with data from generator and spatial grid', async () => {
            mockWorldGeneratorInstance.getCellValue.mockReturnValue('M'); 
            testGameState.spatialGrid?.set(2, 2, { revealed: true, flagged: false });

            const cell = await gameStateService.getCell(testGameState, 2, 2);

            expect(cell).toEqual<Cell>({
                x: 2,
                y: 2,
                isMine: true,
                adjacentMines: 0, 
                revealed: true,
                flagged: false,
            });
        });

        it('should default revealed and flagged to false if not in spatial grid', async () => {
            mockWorldGeneratorInstance.getCellValue.mockReturnValue(1); 

            const cell = await gameStateService.getCell(testGameState, 3, 3); 

            expect(cell).toEqual<Cell>({
                x: 3,
                y: 3,
                isMine: false,
                adjacentMines: 1,
                revealed: false,
                flagged: false,
            });
        });
    });

    describe('updateGridCells / updateGridCell', () => {
        let testGameState: GameState;

        beforeEach(() => {
            testGameState = {
                gameId: GAME_ID_1,
                boardConfig: initialGameConfig,
                players: {},
                gameOver: false,
                mineReveals: [],
                pendingReveals: [],
                scoringConfig: {} as any,
                spatialGrid: new SpatialHashGrid<PointData>(SPATIAL_GRID_CELL_SIZE),
            };
            gameStateService.setGame(GAME_ID_1, testGameState);
        });

        it('should not update if game or spatialGrid is not found', () => {
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            gameStateService.updateGridCells('nonExistentGame', [{ x: 0, y: 0, revealed: true, flagged: false, isMine: false, adjacentMines: 0 }]);
            expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Cannot update grid cells: Game nonExistentGame not found'));

            // @ts-expect-error private property
            gameStateService.games.set(GAME_ID_1, { ...testGameState, spatialGrid: undefined } as GameState); 
            gameStateService.updateGridCells(GAME_ID_1, [{ x: 0, y: 0, revealed: true, flagged: false, isMine: false, adjacentMines: 0 }]);
            expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining(`Game ${GAME_ID_1} not found or has no spatial grid`)); 
            consoleErrorSpy.mockRestore();
        });

        it('should update cells in the spatialGrid', () => {
            const cellsToUpdate: Cell[] = [
                { x: 0, y: 0, revealed: true, flagged: false, isMine: false, adjacentMines: 0 },
                { x: 1, y: 1, revealed: false, flagged: true, isMine: false, adjacentMines: 0 },
            ];
            gameStateService.updateGridCells(GAME_ID_1, cellsToUpdate);

            const data00 = testGameState.spatialGrid?.get(0, 0);
            const data11 = testGameState.spatialGrid?.get(1, 1);

            expect(data00).toEqual({ revealed: true, flagged: false });
            expect(data11).toEqual({ revealed: false, flagged: true });
        });

        it('should remove cell from grid if updated to default hidden state (neither revealed nor flagged)', () => {
            testGameState.spatialGrid?.set(0, 0, { revealed: true, flagged: false }); 
            const cellsToUpdate: Cell[] = [
                { x: 0, y: 0, revealed: false, flagged: false, isMine: false, adjacentMines: 0 },
            ];
            gameStateService.updateGridCells(GAME_ID_1, cellsToUpdate);
            expect(testGameState.spatialGrid?.get(0, 0)).toBeUndefined();
        });

        it('updateGridCell should call updateGridCells with a single cell', () => {
            const updateGridCellsSpy = jest.spyOn(gameStateService, 'updateGridCells');
            const cellToUpdate: Cell = { x: 0, y: 0, revealed: true, flagged: false, isMine: false, adjacentMines: 0 };
            gameStateService.updateGridCell(GAME_ID_1, cellToUpdate);
            expect(updateGridCellsSpy).toHaveBeenCalledWith(GAME_ID_1, [cellToUpdate]);
            updateGridCellsSpy.mockRestore();
        });
    });

    describe('createGame', () => {
        it('should create a new game with the given config and ID', () => {
            gameStateService.createGame(GAME_ID_1, initialGameConfig);
            const game = gameStateService.getGame(GAME_ID_1);
            expect(game).toBeDefined();
            expect(game?.gameId).toBe(GAME_ID_1);
            expect(game?.boardConfig).toEqual(initialGameConfig);
            expect(game?.players).toEqual({});
            expect(game?.gameOver).toBe(false);
            expect(game?.spatialGrid).toBeInstanceOf(SpatialHashGrid);
        });

        it('should throw an error if a game with the ID already exists', () => {
            gameStateService.createGame(GAME_ID_1, initialGameConfig);
            expect(() => gameStateService.createGame(GAME_ID_1, initialGameConfig)).toThrow(
                `Game with ID ${GAME_ID_1} already exists.`
            );
        });
    });

    describe('addPlayer', () => {
        beforeEach(() => {
            gameStateService.createGame(GAME_ID_1, initialGameConfig);
        });

        it('should add a player to the game', () => {
            gameStateService.addPlayer(GAME_ID_1, PLAYER_ID_1, USERNAME_1);
            const game = gameStateService.getGame(GAME_ID_1);
            expect(game?.players[PLAYER_ID_1]).toBeDefined();
            expect(game?.players[PLAYER_ID_1]?.id).toBe(PLAYER_ID_1);
            expect(game?.players[PLAYER_ID_1]?.username).toBe(USERNAME_1);
            expect(game?.players[PLAYER_ID_1]?.score).toBe(0);
            expect(game?.players[PLAYER_ID_1]?.status).toBe(PlayerStatus.ACTIVE);
        });

        it('should throw an error if game not found', () => {
            expect(() => gameStateService.addPlayer('nonExistentGame', PLAYER_ID_1, USERNAME_1)).toThrow(
                `Game nonExistentGame not found.`
            );
        });

        it('should not add a player if already added', () => {
            gameStateService.addPlayer(GAME_ID_1, PLAYER_ID_1, USERNAME_1);
            const gameBefore = gameStateService.getGame(GAME_ID_1);
            const playerBefore = { ...gameBefore?.players[PLAYER_ID_1] };

            gameStateService.addPlayer(GAME_ID_1, PLAYER_ID_1, 'NewName'); 
            const gameAfter = gameStateService.getGame(GAME_ID_1);
            expect(gameAfter?.players[PLAYER_ID_1]).toEqual(playerBefore); 
        });
    });

    describe('gameExists', () => {
        it('should return true if game exists', () => {
            gameStateService.createGame(GAME_ID_1, initialGameConfig);
            expect(gameStateService.gameExists(GAME_ID_1)).toBe(true);
        });

        it('should return false if game does not exist', () => {
            expect(gameStateService.gameExists('nonExistentGame')).toBe(false);
        });
    });

    describe('setPlayerStatus', () => {
        beforeEach(() => {
            gameStateService.createGame(GAME_ID_1, initialGameConfig);
            gameStateService.addPlayer(GAME_ID_1, PLAYER_ID_1, USERNAME_1);
        });

        it('should set a player\'s status', () => {
            gameStateService.setPlayerStatus(GAME_ID_1, PLAYER_ID_1, PlayerStatus.ACTIVE);
            const game = gameStateService.getGame(GAME_ID_1);
            expect(game?.players[PLAYER_ID_1]?.status).toBe(PlayerStatus.ACTIVE);
        });

        it('should throw an error if game not found', () => {
            expect(() => gameStateService.setPlayerStatus('nonExistentGame', PLAYER_ID_1, PlayerStatus.ACTIVE)).toThrow(
                `Game nonExistentGame not found.`
            );
        });

        it('should throw an error if player not found in game', () => {
            expect(() => gameStateService.setPlayerStatus(GAME_ID_1, 'nonExistentPlayer', PlayerStatus.ACTIVE)).toThrow(
                `Player nonExistentPlayer not found in game ${GAME_ID_1}.`
            );
        });
    });
});
