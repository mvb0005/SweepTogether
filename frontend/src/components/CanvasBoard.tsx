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

// ─── Render passes ─────────────────────────────────────────────────────────

interface DrawParams {
  ctx: CanvasRenderingContext2D;
  worldLeft: number;
  worldTop: number;
  logW: number;
  logH: number;
  cellPx: number;
  chunkSize: number;
  visMinCx: number;
  visMaxCx: number;
  visMinCy: number;
  visMaxCy: number;
}

function drawBackground(p: DrawParams, allChunks: ChunkMap): void {
  // Dark void, then lighter fill only for subscribed chunks.
  p.ctx.fillStyle = '#9e9e9e';
  p.ctx.fillRect(0, 0, p.logW, p.logH);

  p.ctx.fillStyle = '#bdbdbd';
  const chunkPx = p.chunkSize * p.cellPx;
  for (let cx = p.visMinCx; cx <= p.visMaxCx; cx++) {
    for (let cy = p.visMinCy; cy <= p.visMaxCy; cy++) {
      if (!allChunks[`${cx}_${cy}`]) continue;
      const csx = (cx * p.chunkSize - p.worldLeft) * p.cellPx;
      const csy = (cy * p.chunkSize - p.worldTop)  * p.cellPx;
      p.ctx.fillRect(csx, csy, chunkPx, chunkPx);
    }
  }
}

function drawGridLines(p: DrawParams): void {
  if (p.cellPx < 2) return;

  const c0 = Math.floor(p.worldLeft);
  const c1 = Math.ceil(p.worldLeft + p.logW / p.cellPx) + 1;
  const r0 = Math.floor(p.worldTop);
  const r1 = Math.ceil(p.worldTop + p.logH / p.cellPx) + 1;

  p.ctx.lineWidth = 1;
  p.ctx.strokeStyle = 'rgba(0,0,0,0.1)';
  p.ctx.beginPath();
  for (let c = c0; c <= c1; c++) {
    if (c % p.chunkSize === 0) continue;
    const sx = Math.round((c - p.worldLeft) * p.cellPx) + 0.5;
    p.ctx.moveTo(sx, 0); p.ctx.lineTo(sx, p.logH);
  }
  for (let r = r0; r <= r1; r++) {
    if (r % p.chunkSize === 0) continue;
    const sy = Math.round((r - p.worldTop) * p.cellPx) + 0.5;
    p.ctx.moveTo(0, sy); p.ctx.lineTo(p.logW, sy);
  }
  p.ctx.stroke();

  p.ctx.strokeStyle = 'rgba(80,120,200,0.6)';
  p.ctx.lineWidth = 2;
  p.ctx.beginPath();
  for (let c = c0; c <= c1; c++) {
    if (c % p.chunkSize !== 0) continue;
    const sx = Math.round((c - p.worldLeft) * p.cellPx) + 0.5;
    p.ctx.moveTo(sx, 0); p.ctx.lineTo(sx, p.logH);
  }
  for (let r = r0; r <= r1; r++) {
    if (r % p.chunkSize !== 0) continue;
    const sy = Math.round((r - p.worldTop) * p.cellPx) + 0.5;
    p.ctx.moveTo(0, sy); p.ctx.lineTo(p.logW, sy);
  }
  p.ctx.stroke();
}

