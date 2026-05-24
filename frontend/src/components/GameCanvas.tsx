import React, { useCallback, useEffect, useRef } from 'react';
import { ChunkMap } from '../types';
import { useViewportContext } from '../contexts/ViewportContext';
import { useGameContext } from '../contexts/GameContext';
import { BoardRenderer, screenToWorldCell } from '../renderer';

interface GameCanvasProps {
  chunks: ChunkMap;
  chunkSize: number;
}

const DRAG_THRESHOLD_PX = 4;

const GameCanvas: React.FC<GameCanvasProps> = ({ chunks, chunkSize }) => {
  const {
    viewport,
    cellPx,
    onPanStart,
    onPanMove,
    onPanEnd,
    onZoom,
    setHoverCell,
  } = useViewportContext();
  const { isPlayerLocked, onRevealCell, onFlagCell, onChordCell } = useGameContext();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<BoardRenderer | null>(null);
  const rafRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const panStartRef = useRef<{ x: number; y: number } | null>(null);

  const chunksRef = useRef(chunks);
  chunksRef.current = chunks;
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const cellPxRef = useRef(cellPx);
  cellPxRef.current = cellPx;

  const paint = useCallback(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.render({
      chunks: chunksRef.current,
      chunkSize,
      viewport: viewportRef.current,
      cellPx: cellPxRef.current,
    });
  }, [chunkSize]);

  const schedulePaint = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      paint();
    });
  }, [paint]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    rendererRef.current = new BoardRenderer(canvas);
    schedulePaint();
  }, [schedulePaint]);

  useEffect(() => {
    schedulePaint();
  }, [chunks, viewport, cellPx, schedulePaint]);

  useEffect(() => {
    window.addEventListener('resize', schedulePaint);
    return () => window.removeEventListener('resize', schedulePaint);
  }, [schedulePaint]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const delta = Math.max(-0.3, Math.min(0.3, -e.deltaY * 0.002));
      onZoom(delta);
    };
    canvas.addEventListener('wheel', handler, { passive: false });
    return () => canvas.removeEventListener('wheel', handler);
  }, [onZoom]);

  const pickCell = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return screenToWorldCell(
      clientX,
      clientY,
      canvas.getBoundingClientRect(),
      viewportRef.current,
      cellPxRef.current,
    );
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="game-canvas"
      aria-label="Minesweeper board"
      style={{ cursor: isPlayerLocked ? 'not-allowed' : 'crosshair' }}
      onMouseDown={e => {
        if (e.button === 0) {
          draggingRef.current = false;
          panStartRef.current = { x: e.clientX, y: e.clientY };
          onPanStart(e.clientX, e.clientY);
        }
      }}
      onMouseMove={e => {
        const cell = pickCell(e.clientX, e.clientY);
        setHoverCell(cell ? { x: cell.worldX, y: cell.worldY } : null);

        if (e.buttons === 1 && panStartRef.current) {
          const dx = e.clientX - panStartRef.current.x;
          const dy = e.clientY - panStartRef.current.y;
          if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) draggingRef.current = true;
          onPanMove(e.clientX, e.clientY);
        }
      }}
      onMouseUp={() => {
        onPanEnd();
        panStartRef.current = null;
      }}
      onMouseLeave={() => {
        onPanEnd();
        panStartRef.current = null;
        setHoverCell(null);
      }}
      onClick={e => {
        if (draggingRef.current || isPlayerLocked) return;
        const cell = pickCell(e.clientX, e.clientY);
        if (cell) onRevealCell(cell.worldX, cell.worldY);
      }}
      onDoubleClick={e => {
        if (isPlayerLocked) return;
        const cell = pickCell(e.clientX, e.clientY);
        if (cell) onChordCell(cell.worldX, cell.worldY);
      }}
      onContextMenu={e => {
        e.preventDefault();
        if (isPlayerLocked) return;
        const cell = pickCell(e.clientX, e.clientY);
        if (cell) onFlagCell(cell.worldX, cell.worldY);
      }}
    />
  );
};

export default GameCanvas;
