// backend/src/spatialHashGrid.ts

// Data stored for a cell in the grid (minimal state)
export interface PointData {
    revealed?: boolean;
    flagged?: boolean;
    // Potentially add playerId later
}

// Represents a point with coordinates and data
export interface Point {
    x: number;
    y: number;
    data: PointData;
}

// Represents rectangular bounds for querying
export interface Bounds {
    minX: number;
    minY: number;
    maxX: number; // Exclusive
    maxY: number; // Exclusive
}

export class SpatialHashGrid {
    private chunkSize: number;
    private grid: Map<string, Map<string, PointData>>; // Outer key: "chunkX,chunkY", Inner key: "cellX,cellY"

    constructor(chunkSize: number = 16) {
        if (chunkSize <= 0) {
            throw new Error("chunkSize must be positive");
        }
        this.chunkSize = chunkSize;
        this.grid = new Map();
    }

    private getChunkCoords(x: number, y: number): { chunkX: number; chunkY: number } {
        const chunkX = Math.floor(x / this.chunkSize);
        const chunkY = Math.floor(y / this.chunkSize);
        return { chunkX, chunkY };
    }

    private getChunkKey(chunkX: number, chunkY: number): string {
        return `${chunkX},${chunkY}`;
    }

    private getCellKey(x: number, y: number): string {
        return `${x},${y}`;
    }

    /**
     * Sets or updates the data for a cell at given coordinates.
     * Merges new data with existing data if the cell already exists.
     */
    set(x: number, y: number, data: PointData): void {
        const { chunkX, chunkY } = this.getChunkCoords(x, y);
        const chunkKey = this.getChunkKey(chunkX, chunkY);
        const cellKey = this.getCellKey(x, y);

        let chunk = this.grid.get(chunkKey);
        if (!chunk) {
            chunk = new Map();
            this.grid.set(chunkKey, chunk);
        }

        const existingData = chunk.get(cellKey) || {};
        // Merge new data over existing data
        chunk.set(cellKey, { ...existingData, ...data });
    }

    /**
     * Gets the stored data for a cell at given coordinates.
     * Returns undefined if the cell has no stored data (meaning it's in its default state from worldGenerator).
     */
    get(x: number, y: number): PointData | undefined {
        const { chunkX, chunkY } = this.getChunkCoords(x, y);
        const chunkKey = this.getChunkKey(chunkX, chunkY);
        const cellKey = this.getCellKey(x, y);

        const chunk = this.grid.get(chunkKey);
        return chunk ? chunk.get(cellKey) : undefined;
    }

    /**
     * Deletes the stored data for a cell (e.g., unflagging might reset it).
     */
    delete(x: number, y: number): boolean {
        const { chunkX, chunkY } = this.getChunkCoords(x, y);
        const chunkKey = this.getChunkKey(chunkX, chunkY);
        const cellKey = this.getCellKey(x, y);

        const chunk = this.grid.get(chunkKey);
        if (chunk) {
            const deleted = chunk.delete(cellKey);
            // Optional: Remove chunk if empty? Might cause churn.
            // if (chunk.size === 0) {
            //     this.grid.delete(chunkKey);
            // }
            return deleted;
        }
        return false;
    }


    /**
     * Queries for all stored points within the given rectangular bounds.
     */
    query(bounds: Bounds): Point[] {
        const found: Point[] = [];
        const { minX, minY, maxX, maxY } = bounds;

        const startChunkX = Math.floor(minX / this.chunkSize);
        const startChunkY = Math.floor(minY / this.chunkSize);
        const endChunkX = Math.floor((maxX - 1) / this.chunkSize); // Inclusive chunk index
        const endChunkY = Math.floor((maxY - 1) / this.chunkSize); // Inclusive chunk index

        for (let cx = startChunkX; cx <= endChunkX; cx++) {
            for (let cy = startChunkY; cy <= endChunkY; cy++) {
                const chunkKey = this.getChunkKey(cx, cy);
                const chunk = this.grid.get(chunkKey);

                if (chunk) {
                    for (const [cellKey, data] of chunk.entries()) {
                        // Parse cell coordinates from cellKey
                        const [xStr, yStr] = cellKey.split(',');
                        const x = parseInt(xStr, 10);
                        const y = parseInt(yStr, 10);

                        // Check if the actual point is within the precise bounds
                        if (x >= minX && x < maxX && y >= minY && y < maxY) {
                            found.push({ x, y, data });
                        }
                    }
                }
            }
        }
        return found;
    }
}
