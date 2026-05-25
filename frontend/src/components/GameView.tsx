import React from 'react';
import { CHUNK_SIZE } from '../constants';
import { useGameContext } from '../contexts/GameContext';
import { useViewportContext } from '../contexts/ViewportContext';
import { useSocket } from '../hooks/useSocket';
import { useChunkSubscriptions } from '../hooks/useChunkSubscriptions';
import GameCanvas from './GameCanvas';
import GameHud from './GameHud';

interface GameViewProps {
  isConnected: boolean;
  isJoined: boolean;
}

const GameView: React.FC<GameViewProps> = ({ isConnected, isJoined }) => {
  const { socket } = useSocket();
  const { gameId, isPlayerLocked } = useGameContext();
  const { immediateChunks, prefetchChunks, retentionChunks, viewport } = useViewportContext();
  const { chunks, isLoading, error } = useChunkSubscriptions(
    socket,
    isConnected && isJoined,
    gameId,
    immediateChunks,
    prefetchChunks,
    retentionChunks,
    viewport.center,
  );

  if (error) {
    return <div className="game-overlay game-overlay--error">{error}</div>;
  }

  return (
    <div className="game-view">
      <GameHud
        isConnected={isConnected}
        isPlayerLocked={isPlayerLocked}
        loadedChunkCount={Object.keys(chunks).length}
        isInitialLoad={isLoading}
      />
      <GameCanvas chunks={chunks} chunkSize={CHUNK_SIZE} />
    </div>
  );
};

export default GameView;
