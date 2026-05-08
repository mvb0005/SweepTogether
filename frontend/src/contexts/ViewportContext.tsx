import React, { createContext, useContext } from 'react';
import { useViewport } from '../hooks/useViewport';
import { ChunkCoords, Coordinates, ViewportState } from '../types';

const CELL_SIZE = 30;

export interface ViewportContextValue {
  viewport: ViewportState;
  visibleChunks: ChunkCoords[];
  onPanStart: (clientX: number, clientY: number) => void;
  onPanMove: (clientX: number, clientY: number) => void;
  onPanEnd: () => void;
}

const ViewportContext = createContext<ViewportContextValue | null>(null);

interface ViewportProviderProps {
  chunkSize: number;
  initialCenter?: Coordinates;
  children: React.ReactNode;
}

function getVisibleChunks(viewport: ViewportState, chunkSize: number): ChunkCoords[] {
  const minChunkX = Math.floor((viewport.center.x - viewport.width / 2) / chunkSize);
  const maxChunkX = Math.floor((viewport.center.x + viewport.width / 2) / chunkSize);
  const minChunkY = Math.floor((viewport.center.y - viewport.height / 2) / chunkSize);
  const maxChunkY = Math.floor((viewport.center.y + viewport.height / 2) / chunkSize);

  const chunks: ChunkCoords[] = [];
  for (let cx = minChunkX; cx <= maxChunkX; cx++) {
    for (let cy = minChunkY; cy <= maxChunkY; cy++) {
      chunks.push({ x: cx, y: cy });
    }
  }
  return chunks;
}

export const ViewportProvider: React.FC<ViewportProviderProps> = ({
  chunkSize,
  initialCenter,
  children
}) => {
  const initialWidth = Math.ceil(window.innerWidth / CELL_SIZE);
  const initialHeight = Math.ceil(window.innerHeight / CELL_SIZE);

  const {
    viewport,
    handlePanStart,
    handlePanMove,
    handlePanEnd,
  } = useViewport({
    initialCenter: initialCenter ?? { x: 0, y: 0 },
    initialWidth,
    initialHeight,
  });

  const visibleChunks = getVisibleChunks(viewport, chunkSize);

  const value: ViewportContextValue = {
    viewport,
    visibleChunks,
    onPanStart: handlePanStart,
    onPanMove: handlePanMove,
    onPanEnd: handlePanEnd,
  };

  return (
    <ViewportContext.Provider value={value}>
      {children}
    </ViewportContext.Provider>
  );
};

export function useViewportContext(): ViewportContextValue {
  const ctx = useContext(ViewportContext);
  if (!ctx) {
    throw new Error('useViewportContext must be used within a ViewportProvider');
  }
  return ctx;
}
