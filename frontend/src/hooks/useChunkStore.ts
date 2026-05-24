import { useCallback, useEffect, useRef, useState } from 'react';
import {
  applyChunkDelta,
  buildChunk,
  chunkKey,
  WireCellState,
  WireRevealedCell,
} from '../chunkWire';
import { useSocket } from './useSocket';
import { Chunk, ChunkMap, ChunkCoords } from '../types';

interface UseChunkStoreOptions {
  gameId: string;
  subscribeChunks: ChunkCoords[];
}

interface UseChunkStoreResult {
  chunks: ChunkMap;
  loadedChunkCount: number;
  isInitialLoad: boolean;
  error: string | null;
}

export function useChunkStore({
  gameId,
  subscribeChunks,
}: UseChunkStoreOptions): UseChunkStoreResult {
  const { send, isConnected, connectionId, on, off } = useSocket();
  const [chunks, setChunks] = useState<ChunkMap>({});
  const chunksRef = useRef<ChunkMap>({});
  chunksRef.current = chunks;
  const [error, setError] = useState<string | null>(null);
  const [hasReceivedChunk, setHasReceivedChunk] = useState(false);
  const subscribedRef = useRef<Set<string>>(new Set());
  const subscribeKey = subscribeChunks
    .map(c => chunkKey(c.x, c.y))
    .sort()
    .join('|');

  const pendingRef = useRef<Map<string, Chunk>>(new Map());
  const rafRef = useRef<number | null>(null);

  const flushPending = useCallback(() => {
    const pending = pendingRef.current;
    if (pending.size === 0) return;
    pendingRef.current = new Map();
    setChunks(prev => {
      const next = { ...prev };
      pending.forEach((chunk, key) => {
        next[key] = chunk;
      });
      return next;
    });
    setHasReceivedChunk(true);
  }, []);

  const scheduleFlush = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      flushPending();
    });
  }, [flushPending]);

  useEffect(() => {
    subscribedRef.current.clear();
    setHasReceivedChunk(false);
    setChunks({});
  }, [connectionId]);

  useEffect(() => {
    if (!isConnected) return;

    const handleChunkState = (data: Record<string, unknown>) => {
      const { chunkX, chunkY, cells } = data as {
        chunkX: number;
        chunkY: number;
        cells: WireCellState[];
      };
      const key = chunkKey(chunkX, chunkY);
      pendingRef.current.set(key, buildChunk(chunkX, chunkY, cells ?? []));
      scheduleFlush();
    };

    const handleChunkDelta = (data: Record<string, unknown>) => {
      const { chunkX, chunkY, revealed, flagged, unflagged } = data as {
        chunkX: number;
        chunkY: number;
        revealed?: WireRevealedCell[];
        flagged?: { index: number; playerId: string }[];
        unflagged?: number[];
      };
      const key = chunkKey(chunkX, chunkY);
      const base =
        pendingRef.current.get(key) ??
        chunksRef.current[key] ??
        buildChunk(chunkX, chunkY, []);
      pendingRef.current.set(key, applyChunkDelta(base, revealed, flagged, unflagged));
      scheduleFlush();
    };

    const handleError = (data: Record<string, unknown>) => {
      setError(String(data.message ?? 'Server error'));
    };

    on('chunkState', handleChunkState);
    on('chunkDelta', handleChunkDelta);
    on('error', handleError);
    return () => {
      off('chunkState', handleChunkState);
      off('chunkDelta', handleChunkDelta);
      off('error', handleError);
    };
  }, [isConnected, on, off, scheduleFlush]);

  useEffect(() => {
    if (!isConnected || !gameId) return;

    const targetKeys = new Set(subscribeChunks.map(c => chunkKey(c.x, c.y)));

    for (const c of subscribeChunks) {
      const key = chunkKey(c.x, c.y);
      if (!subscribedRef.current.has(key)) {
        send({ type: 'subscribe', chunkX: c.x, chunkY: c.y });
        subscribedRef.current.add(key);
      }
    }

    for (const key of Array.from(subscribedRef.current)) {
      if (!targetKeys.has(key)) {
        const [x, y] = key.split('_').map(Number);
        send({ type: 'unsubscribe', chunkX: x, chunkY: y });
        subscribedRef.current.delete(key);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, gameId, subscribeKey, send]);

  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    return () => {
      for (const key of Array.from(subscribedRef.current)) {
        const [x, y] = key.split('_').map(Number);
        sendRef.current({ type: 'unsubscribe', chunkX: x, chunkY: y });
      }
      subscribedRef.current.clear();
    };
  }, []);

  return {
    chunks,
    loadedChunkCount: Object.keys(chunks).length,
    isInitialLoad: !hasReceivedChunk && !error,
    error,
  };
}
