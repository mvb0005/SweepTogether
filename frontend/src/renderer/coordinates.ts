import { ViewportState } from '../types';

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface WorldPoint {
  worldX: number;
  worldY: number;
}

/** World-space top-left corner of the viewport (cell units, may be fractional). */
export function viewportWorldOrigin(viewport: ViewportState): { left: number; top: number } {
  return {
    left: viewport.center.x - viewport.width / 2,
    top: viewport.center.y - viewport.height / 2,
  };
}

export function screenToWorldCell(
  clientX: number,
  clientY: number,
  canvasRect: DOMRect,
  viewport: ViewportState,
  cellPx: number,
): WorldPoint {
  const { left, top } = viewportWorldOrigin(viewport);
  return {
    worldX: Math.floor((clientX - canvasRect.left) / cellPx + left),
    worldY: Math.floor((clientY - canvasRect.top) / cellPx + top),
  };
}

export function worldCellToScreen(
  worldX: number,
  worldY: number,
  viewport: ViewportState,
  cellPx: number,
): ScreenPoint {
  const { left, top } = viewportWorldOrigin(viewport);
  return {
    x: (worldX - left) * cellPx,
    y: (worldY - top) * cellPx,
  };
}
