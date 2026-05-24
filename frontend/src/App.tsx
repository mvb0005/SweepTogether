import React, { useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { SocketProvider, useSocket } from './hooks/useSocket';
import { useGameSession } from './hooks/useGameSession';
import { ViewportProvider } from './contexts/ViewportContext';
import { GameProvider } from './contexts/GameContext';
import ChunkLoader from './components/ChunkLoader';
import './App.css';

const CHUNK_SIZE = 32;
const GAME_ID = 'default';

const params = new URLSearchParams(window.location.search);
const USERNAME = params.get('playerId') || 'Anonymous';

const AppContent: React.FC = () => {
  const { socket, isConnected } = useSocket();
  const { playerId, isJoined } = useGameSession(socket, isConnected, GAME_ID, USERNAME);

  const handleRevealCell = useCallback((x: number, y: number) => {
    if (!socket || !isConnected || !isJoined || !playerId) return;
    socket.emit('revealTile', { gameId: GAME_ID, playerId, x, y });
  }, [socket, isConnected, isJoined, playerId]);

  const handleFlagCell = useCallback((x: number, y: number) => {
    if (!socket || !isConnected || !isJoined || !playerId) return;
    socket.emit('flagTile', { gameId: GAME_ID, playerId, x, y });
  }, [socket, isConnected, isJoined, playerId]);

  const handleChordCell = useCallback((x: number, y: number) => {
    if (!socket || !isConnected || !isJoined || !playerId) return;
    socket.emit('chordClick', { gameId: GAME_ID, playerId, x, y });
  }, [socket, isConnected, isJoined, playerId]);

  if (!isJoined) {
    return <div className="loading-message">Joining game...</div>;
  }

  return (
    <div className="app">
      <Routes>
        <Route path="/" element={
          <div className="game-container">
            <GameProvider
              gameId={GAME_ID}
              playerId={playerId}
              isPlayerLocked={false}
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
