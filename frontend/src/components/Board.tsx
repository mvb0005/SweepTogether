import React from 'react';
import { ChunkMap, ViewportState } from '../types';
import './Board.css';

interface BoardProps {
  chunkMap: ChunkMap;
  chunkSize: number;
  viewport: ViewportState;
  onRevealCell: (x: number, y: number) => void;
  onFlagCell: (x: number, y: number) => void;
  onChordCell: (x: number, y: number) => void;
  isPlayerLocked: boolean;
  onPanStart: (clientX: number, clientY: number) => void;
  onPanMove: (clientX: number, clientY: number) => void;
  onPanEnd: () => void;
}

const Board: React.FC<BoardProps> = ({
  chunkMap,
  chunkSize,
  viewport,
  onRevealCell,
  onFlagCell,
  onChordCell,
  isPlayerLocked,
  onPanStart,
  onPanMove,
  onPanEnd
}) => {
  const handleCellClick = (x: number, y: number) => {
    if (isPlayerLocked) return;
    onRevealCell(x, y);
  };

  const handleCellRightClick = (e: React.MouseEvent, x: number, y: number) => {
    e.preventDefault();
    if (isPlayerLocked) return;
    onFlagCell(x, y);
  };

  const handleCellDoubleClick = (x: number, y: number) => {
    if (isPlayerLocked) return;
    onChordCell(x, y);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0) { // Left click
      onPanStart(e.clientX, e.clientY);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (e.buttons === 1) { // Left button is pressed
      onPanMove(e.clientX, e.clientY);
    }
  };

  const handleMouseUp = () => {
    onPanEnd();
  };

  const handleMouseLeave = () => {
    onPanEnd();
  };

  // Calculate the visible area in world coordinates
  const worldLeft = viewport.center.x - viewport.width / 2;
  const worldTop = viewport.center.y - viewport.height / 2;
  const worldRight = viewport.center.x + viewport.width / 2;
  const worldBottom = viewport.center.y + viewport.height / 2;

  // Calculate the transform to position the board
  const transform = {
    x: -worldLeft * viewport.scale,
    y: -worldTop * viewport.scale,
    scale: viewport.scale
  };

  return (
    <div
      className="board"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
    >
      <div
        className="board-content"
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          transformOrigin: '0 0'
        }}
      >
        {Object.entries(chunkMap).map(([key, chunk]) => {
          const { coords, cells } = chunk;
          // Position chunks based on their coordinates
          const chunkLeft = coords.x * chunkSize;
          const chunkTop = coords.y * chunkSize;

          return (
            <div
              key={key}
              className="chunk"
              style={{
                position: 'absolute',
                left: `${chunkLeft}px`,
                top: `${chunkTop}px`,
                width: `${chunkSize}px`,
                height: `${chunkSize}px`,
                display: 'grid',
                gridTemplateColumns: `repeat(${chunkSize}, 1fr)`,
                gridTemplateRows: `repeat(${chunkSize}, 1fr)`,
                gap: '1px',
                backgroundColor: '#999',
                border: '1px solid #666'
              }}
            >
              {cells.map((row, y) =>
                row.map((cell, x) => {
                  const worldX = chunkLeft + x;
                  const worldY = chunkTop + y;

                  // Only render cells that are within the viewport
                  if (
                    worldX < worldLeft ||
                    worldX > worldRight ||
                    worldY < worldTop ||
                    worldY > worldBottom
                  ) {
                    return null;
                  }

                  return (
                    <div
                      key={`${x}-${y}`}
                      className={`cell ${cell.revealed ? 'revealed' : ''} ${cell.flagged ? 'flagged' : ''}`}
                      onClick={() => handleCellClick(worldX, worldY)}
                      onContextMenu={(e) => handleCellRightClick(e, worldX, worldY)}
                      onDoubleClick={() => handleCellDoubleClick(worldX, worldY)}
                    >
                      {cell.revealed && !cell.isMine && cell.adjacentMines !== undefined && cell.adjacentMines > 0 && (
                        <span className={`number number-${cell.adjacentMines}`}>
                          {cell.adjacentMines}
                        </span>
                      )}
                      {cell.revealed && cell.isMine && <span className="mine">💣</span>}
                      {cell.flagged && !cell.revealed && <span className="flag">🚩</span>}
                    </div>
                  );
                })
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default Board;
