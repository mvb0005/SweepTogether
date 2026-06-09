import { useCallback, useEffect, useRef, useState } from 'react';
import { Socket } from 'socket.io-client';
import { useTelemetry } from '../contexts/TelemetryContext';
import { chunkSetKey } from '../utils/chunkKeys';
import {
  CHUNK_LOAD_TIMEOUT_MS,
  CHUNK_RETRY_INTERVAL_MS,
  CHUNK_RETRY_MAX,
  CHUNK_SIZE,
  MAX_CLIENT_CHUNKS,
  MAX_SUBSCRIBED_CHUNKS,
} from '../constants';
import { emptyChunk, parseChunkWire } from '../chunkWire';
import { patchFlag, patchReveal } from '../chunkPatch';
import { Chunk, ChunkMap, Coordinates } from '../types';

interface UseChunkSubscriptionsResult {
  chunks: ChunkMap;
  isLoading: boolean;
  error: string | null;
  optimisticReveal: (x: number, y: number) => void;
  optimisticFlag: (x: number, y: number) => void;
}

interface PendingLoad {
  requestedAt: number;
  attempts: number;
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
  const pendingLoadRef = useRef<Map<string, PendingLoad>>(new Map());
  const immediateChunksRef = useRef<Coordinates[]>(immediateChunks);
  immediateChunksRef.current = immediateChunks;
  const prefetchChunksRef = useRef<Coordinates[]>(prefetchChunks);
  prefetchChunksRef.current = prefetchChunks;
  const viewportCenterRef = useRef(viewportCenter);
  viewportCenterRef.current = viewportCenter;
  const chunksRef = useRef(chunks);
  chunksRef.current = chunks;

  const pendingLiveRef = useRef<Map<string, Chunk>>(new Map());
  const liveRafRef = useRef<number | null>(null);
  const lastSubscribeAtRef = useRef<number | null>(null);
  const batchIndexRef = useRef(0);
  const initialLoadStartRef = useRef(performance.now());
  const initialLoadTrackedRef = useRef(false);

  const markPendingLoaded = useCallback((keys: string[]) => {
    for (const key of keys) pendingLoadRef.current.delete(key);
  }, []);

  const markInitialLoadDone = useCallback((chunkCount: number) => {
    if (initialLoadTrackedRef.current) return;
    initialLoadTrackedRef.current = true;
    trackDuration('chunk_first_load', initialLoadStartRef.current, { chunkCount });
  }, [trackDuration]);

  const trimChunkMap = useCallback((map: ChunkMap): ChunkMap => {
    const keys = Object.keys(map);
    if (keys.length <= MAX_CLIENT_CHUNKS) return map;
    const center = viewportCenterRef.current;
    const ranked = keys
      .map(key => {
        const [x, y] = key.split('_').map(Number);
        const wx = x * CHUNK_SIZE + CHUNK_SIZE / 2;
        const wy = y * CHUNK_SIZE + CHUNK_SIZE / 2;
        return { key, dist: (wx - center.x) ** 2 + (wy - center.y) ** 2 };
      })
      .sort((a, b) => b.dist - a.dist);
    const next = { ...map };
    for (let i = 0; i < ranked.length - MAX_CLIENT_CHUNKS; i++) {
      delete next[ranked[i].key];
    }
    return next;
  }, []);

  const flushLiveUpdates = useCallback(() => {
    const pending = pendingLiveRef.current;
    if (pending.size === 0) return;
    pendingLiveRef.current = new Map();
    markPendingLoaded(Array.from(pending.keys()));
    setChunks(prev => {
      const next = { ...prev };
      pending.forEach((chunk, key) => { next[key] = chunk; });
      return trimChunkMap(next);
    });
    setIsLoading(false);
  }, [markPendingLoaded, trimChunkMap]);

  const scheduleLiveFlush = useCallback(() => {
    if (liveRafRef.current !== null) return;
    liveRafRef.current = requestAnimationFrame(() => {
      liveRafRef.current = null;
      flushLiveUpdates();
    });
  }, [flushLiveUpdates]);

