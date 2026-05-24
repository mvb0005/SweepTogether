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
  MAX_SCALE,
  MIN_SCALE,
} from '../constants';
import { ChunkCoords, Coordinates, ViewportState } from '../types';
import { getBufferedChunks, getVisibleChunks } from '../viewportChunks';

export interface ViewportContextValue {
  viewport: ViewportState;
  scale: number;
  cellPx: number;
  immediateChunks: ChunkCoords[];
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
