import { useEffect, useRef, useState } from 'react';
import { Socket } from 'socket.io-client';
import { telemetry } from '../telemetry/collector';

interface GameSession {
  playerId: string | null;
  isJoined: boolean;
}

export function useGameSession(
  socket: Socket | null,
  isConnected: boolean,
  gameId: string,
  username: string,
): GameSession {
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [isJoined, setIsJoined] = useState(false);
  const joinStartedRef = useRef<number | null>(null);

  useEffect(() => {
    if (!socket || !isConnected || isJoined) return;

    joinStartedRef.current = performance.now();
    socket.emit('joinGame', { gameId, username });

    const handleGameJoined = (data: { playerId: string }) => {
      if (joinStartedRef.current !== null) {
        telemetry.trackDuration('game_joined', joinStartedRef.current);
        joinStartedRef.current = null;
      }
      setPlayerId(data.playerId);
      setIsJoined(true);
    };
    socket.on('gameJoined', handleGameJoined);
    return () => { socket.off('gameJoined', handleGameJoined); };
  }, [socket, isConnected, gameId, username, isJoined]);

  return { playerId, isJoined };
}
