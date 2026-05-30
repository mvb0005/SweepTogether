import { useEffect, useRef, useState } from 'react';
import { Socket } from 'socket.io-client';
import { PlayerSnapshot } from '../contexts/PlayerContext';
import { telemetry } from '../telemetry/collector';

interface GameSession {
  playerId: string | null;
  isJoined: boolean;
  playerPositions: PlayerSnapshot[] | null;
}

export function useGameSession(
  socket: Socket | null,
  isConnected: boolean,
  gameId: string,
  username: string,
  avatarUrl: string | null,
  discordUserId: string | null,
  readyToJoin: boolean,
): GameSession {
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [isJoined, setIsJoined] = useState(false);
  const [playerPositions, setPlayerPositions] = useState<PlayerSnapshot[] | null>(null);
  const joinStartedRef = useRef<number | null>(null);

  useEffect(() => {
    if (!socket || !isConnected || !readyToJoin) return;

    let active = true;
    setIsJoined(false);
    setPlayerId(null);
    setPlayerPositions(null);
    joinStartedRef.current = performance.now();
    socket.emit('joinGame', {
      gameId,
      username,
      ...(avatarUrl ? { avatarUrl } : {}),
      ...(discordUserId ? { discordUserId } : {}),
    });

    const handleGameJoined = (data: { playerId: string; playerPositions?: PlayerSnapshot[] }) => {
      if (!active) return;
      if (joinStartedRef.current !== null) {
        telemetry.trackDuration('game_joined', joinStartedRef.current);
        joinStartedRef.current = null;
      }
      setPlayerId(data.playerId);
      setPlayerPositions(data.playerPositions ?? null);
      setIsJoined(true);
    };
    socket.on('gameJoined', handleGameJoined);
    return () => {
      active = false;
      socket.off('gameJoined', handleGameJoined);
    };
  }, [socket, isConnected, gameId, username, avatarUrl, discordUserId, readyToJoin]);

  return { playerId, isJoined, playerPositions };
}
