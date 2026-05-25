import { useCallback, useEffect, useRef, useState } from 'react';

import { Socket } from 'socket.io-client';

import { useTelemetry } from '../contexts/TelemetryContext';

import { chunkSetKey } from '../utils/chunkKeys';

import { CHUNK_SIZE, MAX_SUBSCRIBED_CHUNKS } from '../constants';

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

  prefetchChunks: Coordinates[],

  retentionChunks: Coordinates[],

  viewportCenter: Coordinates,

): UseChunkSubscriptionsResult {

  const { track, trackDuration } = useTelemetry();

  const [chunks, setChunks] = useState<ChunkMap>({});

  const [isLoading, setIsLoading] = useState(true);

  const [error, setError] = useState<string | null>(null);



  const subscribedRef = useRef<Set<string>>(new Set());

  const immediateChunksRef = useRef<Coordinates[]>(immediateChunks);

  immediateChunksRef.current = immediateChunks;

  const prefetchChunksRef = useRef<Coordinates[]>(prefetchChunks);

  prefetchChunksRef.current = prefetchChunks;

  const viewportCenterRef = useRef(viewportCenter);

  viewportCenterRef.current = viewportCenter;



  const pendingLiveRef = useRef<Map<string, Chunk>>(new Map());

  const liveRafRef = useRef<number | null>(null);

  const lastSubscribeAtRef = useRef<number | null>(null);

  const batchIndexRef = useRef(0);

  const initialLoadStartRef = useRef(performance.now());

  const initialLoadTrackedRef = useRef(false);



  const markInitialLoadDone = useCallback((chunkCount: number) => {

    if (initialLoadTrackedRef.current) return;

    initialLoadTrackedRef.current = true;

    trackDuration('chunk_first_load', initialLoadStartRef.current, { chunkCount });

  }, [trackDuration]);



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



  useEffect(() => {

    if (!socket || !isConnected) return;



    const parseChunk = (data: any): Chunk => {

      const { chunkX, chunkY, size, revealed, adjMines = [], revealedMines = [], flagged = [] } = data;

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

      const key = `${data.chunkX}_${data.chunkY}`;

      if (!subscribedRef.current.has(key)) return;

      pendingLiveRef.current.set(key, parseChunk(data));

      scheduleLiveFlush();

    };



    const handleChunksData = (dataArray: any[]) => {

      const t0 = performance.now();

      const parsed = dataArray

        .filter(data => subscribedRef.current.has(`${data.chunkX}_${data.chunkY}`))

        .map(parseChunk);

      if (parsed.length === 0) return;



      const latencyMs = lastSubscribeAtRef.current !== null

        ? performance.now() - lastSubscribeAtRef.current

        : undefined;

      batchIndexRef.current++;

      track('chunk_batch_received', {

        count: parsed.length,

        batchIndex: batchIndexRef.current,

      }, latencyMs);



      setChunks(prev => {

        const next = { ...prev };

        for (const chunk of parsed) {

          next[`${chunk.coords.x}_${chunk.coords.y}`] = chunk;

        }

        markInitialLoadDone(Object.keys(next).length);

        return next;

      });

      setIsLoading(false);

      trackDuration('chunk_batch_parse', t0, { count: parsed.length });

    };



    const handleError = () => {

      setError('Failed to load chunk data. Please try again.');

      setIsLoading(false);

      track('chunk_load_error');

    };



    socket.on('chunkData', handleChunkData);

    socket.on('chunksData', handleChunksData);

    socket.on('error', handleError);

    return () => {

      socket.off('chunkData', handleChunkData);

      socket.off('chunksData', handleChunksData);

      socket.off('error', handleError);

    };

  }, [socket, isConnected, scheduleLiveFlush, track, trackDuration, markInitialLoadDone]);



  const emitSubscribe = useCallback((targets: Coordinates[], source: 'immediate' | 'buffer') => {

    if (!socket || !gameId) return;

    const toSubscribe = targets.filter(c => !subscribedRef.current.has(`${c.x}_${c.y}`));

    if (toSubscribe.length === 0) return;

    lastSubscribeAtRef.current = performance.now();

    socket.emit('subscribeToChunks', {

      gameId,

      chunks: toSubscribe.map(c => ({ chunkX: c.x, chunkY: c.y })),

    });

    toSubscribe.forEach(c => subscribedRef.current.add(`${c.x}_${c.y}`));

    const protectedKeys = new Set([
      ...immediateChunksRef.current.map(c => `${c.x}_${c.y}`),
      ...prefetchChunksRef.current.map(c => `${c.x}_${c.y}`),
    ]);
    const center = viewportCenterRef.current;
    let over = subscribedRef.current.size - MAX_SUBSCRIBED_CHUNKS;
    const evicted: string[] = [];
    if (over > 0) {
      const ranked = Array.from(subscribedRef.current)
        .filter(key => !protectedKeys.has(key))
        .map(key => {
          const [x, y] = key.split('_').map(Number);
          const wx = x * CHUNK_SIZE + CHUNK_SIZE / 2;
          const wy = y * CHUNK_SIZE + CHUNK_SIZE / 2;
          return { key, dist: (wx - center.x) ** 2 + (wy - center.y) ** 2 };
        })
        .sort((a, b) => b.dist - a.dist);
      for (const { key } of ranked) {
        if (over <= 0) break;
        subscribedRef.current.delete(key);
        evicted.push(key);
        over--;
      }
    }
    if (evicted.length > 0) {
      socket.emit('unsubscribeFromChunks', {
        gameId,
        chunks: evicted.map(k => {
          const [x, y] = k.split('_').map(Number);
          return { chunkX: x, chunkY: y };
        }),
      });
      track('chunk_unsubscribe_emit', { count: evicted.length, source: 'cap' });
    }

    setChunks(prev => {

      let changed = false;

      const next = { ...prev };

      for (const { x, y } of toSubscribe) {

        const key = `${x}_${y}`;

        if (next[key]) continue;

        changed = true;

        next[key] = {

          coords: { x, y },

          cells: Array.from({ length: CHUNK_SIZE }, (_, ly) =>

            Array.from({ length: CHUNK_SIZE }, (_, lx) => ({

              x: x * CHUNK_SIZE + lx,

              y: y * CHUNK_SIZE + ly,

              revealed: false,

              flagged: false,

            })),

          ),

        };

      }

      return changed ? next : prev;

    });

    if (evicted.length > 0) {
      setChunks(prev => {
        const next = { ...prev };
        for (const key of evicted) delete next[key];
        return next;
      });
    }

    track('chunk_subscribe_emit', { count: toSubscribe.length, source });

  }, [socket, gameId, track]);



  const subscribeNew = useCallback((targets: Coordinates[]) => {

    emitSubscribe(targets, 'immediate');

  }, [emitSubscribe]);



  const pruneDeparted = useCallback((retainKeys: Set<string>) => {

    if (!socket || !gameId) return;

    const visibleKeys = new Set(immediateChunksRef.current.map(c => `${c.x}_${c.y}`));

    const departed: string[] = [];

    for (const key of Array.from(subscribedRef.current)) {

      if (!retainKeys.has(key) && !visibleKeys.has(key)) {

        subscribedRef.current.delete(key);

        departed.push(key);

      }

    }

    if (departed.length === 0) return;

    socket.emit('unsubscribeFromChunks', {

      gameId,

      chunks: departed.map(k => {

        const [x, y] = k.split('_').map(Number);

        return { chunkX: x, chunkY: y };

      }),

    });

    track('chunk_unsubscribe_emit', { count: departed.length });

    setChunks(prev => {

      const next = { ...prev };

      for (const key of departed) delete next[key];

      return next;

    });

  }, [socket, gameId, track]);



  const immediateKey = chunkSetKey(immediateChunks);

  const prefetchKey = chunkSetKey(prefetchChunks);

  const retentionKey = chunkSetKey(retentionChunks);



  useEffect(() => {

    if (!socket || !isConnected || !gameId) return;

    subscribeNew(immediateChunks);

    emitSubscribe(

      prefetchChunks.filter(c => !subscribedRef.current.has(`${c.x}_${c.y}`)),

      'buffer',

    );

  }, [socket, isConnected, gameId, immediateKey, prefetchKey, immediateChunks, prefetchChunks, subscribeNew, emitSubscribe]);



  useEffect(() => {

    if (!socket || !isConnected || !gameId) return;

    const keys = new Set(retentionChunks.map(c => `${c.x}_${c.y}`));

    pruneDeparted(keys);

  }, [socket, isConnected, gameId, retentionKey, retentionChunks, pruneDeparted]);



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


