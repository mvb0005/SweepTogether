import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSocket } from '../hooks/useSocket';
import { useViewportContext } from '../contexts/ViewportContext';
import { useGameContext } from '../contexts/GameContext';
import CanvasBoard from './CanvasBoard';
import { Chunk, ChunkMap, Coordinates } from '../types';

const CHUNK_SIZE = 32;
const BUFFER_DEBOUNCE_MS = 300;

// ── Wire → frontend Cell conversion helpers ───────────────────────────────────

interface WireCellState {
  index: number;
  isMine: boolean;
  adjacentMines: number;
  revealedBy?: string;
  flaggedBy?: string;
}

interface WireRevealedCell {
  index: number;
  isMine: boolean;
  adjacentMines: number;
  playerId: string;
}

function buildChunk(chunkX: number, chunkY: number, wireCells: WireCellState[]): Chunk {
  const grid = Array.from({ length: CHUNK_SIZE }, (_, ly) =>
    Array.from({ length: CHUNK_SIZE }, (_, lx) => ({
      x: chunkX * CHUNK_SIZE + lx,
      y: chunkY * CHUNK_SIZE + ly,
      revealed: false,
      flagged: false,
    }))
  );
  for (const c of wireCells) {
    const lx = c.index % CHUNK_SIZE;
    const ly = Math.floor(c.index / CHUNK_SIZE);
    grid[ly][lx] = {
      x: chunkX * CHUNK_SIZE + lx,
      y: chunkY * CHUNK_SIZE + ly,
      revealed: !!c.revealedBy,
      flagged: !!c.flaggedBy,
      ...(c.revealedBy && { isMine: c.isMine, adjacentMines: c.adjacentMines }),
    };
  }
  return { coords: { x: chunkX, y: chunkY }, cells: grid };
}

function applyDelta(
  chunk: Chunk,
  revealed: WireRevealedCell[] | undefined,
  flagged: { index: number; playerId: string }[] | undefined,
  unflagged: number[] | undefined,
): Chunk {
  const grid = chunk.cells.map(row => [...row]);

  if (revealed) {
    for (const c of revealed) {
      const lx = c.index % CHUNK_SIZE;
      const ly = Math.floor(c.index / CHUNK_SIZE);
      grid[ly][lx] = {
        ...grid[ly][lx],
        revealed: true,
        isMine: c.isMine,
        adjacentMines: c.adjacentMines,
      };
    }
  }
  if (flagged) {
    for (const c of flagged) {
      const lx = c.index % CHUNK_SIZE;
      const ly = Math.floor(c.index / CHUNK_SIZE);
      grid[ly][lx] = { ...grid[ly][lx], flagged: true };
    }
  }
  if (unflagged) {
    for (const idx of unflagged) {
      const lx = idx % CHUNK_SIZE;
      const ly = Math.floor(idx / CHUNK_SIZE);
      grid[ly][lx] = { ...grid[ly][lx], flagged: false };
    }
  }

  return { ...chunk, cells: grid };
}

// ── Component ─────────────────────────────────────────────────────────────────

