import React, { useState, useCallback, useEffect, useRef } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { SocketProvider, useSocket } from './hooks/useSocket';
import { ViewportProvider } from './contexts/ViewportContext';
import { GameProvider } from './contexts/GameContext';
import GameView from './components/GameView';
import { CHUNK_SIZE } from './constants';

function getOrCreatePlayerId(): string {
  const key = 'sweeptogether_player_id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = `player_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(key, id);
  }
  return id;
}

const AppContent: React.FC = () => {
  const { send, isConnected, on, off } = useSocket();
  const [isPlayerLocked, setIsPlayerLocked] = useState(false);
  const playerId = useRef(getOrCreatePlayerId()).current;

  useEffect(() => {
    if (!isConnected) return;
    send({ type: 'join', playerId });
  }, [isConnected, send, playerId]);

  useEffect(() => {
    if (!isConnected) return;
    const handleMineHit = () => setIsPlayerLocked(true);
    on('mineHit', handleMineHit);
    return () => off('mineHit', handleMineHit);
  }, [isConnected, on, off]);

  const handleRevealCell = useCallback(
    (x: number, y: number) => {
      if (!isConnected || isPlayerLocked) return;
      send({ type: 'reveal', worldX: x, worldY: y });
    },
    [isConnected, isPlayerLocked, send],
  );

  const handleFlagCell = useCallback(
    (x: number, y: number) => {
      if (!isConnected || isPlayerLocked) return;
      send({ type: 'flag', worldX: x, worldY: y });
    },
    [isConnected, isPlayerLocked, send],
  );

  const handleChordCell = useCallback(
    (x: number, y: number) => {
      if (!isConnected || isPlayerLocked) return;
      send({ type: 'chord', worldX: x, worldY: y });
    },
    [isConnected, isPlayerLocked, send],
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
                gameId="default"
                isPlayerLocked={isPlayerLocked}
                onRevealCell={handleRevealCell}
                onFlagCell={handleFlagCell}
                onChordCell={handleChordCell}
              >
                <ViewportProvider chunkSize={CHUNK_SIZE}>
                  <GameView isConnected={isConnected} />
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
