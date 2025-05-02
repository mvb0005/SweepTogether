import React, { useRef, useEffect, MouseEvent } from 'react';
import { BoardState, ViewportState, Coordinates } from '../types';
import Cell from './Cell';

interface BoardProps {
  boardData: BoardState | null;
  onRevealCell: (worldX: number, worldY: number) => void;
  onFlagCell: (worldX: number, worldY: number) => void;
  onChordCell: (worldX: number, worldY: number) => void;
  isPlayerLocked: boolean;
  viewport: ViewportState;
  onPanStart: (clientX: number, clientY: number) => void;
  onPanMove: (clientX: number, clientY: number) => void;
  onPanEnd: () => void;
  cellSize?: number;
}

const Board: React.FC<BoardProps> = ({ 
  boardData, 
  onRevealCell, 
  onFlagCell, 
  onChordCell,
  isPlayerLocked,
  viewport,
  onPanStart,
  onPanMove,
  onPanEnd,
  cellSize = 30
}) => {
  const boardRef = useRef<HTMLDivElement>(null);
  
  // Create coordinate conversion functions based on the current viewport
  const worldToViewportCoords = (worldX: number, worldY: number): { row: number, col: number } | null => {
    const halfWidth = Math.floor(viewport.width / 2);
    const halfHeight = Math.floor(viewport.height / 2);
    
    const minX = viewport.center.x - halfWidth;
    const minY = viewport.center.y - halfHeight;
    
    // Check if the world coordinates are within our current viewport
    const viewportX = worldX - minX;
    const viewportY = worldY - minY;
    
    if (viewportX < 0 || viewportX >= viewport.width || viewportY < 0 || viewportY >= viewport.height) {
      return null;
    }
    
    return { row: viewportY, col: viewportX };
  };
  
  const viewportToWorldCoords = (row: number, col: number): Coordinates => {
    const halfWidth = Math.floor(viewport.width / 2);
    const halfHeight = Math.floor(viewport.height / 2);
    
    const worldX = viewport.center.x - halfWidth + col;
    const worldY = viewport.center.y - halfHeight + row;
    
    return { x: worldX, y: worldY };
  };

  // Mouse event handlers for panning
  const handleMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    // Middle button (wheel) or holding Ctrl/Cmd for panning
    if (e.button === 1 || (e.button === 0 && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      onPanStart(e.clientX, e.clientY);
    }
  };

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    onPanMove(e.clientX, e.clientY);
  };

  const handleMouseUp = () => {
    onPanEnd();
  };

  const handleMouseLeave = () => {
    onPanEnd();
  };

  // Focus the board element when mounted so keyboard controls work
  useEffect(() => {
    if (boardRef.current) {
      boardRef.current.focus();
    }
  }, []);

  if (!boardData) {
    return <div className="board-container"><div className="loading">Loading board...</div></div>;
  }

  // Generate visible cells based on the current viewport
  const renderCells = () => {
    const cells = [];
    
    for (let row = 0; row < viewport.height; row++) {
      for (let col = 0; col < viewport.width; col++) {
        // Convert viewport coordinates to world coordinates
        const worldCoords = viewportToWorldCoords(row, col);
        
        // Default empty cell if we don't have data
        let cellData = {
          revealed: false,
          flagged: false
        };
        
        // Try to find this cell in the provided boardData
        // In infinite mode, boardData will be a sparse representation
        if (boardData[row] && boardData[row][col]) {
          cellData = boardData[row][col];
        }
        
        cells.push(
          <Cell
            key={`${row}-${col}`}
            cellData={cellData}
            rowIndex={row}
            colIndex={col}
            onReveal={() => onRevealCell(worldCoords.x, worldCoords.y)}
            onFlag={() => onFlagCell(worldCoords.x, worldCoords.y)}
            onChord={() => onChordCell(worldCoords.x, worldCoords.y)}
            isLocked={isPlayerLocked}
          />
        );
      }
    }
    
    return cells;
  };

  // Calculate grid size based on viewport dimensions and cell size
  const gridStyle = {
    display: 'grid',
    gridTemplateColumns: `repeat(${viewport.width}, ${cellSize}px)`,
    gridTemplateRows: `repeat(${viewport.height}, ${cellSize}px)`,
    gap: '1px',
    border: '1px solid #999',
    userSelect: 'none' as const,
    cursor: 'pointer'
  };

  // Add viewport position indicator
  const viewportInfo = `Viewport: (${viewport.center.x}, ${viewport.center.y})`;

  return (
    <div className="board-container">
      <div className="viewport-info">{viewportInfo}</div>
      <div
        ref={boardRef}
        className="board"
        style={gridStyle}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        tabIndex={0} // Make the div focusable for keyboard controls
      >
        {renderCells()}
      </div>
      <div className="controls-help">
        <p>Pan: WASD/Arrow keys or middle mouse button/Ctrl+drag</p>
      </div>
    </div>
  );
};

export default Board;
