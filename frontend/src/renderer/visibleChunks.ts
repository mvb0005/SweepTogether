import { Chunk, ChunkMap, ViewportState } from '../types';
import { viewportWorldOrigin } from './coordinates';

/** Only chunks intersecting the viewport — avoids drawing hundreds of off-screen chunks. */
export function chunksVisibleInViewport(
  chunks: ChunkMap,
  chunkSize: number,
  viewport: ViewportState,
): Chunk[] {
  const { left, top } = viewportWorldOrigin(viewport);
  const right = left + viewport.width;
  const bottom = top + viewport.height;

  const minCX = Math.floor(left / chunkSize);
  const maxCX = Math.floor((right - 1e-6) / chunkSize);
  const minCY = Math.floor(top / chunkSize);
  const maxCY = Math.floor((bottom - 1e-6) / chunkSize);

  const out: Chunk[] = [];
  for (const chunk of Object.values(chunks)) {
    const { x, y } = chunk.coords;
    if (x < minCX || x > maxCX || y < minCY || y > maxCY) continue;
    out.push(chunk);
  }
  return out;
}
