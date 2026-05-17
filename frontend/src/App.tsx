import React, { useState, useCallback, useEffect, useRef } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { SocketProvider, useSocket } from './hooks/useSocket';
import { ViewportProvider } from './contexts/ViewportContext';
import { GameProvider } from './contexts/GameContext';
import ChunkLoader from './components/ChunkLoader';
import SingleChunkPage from './components/SingleChunkPage';
import './App.css';

const CHUNK_SIZE = 32;

// Stable player ID — persisted across page reloads
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

  // Send join on every (re)connection for player ID attribution
  useEffect(() => {
    if (!isConnected) return;
    send({ type: 'join', playerId });
  }, [isConnected, send, playerId]);

  // Mine hit listener
  useEffect(() => {
    if (!isConnected) return;
    const handleMineHit = () => setIsPlayerLocked(true);
    on('mineHit', handleMineHit);
    return () => off('mineHit', handleMineHit);
  }, [isConnected, on, off]);

  const handleRevealCell = useCallback((x: number, y: number) => {
    if (!isConnected || isPlayerLocked) return;
    send({ type: 'reveal', worldX: x, worldY: y });
  }, [isConnected, isPlayerLocked, send]);

  const handleFlagCell = useCallback((x: number, y: number) => {
    if (!isConnected || isPlayerLocked) return;
    send({ type: 'flag', worldX: x, worldY: y });
  }, [isConnected, isPlayerLocked, send]);

  const handleChordCell = useCallback((x: number, y: number) => {
    if (!isConnected || isPlayerLocked) return;
    send({ type: 'chord', worldX: x, worldY: y });
  }, [isConnected, isPlayerLocked, send]);

  if (!isConnected) {
    return <div className="loading-message">Connecting…</div>;
  }

  return (
    <div className="app">
      <Routes>
        <Route path="/chunk/:gameId/:chunkX/:chunkY" element={<SingleChunkPage />} />
        <Route path="/" element={
          <div className="game-container">
            <GameProvider
              gameId="default"
              isPlayerLocked={isPlayerLocked}
              onRevealCell={handleRevealCell}
              onFlagCell={handleFlagCell}
              onChordCell={handleChordCell}
            >
              <ViewportProvider chunkSize={CHUNK_SIZE}>
                <ChunkLoader />
              </ViewportProvider>
            </GameProvider>
          </div>
        } />
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
