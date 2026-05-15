import React, { useCallback, useEffect, useRef } from 'react';
import { ChunkMap } from '../types';
import { useViewportContext } from '../contexts/ViewportContext';
import { useGameContext } from '../contexts/GameContext';

interface CanvasBoardProps {
  chunks: ChunkMap;
  chunkSize: number;
}

const BASE_CELL_PX = 30;

const NUMBER_COLORS: Record<number, string> = {
  1: '#0000ff', 2: '#008000', 3: '#ff0000', 4: '#000080',
  5: '#800000', 6: '#008080', 7: '#000000', 8: '#808080',
};

const CanvasBoard: React.FC<CanvasBoardProps> = ({ chunks, chunkSize }) => {
  const { viewport, scale, onPanStart, onPanMove, onPanEnd, onZoom } = useViewportContext();
  const { isPlayerLocked, onRevealCell, onFlagCell, onChordCell } = useGameContext();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draggingRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  // Keep refs pointing to latest values so draw() closure doesn't stale.
  const chunksRef = useRef(chunks);
  chunksRef.current = chunks;
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const vp = viewportRef.current;
    const sc = scaleRef.current;
    const allChunks = chunksRef.current;
    const cellPx = BASE_CELL_PX * sc;
    const dpr = window.devicePixelRatio || 1;

    // Resize canvas buffer to match physical pixels.
    const logW = canvas.clientWidth;
    const logH = canvas.clientHeight;
    if (canvas.width !== logW * dpr || canvas.height !== logH * dpr) {
      canvas.width = logW * dpr;
      canvas.height = logH * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, logW, logH);

    const worldLeft = vp.center.x - vp.width / 2;
    const worldTop  = vp.center.y - vp.height / 2;

    // Void background, then per-chunk fill; unrevealed cells are implied by the background.
    ctx.fillStyle = '#9e9e9e';
    ctx.fillRect(0, 0, logW, logH);
    ctx.fillStyle = '#bdbdbd';
    for (const chunk of Object.values(allChunks)) {
      const chunkPx = chunkSize * cellPx;
      const csx = (chunk.coords.x * chunkSize - worldLeft) * cellPx;
      const csy = (chunk.coords.y * chunkSize - worldTop)  * cellPx;
      if (csx + chunkPx < 0 || csx > logW || csy + chunkPx < 0 || csy > logH) continue;
      ctx.fillRect(csx, csy, chunkPx, chunkPx);
    }

    // Cell grid lines + chunk border guides spanning full viewport.
    if (cellPx >= 2) {
      const c0 = Math.floor(worldLeft);
      const c1 = Math.ceil(worldLeft + logW / cellPx) + 1;
      const r0 = Math.floor(worldTop);
      const r1 = Math.ceil(worldTop + logH / cellPx) + 1;

      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0,0,0,0.1)';
      ctx.beginPath();
      for (let c = c0; c <= c1; c++) {
        if (c % chunkSize === 0) continue;
        const sx = Math.round((c - worldLeft) * cellPx) + 0.5;
        ctx.moveTo(sx, 0); ctx.lineTo(sx, logH);
      }
      for (let r = r0; r <= r1; r++) {
        if (r % chunkSize === 0) continue;
        const sy = Math.round((r - worldTop) * cellPx) + 0.5;
        ctx.moveTo(0, sy); ctx.lineTo(logW, sy);
      }
      ctx.stroke();

      ctx.strokeStyle = 'rgba(80,120,200,0.6)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let c = c0; c <= c1; c++) {
        if (c % chunkSize !== 0) continue;
        const sx = Math.round((c - worldLeft) * cellPx) + 0.5;
        ctx.moveTo(sx, 0); ctx.lineTo(sx, logH);
      }
      for (let r = r0; r <= r1; r++) {
        if (r % chunkSize !== 0) continue;
        const sy = Math.round((r - worldTop) * cellPx) + 0.5;
        ctx.moveTo(0, sy); ctx.lineTo(logW, sy);
      }
      ctx.stroke();
    }

    for (const chunk of Object.values(allChunks)) {
      const baseX = chunk.coords.x * chunkSize;
      const baseY = chunk.coords.y * chunkSize;

      for (let cy = 0; cy < chunk.cells.length; cy++) {
        const row = chunk.cells[cy];
        for (let cx = 0; cx < row.length; cx++) {
          const cell = row[cx];
          if (!cell.revealed && !cell.flagged) continue;

          const sx = (baseX + cx - worldLeft) * cellPx;
          const sy = (baseY + cy - worldTop)  * cellPx;

          if (sx + cellPx < 0 || sx > logW || sy + cellPx < 0 || sy > logH) continue;

          ctx.fillStyle = cell.revealed ? '#eeeeee' : '#ffd700';
          ctx.fillRect(sx, sy, cellPx - 1, cellPx - 1);

          if (cell.revealed && cell.isMine) {
            ctx.font = `${cellPx * 0.65}px serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('💣', sx + cellPx / 2, sy + cellPx / 2);
          } else if (cell.flagged && !cell.revealed) {
            ctx.font = `${cellPx * 0.65}px serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('🚩', sx + cellPx / 2, sy + cellPx / 2);
          } else if (cell.revealed && !cell.isMine && cell.adjacentMines && cell.adjacentMines > 0) {
            ctx.fillStyle = NUMBER_COLORS[cell.adjacentMines] ?? '#333';
            ctx.font = `bold ${Math.max(8, cellPx * 0.5)}px monospace`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(cell.adjacentMines), sx + cellPx / 2, sy + cellPx / 2);
          }
        }
      }
    }
  }, []); // stable — reads everything from refs

  const scheduleDraw = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      draw();
    });
  }, [draw]);

  // Redraw whenever data or viewport changes.
  useEffect(() => {
    scheduleDraw();
  }, [chunks, viewport, scale, scheduleDraw]);

  // Redraw on window resize.
  useEffect(() => {
    window.addEventListener('resize', scheduleDraw);
    return () => window.removeEventListener('resize', scheduleDraw);
  }, [scheduleDraw]);

  // Wheel zoom — must be non-passive to call preventDefault().
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

  const getWorldCell = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const cellPx = BASE_CELL_PX * scaleRef.current;
    const vp = viewportRef.current;
    const worldLeft = vp.center.x - vp.width / 2;
    const worldTop  = vp.center.y - vp.height / 2;
    // Apply Math.floor to the full expression so fractional worldLeft doesn't
    // produce float cell coords (e.g. worldLeft=-31.5 → worldX=0.5).
    return {
      worldX: Math.floor((clientX - rect.left) / cellPx + worldLeft),
      worldY: Math.floor((clientY - rect.top)  / cellPx + worldTop),
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        display: 'block',
        width: '100%',
        height: '100%',
        cursor: isPlayerLocked ? 'not-allowed' : 'default',
      }}
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
      onClick={e => {
        if (draggingRef.current) return;
        const { worldX, worldY } = getWorldCell(e.clientX, e.clientY);
        if (!isPlayerLocked) onRevealCell(worldX, worldY);
      }}
      onDoubleClick={e => {
        const { worldX, worldY } = getWorldCell(e.clientX, e.clientY);
        if (!isPlayerLocked) onChordCell(worldX, worldY);
      }}
      onContextMenu={e => {
        e.preventDefault();
        const { worldX, worldY } = getWorldCell(e.clientX, e.clientY);
        if (!isPlayerLocked) onFlagCell(worldX, worldY);
      }}
    />
  );
};

export default CanvasBoard;