function drawCells(p: DrawParams, allChunks: ChunkMap): void {
  p.ctx.font = `${p.cellPx * 0.65}px serif`;
  p.ctx.textAlign = 'center';
  p.ctx.textBaseline = 'middle';

  for (let cx = p.visMinCx; cx <= p.visMaxCx; cx++) {
    for (let cy = p.visMinCy; cy <= p.visMaxCy; cy++) {
      const chunk = allChunks[`${cx}_${cy}`];
      if (!chunk) continue;
      const baseX = cx * p.chunkSize;
      const baseY = cy * p.chunkSize;

      for (let lcy = 0; lcy < chunk.cells.length; lcy++) {
        const row = chunk.cells[lcy];
        for (let lcx = 0; lcx < row.length; lcx++) {
          const cell = row[lcx];
          if (!cell.revealed && !cell.flagged) continue;

          const sx = (baseX + lcx - p.worldLeft) * p.cellPx;
          const sy = (baseY + lcy - p.worldTop)  * p.cellPx;

          p.ctx.fillStyle = cell.revealed ? '#eeeeee' : '#ffd700';
          p.ctx.fillRect(sx, sy, p.cellPx - 1, p.cellPx - 1);

          if (cell.revealed && cell.isMine) {
            p.ctx.fillText('💣', sx + p.cellPx / 2, sy + p.cellPx / 2);
          } else if (cell.flagged && !cell.revealed) {
            p.ctx.fillText('🚩', sx + p.cellPx / 2, sy + p.cellPx / 2);
          } else if (cell.revealed && !cell.isMine && cell.adjacentMines && cell.adjacentMines > 0) {
            p.ctx.fillStyle = NUMBER_COLORS[cell.adjacentMines] ?? '#333';
            p.ctx.font = `bold ${Math.max(8, p.cellPx * 0.5)}px monospace`;
            p.ctx.textAlign = 'center';
            p.ctx.textBaseline = 'middle';
            p.ctx.fillText(String(cell.adjacentMines), sx + p.cellPx / 2, sy + p.cellPx / 2);
            p.ctx.font = `${p.cellPx * 0.65}px serif`;
          }
        }
      }
    }
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

const CanvasBoard: React.FC<CanvasBoardProps> = ({ chunks, chunkSize }) => {
  const { viewport, onPanStart, onPanMove, onPanEnd } = useViewportContext();
  const { isPlayerLocked, onRevealCell, onFlagCell, onChordCell } = useGameContext();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draggingRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  const chunksRef = useRef(chunks);
  chunksRef.current = chunks;
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  // Stable refs so touch handler useEffect never needs to re-register
  const onPanStartRef = useRef(onPanStart);
  const onPanMoveRef = useRef(onPanMove);
  const onPanEndRef = useRef(onPanEnd);
  const onRevealCellRef = useRef(onRevealCell);
  const onFlagCellRef = useRef(onFlagCell);
  const onChordCellRef = useRef(onChordCell);
  const isPlayerLockedRef = useRef(isPlayerLocked);
  onPanStartRef.current = onPanStart;
  onPanMoveRef.current = onPanMove;
  onPanEndRef.current = onPanEnd;
  onRevealCellRef.current = onRevealCell;
  onFlagCellRef.current = onFlagCell;
  onChordCellRef.current = onChordCell;
  isPlayerLockedRef.current = isPlayerLocked;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const vp = viewportRef.current;
    const allChunks = chunksRef.current;
    const cellPx = BASE_CELL_PX;
    const dpr = window.devicePixelRatio || 1;

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
    const visMinCx = Math.floor(worldLeft / chunkSize);
    const visMaxCx = Math.floor((worldLeft + logW / cellPx) / chunkSize);
    const visMinCy = Math.floor(worldTop  / chunkSize);
    const visMaxCy = Math.floor((worldTop  + logH / cellPx) / chunkSize);

    const p: DrawParams = {
      ctx, worldLeft, worldTop, logW, logH, cellPx, chunkSize,
      visMinCx, visMaxCx, visMinCy, visMaxCy,
    };

    drawBackground(p, allChunks);
    drawGridLines(p);
    drawCells(p, allChunks);
  }, [chunkSize]); // stable — reads everything else from refs

  const scheduleDraw = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      draw();
    });
  }, [draw]);

  useEffect(() => { scheduleDraw(); }, [chunks, viewport, scheduleDraw]);

  useEffect(() => {
    window.addEventListener('resize', scheduleDraw);
    return () => window.removeEventListener('resize', scheduleDraw);
  }, [scheduleDraw]);

  const getWorldCell = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const cellPx = BASE_CELL_PX;
    const vp = viewportRef.current;
    const worldLeft = vp.center.x - vp.width / 2;
    const worldTop  = vp.center.y - vp.height / 2;
    return {
      worldX: Math.floor((clientX - rect.left) / cellPx + worldLeft),
      worldY: Math.floor((clientY - rect.top)  / cellPx + worldTop),
    };
  }, []);

  // Touch handling — registered with passive:false so preventDefault stops scroll
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const LONG_PRESS_MS = 500;
    const DRAG_THRESHOLD_PX = 10;

    let touchStartX = 0;
    let touchStartY = 0;
    let touchDragging = false;
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;
    let lastTapTime = 0;

    const clearLongPress = () => {
      if (longPressTimer !== null) { clearTimeout(longPressTimer); longPressTimer = null; }
    };

    const cellFromTouch = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const vp = viewportRef.current;
      const worldLeft = vp.center.x - vp.width / 2;
      const worldTop  = vp.center.y - vp.height / 2;
      return {
        worldX: Math.floor((clientX - rect.left) / BASE_CELL_PX + worldLeft),
        worldY: Math.floor((clientY - rect.top)  / BASE_CELL_PX + worldTop),
      };
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) { clearLongPress(); return; }
      e.preventDefault();
      const t = e.touches[0];
      touchStartX = t.clientX;
      touchStartY = t.clientY;
      touchDragging = false;
      onPanStartRef.current(t.clientX, t.clientY);

      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        if (!touchDragging && !isPlayerLockedRef.current) {
          const { worldX, worldY } = cellFromTouch(touchStartX, touchStartY);
          onFlagCellRef.current(worldX, worldY);
        }
      }, LONG_PRESS_MS);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      e.preventDefault();
      const t = e.touches[0];
      if (!touchDragging && Math.hypot(t.clientX - touchStartX, t.clientY - touchStartY) > DRAG_THRESHOLD_PX) {
        touchDragging = true;
        clearLongPress();
      }
      if (touchDragging) onPanMoveRef.current(t.clientX, t.clientY);
    };

    const handleTouchEnd = (e: TouchEvent) => {
      e.preventDefault();
      clearLongPress();
      onPanEndRef.current();

      if (!touchDragging && e.changedTouches.length === 1) {
        const t = e.changedTouches[0];
        const now = Date.now();
        const { worldX, worldY } = cellFromTouch(t.clientX, t.clientY);
        if (now - lastTapTime < 300) {
          lastTapTime = 0;
          if (!isPlayerLockedRef.current) onChordCellRef.current(worldX, worldY);
        } else {
          lastTapTime = now;
          if (!isPlayerLockedRef.current) onRevealCellRef.current(worldX, worldY);
        }
      }
      touchDragging = false;
    };

    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove',  handleTouchMove,  { passive: false });
    canvas.addEventListener('touchend',   handleTouchEnd,   { passive: false });

    return () => {
      canvas.removeEventListener('touchstart', handleTouchStart);
      canvas.removeEventListener('touchmove',  handleTouchMove);
      canvas.removeEventListener('touchend',   handleTouchEnd);
      clearLongPress();
    };
  }, []); // stable — all callbacks accessed via refs

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
