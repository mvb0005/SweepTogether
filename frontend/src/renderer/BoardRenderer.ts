import { Chunk, ChunkMap } from '../types';
import { ViewportState } from '../types';
import { getAvatarImage, requestAvatar } from './avatarCache';
import { viewportWorldOrigin } from './coordinates';
import { chunksVisibleInViewport } from './visibleChunks';
import { NUMBER_COLORS, THEME } from './theme';

export interface RenderPlayer {
  id: string;
  username: string;
  color: string;
  avatarUrl?: string;
  displayX: number;
  displayY: number;
  isSelf: boolean;
  isSpeaking?: boolean;
}
export interface BoardRenderFrame {
  chunks: ChunkMap;
  chunkSize: number;
  viewport: ViewportState;
  cellPx: number;
  players: RenderPlayer[];
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
  onAvatarLoaded: (() => void) | null = null;
  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.canvas = canvas;
    this.ctx = ctx;
  }

  render(frame: BoardRenderFrame): void {
    const { chunks, chunkSize, viewport, cellPx, players } = frame;
    const ctx = this.ctx;    this.syncCanvasSize();

    const logW = this.canvas.clientWidth;
    const logH = this.canvas.clientHeight;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, logW, logH);

    const { left: worldLeft, top: worldTop } = viewportWorldOrigin(viewport);
    const visibleChunks = chunksVisibleInViewport(chunks, chunkSize, viewport);

    ctx.fillStyle = THEME.void;
    ctx.fillRect(0, 0, logW, logH);

    ctx.fillStyle = THEME.covered;
    for (const chunk of visibleChunks) {
      const chunkPx = chunkSize * cellPx;
      const sx = (chunk.coords.x * chunkSize - worldLeft) * cellPx;
      const sy = (chunk.coords.y * chunkSize - worldTop) * cellPx;
      if (sx + chunkPx < 0 || sx > logW || sy + chunkPx < 0 || sy > logH) continue;
      ctx.fillRect(sx, sy, chunkPx, chunkPx);
    }

    if (cellPx >= 4) {
      this.drawGrid(ctx, worldLeft, worldTop, logW, logH, cellPx, chunkSize);
    }

    for (const chunk of visibleChunks) {
      this.drawChunkCells(ctx, chunk, chunkSize, worldLeft, worldTop, cellPx, logW, logH);
    }

    this.drawPlayers(ctx, players, worldLeft, worldTop, cellPx, logW, logH);
  }

  private drawPlayers(
    ctx: CanvasRenderingContext2D,
    players: RenderPlayer[],
    worldLeft: number,
    worldTop: number,
    cellPx: number,
    logW: number,
    logH: number,
  ): void {
    const others = players.filter(p => !p.isSelf);
    const self = players.find(p => p.isSelf);
    const drawOrder = self ? [...others, self] : others;

    for (const player of drawOrder) {
      const cellX = Math.floor(player.displayX - 0.5);
      const cellY = Math.floor(player.displayY - 0.5);
      const sx = (cellX - worldLeft) * cellPx;
      const sy = (cellY - worldTop) * cellPx;
      if (sx + cellPx < 0 || sx > logW || sy + cellPx < 0 || sy > logH) continue;

      const cx = sx + cellPx / 2;
      const cy = sy + cellPx / 2;
      const r = cellPx * 0.38;
      const avatar = getAvatarImage(player.avatarUrl);

      if (player.avatarUrl && !avatar) {
        requestAvatar(player.avatarUrl, () => this.onAvatarLoaded?.());
      }

      if (avatar) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(avatar, cx - r, cy - r, r * 2, r * 2);
        ctx.restore();
      } else {
        ctx.fillStyle = player.color;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.strokeStyle = player.isSelf ? '#ffffff' : '#1a1d23';
      ctx.lineWidth = Math.max(2, cellPx * 0.06);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();

      if (player.isSpeaking) {
        ctx.save();
        ctx.strokeStyle = 'rgba(35, 165, 89, 0.35)';
        ctx.lineWidth = Math.max(4, cellPx * 0.12);
        ctx.beginPath();
        ctx.arc(cx, cy, r + ctx.lineWidth * 0.65, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = '#23a559';
        ctx.lineWidth = Math.max(3, cellPx * 0.1);
        ctx.beginPath();
        ctx.arc(cx, cy, r + ctx.lineWidth * 0.35, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      if (!player.isSelf && cellPx >= 10) {
        ctx.fillStyle = '#1a1d23';
        ctx.font = `${Math.max(9, cellPx * 0.34)}px "Segoe UI", system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(player.username, cx, sy - 2);
      }
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
    const size = chunk.size;
    const pad = 0;
    const bevel = Math.max(2, Math.floor(cellPx * 0.12));

    const drawCovered = (sx: number, sy: number, inner: number) => {
      ctx.fillStyle = THEME.covered;
      ctx.fillRect(sx, sy, inner, inner);
      ctx.fillStyle = THEME.coveredHighlight;
      ctx.fillRect(sx, sy, inner, bevel);
      ctx.fillRect(sx, sy, bevel, inner);
      ctx.fillStyle = THEME.coveredShadow;
      ctx.fillRect(sx + inner - bevel, sy, bevel, inner);
      ctx.fillRect(sx, sy + inner - bevel, inner, bevel);
    };

    type CellDrawPos = { sx: number; sy: number; midX: number; midY: number };

    const drawCell = (idx: number, revealed: boolean): CellDrawPos | null => {
      const lx = idx % size;
      const ly = Math.floor(idx / size);
      const sx = (baseX + lx - worldLeft) * cellPx;
      const sy = (baseY + ly - worldTop) * cellPx;
      if (sx + cellPx < 0 || sx > logW || sy + cellPx < 0 || sy > logH) return null;

      const inner = cellPx - pad;
      if (revealed) {
        ctx.fillStyle = THEME.revealed;
        ctx.fillRect(sx, sy, inner, inner);
      } else {
        drawCovered(sx, sy, inner);
      }

      return {
        sx,
        sy,
        midX: sx + cellPx / 2,
        midY: sy + cellPx / 2,
      };
    };

    for (let i = 0; i < chunk.revealed.length; i++) {
      const idx = chunk.revealed[i];
      const pos = drawCell(idx, true);
      if (!pos) continue;

      const adj = chunk.adjMines[i] ?? 0;
      if (adj > 0) {
        ctx.fillStyle = NUMBER_COLORS[adj] ?? '#333';
        ctx.font = `bold ${Math.max(9, cellPx * 0.52)}px "Segoe UI", system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(adj), pos.midX, pos.midY);
      }
    }

    for (const idx of chunk.revealedMines) {
      const pos = drawCell(idx, true);
      if (pos) drawMine(ctx, pos.midX, pos.midY, cellPx * 0.45);
    }

    const revealedSet = new Set([...chunk.revealed, ...chunk.revealedMines]);
    for (const idx of chunk.flagged) {
      if (revealedSet.has(idx)) continue;
      const pos = drawCell(idx, false);
      if (pos) drawFlag(ctx, pos.sx, pos.sy, cellPx);
    }
  }
}
