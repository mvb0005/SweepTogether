import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useViewport } from '../hooks/useViewport';
import {
  BASE_CELL_PX,
  CHUNK_BUFFER,
  CHUNK_DIRECTION_EXTRA,
  MAX_SCALE,
  MIN_SCALE,
} from '../constants';
import { ChunkCoords, Coordinates, ViewportState } from '../types';

export interface ViewportContextValue {
  viewport: ViewportState;
  scale: number;
  cellPx: number;
  /** Chunks in the visible viewport — subscribe immediately. */
  immediateChunks: ChunkCoords[];
  /** Visible + buffer — subscribe after debounce; drives unsubscribe sync. */
  bufferedChunks: ChunkCoords[];
  onPanStart: (clientX: number, clientY: number) => void;
  onPanMove: (clientX: number, clientY: number) => void;
  onPanEnd: () => void;
  onZoom: (delta: number) => void;
  hoverCell: Coordinates | null;
  setHoverCell: (cell: Coordinates | null) => void;
}

const ViewportContext = createContext<ViewportContextValue | null>(null);

interface ViewportProviderProps {
  chunkSize: number;
  initialCenter?: Coordinates;
  children: React.ReactNode;
}

function distSq(cx: number, cy: number, chunkSize: number, center: Coordinates): number {
  const wx = cx * chunkSize + chunkSize / 2;
  const wy = cy * chunkSize + chunkSize / 2;
  return (wx - center.x) ** 2 + (wy - center.y) ** 2;
}

function getVisibleChunks(viewport: ViewportState, chunkSize: number): ChunkCoords[] {
  const minX = Math.floor((viewport.center.x - viewport.width / 2) / chunkSize);
  const maxX = Math.floor((viewport.center.x + viewport.width / 2) / chunkSize);
  const minY = Math.floor((viewport.center.y - viewport.height / 2) / chunkSize);
  const maxY = Math.floor((viewport.center.y + viewport.height / 2) / chunkSize);
  const chunks: ChunkCoords[] = [];
  for (let cx = minX; cx <= maxX; cx++)
    for (let cy = minY; cy <= maxY; cy++)
      chunks.push({ x: cx, y: cy });
  return chunks.sort((a, b) =>
    distSq(a.x, a.y, chunkSize, viewport.center) - distSq(b.x, b.y, chunkSize, viewport.center)
  );
}

function getBufferedChunks(
  viewport: ViewportState,
  chunkSize: number,
  panDir: { dx: number; dy: number },
): ChunkCoords[] {
  const minX = Math.floor((viewport.center.x - viewport.width / 2) / chunkSize);
  const maxX = Math.floor((viewport.center.x + viewport.width / 2) / chunkSize);
  const minY = Math.floor((viewport.center.y - viewport.height / 2) / chunkSize);
  const maxY = Math.floor((viewport.center.y + viewport.height / 2) / chunkSize);

  const bufMinX = minX - CHUNK_BUFFER - (panDir.dx < 0 ? CHUNK_DIRECTION_EXTRA : 0);
  const bufMaxX = maxX + CHUNK_BUFFER + (panDir.dx > 0 ? CHUNK_DIRECTION_EXTRA : 0);
  const bufMinY = minY - CHUNK_BUFFER - (panDir.dy < 0 ? CHUNK_DIRECTION_EXTRA : 0);
  const bufMaxY = maxY + CHUNK_BUFFER + (panDir.dy > 0 ? CHUNK_DIRECTION_EXTRA : 0);

  const chunks: ChunkCoords[] = [];
  for (let cx = bufMinX; cx <= bufMaxX; cx++)
    for (let cy = bufMinY; cy <= bufMaxY; cy++)
      chunks.push({ x: cx, y: cy });
  return chunks.sort((a, b) =>
    distSq(a.x, a.y, chunkSize, viewport.center) - distSq(b.x, b.y, chunkSize, viewport.center)
  );
}

export const ViewportProvider: React.FC<ViewportProviderProps> = ({
  chunkSize,
  initialCenter,
  children,
}) => {
  const [scale, setScale] = useState(1);
  const cellPx = BASE_CELL_PX * scale;
  const [hoverCell, setHoverCell] = useState<Coordinates | null>(null);

  const {
    viewport,
    handlePanStart,
    handlePanMove,
    handlePanEnd,
    resizeTo,
  } = useViewport({
    initialCenter: initialCenter ?? { x: 0, y: 0 },
    initialWidth: Math.ceil(window.innerWidth / BASE_CELL_PX),
    initialHeight: Math.ceil(window.innerHeight / BASE_CELL_PX),
    cellSizePx: cellPx,
  });

  useEffect(() => {
    const onResize = () => {
      resizeTo(
        Math.ceil(window.innerWidth / cellPx),
        Math.ceil(window.innerHeight / cellPx),
      );
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [cellPx, resizeTo]);

  const onZoom = useCallback((delta: number) => {
    setScale(s => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s * (1 + delta))));
  }, []);

  const prevCenterRef = useRef(viewport.center);
  const panDirRef = useRef({ dx: 0, dy: 0 });
  const dx = viewport.center.x - prevCenterRef.current.x;
  const dy = viewport.center.y - prevCenterRef.current.y;
  if (dx !== 0 || dy !== 0) {
    panDirRef.current = { dx: Math.sign(dx), dy: Math.sign(dy) };
    prevCenterRef.current = viewport.center;
  }

  const immediateChunks = getVisibleChunks(viewport, chunkSize);
  const bufferedChunks = getBufferedChunks(viewport, chunkSize, panDirRef.current);

  const value: ViewportContextValue = {
    viewport,
    scale,
    cellPx,
    immediateChunks,
    bufferedChunks,
    onPanStart: handlePanStart,
    onPanMove: handlePanMove,
    onPanEnd: handlePanEnd,
    onZoom,
    hoverCell,
    setHoverCell,
  };

  return <ViewportContext.Provider value={value}>{children}</ViewportContext.Provider>;
};

export function useViewportContext(): ViewportContextValue {
  const ctx = useContext(ViewportContext);
  if (!ctx) throw new Error('useViewportContext must be used within a ViewportProvider');
  return ctx;
}
