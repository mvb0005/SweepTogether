import React from 'react';
import { BoardState } from '../types';
import Cell from './Cell';
// Import board styles if using CSS Modules or similar
// import styles from './Board.module.css';

interface BoardProps {
  boardData: BoardState;
  onRevealCell: (row: number, col: number) => void;
  onFlagCell: (row: number, col: number) => void;
  isPlayerLocked: boolean; // Pass down player lock status
}

const Board: React.FC<BoardProps> = ({ boardData, onRevealCell, onFlagCell, isPlayerLocked }) => {
  if (!boardData || boardData.length === 0) {
    return <div>Loading board...</div>;
  }

  const numRows = boardData.length;
  const numCols = boardData[0].length;

  return (
    <div
      className="board" // Use styles.board if using CSS Modules
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${numCols}, 30px)`, // Adjust cell size as needed
        gridTemplateRows: `repeat(${numRows}, 30px)`,
        gap: '1px', // Small gap between cells
        border: '1px solid #999',
        width: 'fit-content', // Size board to content
        // Add styles to visually indicate if the board is locked
        opacity: isPlayerLocked ? 0.6 : 1,
        cursor: isPlayerLocked ? 'not-allowed' : 'default',
      }}
    >
      {boardData.map((row, rowIndex) =>
        row.map((cell, colIndex) => (
          <Cell
            key={`${rowIndex}-${colIndex}`}
            cellData={cell}
            rowIndex={rowIndex}
            colIndex={colIndex}
            onReveal={onRevealCell}
            onFlag={onFlagCell}
            isLocked={isPlayerLocked} // Pass lock status to Cell
          />
        ))
      )}
    </div>
  );
};

export default Board;
