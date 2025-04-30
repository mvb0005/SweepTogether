import React from 'react';
import { CellState } from '../types';

interface CellProps {
  cellData: CellState;
  rowIndex: number;
  colIndex: number;
  onReveal: (row: number, col: number) => void;
  onFlag: (row: number, col: number) => void;
  isLocked: boolean; // Add prop to know if the current player is locked
}

const Cell: React.FC<CellProps> = ({ cellData, rowIndex, colIndex, onReveal, onFlag, isLocked }) => {
  const { isRevealed, isFlagged, isMine, neighborMineCount } = cellData;

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    // Only allow reveal if not revealed, not flagged, and player not locked
    if (!isRevealed && !isFlagged && !isLocked) {
      onReveal(rowIndex, colIndex);
    }
    // TODO: Handle chord click logic if cell is revealed and numbered
  };

  const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault(); // Prevent browser context menu
    // Only allow flag/unflag if not revealed and player not locked
    if (!isRevealed && !isLocked) {
      onFlag(rowIndex, colIndex);
    }
  };

  // Determine cell content and styling based on state
  let content = '';
  let className = 'cell hidden'; // Start with base classes

  if (isFlagged) {
    content = '🚩'; // Flag emoji
    className = 'cell flagged';
  } else if (isRevealed) {
    className = 'cell revealed';
    if (isMine) {
      content = '💣'; // Bomb emoji
      className += ' mine'; // Add mine class for styling
    } else if (neighborMineCount > 0) {
      content = neighborMineCount.toString();
      className += ` mines-${neighborMineCount}`; // Class for styling numbers
    } else {
      // Empty revealed cell
      content = '';
    }
  }

  // Add locked class if player is locked to visually disable interaction
  if (isLocked) {
    className += ' locked';
  }

  return (
    <div
      className={className}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      data-row={rowIndex}
      data-col={colIndex}
    >
      {content}
    </div>
  );
};

export default Cell;
