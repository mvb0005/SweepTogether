import React from 'react';
import { useSocket } from '../hooks/useSocket';
import { useViewportContext } from '../contexts/ViewportContext';
import { useGameContext } from '../contexts/GameContext';
import { useChunkSubscriptions } from '../hooks/useChunkSubscriptions';
import CanvasBoard from './CanvasBoard';

const CHUNK_SIZE = 32;

const ChunkLoader: React.FC = () => {
  const { socket, isConnected } = useSocket();
  const { immediateChunks, bufferedChunks } = useViewportContext();
  const { gameId } = useGameContext();

  const { chunks, isLoading, error } = useChunkSubscriptions(
    socket,
    isConnected,
    gameId,
    immediateChunks,
    bufferedChunks,
  );

  if (error) return <div className="error-message">{error}</div>;
  if (isLoading) return <div className="loading-message">Loading chunks...</div>;

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <CanvasBoard chunks={chunks} chunkSize={CHUNK_SIZE} />
    </div>
  );
};

export default ChunkLoader;
