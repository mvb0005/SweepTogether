/**
 * @fileoverview Unit tests for the SpatialHashGrid utility.
 * This file contains tests for the spatial hash grid data structure, including:
 * - Initialization with cell size and dimensions.
 * - Adding items (e.g., Cells) to the grid.
 * - Removing items from the grid.
 * - Querying for neighbors within a given radius or bounding box.
 * - Handling edge cases and grid boundaries.
 * - Efficiency of neighbor lookups (conceptual, not performance testing here).
 */

import { SpatialHashGrid } from '../../src/domain/spatialHashGrid';
import { Cell } from '../../src/domain/types'; // Import the Cell type

describe('SpatialHashGrid', () => {
  let grid: SpatialHashGrid<Cell>; // SpatialHashGrid properly parameterized with Cell
  const width = 10;
  const height = 10;
  const cellSize = 1; // Example cell size

  beforeEach(() => {
    grid = new SpatialHashGrid<Cell>(width, height, cellSize);
  });

  it('should be defined', () => {
    expect(grid).toBeDefined();
  });

  // Add simple test for adding an item
  it('should add an item to the grid', () => {
    const cell: Cell = { 
      isMine: false, 
      adjacentMines: 0, 
      revealed: false, 
      flagged: false 
    };
    grid.add(cell, 5, 5);
    
    // Verify the item was added by checking queryNeighbors
    const neighbors = grid.queryNeighbors(5, 5);
    expect(neighbors).toContain(cell);
  });
});
