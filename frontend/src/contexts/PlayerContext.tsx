import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Socket } from 'socket.io-client';
import { INPUT_COOLDOWN_MS } from '../constants';
import { Coordinates } from '../types';

export interface PlayerSnapshot {
  playerId: string;
  username: string;
  x: number;
  y: number;
  color: string;
  avatarUrl?: string;
  discordUserId?: string;
}

export interface PlayerEntity {
  id: string;
  username: string;
  color: string;
  x: number;
  y: number;
  avatarUrl?: string;
  discordUserId?: string;
}

export interface PlayerContextValue {
  self: PlayerEntity | null;
  others: PlayerEntity[];
  movementDir: { dx: number; dy: number };
  subscriptionCenter: Coordinates;
  move: (dx: number, dy: number) => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

interface PlayerProviderProps {
  socket: Socket | null;
  gameId: string;
  playerId: string | null;
  playerPositions: PlayerSnapshot[] | null;
  localAvatarUrl: string | null;
  isJoined: boolean;
  isPlayerLocked: boolean;
  children: React.ReactNode;
}

function toEntity(snapshot: PlayerSnapshot): PlayerEntity {
  return {
    id: snapshot.playerId,
    username: snapshot.username,
    x: snapshot.x,
    y: snapshot.y,
    color: snapshot.color,
    avatarUrl: snapshot.avatarUrl,
    discordUserId: snapshot.discordUserId,
  };
}

export const PlayerProvider: React.FC<PlayerProviderProps> = ({
  socket,
  gameId,
  playerId,
  playerPositions,
  localAvatarUrl,
  isJoined,
  isPlayerLocked,
  children,
}) => {
  const [self, setSelf] = useState<PlayerEntity | null>(null);
  const [others, setOthers] = useState<PlayerEntity[]>([]);
  const [movementDir, setMovementDir] = useState({ dx: 0, dy: 0 });
  const moveLockedUntilRef = useRef(0);
  const keysHeldRef = useRef(new Set<string>());
  const moveRef = useRef<(dx: number, dy: number) => void>(() => {});

  const keyToDir = (key: string): { dx: number; dy: number } | null => {
    switch (key) {
      case 'ArrowUp':
      case 'w':
        return { dx: 0, dy: -1 };
      case 'ArrowDown':
      case 's':
        return { dx: 0, dy: 1 };
      case 'ArrowLeft':
      case 'a':
        return { dx: -1, dy: 0 };
      case 'ArrowRight':
      case 'd':
        return { dx: 1, dy: 0 };
      default:
        return null;
    }
  };

  const applyPositions = useCallback((positions: PlayerSnapshot[], localId: string) => {
    let local: PlayerEntity | null = null;
    const remote: PlayerEntity[] = [];
    for (const p of positions) {
      const entity = toEntity(p);
      if (p.playerId === localId) local = entity;
      else remote.push(entity);
    }
    if (local && !local.avatarUrl && localAvatarUrl) {
      local = { ...local, avatarUrl: localAvatarUrl };
    }
    setSelf(local);
    setOthers(remote);
  }, [localAvatarUrl]);

  useEffect(() => {
    if (!playerId || !playerPositions) return;
    applyPositions(playerPositions, playerId);
  }, [playerId, playerPositions, applyPositions]);

  useEffect(() => {
    if (!socket || !isJoined || !playerId) return;

    const onGameJoined = (data: { playerId: string; playerPositions?: PlayerSnapshot[] }) => {
      if (data.playerId !== playerId || !data.playerPositions) return;
      applyPositions(data.playerPositions, playerId);
    };

    const onPlayerMoved = (data: { playerId: string; x: number; y: number }) => {
      if (data.playerId === playerId) {
        setSelf(prev => {
          const dx = prev ? data.x - prev.x : 0;
          const dy = prev ? data.y - prev.y : 0;
          if (dx !== 0 || dy !== 0) setMovementDir({ dx: Math.sign(dx), dy: Math.sign(dy) });
          if (prev) return { ...prev, x: data.x, y: data.y };
          const snapshot = playerPositions?.find(p => p.playerId === playerId);
          return {
            id: playerId,
            username: snapshot?.username ?? 'Anonymous',
            color: snapshot?.color ?? '#888',
            x: data.x,
            y: data.y,
            avatarUrl: snapshot?.avatarUrl ?? localAvatarUrl ?? undefined,
            discordUserId: snapshot?.discordUserId,
          };
        });
        return;
      }
      setOthers(prev => prev.map(p => {
        if (p.id !== data.playerId) return p;
        const dx = data.x - p.x;
        const dy = data.y - p.y;
        if (dx !== 0 || dy !== 0) setMovementDir({ dx: Math.sign(dx), dy: Math.sign(dy) });
        return { ...p, x: data.x, y: data.y };
      }));
    };

    const onPlayerJoined = (data: {
      playerId: string;
      username?: string;
      players?: Record<string, {
        username: string;
        x?: number;
        y?: number;
        color?: string;
        avatarUrl?: string;
        discordUserId?: string;
      }>;
    }) => {
      if (!data.players || data.playerId === playerId) return;
      const p = data.players[data.playerId];
      if (!p) return;
      const entity: PlayerEntity = {
        id: data.playerId,
        username: p.username,
        x: p.x ?? 0,
        y: p.y ?? 0,
        color: p.color ?? '#888',
        avatarUrl: p.avatarUrl,
        discordUserId: p.discordUserId,
      };
      setOthers(prev => (prev.some(o => o.id === entity.id) ? prev : [...prev, entity]));
    };

    socket.on('gameJoined', onGameJoined);
    socket.on('playerMoved', onPlayerMoved);
    socket.on('playerJoined', onPlayerJoined);
    return () => {
      socket.off('gameJoined', onGameJoined);
      socket.off('playerMoved', onPlayerMoved);
      socket.off('playerJoined', onPlayerJoined);
    };
  }, [socket, isJoined, playerId, playerPositions, localAvatarUrl, applyPositions]);

  const move = useCallback((dx: number, dy: number) => {
    if (!socket || !gameId || !playerId || isPlayerLocked) return;
    if (Math.abs(dx) + Math.abs(dy) !== 1) return;

    const now = performance.now();
    if (now < moveLockedUntilRef.current) return;
    moveLockedUntilRef.current = now + INPUT_COOLDOWN_MS;
    setMovementDir({ dx: Math.sign(dx), dy: Math.sign(dy) });

    setSelf(prev => {
      if (prev) return { ...prev, x: prev.x + dx, y: prev.y + dy };
      const snapshot = playerPositions?.find(p => p.playerId === playerId);
      if (!snapshot) return prev;
      return {
        id: playerId,
        username: snapshot.username,
        color: snapshot.color,
        avatarUrl: snapshot.avatarUrl ?? localAvatarUrl ?? undefined,
        discordUserId: snapshot.discordUserId,
        x: snapshot.x + dx,
        y: snapshot.y + dy,
      };
    });

    socket.emit('movePlayer', { gameId, dx, dy });
  }, [socket, gameId, playerId, isPlayerLocked, playerPositions, localAvatarUrl]);

  moveRef.current = move;

  useEffect(() => {
    if (!isJoined || isPlayerLocked) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const dir = keyToDir(e.key);
      if (!dir) return;
      e.preventDefault();
      keysHeldRef.current.add(e.key.length === 1 ? e.key.toLowerCase() : e.key);
      moveRef.current(dir.dx, dir.dy);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      keysHeldRef.current.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    };

    const onBlur = () => keysHeldRef.current.clear();

    const pollHeldKeys = () => {
      for (const key of keysHeldRef.current) {
        const dir = keyToDir(key);
        if (dir) moveRef.current(dir.dx, dir.dy);
      }
    };
    const interval = window.setInterval(pollHeldKeys, INPUT_COOLDOWN_MS);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      keysHeldRef.current.clear();
    };
  }, [isJoined, isPlayerLocked]);

  const subscriptionCenter: Coordinates = self
    ? { x: self.x + 0.5, y: self.y + 0.5 }
    : { x: 0.5, y: 0.5 };

  const value: PlayerContextValue = {
    self,
    others,
    movementDir,
    subscriptionCenter,
    move,
  };

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
};

export function usePlayerContext(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayerContext must be used within a PlayerProvider');
  return ctx;
}
