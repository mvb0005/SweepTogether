import React from 'react';
import { ChunkMap, ViewportState } from '../types';

interface BoardSVGProps {
  chunkMap: ChunkMap;
  chunkSize: number;
  viewport: ViewportState;
  onRevealCell: (x: number, y: number) => void;
  onFlagCell: (x: number, y: number) => void;
  onChordCell: (x: number, y: number) => void;
  isPlayerLocked: boolean;
}

const CELL_SIZE = 30; // px

// Classic Minesweeper number colors
const numberColors: Record<number, string> = {
  1: '#0000ff', // blue
  2: '#008000', // green
  3: '#ff0000', // red
  4: '#000080', // dark blue
  5: '#800000', // maroon
  6: '#008080', // teal
  7: '#000000', // black
  8: '#808080', // gray
};

const BoardSVG: React.FC<BoardSVGProps> = ({
  chunkMap,
  chunkSize,
  viewport,
  onRevealCell,
  onFlagCell,
  onChordCell,
  isPlayerLocked
}) => {
  // Calculate visible area in world coordinates
  const worldLeft = viewport.center.x - viewport.width / 2;
  const worldTop = viewport.center.y - viewport.height / 2;
  const worldRight = viewport.center.x + viewport.width / 2;
  const worldBottom = viewport.center.y + viewport.height / 2;

  // SVG viewBox
  const viewBox = `${worldLeft * CELL_SIZE} ${worldTop * CELL_SIZE} ${viewport.width * CELL_SIZE} ${viewport.height * CELL_SIZE}`;

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={viewBox}
      style={{ display: 'block', background: '#e0e0e0', userSelect: 'none' }}
    >
      {Object.values(chunkMap).map(chunk => {
        const chunkOffsetX = chunk.coords.x * chunkSize;
        const chunkOffsetY = chunk.coords.y * chunkSize;
        return chunk.cells.map((row, y) =>
          row.map((cell, x) => {
            const worldX = chunkOffsetX + x;
            const worldY = chunkOffsetY + y;
            // Only render cells in the visible area
            if (
              worldX < worldLeft ||
              worldX >= worldRight ||
              worldY < worldTop ||
              worldY >= worldBottom
            ) {
              return null;
            }
            let fill = '#ccc';
            if (cell.revealed) fill = '#eee';
            if (cell.flagged && !cell.revealed) fill = '#ffd700';
            return (
              <g key={`${worldX},${worldY}`}
                 style={{ pointerEvents: 'auto' }}>
                {/* Cell background */}
                <rect
                  x={worldX * CELL_SIZE}
                  y={worldY * CELL_SIZE}
                  width={CELL_SIZE}
                  height={CELL_SIZE}
                  fill={fill}
                  stroke="#999"
                  strokeWidth={1}
                  onClick={() => {
                    console.log('Cell clicked:', worldX, worldY, { isPlayerLocked });
                    if (!isPlayerLocked) onRevealCell(worldX, worldY);
                  }}
                  onContextMenu={e => {
                    e.preventDefault();
                    if (!isPlayerLocked) onFlagCell(worldX, worldY);
                  }}
                  onDoubleClick={() => !isPlayerLocked && onChordCell(worldX, worldY)}
                  style={{ cursor: isPlayerLocked ? 'not-allowed' : 'pointer', pointerEvents: 'auto' }}
                />
                {/* Render mine, flag, or number */}
                {cell.revealed && cell.isMine && (
                  <text
                    x={worldX * CELL_SIZE + CELL_SIZE / 2}
                    y={worldY * CELL_SIZE + CELL_SIZE / 2 + 6}
                    textAnchor="middle"
                    fontSize={20}
                    style={{ userSelect: 'none', pointerEvents: 'none' }}
                  >💣</text>
                )}
                {cell.flagged && !cell.revealed && (
                  <text
                    x={worldX * CELL_SIZE + CELL_SIZE / 2}
                    y={worldY * CELL_SIZE + CELL_SIZE / 2 + 6}
                    textAnchor="middle"
                    fontSize={20}
                    style={{ userSelect: 'none', pointerEvents: 'none' }}
                  >🚩</text>
                )}
                {cell.revealed && !cell.isMine && cell.adjacentMines !== undefined && cell.adjacentMines > 0 && (
                  <text
                    x={worldX * CELL_SIZE + CELL_SIZE / 2}
                    y={worldY * CELL_SIZE + CELL_SIZE / 2 + 6}
                    textAnchor="middle"
                    fontSize={16}
                    fill={numberColors[cell.adjacentMines] || '#333'}
                    style={{ userSelect: 'none', pointerEvents: 'none' }}
                  >{cell.adjacentMines}</text>
                )}
              </g>
            );
          })
        );
      })}
    </svg>
  );
};

export default BoardSVG; 