const ChunkLoader: React.FC = () => {
  const { send, isConnected, connectionId, on, off } = useSocket();
  const { immediateChunks, bufferedChunks } = useViewportContext();
  const { gameId } = useGameContext();
  const [chunks, setChunks]   = useState<ChunkMap>({});
  const chunksRef             = useRef<ChunkMap>({});
  chunksRef.current           = chunks;
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const subscribedRef         = useRef<Set<string>>(new Set());
  const [debouncedBuffered, setDebouncedBuffered] = useState<Coordinates[]>(bufferedChunks);

  // Batch pending updates — flushed once per rAF
  const pendingRef = useRef<Map<string, Chunk>>(new Map());
  const rafRef     = useRef<number | null>(null);

  const flushPending = useCallback(() => {
    const pending = pendingRef.current;
    if (pending.size === 0) return;
    pendingRef.current = new Map();
    setChunks(prev => {
      const next = { ...prev };
      pending.forEach((chunk, key) => { next[key] = chunk; });
      return next;
    });
    setIsLoading(false);
  }, []);

  const scheduleFlush = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      flushPending();
    });
  }, [flushPending]);

  // On every new connection, reset stale subscription state so chunks are re-subscribed
  useEffect(() => {
    subscribedRef.current.clear();
    setIsLoading(true);
  }, [connectionId]);

  // Debounce buffer region
  useEffect(() => {
    const t = setTimeout(() => setDebouncedBuffered(bufferedChunks), BUFFER_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(bufferedChunks)]);

  // ── Stable message listeners ───────────────────────────────────────────────

  useEffect(() => {
    if (!isConnected) return;

    // Full state snapshot sent in response to a subscribe message
    const handleChunkState = (data: Record<string, unknown>) => {
      const { chunkX, chunkY, cells } = data as {
        chunkX: number; chunkY: number; cells: WireCellState[];
      };
      const key   = `${chunkX}_${chunkY}`;
      const chunk = buildChunk(chunkX, chunkY, cells ?? []);
      pendingRef.current.set(key, chunk);
      scheduleFlush();
    };

    // Live delta — apply on top of existing chunk
    const handleChunkDelta = (data: Record<string, unknown>) => {
      const { chunkX, chunkY, revealed, flagged, unflagged } = data as {
        chunkX: number; chunkY: number;
        revealed?: WireRevealedCell[];
        flagged?: { index: number; playerId: string }[];
        unflagged?: number[];
      };
      const key = `${chunkX}_${chunkY}`;

      // Merge with any already-pending update for this chunk
      const base = pendingRef.current.get(key)
        ?? chunksRef.current[key]
        ?? buildChunk(chunkX, chunkY, []);

      pendingRef.current.set(key, applyDelta(base, revealed, flagged, unflagged));
      scheduleFlush();
    };

    const handleError = (data: Record<string, unknown>) => {
      setError(String(data.message ?? 'Server error'));
      setIsLoading(false);
    };

    on('chunkState', handleChunkState);
    on('chunkDelta', handleChunkDelta);
    on('error',      handleError);
    return () => {
      off('chunkState', handleChunkState);
      off('chunkDelta', handleChunkDelta);
      off('error',      handleError);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, scheduleFlush]);

  // ── Subscription management ────────────────────────────────────────────────

  const syncSubscriptions = useCallback((targetKeys: Set<string>, targetChunks: Coordinates[]) => {
    if (!isConnected || !gameId) return;

    const toSubscribe = targetChunks.filter(c => !subscribedRef.current.has(`${c.x}_${c.y}`));
    for (const c of toSubscribe) {
      send({ type: 'subscribe', chunkX: c.x, chunkY: c.y });
      subscribedRef.current.add(`${c.x}_${c.y}`);
    }

    for (const key of Array.from(subscribedRef.current)) {
      if (!targetKeys.has(key)) {
        const [x, y] = key.split('_').map(Number);
        send({ type: 'unsubscribe', chunkX: x, chunkY: y });
        subscribedRef.current.delete(key);
      }
    }
  }, [isConnected, gameId, send]);

  // Immediately subscribe visible chunks
  useEffect(() => {
    if (!isConnected || !gameId) return;
    const keys = new Set(immediateChunks.map(c => `${c.x}_${c.y}`));
    syncSubscriptions(keys, immediateChunks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, gameId, JSON.stringify(immediateChunks)]);

  // After debounce, expand to buffer + directional chunks
  useEffect(() => {
    if (!isConnected || !gameId) return;
    const keys = new Set(debouncedBuffered.map(c => `${c.x}_${c.y}`));
    syncSubscriptions(keys, debouncedBuffered);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, gameId, JSON.stringify(debouncedBuffered)]);

  // Unsubscribe everything on unmount (best-effort; server also cleans up on WS close)
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

  if (error)     return <div className="error-message">{error}</div>;
  if (isLoading) return <div className="loading-message">Loading chunks…</div>;

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <CanvasBoard chunks={chunks} chunkSize={CHUNK_SIZE} />
    </div>
  );
};

export default ChunkLoader;
