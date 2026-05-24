import { useEffect, useState } from 'react';
import { Socket } from 'socket.io-client';

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

  useEffect(() => {
    if (!socket || !isConnected || isJoined) return;

    socket.emit('joinGame', { gameId, username });

    const handleGameJoined = (data: { playerId: string }) => {
      setPlayerId(data.playerId);
      setIsJoined(true);
    };
    socket.on('gameJoined', handleGameJoined);
    return () => { socket.off('gameJoined', handleGameJoined); };
  }, [socket, isConnected, gameId, username, isJoined]);

  return { playerId, isJoined };
}
