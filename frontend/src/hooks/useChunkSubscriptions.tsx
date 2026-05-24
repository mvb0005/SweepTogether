import { useCallback, useEffect, useRef, useState } from 'react';
import { Socket } from 'socket.io-client';
import { Chunk, ChunkMap, Coordinates } from '../types';

interface UseChunkSubscriptionsResult {
  chunks: ChunkMap;
  isLoading: boolean;
  error: string | null;
}

export function useChunkSubscriptions(
  socket: Socket | null,
  isConnected: boolean,
  gameId: string | null,
  immediateChunks: Coordinates[],
  bufferedChunks: Coordinates[],
): UseChunkSubscriptionsResult {
  const [chunks, setChunks] = useState<ChunkMap>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const subscribedRef = useRef<Set<string>>(new Set());
  const immediateChunksRef = useRef<Coordinates[]>(immediateChunks);
  immediateChunksRef.current = immediateChunks;

  // bufferedChunks is already debounced by ViewportContext — no second debounce needed.

  // Batch live chunkData updates via rAF to avoid per-cell state thrashing.
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

  // Stable data listeners — survive pan/zoom re-renders.
  useEffect(() => {
    if (!socket || !isConnected) return;

    const parseChunk = (data: any): Chunk => {
      const { chunkX, chunkY, size, revealed, adjMines, revealedMines, flagged } = data;
      // Build a default all-hidden grid then apply sparse state.
      const cells: Chunk['cells'] = Array.from({ length: size }, (_, ly) =>
        Array.from({ length: size }, (_, lx) => ({
          x: chunkX * size + lx,
          y: chunkY * size + ly,
          revealed: false,
          flagged: false,
        }))
      );
      for (let i = 0; i < revealed.length; i++) {
        const idx = revealed[i];
        cells[Math.floor(idx / size)][idx % size] = {
          x: chunkX * size + (idx % size),
          y: chunkY * size + Math.floor(idx / size),
          revealed: true, flagged: false,
          adjacentMines: adjMines[i],
        };
      }
      for (const idx of revealedMines) {
        cells[Math.floor(idx / size)][idx % size] = {
          x: chunkX * size + (idx % size),
          y: chunkY * size + Math.floor(idx / size),
          revealed: true, flagged: false, isMine: true,
        };
      }
      for (const idx of flagged) {
        cells[Math.floor(idx / size)][idx % size].flagged = true;
      }
      return { coords: { x: chunkX, y: chunkY }, cells };
    };

    const handleChunkData = (data: any) => {
      pendingLiveRef.current.set(`${data.chunkX}_${data.chunkY}`, parseChunk(data));
      scheduleLiveFlush();
    };

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

    const handleError = () => {
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

  // Subscribe only — no unsubscription. Used for immediately-visible chunks.
  const subscribeNew = useCallback((targets: Coordinates[]) => {
    if (!socket || !gameId) return;
    const toSubscribe = targets.filter(c => !subscribedRef.current.has(`${c.x}_${c.y}`));
    if (toSubscribe.length === 0) return;
    socket.emit('subscribeToChunks', {
      gameId,
      chunks: toSubscribe.map(c => ({ chunkX: c.x, chunkY: c.y })),
    });
    toSubscribe.forEach(c => subscribedRef.current.add(`${c.x}_${c.y}`));
  }, [socket, gameId]);

  // Full sync — subscribe buffer chunks, unsubscribe far departed ones (socket only).
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

    // Never unsubscribe currently-visible chunks even if the debounced buffer is stale.
    const visibleKeys = new Set(immediateChunksRef.current.map(c => `${c.x}_${c.y}`));
    const departed: string[] = [];
    for (const key of Array.from(subscribedRef.current)) {
      if (!targetKeys.has(key) && !visibleKeys.has(key)) {
        subscribedRef.current.delete(key);
        departed.push(key);
      }
    }
    if (departed.length > 0) {
      socket.emit('unsubscribeFromChunks', {
        gameId,
        chunks: departed.map(k => {
          const [x, y] = k.split('_').map(Number);
          return { chunkX: x, chunkY: y };
        }),
      });
      // Evict departed chunks from state so memory doesn't grow unboundedly.
      setChunks(prev => {
        const next = { ...prev };
        for (const key of departed) delete next[key];
        return next;
      });
    }
  }, [socket, gameId]);

  // Immediately subscribe visible chunks — no unsubscription.
  useEffect(() => {
    if (!socket || !isConnected || !gameId) return;
    subscribeNew(immediateChunks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, isConnected, gameId, JSON.stringify(immediateChunks)]);

  // After debounce, sync the full buffer set.
  useEffect(() => {
    if (!socket || !isConnected || !gameId) return;
    const keys = new Set(bufferedChunks.map(c => `${c.x}_${c.y}`));
    syncSubscriptions(keys, bufferedChunks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, isConnected, gameId, JSON.stringify(bufferedChunks)]);

  // Unsubscribe everything on unmount.
  useEffect(() => {
    return () => {
      if (socket && gameId && subscribedRef.current.size > 0) {
        socket.emit('unsubscribeFromChunks', {
          gameId,
          chunks: Array.from(subscribedRef.current).map(k => {
            const [x, y] = k.split('_').map(Number);
            return { chunkX: x, chunkY: y };
          }),
        });
        subscribedRef.current.clear();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { chunks, isLoading, error };
}
