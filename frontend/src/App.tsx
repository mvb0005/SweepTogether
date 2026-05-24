import React, { useCallback, useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { SocketProvider, useSocket } from './hooks/useSocket';
import { useGameSession } from './hooks/useGameSession';
import { ViewportProvider } from './contexts/ViewportContext';
import { GameProvider } from './contexts/GameContext';
import GameView from './components/GameView';
import { CHUNK_SIZE } from './constants';
import { PlayerStatus } from './types';

const GAME_ID = 'default';
const params = new URLSearchParams(window.location.search);
const USERNAME = params.get('playerId') || params.get('username') || 'Anonymous';

const AppContent: React.FC = () => {
  const { socket, isConnected } = useSocket();
  const { playerId, isJoined } = useGameSession(socket, isConnected, GAME_ID, USERNAME);
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

  const handleRevealCell = useCallback(
    (x: number, y: number) => {
      if (!socket || !isConnected || !isJoined || !playerId || isPlayerLocked) return;
      socket.emit('revealTile', { gameId: GAME_ID, playerId, x, y });
    },
    [socket, isConnected, isJoined, playerId, isPlayerLocked],
  );

  const handleFlagCell = useCallback(
    (x: number, y: number) => {
      if (!socket || !isConnected || !isJoined || !playerId || isPlayerLocked) return;
      socket.emit('flagTile', { gameId: GAME_ID, playerId, x, y });
    },
    [socket, isConnected, isJoined, playerId, isPlayerLocked],
  );

  const handleChordCell = useCallback(
    (x: number, y: number) => {
      if (!socket || !isConnected || !isJoined || !playerId || isPlayerLocked) return;
      socket.emit('chordClick', { gameId: GAME_ID, playerId, x, y });
    },
    [socket, isConnected, isJoined, playerId, isPlayerLocked],
  );

  if (!isConnected) {
    return <div className="loading-message">Connecting…</div>;
  }

  return (
    <div className="app">
      <Routes>
        <Route
          path="/"
          element={
            <div className="game-container">
              <GameProvider
                gameId={GAME_ID}
                playerId={playerId}
                isPlayerLocked={isPlayerLocked}
                onRevealCell={handleRevealCell}
                onFlagCell={handleFlagCell}
                onChordCell={handleChordCell}
              >
                <ViewportProvider chunkSize={CHUNK_SIZE}>
                  <GameView isConnected={isConnected} isJoined={isJoined} />
                </ViewportProvider>
              </GameProvider>
            </div>
          }
        />
      </Routes>
    </div>
  );
};

const App: React.FC = () => (
  <SocketProvider>
    <Router>
      <AppContent />
    </Router>
  </SocketProvider>
);

export default App;
