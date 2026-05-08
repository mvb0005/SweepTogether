import React, { useEffect, useState } from 'react';
import { useSocket } from '../hooks/useSocket';
import { useViewportContext } from '../contexts/ViewportContext';
import { useGameContext } from '../contexts/GameContext';
import BoardSVG from './BoardSVG';
import { ChunkMap } from '../types';

const CHUNK_SIZE = 16;

const ChunkLoader: React.FC = () => {
  const { socket, isConnected } = useSocket();
  const { visibleChunks } = useViewportContext();
  const { gameId } = useGameContext();
  const [chunks, setChunks] = useState<ChunkMap>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!socket || !isConnected || !gameId) return;

    visibleChunks.forEach(chunk => {
      const chunkKey = `${chunk.x}_${chunk.y}`;
      if (!chunks[chunkKey]) {
        socket.emit('subscribeToChunk', {
          gameId,
          chunkX: chunk.x,
          chunkY: chunk.y
        });
      }
    });

    Object.keys(chunks).forEach(key => {
      const [x, y] = key.split('_').map(Number);
      const isStillVisible = visibleChunks.some(vc => vc.x === x && vc.y === y);
      if (!isStillVisible) {
        socket.emit('unsubscribeFromChunk', {
          gameId,
          chunkX: x,
          chunkY: y
        });
      }
    });

    const handleChunkData = (data: any) => {
      const chunkKey = `${data.chunkX}_${data.chunkY}`;
      setChunks(prev => ({
        ...prev,
        [chunkKey]: {
          coords: { x: data.chunkX, y: data.chunkY },
          cells: data.tiles.map((row: any[]) =>
            row.map(cell => ({
              x: cell.x,
              y: cell.y,
              revealed: cell.revealed,
              flagged: cell.flagged,
              ...(cell.revealed && {
                isMine: cell.isMine,
                adjacentMines: cell.adjacentMines
              })
            }))
          )
        }
      }));
      setIsLoading(false);
    };

    const handleError = (_err: any) => {
      setError('Failed to load chunk data. Please try again.');
      setIsLoading(false);
    };

    socket.on('chunkData', handleChunkData);
    socket.on('error', handleError);

    return () => {
      visibleChunks.forEach(chunk => {
        socket.emit('unsubscribeFromChunk', {
          gameId,
          chunkX: chunk.x,
          chunkY: chunk.y
        });
      });
      socket.off('chunkData', handleChunkData);
      socket.off('error', handleError);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, isConnected, gameId, JSON.stringify(visibleChunks)]);

  if (error) {
    return <div className="error-message">{error}</div>;
  }

  if (isLoading) {
    return <div className="loading-message">Loading chunks...</div>;
  }

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <BoardSVG chunks={chunks} chunkSize={CHUNK_SIZE} />
    </div>
  );
};

export default ChunkLoader;
