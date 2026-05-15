import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSocket } from '../hooks/useSocket';
import { useViewportContext } from '../contexts/ViewportContext';
import { useGameContext } from '../contexts/GameContext';
import CanvasBoard from './CanvasBoard';
import { Chunk, ChunkMap, Coordinates } from '../types';

const CHUNK_SIZE = 32;
const BUFFER_DEBOUNCE_MS = 300;

const ChunkLoader: React.FC = () => {
  const { socket, isConnected } = useSocket();
  const { immediateChunks, bufferedChunks } = useViewportContext();
  const { gameId } = useGameContext();
  const [chunks, setChunks] = useState<ChunkMap>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const subscribedRef = useRef<Set<string>>(new Set());
  const [debouncedBuffered, setDebouncedBuffered] = useState<Coordinates[]>(bufferedChunks);

  // Pending live updates from chunkData events — flushed once per rAF.
  const pendingLiveRef = useRef<Map<string, Chunk>>(new Map());
  const liveRafRef = useRef<number | null>(null);

  const flushLiveUpdates = useCallback(() => {
    const pending = pendingLiveRef.current;
    if (pending.size === 0) return;
    pendingLiveRef.current = new Map();
    setChunks(prev => {
      const next = { ...prev };
      pending.forEach((chunk, key) => { next[key] = chunk; });
      return next;
    });
    setIsLoading(false);
  }, []);

  const scheduleLiveFlush = useCallback(() => {
    if (liveRafRef.current !== null) return;
    liveRafRef.current = requestAnimationFrame(() => {
      liveRafRef.current = null;
      flushLiveUpdates();
    });
  }, [flushLiveUpdates]);

  // Debounce buffer chunks only — visible chunks are handled immediately below.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedBuffered(bufferedChunks), BUFFER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(bufferedChunks)]);

  // Stable chunkData listener — never torn down by pan updates.
  useEffect(() => {
    if (!socket || !isConnected) return;

    const parseChunk = (data: any): Chunk => ({
      coords: { x: data.chunkX, y: data.chunkY },
      cells: data.tiles.map((row: any[]) =>
        row.map(cell => ({
          x: cell.x,
          y: cell.y,
          revealed: cell.revealed,
          flagged: cell.flagged,
          ...(cell.revealed && { isMine: cell.isMine, adjacentMines: cell.adjacentMines }),
        }))
      ),
    });

    // Live per-chunk update — batch via rAF.
    const handleChunkData = (data: any) => {
      pendingLiveRef.current.set(`${data.chunkX}_${data.chunkY}`, parseChunk(data));
      scheduleLiveFlush();
    };

    // Bulk initial response — single state update.
    const handleChunksData = (dataArray: any[]) => {
      setChunks(prev => {
        const next = { ...prev };
        for (const data of dataArray) {
          next[`${data.chunkX}_${data.chunkY}`] = parseChunk(data);
        }
        return next;
      });
      setIsLoading(false);
    };

    const handleError = (_err: any) => {
      setError('Failed to load chunk data. Please try again.');
      setIsLoading(false);
    };

    socket.on('chunkData', handleChunkData);
    socket.on('chunksData', handleChunksData);
    socket.on('error', handleError);
    return () => {
      socket.off('chunkData', handleChunkData);
      socket.off('chunksData', handleChunksData);
      socket.off('error', handleError);
    };
  }, [socket, isConnected, scheduleLiveFlush]);

  // Helper: subscribe new chunks, unsubscribe departed ones.
  const syncSubscriptions = useCallback((targetKeys: Set<string>, targetChunks: Coordinates[]) => {
    if (!socket || !gameId) return;

    const toSubscribe = targetChunks.filter(c => !subscribedRef.current.has(`${c.x}_${c.y}`));
    if (toSubscribe.length > 0) {
      socket.emit('subscribeToChunks', {
        gameId,
        chunks: toSubscribe.map(c => ({ chunkX: c.x, chunkY: c.y })),
      });
      toSubscribe.forEach(c => subscribedRef.current.add(`${c.x}_${c.y}`));
    }

    // Unsubscribe departed chunks from the socket but keep them in render state
    // so returning to an area shows cached data instead of a void flash.
    for (const key of Array.from(subscribedRef.current)) {
      if (!targetKeys.has(key)) {
        const [x, y] = key.split('_').map(Number);
        socket.emit('unsubscribeFromChunk', { gameId, chunkX: x, chunkY: y });
        subscribedRef.current.delete(key);
      }
    }
  }, [socket, gameId]);

  // Immediately subscribe to exactly-visible chunks.
  useEffect(() => {
    if (!socket || !isConnected || !gameId) return;
    const keys = new Set(immediateChunks.map(c => `${c.x}_${c.y}`));
    syncSubscriptions(keys, immediateChunks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, isConnected, gameId, JSON.stringify(immediateChunks)]);

  // After debounce, expand to buffer + directional chunks.
  useEffect(() => {
    if (!socket || !isConnected || !gameId) return;
    const keys = new Set(debouncedBuffered.map(c => `${c.x}_${c.y}`));
    syncSubscriptions(keys, debouncedBuffered);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, isConnected, gameId, JSON.stringify(debouncedBuffered)]);

  // Unsubscribe everything on unmount.
  useEffect(() => {
    return () => {
      if (socket && gameId) {
        for (const key of Array.from(subscribedRef.current)) {
          const [x, y] = key.split('_').map(Number);
          socket.emit('unsubscribeFromChunk', { gameId, chunkX: x, chunkY: y });
        }
        subscribedRef.current.clear();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) return <div className="error-message">{error}</div>;
  if (isLoading) return <div className="loading-message">Loading chunks...</div>;

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <CanvasBoard chunks={chunks} chunkSize={CHUNK_SIZE} />
    </div>
  );
};

export default ChunkLoader;
