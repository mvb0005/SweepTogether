import React from 'react';
import { CHUNK_SIZE } from '../constants';
import { useGameContext } from '../contexts/GameContext';
import { useViewportContext } from '../contexts/ViewportContext';
import { useChunkStore } from '../hooks/useChunkStore';
import GameCanvas from './GameCanvas';
import GameHud from './GameHud';

interface GameViewProps {
  isConnected: boolean;
}

const GameView: React.FC<GameViewProps> = ({ isConnected }) => {
  const { gameId, isPlayerLocked } = useGameContext();
  const { subscriptionChunks } = useViewportContext();
  const { chunks, loadedChunkCount, isInitialLoad, error } = useChunkStore({
    gameId,
    subscribeChunks: subscriptionChunks,
  });

  if (error) {
    return <div className="game-overlay game-overlay--error">{error}</div>;
  }

  return (
    <div className="game-view">
      <GameHud
        isConnected={isConnected}
        isPlayerLocked={isPlayerLocked}
        loadedChunkCount={loadedChunkCount}
        isInitialLoad={isInitialLoad}
      />
      <GameCanvas chunks={chunks} chunkSize={CHUNK_SIZE} />
    </div>
  );
};

export default GameView;
