// backend/src/domain/spatialHashGrid.ts
import { PointData } from './types'; // Import PointData

// Represents rectangular bounds for querying
export interface Bounds {
    minX: number;
    minY: number;
    maxX: number; // Exclusive
    maxY: number; // Exclusive
}

// Add the generic type parameter <T>
export class SpatialHashGrid<T> {
    private grid: Map<string, Map<string, T>>; // Store as Map<chunkId, Map<cellKey, T>>
    private cellSize: number;
    // Removed width/height as they aren't strictly necessary for an infinite grid logic based on chunks

    constructor(cellSize: number) { // Simplified constructor for infinite grid
        if (cellSize <= 0) {
            throw new Error("Cell size must be positive.");
        }
        this.cellSize = cellSize;
        this.grid = new Map();
    }

    // Returns "chunkX_chunkY"
    getChunkIdForCoords(x: number, y: number): string {
        const cellX = Math.floor(x / this.cellSize);
        const cellY = Math.floor(y / this.cellSize);
        return `${cellX}_${cellY}`;
    }

    // Returns "x,y"
    private getCellKey(x: number, y: number): string {
        return `${x},${y}`;
    }

    // Get data for a specific cell
    get(x: number, y: number): T | undefined {
        const chunkId = this.getChunkIdForCoords(x, y);
        const cellKey = this.getCellKey(x, y);
        return this.grid.get(chunkId)?.get(cellKey);
    }

    // Set data for a specific cell
    set(x: number, y: number, value: T): void {
        const chunkId = this.getChunkIdForCoords(x, y);
        if (!this.grid.has(chunkId)) {
            this.grid.set(chunkId, new Map());
        }
        this.grid.get(chunkId)!.set(this.getCellKey(x, y), value);
    }

    // Remove data for a specific cell
    delete(x: number, y: number): boolean {
        const chunkId = this.getChunkIdForCoords(x, y);
        const chunk = this.grid.get(chunkId);
        if (chunk) {
            const deleted = chunk.delete(this.getCellKey(x, y));
            if (chunk.size === 0) {
                this.grid.delete(chunkId); // Clean up empty chunk
            }
            return deleted;
        }
        return false;
    }

    // Get all data within a specific chunk
    getChunkData(chunkId: string): Map<string, T> | undefined {
        return this.grid.get(chunkId);
    }

    // Set data for an entire chunk (e.g., when loading from persistence)
    setChunkData(chunkId: string, data: Map<string, T>): void {
        if (data.size > 0) {
             this.grid.set(chunkId, data);
        } else {
            this.grid.delete(chunkId); // Remove if data is empty
        }
    }

    // Query items within a rectangular bounds
    queryBounds(bounds: Bounds): T[] {
        const items: T[] = [];
        const minCellX = Math.floor(bounds.minX / this.cellSize);
        const minCellY = Math.floor(bounds.minY / this.cellSize);
        const maxCellX = Math.floor((bounds.maxX - 1) / this.cellSize);
        const maxCellY = Math.floor((bounds.maxY - 1) / this.cellSize);

        for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
            for (let cellY = minCellY; cellY <= maxCellY; cellY++) {
                const chunkId = `${cellX}_${cellY}`;
                const chunk = this.grid.get(chunkId);
                if (chunk) {
                    chunk.forEach((item, cellKey) => {
                        const [x, y] = cellKey.split(',').map(Number);
                        // Check if the item's coordinates are within the query bounds
                        if (x >= bounds.minX && x < bounds.maxX && y >= bounds.minY && y < bounds.maxY) {
                            items.push(item);
                        }
                    });
                }
            }
        }
        return items; // Duplicates are unlikely if set/get logic is correct
    }

    clear(): void {
        this.grid.clear();
    }
}
