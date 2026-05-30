import { createNoise2D } from 'simplex-noise';
import seedrandom, { PRNG } from 'seedrandom';

const MINE_DENSITY_THRESHOLD = 0.9;
const MAX_CACHE_SIZE = 10000;
const MAX_CELL_VALUE_CACHE_SIZE = 5000;
export const MINE_CELL = 0xff;

export type Noise2DFunction = (x: number, y: number) => number;

export class WorldGenerator {
    private rng: PRNG;
    private noise2D: Noise2DFunction;
    private mineCache: Map<string, boolean>;
    private cellValueCache: Map<string, number | 'M'>;
    private seed: string;

    constructor(seed: string, noise2DFn?: Noise2DFunction) {
        this.seed = seed;
        this.rng = seedrandom(seed);
        this.noise2D = noise2DFn || createNoise2D(this.rng);
        this.mineCache = new Map<string, boolean>();
        this.cellValueCache = new Map<string, number | 'M'>();
    }

    private createCacheKey(x: number, y: number): string {
        return `${x},${y}`;
    }

    public isMine(x: number, y: number): boolean {
        const key = this.createCacheKey(x, y);

        if (this.mineCache.has(key)) {
            return this.mineCache.get(key)!;
        }

        const noiseValue = this.noise2D(x, y);
        const scaledValue = (noiseValue + 1) / 2;
        const result = scaledValue < (1 - MINE_DENSITY_THRESHOLD);

        if (this.mineCache.size >= MAX_CACHE_SIZE) {
            const firstKey = this.mineCache.keys().next().value;
            if (firstKey) {
                this.mineCache.delete(firstKey);
            }
        }

        this.mineCache.set(key, result);
        return result;
    }

    public getCellValue(x: number, y: number): number | 'M' {
        const key = this.createCacheKey(x, y);

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
                    if (this.isMine(x + dx, y + dy)) {
                        mineCount++;
                    }
                }
            }
            result = mineCount;
        }

        if (this.cellValueCache.size >= MAX_CELL_VALUE_CACHE_SIZE) {
            const firstKey = this.cellValueCache.keys().next().value;
            if (firstKey) {
                this.cellValueCache.delete(firstKey);
            }
        }

        this.cellValueCache.set(key, result);
        return result;
    }

    /** Chunk byte layout: 0xFF = mine, 0–8 = adjacent mine count. */
    generateChunkLayout(chunkX: number, chunkY: number, chunkSize: number): Uint8Array {
        const out = new Uint8Array(chunkSize * chunkSize);
        for (let ly = 0; ly < chunkSize; ly++) {
            for (let lx = 0; lx < chunkSize; lx++) {
                const gx = chunkX * chunkSize + lx;
                const gy = chunkY * chunkSize + ly;
                const idx = ly * chunkSize + lx;
                const val = this.getCellValue(gx, gy);
                out[idx] = val === 'M' ? MINE_CELL : val;
            }
        }
        return out;
    }
}
