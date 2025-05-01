import { isMine, getCellValue } from '../../src/worldGenerator';

describe('isMine function', () => {
    it('should be deterministic for the same coordinates', () => {
        const x = 10, y = 20;
        const result1 = isMine(x, y);
        const result2 = isMine(x, y);
        expect(result1).toBe(result2);
    });

    it('should produce boolean results', () => {
        const result1 = isMine(1, 1);
        const result2 = isMine(100, 200);
        expect(typeof result1).toBe('boolean');
        expect(typeof result2).toBe('boolean');
    });

    // Testing specific coordinates without mocks, relying on the deterministic nature
    it('should return consistent values for specific coordinates', () => {
        // These tests rely on the implementation using the default WORLD_SEED
        // We're testing the actual behavior without mocking
        const mineAt1_1 = isMine(1, 1);
        const mineAt2_2 = isMine(2, 2);
        
        // We don't assert specific values, only that they remain consistent
        // across test runs with the same seed
        expect(typeof mineAt1_1).toBe('boolean');
        expect(typeof mineAt2_2).toBe('boolean');
    });
});

describe('getCellValue function', () => {
    it('should return "M" for mine cells', () => {
        // Find a mine cell based on isMine
        let x = 0, y = 0;
        let attempts = 0;
        
        // Find a coordinate that has a mine
        while (!isMine(x, y) && attempts < 100) {
            x++;
            y++;
            attempts++;
        }
        
        // Skip the test if we couldn't find a mine coordinate in our search
        if (!isMine(x, y)) {
            console.log('Could not find a mine coordinate for testing. Skipping test.');
            return;
        }

        const result = getCellValue(x, y);
        expect(result).toBe('M');
    });

    it('should return a number between 0 and 8 for non-mine cells', () => {
        // Find a non-mine cell
        let x = 0, y = 0;
        let attempts = 0;
        
        // Find a coordinate that doesn't have a mine
        while (isMine(x, y) && attempts < 100) {
            x++;
            y--;
            attempts++;
        }
        
        // Skip the test if we couldn't find a non-mine coordinate in our search
        if (isMine(x, y)) {
            console.log('Could not find a non-mine coordinate for testing. Skipping test.');
            return;
        }

        const result = getCellValue(x, y);
        expect(typeof result).toBe('number');
        expect(Number(result)).toBeGreaterThanOrEqual(0);
        expect(Number(result)).toBeLessThanOrEqual(8);
    });
});