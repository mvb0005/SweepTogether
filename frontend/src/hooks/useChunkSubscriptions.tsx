import { useCallback, useEffect, useRef, useState } from 'react';
import { Socket } from 'socket.io-client';
import { parseChunkFromSocket } from '../chunkParse';
import { CHUNK_SUBSCRIBE_DEBOUNCE_MS } from '../constants';
import { Chunk, ChunkMap, Coordinates } from '../types';

const SUBSCRIBE_BATCH_SIZE = 40;

interface UseChunkSubscriptionsResult {
  chunks: ChunkMap;
  isLoading: boolean;
  error: string | null;
}

function chunkKey(c: Coordinates): string {
  return `${c.x}_${c.y}`;
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

  const [debouncedBuffered, setDebouncedBuffered] = useState<Coordinates[]>(bufferedChunks);
  const bufferedKeyRef = useRef('');

  const pendingLiveRef = useRef<Map<string, Chunk>>(new Map());
  const liveRafRef = useRef<number | null>(null);

  const flushLiveUpdates = useCallback(() => {
    const pending = pendingLiveRef.current;
    if (pending.size === 0) return;
    pendingLiveRef.current = new Map();
    setChunks(prev => {
      const next = { ...prev };
      pending.forEach((chunk, key) => {
        next[key] = chunk;
      });
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

  useEffect(() => {
    const key = bufferedChunks.map(c => chunkKey(c)).sort().join('|');
    if (key === bufferedKeyRef.current) return;

    const immediateKey = immediateChunks.map(c => chunkKey(c)).sort().join('|');
    const isZoomOut = key.length > bufferedKeyRef.current.length && key.includes(immediateKey);

    if (isZoomOut) {
      bufferedKeyRef.current = key;
      setDebouncedBuffered(bufferedChunks);
      return;
    }

    const timer = setTimeout(() => {
      bufferedKeyRef.current = key;
      setDebouncedBuffered(bufferedChunks);
    }, CHUNK_SUBSCRIBE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bufferedChunks]);

  useEffect(() => {
    if (!socket || !isConnected) return;

    const handleChunkData = (data: Record<string, unknown>) => {
      try {
        const chunk = parseChunkFromSocket(data as Parameters<typeof parseChunkFromSocket>[0]);
        pendingLiveRef.current.set(chunkKey(chunk.coords), chunk);
        scheduleLiveFlush();
      } catch (e) {
        console.error('[chunkData] parse error', e, data);
      }
    };

    const handleChunksData = (dataArray: Record<string, unknown>[]) => {
      setChunks(prev => {
        const next = { ...prev };
        for (const data of dataArray) {
          try {
            const chunk = parseChunkFromSocket(data as Parameters<typeof parseChunkFromSocket>[0]);
            next[chunkKey(chunk.coords)] = chunk;
          } catch (e) {
            console.error('[chunksData] parse error', e, data);
          }
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

  const emitSubscribe = useCallback(
    (targets: Coordinates[]) => {
      if (!socket || !gameId) return;
      const toSubscribe = targets.filter(c => !subscribedRef.current.has(chunkKey(c)));
      if (toSubscribe.length === 0) return;

      for (let i = 0; i < toSubscribe.length; i += SUBSCRIBE_BATCH_SIZE) {
        const batch = toSubscribe.slice(i, i + SUBSCRIBE_BATCH_SIZE);
        socket.emit('subscribeToChunks', {
          gameId,
          chunks: batch.map(c => ({ chunkX: c.x, chunkY: c.y })),
        });
        batch.forEach(c => subscribedRef.current.add(chunkKey(c)));
      }
    },
    [socket, gameId],
  );

  const syncSubscriptions = useCallback(
    (targetChunks: Coordinates[]) => {
      if (!socket || !gameId) return;

      const targetKeys = new Set(targetChunks.map(chunkKey));
      emitSubscribe(targetChunks);

      const visibleKeys = new Set(immediateChunksRef.current.map(chunkKey));
      const departed: string[] = [];
      for (const key of Array.from(subscribedRef.current)) {
        if (!targetKeys.has(key) && !visibleKeys.has(key)) {
          subscribedRef.current.delete(key);
          departed.push(key);
        }
      }
      if (departed.length > 0) {
        for (let i = 0; i < departed.length; i += SUBSCRIBE_BATCH_SIZE) {
          const batch = departed.slice(i, i + SUBSCRIBE_BATCH_SIZE);
          socket.emit('unsubscribeFromChunks', {
            gameId,
            chunks: batch.map(k => {
              const [x, y] = k.split('_').map(Number);
              return { chunkX: x, chunkY: y };
            }),
          });
        }
      }
    },
    [socket, gameId, emitSubscribe],
  );

  useEffect(() => {
    if (!socket || !isConnected || !gameId) return;
    emitSubscribe(immediateChunks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, isConnected, gameId, immediateChunks.map(chunkKey).join('|')]);

  useEffect(() => {
    if (!socket || !isConnected || !gameId) return;
    syncSubscriptions(debouncedBuffered);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, isConnected, gameId, debouncedBuffered.map(chunkKey).join('|')]);

  useEffect(() => {
    return () => {
      if (socket && gameId && subscribedRef.current.size > 0) {
        const all = Array.from(subscribedRef.current);
        for (let i = 0; i < all.length; i += SUBSCRIBE_BATCH_SIZE) {
          const batch = all.slice(i, i + SUBSCRIBE_BATCH_SIZE);
          socket.emit('unsubscribeFromChunks', {
            gameId,
            chunks: batch.map(k => {
              const [x, y] = k.split('_').map(Number);
              return { chunkX: x, chunkY: y };
            }),
          });
        }
        subscribedRef.current.clear();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { chunks, isLoading, error };
}
