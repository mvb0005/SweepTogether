import { createNoise2D } from 'simplex-noise'; // Removed Noise2D import
import seedrandom, { PRNG } from 'seedrandom';

// Variables to hold the seeded generator and noise function
// These will be initialized by initializeWorldGenerator
let rng: PRNG;
// Use the function signature type directly
let noise2D: (x: number, y: number) => number;

// TODO: Make density configurable
const MINE_DENSITY_THRESHOLD = 0.85; // Adjust this value (0 to 1). Higher = fewer mines.

// Cache for isMine results
const mineCache = new Map<string, boolean>();
// Cache size limits to prevent memory issues with infinite world
const MAX_CACHE_SIZE = 10000;

// Cache for getCellValue results
const cellValueCache = new Map<string, number | 'M'>();
const MAX_CELL_VALUE_CACHE_SIZE = 5000;

/**
 * Initializes the world generator with a specific seed.
 * This must be called before using isMine or getCellValue.
 * @param seed The seed string (e.g., gameId).
 */
export function initializeWorldGenerator(seed: string): void {
    console.log(`Initializing world generator with seed: ${seed}`);
    rng = seedrandom(seed);
    noise2D = createNoise2D(rng);
    // Clear caches when the seed changes
    mineCache.clear();
    cellValueCache.clear();
}

/**
 * Creates a cache key from x and y coordinates
 */
function createCacheKey(x: number, y: number): string {
    return `${x},${y}`;
}

/**
 * Determines if a cell at the given coordinates contains a mine based on Simplex noise.
 * Requires initializeWorldGenerator to have been called.
 * The noise function outputs values between -1 and 1. We scale this to 0-1.
 * If the scaled noise value is above the threshold, it's NOT a mine.
 * @param x The x-coordinate.
 * @param y The y-coordinate.
 * @returns True if the cell contains a mine, false otherwise.
 */
export function isMine(x: number, y: number): boolean {
    if (!noise2D) {
        throw new Error("World generator not initialized. Call initializeWorldGenerator(seed) first.");
    }
    const key = createCacheKey(x, y);
    
    // Check cache first
    if (mineCache.has(key)) {
        return mineCache.get(key)!;
    }
    
    // Calculate if not in cache
    const noiseValue = noise2D(x, y); // Output: -1 to 1
    const scaledValue = (noiseValue + 1) / 2; // Scale to 0 to 1
    const result = scaledValue < (1 - MINE_DENSITY_THRESHOLD); // Mine if below (1 - threshold)
    
    // Store in cache, managing cache size
    if (mineCache.size >= MAX_CACHE_SIZE) {
        // Simple cache eviction - remove oldest entry
        const firstKey = Array.from(mineCache.keys())[0];
        if (firstKey) {
            mineCache.delete(firstKey);
        }
    }
    
    mineCache.set(key, result);
    return result;
}

/**
 * Gets the value of a cell - either "M" for a mine or the count of adjacent mines (0-8).
 * Requires initializeWorldGenerator to have been called.
 * @param x The x-coordinate.
 * @param y The y-coordinate.
 * @returns "M" if the cell is a mine, otherwise the count of adjacent mines (0-8).
 */
export function getCellValue(x: number, y: number): number | 'M' {
    if (!noise2D) {
        throw new Error("World generator not initialized. Call initializeWorldGenerator(seed) first.");
    }
    const key = createCacheKey(x, y);
    
    // Check cache first
    if (cellValueCache.has(key)) {
        return cellValueCache.get(key)!;
    }
    
    let result: number | 'M';
    
    if (isMine(x, y)) {
        result = 'M';
    } else {
        let mineCount = 0;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                if (isMine(x + dx, y + dy)) {
                    mineCount++;
                }
            }
        }
        result = mineCount;
    }
    
    // Store in cache, managing cache size
    if (cellValueCache.size >= MAX_CELL_VALUE_CACHE_SIZE) {
        // Simple cache eviction - remove oldest entry
        const firstKey = Array.from(cellValueCache.keys())[0];
        if (firstKey) {
            cellValueCache.delete(firstKey);
        }
    }
    
    cellValueCache.set(key, result);
    return result;
}
