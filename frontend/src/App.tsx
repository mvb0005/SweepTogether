import { useState, useEffect } from 'react';
import { useSocket } from './hooks/useSocket';
import { useViewport } from './hooks/useViewport'; // Import our new hook
import Board from './components/Board';
import {
  BoardState,
  Player,
  LeaderboardEntry,
  UpdateBoardPayload,
  UpdatePlayersPayload,
  GameOverPayload,
  PlayerLockoutPayload,
  PlayerUnlockPayload,
  UpdateLeaderboardPayload,
  GameJoinedPayload,
  GameStatePayload,
  ViewportState
} from './types';

function App() {
  const { socket, isConnected } = useSocket();
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [board, setBoard] = useState<BoardState>([]);
  const [players, setPlayers] = useState<Record<string, Player>>({});
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [isGameOver, setIsGameOver] = useState<boolean>(false);
  const [winner, setWinner] = useState<string | undefined | null>(null);
  const [gameId, setGameId] = useState<string | null>(null);
  
  // Get viewport dimensions based on window size
  const calculateInitialViewport = () => {
    const cellSize = 30; // px per cell
    const width = Math.floor((window.innerWidth * 0.8) / cellSize);
    const height = Math.floor((window.innerHeight * 0.8) / cellSize);
    return { width, height };
  };
  
  const initialDimensions = calculateInitialViewport();

  // Viewport management with our custom hook
  const { 
    viewport, 
    handlePanStart, 
    handlePanMove, 
    handlePanEnd,
    setCenterPosition
  } = useViewport({
    initialWidth: initialDimensions.width,
    initialHeight: initialDimensions.height,
    onViewportChange: (newViewport) => {
      // Send viewport updates to server when it changes
      if (socket && isConnected && playerId) {
        socket.emit('updateViewport', {
          center: newViewport.center,
          width: newViewport.width,
          height: newViewport.height,
          zoom: newViewport.zoom
        });
      }
    }
  });

  // Determine if the current player is locked
  const isPlayerLocked = playerId ? players[playerId]?.isLocked ?? false : false;

  // --- Event Handlers for Board Interaction ---
  const handleRevealCell = (worldX: number, worldY: number) => {
    if (socket && isConnected && !isPlayerLocked && !isGameOver) {
      console.log(`Sending revealTile event for cell: (${worldX}, ${worldY})`);
      socket.emit('revealTile', { x: worldX, y: worldY });
    } else {
      console.log('Cannot reveal: Socket not connected, player locked, or game over.');
    }
  };

  const handleFlagCell = (worldX: number, worldY: number) => {
    if (socket && isConnected && !isPlayerLocked && !isGameOver) {
      console.log(`Sending flagTile event for cell: (${worldX}, ${worldY})`);
      socket.emit('flagTile', { x: worldX, y: worldY });
    } else {
      console.log('Cannot flag: Socket not connected, player locked, or game over.');
    }
  };

  const handleChordCell = (worldX: number, worldY: number) => {
    if (socket && isConnected && !isPlayerLocked && !isGameOver) {
      console.log(`Sending chordClick event for cell: (${worldX}, ${worldY})`);
      socket.emit('chordClick', { x: worldX, y: worldY });
    } else {
      console.log('Cannot chord: Socket not connected, player locked, or game over.');
    }
  };

  // Handle navigation to another player's position
  const handleNavigateToPlayer = (targetPlayerId: string) => {
    const targetPlayer = players[targetPlayerId];
    if (targetPlayer && targetPlayer.viewport) {
      setCenterPosition(
        targetPlayer.viewport.center.x,
        targetPlayer.viewport.center.y
      );
    }
  };

  // --- useEffect Hooks ---
  useEffect(() => {
    const pathSegments = window.location.pathname.split('/').filter(Boolean);
    // Expecting path like /game/{gameId}
    if (pathSegments.length >= 2 && pathSegments[0] === 'game') {
      const id = pathSegments[1];
      console.log(`Extracted game ID: ${id} from path ${window.location.pathname}`);
      setGameId(id);
    } else {
      // Fallback or handle invalid path - maybe redirect or show an error
      console.log(`Invalid path format: ${window.location.pathname}. Expected /game/{gameId}. Using 'default' game ID.`);
      setGameId('default'); 
      // Optionally, redirect to /game/default
      // window.history.replaceState({}, '', '/game/default');
    }
  }, []);

  // Main socket connection and event handlers
  useEffect(() => {
    if (socket && isConnected && gameId) {
      console.log(`Socket connected, attempting to join game: ${gameId}`);
      socket.emit('joinGame', gameId);
      
      // Socket event handlers
      const handleGameState = (data: GameStatePayload) => {
        console.log('Received game state update', data);
        
        // Set player ID if it was included in the response
        if (data.playerId) {
          setPlayerId(data.playerId);
        }
        
        // Update board if it exists in the payload
        if (data.boardState) {
          console.log('Setting board state from game state event');
          setBoard(data.boardState);
        }
        
        // Update players if they exist in the payload
        if (data.players) {
          setPlayers(data.players);
        }
        
        // Update game over state
        if (data.gameOver !== undefined) {
          setIsGameOver(data.gameOver);
        }
        
        // Update winner if it exists
        if (data.winner !== undefined) {
          setWinner(data.winner);
        }
      };
      
      const handleUpdateBoard = (data: UpdateBoardPayload) => {
        console.log('Received board update', data);
        setBoard(data.board);
      };

      const handleUpdatePlayers = (data: UpdatePlayersPayload) => {
        console.log('Received players update', data.players);
        setPlayers(data.players);
      };

      const handleUpdateLeaderboard = (data: UpdateLeaderboardPayload) => {
        console.log('Received leaderboard update', data.leaderboard);
        setLeaderboard(data.leaderboard);
      };

      const handleGameOver = (data: GameOverPayload) => {
        console.log('Received game over', data);
        setIsGameOver(true);
        setWinner(data.winner);
        if (data.boardState) {
          console.log('Setting final board state from game over event');
          setBoard(data.boardState);
        }
      };

      const handlePlayerLocked = (data: PlayerLockoutPayload) => {
        console.log(`Player ${data.playerId} locked until ${new Date(data.lockedUntil).toLocaleTimeString()}`);
        setPlayers(prev => ({
          ...prev,
          ...(prev[data.playerId] && {
            [data.playerId]: { ...prev[data.playerId], isLocked: true, lockedUntil: data.lockedUntil }
          })
        }));
      };

      const handlePlayerUnlocked = (data: PlayerUnlockPayload) => {
        console.log(`Player ${data.playerId} unlocked`);
        setPlayers(prev => ({
          ...prev,
          ...(prev[data.playerId] && {
            [data.playerId]: { ...prev[data.playerId], isLocked: false, lockedUntil: undefined }
          })
        }));
      };

      // Handle viewport updates for other players
      const handlePlayerViewportUpdate = (data: { playerId: string, viewport: ViewportState }) => {
        console.log(`Player ${data.playerId} viewport updated:`, data.viewport);
        setPlayers(prev => ({
          ...prev,
          ...(prev[data.playerId] && {
            [data.playerId]: { ...prev[data.playerId], viewport: data.viewport }
          })
        }));
      };

      // Handler for viewport-specific board updates
      const handleViewportBoardUpdate = (data: { boardState: BoardState, center: { x: number, y: number } }) => {
        console.log('Received viewport board update for center:', data.center);
        if (data.boardState) {
          setBoard(data.boardState);
        }
      };

      // Register event handlers
      socket.on('gameState', handleGameState);
      socket.on('updateBoard', handleUpdateBoard);
      socket.on('updatePlayers', handleUpdatePlayers);
      socket.on('updateLeaderboard', handleUpdateLeaderboard);
      socket.on('gameOver', handleGameOver);
      socket.on('playerLocked', handlePlayerLocked);
      socket.on('playerUnlocked', handlePlayerUnlocked);
      socket.on('playerViewportUpdate', handlePlayerViewportUpdate);
      socket.on('viewportUpdate', handleViewportBoardUpdate);

      return () => {
        console.log('Removing socket listeners...');
        socket.off('gameState', handleGameState);
        socket.off('updateBoard', handleUpdateBoard);
        socket.off('updatePlayers', handleUpdatePlayers);
        socket.off('updateLeaderboard', handleUpdateLeaderboard);
        socket.off('gameOver', handleGameOver);
        socket.off('playerLocked', handlePlayerLocked);
        socket.off('playerUnlocked', handlePlayerUnlocked);
        socket.off('playerViewportUpdate', handlePlayerViewportUpdate);
        socket.off('viewportUpdate', handleViewportBoardUpdate);
      };
    }
  }, [socket, isConnected, gameId, playerId]);

  // Separate effect for sending viewport updates with debounce
  const [viewportUpdateTimeout, setViewportUpdateTimeout] = useState<NodeJS.Timeout | null>(null);
  
  useEffect(() => {
    // Only send viewport updates if we're connected and have a player ID
    if (socket && isConnected && playerId) {
      // Clear any pending timeout to debounce rapid viewport changes
      if (viewportUpdateTimeout) {
        clearTimeout(viewportUpdateTimeout);
      }
      
      // Set a new timeout to send viewport update after a short delay
      const timeout = setTimeout(() => {
        console.log('Sending viewport update:', viewport);
        socket.emit('updateViewport', {
          center: viewport.center,
          width: viewport.width,
          height: viewport.height,
          zoom: viewport.zoom
        });
      }, 100); // Debounce for 100ms
      
      setViewportUpdateTimeout(timeout);
      
      return () => {
        if (viewportUpdateTimeout) {
          clearTimeout(viewportUpdateTimeout);
        }
      };
    }
  }, [viewport, socket, isConnected, playerId]);

  // --- Render Player List ---
  const renderPlayerList = () => {
    return (
      <div className="player-list">
        <h3>Players</h3>
        <ul>
          {Object.entries(players).map(([id, player]) => (
            <li 
              key={id} 
              className={id === playerId ? 'current-player' : ''}
              onClick={() => id !== playerId && handleNavigateToPlayer(id)}
              style={{ cursor: id !== playerId ? 'pointer' : 'default' }}
            >
              {player.username || id.slice(0, 6)} - Score: {player.score}
              {player.isLocked && <span className="locked-badge"> LOCKED</span>}
              {id === playerId && <span className="you-badge"> (You)</span>}
            </li>
          ))}
        </ul>
        {Object.keys(players).length === 0 && <p>No players connected</p>}
      </div>
    );
  };

  // --- Render ---
  return (
    <div className="app-container">
      <h1>Infinite Minesweeper</h1>
      <div className="status-bar">
        <div>Status: {isConnected ? 'Connected' : 'Disconnected'}</div>
        {isConnected && playerId && <div>Your Player ID: {playerId}</div>}
        {isConnected && gameId && <div>Game ID: {gameId}</div>}
      </div>
      
      {isGameOver && (
        <h2 className="game-over-banner">
          Game Over! {winner ? `Winner: ${players[winner]?.username || winner}` : 'No winner.'}
        </h2>
      )}
      
      {isPlayerLocked && (
        <p className="locked-message">
          You are locked out! Wait until {new Date(players[playerId!]?.lockedUntil!).toLocaleTimeString()}
        </p>
      )}
      
      <div className="game-container">
        <div className="sidebar">
          {renderPlayerList()}
        </div>
        
        <div className="main-content">
          <Board 
            boardData={board}
            onRevealCell={handleRevealCell}
            onFlagCell={handleFlagCell}
            onChordCell={handleChordCell}
            isPlayerLocked={isPlayerLocked}
            viewport={viewport}
            onPanStart={handlePanStart}
            onPanMove={handlePanMove}
            onPanEnd={handlePanEnd}
          />
        </div>
      </div>
    </div>
  );
}

export default App;