  const emitSubscribe = useCallback((
    targets: Coordinates[],
    source: 'immediate' | 'buffer' | 'retry',
    opts?: { force?: boolean; bumpAttempt?: boolean },
  ) => {
    if (!socket || !gameId) return;

    const toSubscribe = opts?.force
      ? targets
      : targets.filter(c => !subscribedRef.current.has(`${c.x}_${c.y}`));
    if (toSubscribe.length === 0) return;

    const now = performance.now();
    lastSubscribeAtRef.current = now;
    socket.emit('subscribeToChunks', {
      gameId,
      chunks: toSubscribe.map(c => ({ chunkX: c.x, chunkY: c.y })),
    });

    for (const { x, y } of toSubscribe) {
      const key = `${x}_${y}`;
      subscribedRef.current.add(key);
      const prev = pendingLoadRef.current.get(key);
      pendingLoadRef.current.set(key, {
        requestedAt: now,
        attempts: opts?.bumpAttempt ? (prev?.attempts ?? 0) + 1 : (prev?.attempts ?? 0),
      });
    }

    const immediateKeys = new Set(
      immediateChunksRef.current.map(c => `${c.x}_${c.y}`),
    );
    const center = viewportCenterRef.current;
    let over = subscribedRef.current.size - MAX_SUBSCRIBED_CHUNKS;
    const evicted: string[] = [];
    if (over > 0) {
      const ranked = Array.from(subscribedRef.current)
        .filter(key => !immediateKeys.has(key))
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
        pendingLoadRef.current.delete(key);
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
        next[key] = emptyChunk({ x, y }, CHUNK_SIZE, true);
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

    track(source === 'retry' ? 'chunk_subscribe_retry' : 'chunk_subscribe_emit', {
      count: toSubscribe.length,
      source,
    });
  }, [socket, gameId, track]);

  const retryVisibleChunks = useCallback(() => {
    const visible = immediateChunksRef.current;
    if (visible.length === 0) return;
    visible.forEach(c => {
      const key = `${c.x}_${c.y}`;
      subscribedRef.current.delete(key);
      pendingLoadRef.current.delete(key);
    });
    emitSubscribe(visible, 'retry', { force: true, bumpAttempt: true });
  }, [emitSubscribe]);

  useEffect(() => {
    if (!socket || !isConnected) return;

    const parseChunk = (data: Parameters<typeof parseChunkWire>[0]): Chunk =>
      parseChunkWire(data);

    const handleChunkData = (data: any) => {
      const key = `${data.chunkX}_${data.chunkY}`;
      pendingLiveRef.current.set(key, parseChunk(data));
      flushLiveUpdates();
      setError(null);
    };

    const handleChunksData = (dataArray: any[]) => {
      const t0 = performance.now();
      const parsed = dataArray.map(parseChunk);
      if (parsed.length === 0) return;

      markPendingLoaded(parsed.map(c => `${c.coords.x}_${c.coords.y}`));

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
        return trimChunkMap(next);
      });
      setIsLoading(false);
      setError(null);
      trackDuration('chunk_batch_parse', t0, { count: parsed.length });
    };

    const handleError = () => {
      track('chunk_load_error');
      retryVisibleChunks();
      setError('Chunk load failed — retrying…');
      setIsLoading(true);
    };

    socket.on('chunkData', handleChunkData);
    socket.on('chunksData', handleChunksData);
    socket.on('error', handleError);
    return () => {
      socket.off('chunkData', handleChunkData);
      socket.off('chunksData', handleChunksData);
      socket.off('error', handleError);
    };
  }, [socket, isConnected, scheduleLiveFlush, track, trackDuration, markInitialLoadDone, markPendingLoaded, retryVisibleChunks]);

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
        pendingLoadRef.current.delete(key);
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
    if (!isConnected || !socket || !gameId) return;
    subscribedRef.current.clear();
    pendingLoadRef.current.clear();
    setError(null);
    setIsLoading(true);
  }, [isConnected, socket, gameId]);

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
    if (!socket || !isConnected || !gameId) return;
    const missing = immediateChunks.filter(c => !chunksRef.current[`${c.x}_${c.y}`]);
    if (missing.length === 0) return;
    missing.forEach(c => {
      const key = `${c.x}_${c.y}`;
      subscribedRef.current.delete(key);
      pendingLoadRef.current.delete(key);
    });
    emitSubscribe(missing, 'immediate', { force: true });
  }, [socket, isConnected, gameId, immediateKey, immediateChunks, emitSubscribe]);

  useEffect(() => {
    if (!socket || !isConnected || !gameId) return;
    const id = setInterval(() => {
      const now = performance.now();
      const visible = new Set(immediateChunksRef.current.map(c => `${c.x}_${c.y}`));
      const stale: Coordinates[] = [];
      for (const [key, meta] of pendingLoadRef.current) {
        if (!visible.has(key)) continue;
        if (now - meta.requestedAt < CHUNK_LOAD_TIMEOUT_MS) continue;
        if (meta.attempts >= CHUNK_RETRY_MAX) {
          setError('Failed to load chunk data. Please try again.');
          continue;
        }
        if (chunksRef.current[key]) {
          pendingLoadRef.current.delete(key);
          continue;
        }
        const [x, y] = key.split('_').map(Number);
        stale.push({ x, y });
      }
      if (stale.length === 0) return;
      stale.forEach(c => subscribedRef.current.delete(`${c.x}_${c.y}`));
      emitSubscribe(stale, 'retry', { force: true, bumpAttempt: true });
    }, CHUNK_RETRY_INTERVAL_MS);
    return () => clearInterval(id);
  }, [socket, isConnected, gameId, emitSubscribe]);

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
        pendingLoadRef.current.clear();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const optimisticReveal = useCallback((x: number, y: number) => {
    setChunks(prev => trimChunkMap(patchReveal(prev, x, y)));
  }, [trimChunkMap]);

  const optimisticFlag = useCallback((x: number, y: number) => {
    setChunks(prev => trimChunkMap(patchFlag(prev, x, y)));
  }, [trimChunkMap]);

  return { chunks, isLoading, error, optimisticReveal, optimisticFlag };
}
