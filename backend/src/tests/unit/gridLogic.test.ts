import { revealCell, toggleFlag, chordClick, MineHitResult } from '../../domain/gridLogic';
import { Cell, CellState, Coordinates, GameState, GameConfig, ScoringConfig, Player, PlayerStatus, Players } from '../../domain/types';
import { GetCellFunction } from '../../domain/game';

// --- Mock Data & Helpers ---

const mockGameConfig: GameConfig = {
    rows: 0, // Infinite
    cols: 0, // Infinite
    mines: 0.1, // Density
    isInfiniteWorld: true,
};

const mockScoringConfig: ScoringConfig = { /* ... default values ... */ } as ScoringConfig; // Cast for simplicity

const mockPlayers: Players = {};

const mockGameState: GameState = {
    gameId: 'test-game',
    boardConfig: mockGameConfig,
    scoringConfig: mockScoringConfig,
    players: mockPlayers,
    mineReveals: [],
    pendingReveals: [],
    gameOver: false,
    // spatialGrid: undefined, // Not needed for these domain tests
};

// Helper to create a mock cell
const createMockCell = (
    x: number,
    y: number,
    { isMine = false, adjacentMines = 0, revealed = false, flagged = false } = {}
): Cell => ({
    x,
    y,
    isMine,
    adjacentMines,
    revealed,
    flagged,
});

// Mock getCell function factory
const createMockGetCell = (cells: Record<string, Cell>): GetCellFunction => {
    return async (gameState: GameState, x: number, y: number): Promise<Cell | null> => {
        const key = `${x},${y}`;
        return cells[key] || null; // Return null for out-of-bounds or non-existent cells in mock
    };
};

// --- Test Suites ---

