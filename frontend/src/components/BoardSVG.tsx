import React, { useRef } from 'react';
import { ChunkMap } from '../types';
import { useViewportContext } from '../contexts/ViewportContext';
import { useGameContext } from '../contexts/GameContext';

interface BoardSVGProps {
  chunks: ChunkMap;
  chunkSize: number;
}

const CELL_SIZE = 30; // px

const numberColors: Record<number, string> = {
  1: '#0000ff',
  2: '#008000',
  3: '#ff0000',
  4: '#000080',
  5: '#800000',
  6: '#008080',
  7: '#000000',
  8: '#808080',
};

const BoardSVG: React.FC<BoardSVGProps> = ({ chunks, chunkSize }) => {
  const { viewport, onPanStart, onPanMove, onPanEnd, onZoom } = useViewportContext();
  const { isPlayerLocked, onRevealCell, onFlagCell, onChordCell } = useGameContext();

  const draggingRef = useRef(false);

  const worldLeft = viewport.center.x - viewport.width / 2;
  const worldTop = viewport.center.y - viewport.height / 2;
  const worldRight = viewport.center.x + viewport.width / 2;
  const worldBottom = viewport.center.y + viewport.height / 2;

  const viewBox = `${worldLeft * CELL_SIZE} ${worldTop * CELL_SIZE} ${viewport.width * CELL_SIZE} ${viewport.height * CELL_SIZE}`;

  const firstBorderX = Math.ceil(worldLeft / chunkSize) * chunkSize;
  const firstBorderY = Math.ceil(worldTop / chunkSize) * chunkSize;
  const chunkBorderLines: React.ReactElement[] = [];
  for (let cx = firstBorderX; cx <= worldRight; cx += chunkSize) {
    chunkBorderLines.push(
      <line key={`vb-${cx}`} x1={cx * CELL_SIZE} y1={worldTop * CELL_SIZE} x2={cx * CELL_SIZE} y2={worldBottom * CELL_SIZE}
        stroke="rgba(255,0,0,0.5)" strokeWidth={2} strokeDasharray="6 4" style={{ pointerEvents: 'none' }} />
    );
  }
  for (let cy = firstBorderY; cy <= worldBottom; cy += chunkSize) {
    chunkBorderLines.push(
      <line key={`hb-${cy}`} x1={worldLeft * CELL_SIZE} y1={cy * CELL_SIZE} x2={worldRight * CELL_SIZE} y2={cy * CELL_SIZE}
        stroke="rgba(255,0,0,0.5)" strokeWidth={2} strokeDasharray="6 4" style={{ pointerEvents: 'none' }} />
    );
  }

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={viewBox}
      style={{ display: 'block', background: '#e0e0e0', userSelect: 'none' }}
      onMouseDown={e => {
        if (e.button === 0) {
          draggingRef.current = false;
          onPanStart(e.clientX, e.clientY);
        }
      }}
      onMouseMove={e => {
        if (e.buttons === 1) {
          draggingRef.current = true;
          onPanMove(e.clientX, e.clientY);
        }
      }}
      onMouseUp={() => onPanEnd()}
      onMouseLeave={() => onPanEnd()}
      onWheel={e => {
        e.preventDefault();
        const delta = Math.max(-0.3, Math.min(0.3, -e.deltaY * 0.002));
        onZoom(delta);
      }}
    >
      {Object.values(chunks).map(chunk => {
        const chunkOffsetX = chunk.coords.x * chunkSize;
        const chunkOffsetY = chunk.coords.y * chunkSize;
        return chunk.cells.map((row, y) =>
          row.map((cell, x) => {
            const worldX = chunkOffsetX + x;
            const worldY = chunkOffsetY + y;
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
              <g key={`${worldX},${worldY}`} style={{ pointerEvents: 'auto' }}>
                <rect
                  x={worldX * CELL_SIZE}
                  y={worldY * CELL_SIZE}
                  width={CELL_SIZE}
                  height={CELL_SIZE}
                  fill={fill}
                  stroke="#999"
                  strokeWidth={1}
                  onClick={() => {
                    if (draggingRef.current) return;
                    if (!isPlayerLocked) onRevealCell(worldX, worldY);
                  }}
                  onContextMenu={e => {
                    e.preventDefault();
                    if (!isPlayerLocked) onFlagCell(worldX, worldY);
                  }}
                  onDoubleClick={() => {
                    if (!isPlayerLocked) onChordCell(worldX, worldY);
                  }}
                  style={{ cursor: isPlayerLocked ? 'not-allowed' : 'pointer', pointerEvents: 'auto' }}
                />
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
      {chunkBorderLines}
    </svg>
  );
};

export default BoardSVG;
