import React from 'react';
import BoardSVG from './BoardSVG';
import { ChunkMap, ViewportState } from '../types';
import './ChunkedBoard.css';

interface ChunkedBoardProps {
  gameId: string;
  viewport: ViewportState;
  onRevealCell: (x: number, y: number) => void;
  onFlagCell: (x: number, y: number) => void;
  onChordCell: (x: number, y: number) => void;
  isPlayerLocked: boolean;
  onPanStart: (clientX: number, clientY: number) => void;
  onPanMove: (clientX: number, clientY: number) => void;
  onPanEnd: () => void;
  chunks: ChunkMap;
}

const CHUNK_SIZE = 16;

const ChunkedBoard: React.FC<ChunkedBoardProps> = ({
  gameId,
  viewport,
  onRevealCell,
  onFlagCell,
  onChordCell,
  isPlayerLocked,
  onPanStart,
  onPanMove,
  onPanEnd,
  chunks
}) => {
  return (
    <div className="chunked-board" style={{ width: '100%', height: '100%' }}>
      <BoardSVG
        chunkMap={chunks}
        chunkSize={CHUNK_SIZE}
        viewport={viewport}
        onRevealCell={onRevealCell}
        onFlagCell={onFlagCell}
        onChordCell={onChordCell}
        isPlayerLocked={isPlayerLocked}
      />
    </div>
  );
};

export default ChunkedBoard; 