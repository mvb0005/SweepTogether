import React, { useState, useCallback, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate } from 'react-router-dom';
import { SocketProvider, useSocket } from './hooks/useSocket';
import Viewport from './components/Viewport';
import ChunkLoader from './components/ChunkLoader';
import SingleChunkPage from './components/SingleChunkPage';
import './App.css';

const CHUNK_SIZE = 16;
const MAX_VISIBLE_CHUNKS = 2;

const DEFAULT_USERNAME = 'Player';

const AppContent: React.FC = () => {
  const navigate = useNavigate();
  const { socket, isConnected } = useSocket();
  const [gameId] = useState('default');
  const [isPlayerLocked, setIsPlayerLocked] = useState(false);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [isJoined, setIsJoined] = useState(false);

  // Extract playerId from URL query params
  const params = new URLSearchParams(window.location.search);
  const playerIdFromUrl = params.get('playerId') || 'Anonymous';

  // Join game on connect
  useEffect(() => {
    if (socket && isConnected && !isJoined) {
      socket.emit('joinGame', { gameId, username: playerIdFromUrl });
      socket.on('gameJoined', (data: any) => {
        setPlayerId(data.playerId);
        setIsJoined(true);
      });
      // Clean up listener on unmount
      return () => {
        socket.off('gameJoined');
      };
    }
  }, [socket, isConnected, gameId, isJoined, playerIdFromUrl]);

  const handleRevealCell = useCallback((x: number, y: number) => {
    if (!socket || !isConnected || isPlayerLocked || !isJoined || !playerId) return;
    socket.emit('revealTile', {
      gameId,
      playerId,
      x,
      y
    });
  }, [socket, isConnected, gameId, isPlayerLocked, isJoined, playerId]);

  const handleFlagCell = useCallback((x: number, y: number) => {
    if (!socket || !isConnected || isPlayerLocked || !isJoined || !playerId) return;
    socket.emit('flagTile', {
      gameId,
      playerId,
      x,
      y
    });
  }, [socket, isConnected, gameId, isPlayerLocked, isJoined, playerId]);

  const handleChordCell = useCallback((x: number, y: number) => {
    if (!socket || !isConnected || isPlayerLocked || !isJoined || !playerId) return;
    socket.emit('chordClick', {
      gameId,
      playerId,
      x,
      y
    });
  }, [socket, isConnected, gameId, isPlayerLocked, isJoined, playerId]);

  if (!isJoined) {
    return <div className="loading-message">Joining game...</div>;
  }

  return (
    <div className="app">
      <Routes>
        <Route path="/chunk/:gameId/:chunkX/:chunkY" element={<SingleChunkPage />} />
        <Route path="/" element={
          <div className="game-container">
            <Viewport chunkSize={CHUNK_SIZE} maxVisibleChunks={MAX_VISIBLE_CHUNKS}>
              {({ visibleChunks, viewport, onPanStart, onPanMove, onPanEnd, setViewport }) => (
                <ChunkLoader
                  gameId={gameId}
                  visibleChunks={visibleChunks}
                  viewport={viewport}
                  onRevealCell={handleRevealCell}
                  onFlagCell={handleFlagCell}
                  onChordCell={handleChordCell}
                  isPlayerLocked={isPlayerLocked}
                  onPanStart={onPanStart}
                  onPanMove={onPanMove}
                  onPanEnd={onPanEnd}
                />
              )}
            </Viewport>
          </div>
        } />
      </Routes>
    </div>
  );
};

const App: React.FC = () => {
  return (
    <SocketProvider>
      <Router>
        <AppContent />
      </Router>
    </SocketProvider>
  );
};

export default App;