describe('Board Domain Logic', () => {

    describe('revealCell', () => {
        it('should reveal a hidden non-mine cell with adjacent mines', async () => {
            const cells = {
                '0,0': createMockCell(0, 0, { adjacentMines: 1 }),
            };
            const getCell = createMockGetCell(cells);
            const result = await revealCell(mockGameState, 0, 0, getCell);

            expect(result).toHaveLength(1);
            const revealed = result as Cell[];
            expect(revealed[0]).toMatchObject({ x: 0, y: 0, revealed: true, flagged: false, adjacentMines: 1 });
        });

        it('should reveal a hidden non-mine cell with zero adjacent mines (flood fill)', async () => {
            const cells = {
                '0,0': createMockCell(0, 0, { adjacentMines: 0 }), // Start point
                '0,1': createMockCell(0, 1, { adjacentMines: 1 }), // Neighbor with mines
                '1,0': createMockCell(1, 0, { adjacentMines: 0 }), // Neighbor to flood
                '1,1': createMockCell(1, 1, { adjacentMines: 1 }), // Neighbor of neighbor
                '2,0': createMockCell(2, 0, { isMine: true }),    // Mine, should not be revealed
            };
            const getCell = createMockGetCell(cells);
            const result = await revealCell(mockGameState, 0, 0, getCell);

            expect(result).not.toHaveProperty('hitMine');
            const revealed = result as Cell[];
            // Corrected expectation: Standard flood fill reveals the boundary cells too.
            expect(revealed).toHaveLength(4); // 0,0; 1,0; 0,1; 1,1
            expect(revealed).toEqual(expect.arrayContaining([
                expect.objectContaining({ x: 0, y: 0, revealed: true, adjacentMines: 0 }),
                expect.objectContaining({ x: 1, y: 0, revealed: true, adjacentMines: 0 }),
                expect.objectContaining({ x: 0, y: 1, revealed: true, adjacentMines: 1 }),
                expect.objectContaining({ x: 1, y: 1, revealed: true, adjacentMines: 1 }), // This cell is revealed
            ]));
             // Ensure the mine was not revealed
            expect(revealed).not.toEqual(expect.arrayContaining([
                expect.objectContaining({ x: 2, y: 0 }),
            ]));
        });

        it('should return MineHitResult when revealing a mine', async () => {
            const cells = {
                '0,0': createMockCell(0, 0, { isMine: true }),
            };
            const getCell = createMockGetCell(cells);
            const result = await revealCell(mockGameState, 0, 0, getCell);

            expect(result).toHaveProperty('hitMine');
            const hitResult = result as MineHitResult;
            expect(hitResult.hitMine).toMatchObject({ x: 0, y: 0, isMine: true, revealed: true, flagged: false });
        });

        it('should return empty array when revealing an already revealed cell', async () => {
            const cells = {
                '0,0': createMockCell(0, 0, { revealed: true, adjacentMines: 1 }),
            };
            const getCell = createMockGetCell(cells);
            const result = await revealCell(mockGameState, 0, 0, getCell);
            expect(result).toEqual([]);
        });

        it('should return empty array when revealing a flagged cell', async () => {
            const cells = {
                '0,0': createMockCell(0, 0, { flagged: true }),
            };
            const getCell = createMockGetCell(cells);
            const result = await revealCell(mockGameState, 0, 0, getCell);
            expect(result).toEqual([]);
        });
    });

    describe('toggleFlag', () => {
        it('should flag a hidden cell', async () => {
            const cells = {
                '0,0': createMockCell(0, 0),
            };
            const getCell = createMockGetCell(cells);
            const result = await toggleFlag(mockGameState, 0, 0, getCell);
            expect(result).toMatchObject({ x: 0, y: 0, flagged: true, revealed: false });
        });

        it('should unflag a flagged cell', async () => {
            const cells = {
                '0,0': createMockCell(0, 0, { flagged: true }),
            };
            const getCell = createMockGetCell(cells);
            const result = await toggleFlag(mockGameState, 0, 0, getCell);
            expect(result).toMatchObject({ x: 0, y: 0, flagged: false, revealed: false });
        });

        it('should return null when trying to flag a revealed cell', async () => {
            const cells = {
                '0,0': createMockCell(0, 0, { revealed: true, adjacentMines: 1 }),
            };
            const getCell = createMockGetCell(cells);
            const result = await toggleFlag(mockGameState, 0, 0, getCell);
            expect(result).toBeNull();
        });
    });

    describe('chordClick', () => {
        it('should reveal adjacent hidden cells when flags match adjacent mines', async () => {
            const cells = {
                '0,0': createMockCell(0, 0, { revealed: true, adjacentMines: 1 }), // Center cell
                '0,1': createMockCell(0, 1, { flagged: true, isMine: true }),    // Correctly flagged mine
                '1,0': createMockCell(1, 0, { adjacentMines: 1 }),             // Hidden safe neighbor
                '1,1': createMockCell(1, 1, { adjacentMines: 1 }),             // Hidden safe neighbor
            };
            const getCell = createMockGetCell(cells);
            const result = await chordClick(mockGameState, 0, 0, getCell);

            expect(result).not.toHaveProperty('hitMine');
            const revealed = result as Cell[];
            expect(revealed).toHaveLength(2); // 1,0 and 1,1
            expect(revealed).toEqual(expect.arrayContaining([
                expect.objectContaining({ x: 1, y: 0, revealed: true }),
                expect.objectContaining({ x: 1, y: 1, revealed: true }),
            ]));
        });

        it('should return empty array when flags do not match adjacent mines', async () => {
            const cells = {
                '0,0': createMockCell(0, 0, { revealed: true, adjacentMines: 2 }), // Center cell needs 2 flags
                '0,1': createMockCell(0, 1, { flagged: true, isMine: true }),    // Only one flag placed
                '1,0': createMockCell(1, 0, { isMine: true }),                   // Another mine, unflagged
                '1,1': createMockCell(1, 1, { adjacentMines: 2 }),             // Hidden safe neighbor
            };
            const getCell = createMockGetCell(cells);
            const result = await chordClick(mockGameState, 0, 0, getCell);
            expect(result).toEqual([]);
        });

        it('should return MineHitResult if chording reveals a misflagged mine', async () => {
            const cells = {
                '0,0': createMockCell(0, 0, { revealed: true, adjacentMines: 1 }), // Center cell
                '0,1': createMockCell(0, 1, { flagged: true, isMine: true }),    // Correctly flagged mine
                '1,0': createMockCell(1, 0, { isMine: true }),                   // Hidden mine (will be hit)
                '1,1': createMockCell(1, 1, { adjacentMines: 1 }),             // Hidden safe neighbor
            };
            const getCell = createMockGetCell(cells);
            const result = await chordClick(mockGameState, 0, 0, getCell);

            expect(result).toHaveProperty('hitMine');
            const hitResult = result as MineHitResult;
            expect(hitResult.hitMine).toMatchObject({ x: 1, y: 0, isMine: true, revealed: true });
        });

         it('should return empty array if chording on a non-revealed cell', async () => {
            const cells = { '0,0': createMockCell(0, 0) };
            const getCell = createMockGetCell(cells);
            const result = await chordClick(mockGameState, 0, 0, getCell);
            expect(result).toEqual([]);
        });

        it('should return empty array if chording on a revealed cell with 0 adjacent mines', async () => {
            const cells = { '0,0': createMockCell(0, 0, { revealed: true, adjacentMines: 0 }) };
            const getCell = createMockGetCell(cells);
            const result = await chordClick(mockGameState, 0, 0, getCell);
            expect(result).toEqual([]);
        });
    });
});
