import { WorldGenerator, Noise2DFunction } from '../../../domain/worldGenerator';

describe('WorldGenerator', () => {
    const TEST_SEED = 'test-seed';

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
            // First mock function and generator instance
            const mockNoiseFn1: Noise2DFunction = jest.fn((x, y) => {
                if (x === 0 && y === 0) return 0.0;  // Scaled: (0.0+1)/2 = 0.5. Not a mine (threshold 0.1)
                if (x === 1 && y === 1) return -0.9; // Scaled: (-0.9+1)/2 = 0.05. IS a mine (threshold 0.1)
                return 0.0; // Default for other cells not explicitly tested here
            });
            const generator1 = new WorldGenerator(TEST_SEED, mockNoiseFn1);

            // Assertions for the first generator instance
            expect(generator1.isMine(0, 0)).toBe(false);
            expect(generator1.isMine(1, 1)).toBe(true);
            expect(mockNoiseFn1).toHaveBeenCalledWith(0, 0);
            expect(mockNoiseFn1).toHaveBeenCalledWith(1, 1);

            // Second mock function and generator instance
            const mockNoiseFn2: Noise2DFunction = jest.fn((x, y) => {
                if (x === 0 && y === 0) return 0.8; // Not a mine: scaled = (0.8+1)/2 = 0.9. 0.9 < 0.1 is false.
                if (x === 1 && y === 1) return -0.9; // Is a mine: scaled = (-0.9+1)/2 = 0.05. 0.05 < 0.1 is true.
                return 0.0; // Default for other cells
            });
            const generatorWithSpecificNoise = new WorldGenerator('test', mockNoiseFn2); // Using 'test' seed as original
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
                if (x === 0 && y === 0) return 0.8; // Not a mine: scaled = (0.8+1)/2 = 0.9. 0.9 < 0.1 is false.
                if (x === 1000 && y === 1000) return -0.9; // Is a mine: scaled = (-0.9+1)/2 = 0.05. 0.05 < 0.1 is true.
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
                // (0,0) is NOT a mine. scaled = (0.8+1)/2 = 0.9. 0.9 < 0.1 is false.
                if (x === 0 && y === 0) return 0.8;
                // (-1,-1) IS a mine. scaled = (-0.9+1)/2 = 0.05. 0.05 < 0.1 is true.
                if (x === -1 && y === -1) return -0.9;
                // (1,1) is NOT a mine. scaled = (0.8+1)/2 = 0.9. 0.9 < 0.1 is false.
                if (x === 1 && y === 1) return 0.8;
                // Default to NOT a mine for other cells for simplicity in this test
                return 0.5; // scaled = (0.5+1)/2 = 0.75. 0.75 < 0.1 is false.
            });
            const generatorWithMockNoise = new WorldGenerator(TEST_SEED, mockNoiseFn);
            
            // For (0,0):
            // Neighbors:
            // (-1,-1): mine (mock returns -0.9)
            // (0,-1): not mine (mock returns 0.5)
            // (1,-1): not mine (mock returns 0.5)
            // (-1,0): not mine (mock returns 0.5)
            // (1,0): not mine (mock returns 0.5)
            // (-1,1): not mine (mock returns 0.5)
            // (0,1): not mine (mock returns 0.5)
            // (1,1): not mine (mock returns 0.8)
            // Expected count for (0,0) is 1.
            expect(generatorWithMockNoise.getCellValue(0,0)).toBe(1);

            // For (1,1):
            // (1,1) is not a mine (mock returns 0.8)
            // Neighbors:
            // (0,0): not mine (mock returns 0.8)
            // (1,0): not mine (mock returns 0.5)
            // (2,0): not mine (mock returns 0.5)
            // (0,1): not mine (mock returns 0.5)
            // (2,1): not mine (mock returns 0.5)
            // (0,2): not mine (mock returns 0.5)
            // (1,2): not mine (mock returns 0.5)
            // (2,2): not mine (mock returns 0.5)
            // Expected count for (1,1) is 0.
            expect(generatorWithMockNoise.getCellValue(1,1)).toBe(0);
        });
    });
});
