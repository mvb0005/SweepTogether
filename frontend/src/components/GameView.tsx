import React, { useCallback } from 'react';
import { CHUNK_SIZE } from '../constants';
import { GameProvider } from '../contexts/GameContext';
import { usePlayerContext } from '../contexts/PlayerContext';
import { useViewportContext } from '../contexts/ViewportContext';
import { useSocket } from '../hooks/useSocket';
import { useChunkSubscriptions } from '../hooks/useChunkSubscriptions';
import GameCanvas from './GameCanvas';
import GameHud from './GameHud';

interface GameViewProps {
  isConnected: boolean;
  isJoined: boolean;
  gameId: string;
  playerId: string | null;
  isPlayerLocked: boolean;
}

const GameView: React.FC<GameViewProps> = ({
  isConnected,
  isJoined,
  gameId,
  playerId,
  isPlayerLocked,
}) => {
  const { socket } = useSocket();
  const { immediateChunks, prefetchChunks, retentionChunks } = useViewportContext();
  const { subscriptionCenter } = usePlayerContext();
  const {
    chunks,
    isLoading,
    error,
    optimisticReveal,
    optimisticFlag,
  } = useChunkSubscriptions(
    socket,
    isConnected && isJoined,
    gameId,
    immediateChunks,
    prefetchChunks,
    retentionChunks,
    subscriptionCenter,
  );

  const onRevealCell = useCallback(
    (x: number, y: number) => {
      if (!socket || !isConnected || !isJoined || !playerId || isPlayerLocked) return;
      optimisticReveal(x, y);
      socket.emit('revealTile', { gameId, playerId, x, y });
    },
    [socket, isConnected, isJoined, playerId, isPlayerLocked, gameId, optimisticReveal],
  );

  const onFlagCell = useCallback(
    (x: number, y: number) => {
      if (!socket || !isConnected || !isJoined || !playerId || isPlayerLocked) return;
      optimisticFlag(x, y);
      socket.emit('flagTile', { gameId, playerId, x, y });
    },
    [socket, isConnected, isJoined, playerId, isPlayerLocked, gameId, optimisticFlag],
  );

  const onChordCell = useCallback(
    (x: number, y: number) => {
      if (!socket || !isConnected || !isJoined || !playerId || isPlayerLocked) return;
      optimisticReveal(x, y);
      socket.emit('chordClick', { gameId, playerId, x, y });
    },
    [socket, isConnected, isJoined, playerId, isPlayerLocked, gameId, optimisticReveal],
  );

  return (
    <div className="game-view">
      <GameHud
        isConnected={isConnected}
        isPlayerLocked={isPlayerLocked}
        loadedChunkCount={Object.keys(chunks).length}
        isInitialLoad={isLoading}
      />
      {error && (
        <div className="game-hud__banner game-hud__banner--lockout game-view__error">
          {error}
        </div>
      )}
      <GameProvider
        gameId={gameId}
        playerId={playerId}
        isPlayerLocked={isPlayerLocked}
        onRevealCell={onRevealCell}
        onFlagCell={onFlagCell}
        onChordCell={onChordCell}
      >
        <GameCanvas chunks={chunks} chunkSize={CHUNK_SIZE} />
      </GameProvider>
    </div>
  );
};

export default GameView;
