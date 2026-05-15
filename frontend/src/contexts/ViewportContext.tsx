import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useViewport } from '../hooks/useViewport';
import { ChunkCoords, Coordinates, ViewportState } from '../types';

const CELL_SIZE = 30;
const CHUNK_BUFFER = 3;
const DIRECTION_EXTRA = 1;

export interface ViewportContextValue {
  viewport: ViewportState;
  scale: number;
  /** Chunks exactly within the visible viewport — subscribe immediately. */
  immediateChunks: ChunkCoords[];
  /** Visible + buffer + directional bias — subscribe after debounce. */
  bufferedChunks: ChunkCoords[];
  onPanStart: (clientX: number, clientY: number) => void;
  onPanMove: (clientX: number, clientY: number) => void;
  onPanEnd: () => void;
  onZoom: (delta: number) => void;
}

const ViewportContext = createContext<ViewportContextValue | null>(null);

interface ViewportProviderProps {
  chunkSize: number;
  initialCenter?: Coordinates;
  children: React.ReactNode;
}

function getImmediateChunks(viewport: ViewportState, chunkSize: number): ChunkCoords[] {
  const minX = Math.floor((viewport.center.x - viewport.width / 2) / chunkSize);
  const maxX = Math.floor((viewport.center.x + viewport.width / 2) / chunkSize);
  const minY = Math.floor((viewport.center.y - viewport.height / 2) / chunkSize);
  const maxY = Math.floor((viewport.center.y + viewport.height / 2) / chunkSize);
  const chunks: ChunkCoords[] = [];
  for (let cx = minX; cx <= maxX; cx++)
    for (let cy = minY; cy <= maxY; cy++)
      chunks.push({ x: cx, y: cy });
  return chunks;
}

function getBufferedChunks(
  viewport: ViewportState,
  chunkSize: number,
  panDir: { dx: number; dy: number }
): ChunkCoords[] {
  const minX = Math.floor((viewport.center.x - viewport.width / 2) / chunkSize);
  const maxX = Math.floor((viewport.center.x + viewport.width / 2) / chunkSize);
  const minY = Math.floor((viewport.center.y - viewport.height / 2) / chunkSize);
  const maxY = Math.floor((viewport.center.y + viewport.height / 2) / chunkSize);

  const bufMinX = minX - CHUNK_BUFFER - (panDir.dx < 0 ? DIRECTION_EXTRA : 0);
  const bufMaxX = maxX + CHUNK_BUFFER + (panDir.dx > 0 ? DIRECTION_EXTRA : 0);
  const bufMinY = minY - CHUNK_BUFFER - (panDir.dy < 0 ? DIRECTION_EXTRA : 0);
  const bufMaxY = maxY + CHUNK_BUFFER + (panDir.dy > 0 ? DIRECTION_EXTRA : 0);

  const chunks: ChunkCoords[] = [];
  for (let cx = bufMinX; cx <= bufMaxX; cx++)
    for (let cy = bufMinY; cy <= bufMaxY; cy++)
      chunks.push({ x: cx, y: cy });
  return chunks;
}

export const ViewportProvider: React.FC<ViewportProviderProps> = ({
  chunkSize,
  initialCenter,
  children
}) => {
  const [scale, setScale] = useState(1.0);
  const cellSizePx = CELL_SIZE * scale;

  const {
    viewport,
    handlePanStart,
    handlePanMove,
    handlePanEnd,
    resizeTo,
  } = useViewport({
    initialCenter: initialCenter ?? { x: 0, y: 0 },
    initialWidth: Math.ceil(window.innerWidth / CELL_SIZE),
    initialHeight: Math.ceil(window.innerHeight / CELL_SIZE),
    cellSizePx,
  });

  useEffect(() => {
    resizeTo(
      Math.ceil(window.innerWidth / cellSizePx),
      Math.ceil(window.innerHeight / cellSizePx),
    );
  }, [scale]); // eslint-disable-line react-hooks/exhaustive-deps

  const onZoom = useCallback((delta: number) => {
    setScale(s => Math.max(0.1, Math.min(4, s * (1 + delta))));
  }, []);

  // Track pan direction from successive center positions without adding state.
  const prevCenterRef = useRef(viewport.center);
  const panDirRef = useRef({ dx: 0, dy: 0 });
  const dx = viewport.center.x - prevCenterRef.current.x;
  const dy = viewport.center.y - prevCenterRef.current.y;
  if (dx !== 0 || dy !== 0) {
    panDirRef.current = { dx: Math.sign(dx), dy: Math.sign(dy) };
    prevCenterRef.current = viewport.center;
  }

  const immediateChunks = getImmediateChunks(viewport, chunkSize);
  const bufferedChunks = getBufferedChunks(viewport, chunkSize, panDirRef.current);

  const value: ViewportContextValue = {
    viewport,
    scale,
    immediateChunks,
    bufferedChunks,
    onPanStart: handlePanStart,
    onPanMove: handlePanMove,
    onPanEnd: handlePanEnd,
    onZoom,
  };

  return (
    <ViewportContext.Provider value={value}>
      {children}
    </ViewportContext.Provider>
  );
};

export function useViewportContext(): ViewportContextValue {
  const ctx = useContext(ViewportContext);
  if (!ctx) throw new Error('useViewportContext must be used within a ViewportProvider');
  return ctx;
}
