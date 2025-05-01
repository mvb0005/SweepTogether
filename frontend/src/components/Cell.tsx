import React, { MouseEvent } from 'react';
import { CellState } from '../types';

interface CellProps {
  cellData: CellState;
  rowIndex: number;
  colIndex: number;
  onReveal: (row: number, col: number) => void;
  onFlag: (row: number, col: number) => void;
  onChord: (row: number, col: number) => void; // Add chord click handler
  isLocked: boolean;
}

const Cell: React.FC<CellProps> = ({ 
  cellData, 
  rowIndex, 
  colIndex, 
  onReveal, 
  onFlag, 
  onChord,
  isLocked 
}) => {
  const { revealed, flagged, isMine, adjacentMines } = cellData;

  // Track mouse buttons for chord detection
  const [mouseButtons, setMouseButtons] = React.useState<{ left: boolean; right: boolean }>({
    left: false,
    right: false
  });

  const handleMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    // Left button is 0, right button is 2
    if (event.button === 0) setMouseButtons(prev => ({ ...prev, left: true }));
    if (event.button === 2) setMouseButtons(prev => ({ ...prev, right: true }));
    
    // Detect chord click (both buttons) or middle click (button 1)
    if (
      (mouseButtons.right && event.button === 0) || 
      (mouseButtons.left && event.button === 2) || 
      event.button === 1
    ) {
      // Perform chord click if the cell is revealed and has a number
      if (revealed && adjacentMines && adjacentMines > 0 && !isLocked) {
        onChord(rowIndex, colIndex);
      }
    }
  };

  const handleMouseUp = (event: MouseEvent<HTMLDivElement>) => {
    // Reset mouse button state
    if (event.button === 0) setMouseButtons(prev => ({ ...prev, left: false }));
    if (event.button === 2) setMouseButtons(prev => ({ ...prev, right: false }));
  };

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    // Only allow reveal if not revealed, not flagged, and player not locked
    if (!revealed && !flagged && !isLocked) {
      onReveal(rowIndex, colIndex);
    }
    // Chord click is now handled in handleMouseDown
  };

  const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault(); // Prevent browser context menu
    // Only allow flag/unflag if not revealed and player not locked
    if (!revealed && !isLocked) {
      onFlag(rowIndex, colIndex);
    }
  };

  // Determine cell content and styling based on state
  let content = '';
  let className = 'cell hidden'; // Start with base classes

  if (flagged) {
    content = '🚩'; // Flag emoji
    className = 'cell flagged';
  } else if (revealed) {
    className = 'cell revealed';
    if (isMine) {
      content = '💣'; // Bomb emoji
      className += ' mine'; // Add mine class for styling
    } else if (adjacentMines && adjacentMines > 0) {
      content = adjacentMines.toString();
      className += ` mines-${adjacentMines}`; // Class for styling numbers
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
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => setMouseButtons({ left: false, right: false })}
      data-row={rowIndex}
      data-col={colIndex}
    >
      {content}
    </div>
  );
};

export default Cell;
