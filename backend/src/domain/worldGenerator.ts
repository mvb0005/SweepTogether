import { createNoise2D } from 'simplex-noise';
import seedrandom, { PRNG } from 'seedrandom';

// TODO: Make density configurable
const MINE_DENSITY_THRESHOLD = 0.85; // Adjust this value (0 to 1). Higher = fewer mines.
const MAX_CACHE_SIZE = 10000;
const MAX_CELL_VALUE_CACHE_SIZE = 5000;

export type Noise2DFunction = (x: number, y: number) => number;

export class WorldGenerator {
    private rng: PRNG;
    private noise2D: Noise2DFunction;
    private mineCache: Map<string, boolean>;
    private cellValueCache: Map<string, number | 'M'>;
    private seed: string; // Store the seed for potential debugging or re-initialization

    /**
     * Initializes the world generator instance with a specific seed.
     * @param seed The seed string (e.g., gameId).
     * @param noise2DFn Optional custom noise function for testing.
     */
    constructor(seed: string, noise2DFn?: Noise2DFunction) {
        console.log(`Initializing WorldGenerator instance with seed: ${seed}`);
        this.seed = seed;
        this.rng = seedrandom(seed);
        this.noise2D = noise2DFn || createNoise2D(this.rng);
        this.mineCache = new Map<string, boolean>();
        this.cellValueCache = new Map<string, number | 'M'>();
    }

    /**
     * Creates a cache key from x and y coordinates.
     */
    private createCacheKey(x: number, y: number): string {
        return `${x},${y}`;
    }

    /**
     * Determines if a cell at the given coordinates contains a mine based on Simplex noise.
     * Uses the instance's seeded RNG and noise function.
     * @param x The x-coordinate.
     * @param y The y-coordinate.
     * @returns True if the cell contains a mine, false otherwise.
     */
    public isMine(x: number, y: number): boolean {
        const key = this.createCacheKey(x, y);

        // Check cache first
        if (this.mineCache.has(key)) {
            return this.mineCache.get(key)!;
        }

        // Calculate if not in cache
        const noiseValue = this.noise2D(x, y); // Output: -1 to 1
        const scaledValue = (noiseValue + 1) / 2; // Scale to 0 to 1
        const result = scaledValue < (1 - MINE_DENSITY_THRESHOLD); // Mine if below (1 - threshold)

        // Store in cache, managing cache size
        if (this.mineCache.size >= MAX_CACHE_SIZE) {
            // Simple cache eviction - remove oldest entry
            const firstKey = this.mineCache.keys().next().value;
            if (firstKey) {
                this.mineCache.delete(firstKey);
            }
        }

        this.mineCache.set(key, result);
        return result;
    }

    /**
     * Gets the value of a cell - either "M" for a mine or the count of adjacent mines (0-8).
     * Uses the instance's seeded RNG and noise function.
     * @param x The x-coordinate.
     * @param y The y-coordinate.
     * @returns "M" if the cell is a mine, otherwise the count of adjacent mines (0-8).
     */
    public getCellValue(x: number, y: number): number | 'M' {
        const key = this.createCacheKey(x, y);

        // Check cache first
        if (this.cellValueCache.has(key)) {
            return this.cellValueCache.get(key)!;
        }

        let result: number | 'M';

        if (this.isMine(x, y)) {
            result = 'M';
        } else {
            let mineCount = 0;
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    if (dx === 0 && dy === 0) continue;
                    // Use instance method isMine
                    if (this.isMine(x + dx, y + dy)) {
                        mineCount++;
                    }
                }
            }
            result = mineCount;
        }

        // Store in cache, managing cache size
        if (this.cellValueCache.size >= MAX_CELL_VALUE_CACHE_SIZE) {
            // Simple cache eviction - remove oldest entry
            const firstKey = this.cellValueCache.keys().next().value;
            if (firstKey) {
                this.cellValueCache.delete(firstKey);
            }
        }

        this.cellValueCache.set(key, result);
        return result;
    }
}
