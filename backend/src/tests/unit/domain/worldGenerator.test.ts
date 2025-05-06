import { WorldGenerator, Noise2DFunction } from '../../../domain/worldGenerator';

describe('WorldGenerator', () => {
    const TEST_SEED = 'test-seed';
    const ANOTHER_SEED = 'another-seed';

    describe('constructor', () => {
        it('should produce the same world for the same seed when using default noise', () => {
            const generator1 = new WorldGenerator(TEST_SEED);
            const generator2 = new WorldGenerator(TEST_SEED);
            const x = 0, y = 0;
            expect(generator1.isMine(x, y)).toBe(generator2.isMine(x, y));
            const x2 = 10, y2 = 10;
            expect(generator1.getCellValue(x2, y2)).toBe(generator2.getCellValue(x2, y2));
        });

        it('should use the provided noise function', () => {
            const mockNoiseFn: Noise2DFunction = jest.fn((x, y) => {
                if (x === 0 && y === 0) return 0.0; // Will not be a mine
                if (x === 1 && y === 1) return 0.9; // Will be a mine (assuming threshold < 1.0)
                return 0.0;
            });
            const generator = new WorldGenerator(TEST_SEED, mockNoiseFn);

            const mockNoiseFn2: Noise2DFunction = jest.fn((x, y) => {
                if (x === 0 && y === 0) return 0.8; // Not a mine
                if (x === 1 && y === 1) return -0.8; // Is a mine
                return 0.0;
            });
            const generatorWithSpecificNoise = new WorldGenerator('test', mockNoiseFn2);
            expect(generatorWithSpecificNoise.isMine(0,0)).toBe(false);
            expect(generatorWithSpecificNoise.isMine(1,1)).toBe(true);
            expect(mockNoiseFn2).toHaveBeenCalledWith(0,0);
            expect(mockNoiseFn2).toHaveBeenCalledWith(1,1);
        });
    });

    describe('isMine', () => {
        it('should return a boolean', () => {
            const generator = new WorldGenerator(TEST_SEED);
            expect(typeof generator.isMine(0, 0)).toBe('boolean');
        });

        it('should consistently determine if a cell is a mine for the same seed (with default noise)', () => {
            const generator = new WorldGenerator(TEST_SEED);
            const x = 5, y = 10;
            const mineStatus1 = generator.isMine(x, y);
            const mineStatus2 = generator.isMine(x, y);
            expect(mineStatus1).toBe(mineStatus2);
        });

        it('should return different mine statuses based on mock noise function', () => {
            const mockNoiseFn: Noise2DFunction = jest.fn((x, y) => {
                if (x === 0 && y === 0) return 0.8; // Not a mine
                if (x === 1000 && y === 1000) return -0.8; // Is a mine
                return 0.0;
            });
            const generator = new WorldGenerator(TEST_SEED, mockNoiseFn);
            expect(generator.isMine(0, 0)).toBe(false);
            expect(generator.isMine(1000, 1000)).toBe(true);
        });
    });

    describe('getCellValue', () => {
        let generator: WorldGenerator;
        let isMineSpy: jest.SpyInstance;

        beforeEach(() => {
            generator = new WorldGenerator(TEST_SEED); 
            isMineSpy = jest.spyOn(generator, 'isMine');
        });

        afterEach(() => {
            isMineSpy.mockRestore();
        });

        it('should return "M" if the cell is a mine', () => {
            isMineSpy.mockImplementation((x, y) => x === 1 && y === 1);
            expect(generator.getCellValue(1, 1)).toBe('M');
        });

        it('should return a number if the cell is not a mine', () => {
            isMineSpy.mockReturnValue(false);
            const value = generator.getCellValue(0, 0);
            expect(typeof value).toBe('number');
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThanOrEqual(8);
        });

        it('should correctly count adjacent mines', () => {
            isMineSpy.mockImplementation((x, y) => {
                if (x === 0 && y === 0) return true;
                if (x === 0 && y === 1) return true;
                if (x === 0 && y === 2) return true;
                if (x === 1 && y === 1) return false; 
                return false;
            });
            expect(generator.getCellValue(1, 1)).toBe(3);
        });
        
        it('should return 0 if no adjacent mines and not a mine itself', () => {
            isMineSpy.mockReturnValue(false);
            expect(generator.getCellValue(2, 2)).toBe(0);
        });

        it('should consistently determine cell value for the same seed (with default noise)', () => {
            isMineSpy.mockRestore(); 
            const gen1 = new WorldGenerator(TEST_SEED);
            const gen2 = new WorldGenerator(TEST_SEED);
            const x = 7, y = 3;
            expect(gen1.getCellValue(x, y)).toBe(gen2.getCellValue(x, y));
        });

        it('should return different cell values based on mock noise function', () => {
            const mockNoiseFn: Noise2DFunction = jest.fn((x, y) => {
                if (x === 0 && y === 0) return 0.8; // (0,0) not a mine
                if (x === -1 && y === -1) return -0.8; // (-1,-1) is a mine
                if (x === 1 && y === 1) return 0.8; // (1,1) not a mine
                return 0.5; // Default to not a mine for other cells
            });
            const generatorWithMockNoise = new WorldGenerator(TEST_SEED, mockNoiseFn);
            
            expect(generatorWithMockNoise.getCellValue(0,0)).toBe(1);
            expect(generatorWithMockNoise.getCellValue(1,1)).toBe(0);
        });
    });
});
