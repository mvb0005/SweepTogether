import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { SocketProvider, useSocket } from './hooks/useSocket';
import { useGameSession } from './hooks/useGameSession';
import { ViewportProvider } from './contexts/ViewportContext';
import { PlayerProvider } from './contexts/PlayerContext';
import { DiscordProvider, useDiscord } from './discord/DiscordProvider';
import { TelemetryProvider } from './contexts/TelemetryContext';
import GameView from './components/GameView';
import { CHUNK_SIZE } from './constants';
import { PlayerStatus } from './types';

const AppContent: React.FC = () => {
  const { socket, isConnected } = useSocket();
  const { mode, gameId, username, avatarUrl, user, error: discordError } = useDiscord();
  const readyToJoin = mode !== 'loading';
  const { playerId, isJoined, playerPositions } = useGameSession(
    socket,
    isConnected,
    gameId,
    username,
    avatarUrl,
    user?.id ?? null,
    readyToJoin,
  );
  const [isPlayerLocked, setIsPlayerLocked] = useState(false);

  useEffect(() => {
    if (!socket || !playerId) return;

    const handleStatus = (data: { playerId: string; status: string }) => {
      if (data.playerId !== playerId) return;
      setIsPlayerLocked(data.status === PlayerStatus.LOCKED_OUT);
    };

    socket.on('playerStatusUpdate', handleStatus);
    return () => {
      socket.off('playerStatusUpdate', handleStatus);
    };
  }, [socket, playerId]);

  if (!isConnected || !readyToJoin) {
    return (
      <div className="app app--loading">
        <div className="loading-message">
          {!isConnected ? 'Connecting…' : 'Starting Discord activity…'}
          {discordError && <div className="loading-message__error">{discordError}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <TelemetryProvider>
        <Routes>
          <Route
            path="/"
            element={
              <div className="game-container">
                <PlayerProvider
                  socket={socket}
                  gameId={gameId}
                  playerId={playerId}
                  playerPositions={playerPositions}
                  localAvatarUrl={avatarUrl}
                  isJoined={isJoined}
                  isPlayerLocked={isPlayerLocked}
                >
                  <ViewportProvider chunkSize={CHUNK_SIZE}>
                    <GameView
                      isConnected={isConnected}
                      isJoined={isJoined}
                      gameId={gameId}
                      playerId={playerId}
                      isPlayerLocked={isPlayerLocked}
                    />
                  </ViewportProvider>
                </PlayerProvider>
              </div>
            }
          />
        </Routes>
      </TelemetryProvider>
    </div>
  );
};

const App: React.FC = () => (
  <SocketProvider>
    <DiscordProvider>
      <Router>
        <AppContent />
      </Router>
    </DiscordProvider>
  </SocketProvider>
);

export default App;
