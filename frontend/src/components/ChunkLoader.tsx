import React, { useEffect, useState } from 'react';
import { useSocket } from '../hooks/useSocket';
import ChunkedBoard from './ChunkedBoard';
import { ChunkMap, ChunkCoords, ViewportState } from '../types';

interface ChunkLoaderProps {
  gameId: string;
  visibleChunks: ChunkCoords[];
  viewport: ViewportState;
  onRevealCell: (x: number, y: number) => void;
  onFlagCell: (x: number, y: number) => void;
  onChordCell: (x: number, y: number) => void;
  isPlayerLocked: boolean;
  onPanStart: (clientX: number, clientY: number) => void;
  onPanMove: (clientX: number, clientY: number) => void;
  onPanEnd: () => void;
}

const ChunkLoader: React.FC<ChunkLoaderProps> = ({
  gameId,
  visibleChunks,
  viewport,
  onRevealCell,
  onFlagCell,
  onChordCell,
  isPlayerLocked,
  onPanStart,
  onPanMove,
  onPanEnd
}) => {
  const { socket, isConnected } = useSocket();
  const [chunks, setChunks] = useState<ChunkMap>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!socket || !isConnected || !gameId) return;

    // Subscribe to new visible chunks
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

    // Unsubscribe from chunks that are no longer visible
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

    const handleError = (error: any) => {
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
    <ChunkedBoard
      gameId={gameId}
      viewport={viewport}
      onRevealCell={onRevealCell}
      onFlagCell={onFlagCell}
      onChordCell={onChordCell}
      isPlayerLocked={isPlayerLocked}
      onPanStart={onPanStart}
      onPanMove={onPanMove}
      onPanEnd={onPanEnd}
      // @ts-ignore
      chunks={chunks}
    />
  );
};

export default ChunkLoader; 