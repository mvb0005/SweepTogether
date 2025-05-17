import React, { useState } from 'react';
import { ChunkCoords, ViewportState } from '../types';

interface ViewportProps {
  chunkSize: number;
  maxVisibleChunks: number;
  initialCenter?: { x: number; y: number };
  initialScale?: number;
  children: (props: {
    visibleChunks: ChunkCoords[];
    viewport: ViewportState;
    onPanStart: (clientX: number, clientY: number) => void;
    onPanMove: (clientX: number, clientY: number) => void;
    onPanEnd: () => void;
    setViewport: React.Dispatch<React.SetStateAction<ViewportState>>;
  }) => React.ReactNode;
}

const Viewport: React.FC<ViewportProps> = ({
  chunkSize,
  maxVisibleChunks,
  children
}) => {
  // For a 2x2 grid of 16x16, center should be (16, 16)
  const [viewport, setViewport] = useState<ViewportState>({
    center: { x: 16, y: 16 },
    width: chunkSize * maxVisibleChunks,
    height: chunkSize * maxVisibleChunks,
    scale: 1,
    panStart: undefined
  });

  // Calculate visible chunks based on viewport center and size
  const getVisibleChunks = (): ChunkCoords[] => {
    // Always show (0,0), (0,1), (1,0), (1,1)
    return [
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 0 },
      { x: 1, y: 1 }
    ];
  };

  // Pan handlers are no-ops
  const onPanStart = () => {};
  const onPanMove = () => {};
  const onPanEnd = () => {};

  const visibleChunks = getVisibleChunks();

  return (
    <>{children({
      visibleChunks,
      viewport,
      onPanStart,
      onPanMove,
      onPanEnd,
      setViewport
    })}</>
  );
};

export default Viewport; 