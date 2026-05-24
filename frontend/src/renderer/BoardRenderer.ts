import { getViewportChunkBounds } from '../viewportChunks';
import { Chunk, ChunkMap } from '../types';
import { ViewportState } from '../types';
import { viewportWorldOrigin } from './coordinates';
import { NUMBER_COLORS, THEME } from './theme';

export interface BoardRenderFrame {
  chunks: ChunkMap;
  chunkSize: number;
  viewport: ViewportState;
  cellPx: number;
}

function drawMine(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.fillStyle = THEME.mine;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = THEME.mine;
  ctx.lineWidth = Math.max(1, r * 0.12);
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r * 0.4, cy + Math.sin(a) * r * 0.4);
    ctx.lineTo(cx + Math.cos(a) * r * 0.75, cy + Math.sin(a) * r * 0.75);
    ctx.stroke();
  }
}

function drawFlag(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const poleX = x + size * 0.35;
  const baseY = y + size * 0.78;
  ctx.strokeStyle = '#333';
  ctx.lineWidth = Math.max(1, size * 0.06);
  ctx.beginPath();
  ctx.moveTo(poleX, y + size * 0.18);
  ctx.lineTo(poleX, baseY);
  ctx.stroke();
  ctx.fillStyle = '#e53935';
  ctx.beginPath();
  ctx.moveTo(poleX, y + size * 0.2);
  ctx.lineTo(poleX + size * 0.42, y + size * 0.32);
  ctx.lineTo(poleX, y + size * 0.44);
  ctx.closePath();
  ctx.fill();
}

/**
 * Canvas 2D renderer for the infinite chunk board.
 * Keeps drawing logic out of React so the canvas loop stays cheap.
 */
export class BoardRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.canvas = canvas;
    this.ctx = ctx;
  }

  render(frame: BoardRenderFrame): void {
    const { chunks, chunkSize, viewport, cellPx } = frame;
    const ctx = this.ctx;
    this.syncCanvasSize();

    const logW = this.canvas.clientWidth;
    const logH = this.canvas.clientHeight;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, logW, logH);

    const { left: worldLeft, top: worldTop } = viewportWorldOrigin(viewport);

    ctx.fillStyle = THEME.void;
    ctx.fillRect(0, 0, logW, logH);

    const chunkPx = chunkSize * cellPx;
    const { minX, maxX, minY, maxY } = getViewportChunkBounds(viewport, chunkSize);
    ctx.fillStyle = THEME.covered;
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cy = minY; cy <= maxY; cy++) {
        const sx = (cx * chunkSize - worldLeft) * cellPx;
        const sy = (cy * chunkSize - worldTop) * cellPx;
        if (sx + chunkPx < 0 || sx > logW || sy + chunkPx < 0 || sy > logH) continue;
        ctx.fillRect(sx, sy, chunkPx, chunkPx);
      }
    }

    if (cellPx >= 4) {
      this.drawGrid(ctx, worldLeft, worldTop, logW, logH, cellPx, chunkSize);
    }

    for (const chunk of Object.values(chunks)) {
      this.drawChunkCells(ctx, chunk, chunkSize, worldLeft, worldTop, cellPx, logW, logH);
    }
  }

  private syncCanvasSize(): void {
    this.dpr = window.devicePixelRatio || 1;
    const logW = this.canvas.clientWidth;
    const logH = this.canvas.clientHeight;
    const bufW = Math.round(logW * this.dpr);
    const bufH = Math.round(logH * this.dpr);
    if (this.canvas.width !== bufW || this.canvas.height !== bufH) {
      this.canvas.width = bufW;
      this.canvas.height = bufH;
    }
  }

  private drawGrid(
    ctx: CanvasRenderingContext2D,
    worldLeft: number,
    worldTop: number,
    logW: number,
    logH: number,
    cellPx: number,
    chunkSize: number,
  ): void {
    const c0 = Math.floor(worldLeft);
    const c1 = Math.ceil(worldLeft + logW / cellPx) + 1;
    const r0 = Math.floor(worldTop);
    const r1 = Math.ceil(worldTop + logH / cellPx) + 1;

    ctx.lineWidth = 1;
    ctx.strokeStyle = THEME.grid;
    ctx.beginPath();
    for (let c = c0; c <= c1; c++) {
      if (c % chunkSize === 0) continue;
      const sx = Math.round((c - worldLeft) * cellPx) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, logH);
    }
    for (let r = r0; r <= r1; r++) {
      if (r % chunkSize === 0) continue;
      const sy = Math.round((r - worldTop) * cellPx) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(logW, sy);
    }
    ctx.stroke();

    ctx.strokeStyle = THEME.chunkBorder;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let c = c0; c <= c1; c++) {
      if (c % chunkSize !== 0) continue;
      const sx = Math.round((c - worldLeft) * cellPx) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, logH);
    }
    for (let r = r0; r <= r1; r++) {
      if (r % chunkSize !== 0) continue;
      const sy = Math.round((r - worldTop) * cellPx) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(logW, sy);
    }
    ctx.stroke();
  }

  private drawChunkCells(
    ctx: CanvasRenderingContext2D,
    chunk: Chunk,
    chunkSize: number,
    worldLeft: number,
    worldTop: number,
    cellPx: number,
    logW: number,
    logH: number,
  ): void {
    const baseX = chunk.coords.x * chunkSize;
    const baseY = chunk.coords.y * chunkSize;
    const pad = 1;

    for (let ly = 0; ly < chunk.cells.length; ly++) {
      const row = chunk.cells[ly];
      for (let lx = 0; lx < row.length; lx++) {
        const cell = row[lx];
        if (!cell.revealed && !cell.flagged) continue;

        const sx = (baseX + lx - worldLeft) * cellPx;
        const sy = (baseY + ly - worldTop) * cellPx;
        if (sx + cellPx < 0 || sx > logW || sy + cellPx < 0 || sy > logH) continue;

        const inner = cellPx - pad;
        ctx.fillStyle = cell.revealed ? THEME.revealed : THEME.flagged;
        ctx.fillRect(sx, sy, inner, inner);

        const midX = sx + cellPx / 2;
        const midY = sy + cellPx / 2;

        if (cell.revealed && cell.isMine) {
          drawMine(ctx, midX, midY, cellPx * 0.45);
        } else if (cell.flagged && !cell.revealed) {
          drawFlag(ctx, sx, sy, cellPx);
        } else if (
          cell.revealed &&
          !cell.isMine &&
          cell.adjacentMines &&
          cell.adjacentMines > 0
        ) {
          ctx.fillStyle = NUMBER_COLORS[cell.adjacentMines] ?? '#333';
          ctx.font = `bold ${Math.max(9, cellPx * 0.52)}px "Segoe UI", system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(cell.adjacentMines), midX, midY);
        }
      }
    }
  }
}
