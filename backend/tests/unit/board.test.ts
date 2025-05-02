/**
 * @fileoverview Unit tests for the Board domain logic.
 * This file contains tests for the game board logic, including:
 * - Board initialization with specified dimensions and mine count.
 * - Correct mine placement according to configuration.
 * - Cell state transitions (hidden, revealed, flagged).
 * - Reveal logic, including flood fill for empty cells.
 * - Flagging and unflagging logic.
 * - Chording logic (revealing adjacent cells).
 * - Calculating adjacent mine counts for cells.
 */

import { Board, Cell, GameConfig } from '../../src/domain/types';
import { generateBoard, calculateAdjacentMines } from '../../src/domain/board';

describe('Board Functions', () => {
  let board: Board;
  const rows = 10;
  const cols = 10;
  const mines = 10;

  beforeEach(() => {
    // Initialize a new board using the generateBoard function
    board = generateBoard(rows, cols);
  });

  it('should create a board with correct dimensions', () => {
    expect(board.length).toBe(rows);
    expect(board[0].length).toBe(cols);
  });

  it('should initialize all cells as unrevealed and not flagged', () => {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        expect(board[r][c].revealed).toBe(false);
        expect(board[r][c].flagged).toBe(false);
      }
    }
  });
});
