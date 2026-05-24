import { CHUNK_BUFFER, CHUNK_DIRECTION_EXTRA, CHUNK_SIZE } from './constants';
import { ChunkCoords, ViewportState } from './types';

const MAX_BUFFER_RADIUS = 12;

/** Chunk indices overlapping the viewport in world cell space. */
export function getViewportChunkBounds(
  viewport: ViewportState,
  chunkSize: number = CHUNK_SIZE,
): { minX: number; maxX: number; minY: number; maxY: number } {
  const worldLeft = viewport.center.x - viewport.width / 2;
  const worldTop = viewport.center.y - viewport.height / 2;
  const worldRight = worldLeft + viewport.width;
  const worldBottom = worldTop + viewport.height;

  return {
    minX: Math.floor(worldLeft / chunkSize),
    maxX: Math.floor((worldRight - 1e-6) / chunkSize),
    minY: Math.floor(worldTop / chunkSize),
    maxY: Math.floor((worldBottom - 1e-6) / chunkSize),
  };
}

export function enumerateChunks(minX: number, maxX: number, minY: number, maxY: number): ChunkCoords[] {
  const chunks: ChunkCoords[] = [];
  for (let cx = minX; cx <= maxX; cx++) {
    for (let cy = minY; cy <= maxY; cy++) {
      chunks.push({ x: cx, y: cy });
    }
  }
  return chunks;
}

/** Grows buffer when zoomed out so panning does not outrun subscriptions. */
export function getBufferRadius(viewport: ViewportState, chunkSize: number = CHUNK_SIZE): number {
  const { minX, maxX, minY, maxY } = getViewportChunkBounds(viewport, chunkSize);
  const span = Math.max(maxX - minX + 1, maxY - minY + 1);
  return Math.max(CHUNK_BUFFER, Math.min(MAX_BUFFER_RADIUS, Math.ceil(span / 2)));
}

export function getVisibleChunks(viewport: ViewportState, chunkSize: number = CHUNK_SIZE): ChunkCoords[] {
  const b = getViewportChunkBounds(viewport, chunkSize);
  return enumerateChunks(b.minX, b.maxX, b.minY, b.maxY);
}

export function getBufferedChunks(
  viewport: ViewportState,
  chunkSize: number,
  panDir: { dx: number; dy: number },
): ChunkCoords[] {
  const b = getViewportChunkBounds(viewport, chunkSize);
  const pad = getBufferRadius(viewport, chunkSize);

  const bufMinX = b.minX - pad - (panDir.dx < 0 ? CHUNK_DIRECTION_EXTRA : 0);
  const bufMaxX = b.maxX + pad + (panDir.dx > 0 ? CHUNK_DIRECTION_EXTRA : 0);
  const bufMinY = b.minY - pad - (panDir.dy < 0 ? CHUNK_DIRECTION_EXTRA : 0);
  const bufMaxY = b.maxY + pad + (panDir.dy > 0 ? CHUNK_DIRECTION_EXTRA : 0);

  return enumerateChunks(bufMinX, bufMaxX, bufMinY, bufMaxY);
}
