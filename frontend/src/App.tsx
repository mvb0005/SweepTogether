import { useState, useEffect } from 'react';
import { useSocket } from './hooks/useSocket';
import Board from './components/Board'; // Import the Board component
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
  GameStatePayload
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

  // Determine if the current player is locked
  const isPlayerLocked = playerId ? players[playerId]?.isLocked ?? false : false;

  // --- Event Handlers for Board Interaction ---
  const handleRevealCell = (row: number, col: number) => {
    if (socket && isConnected && !isPlayerLocked && !isGameOver) {
      console.log(`Sending revealTile event for cell: (${row}, ${col})`);
      socket.emit('revealTile', { row, col });
    } else {
      console.log('Cannot reveal: Socket not connected, player locked, or game over.');
    }
  };

  const handleFlagCell = (row: number, col: number) => {
    if (socket && isConnected && !isPlayerLocked && !isGameOver) {
      console.log(`Sending flagTile event for cell: (${row}, ${col})`);
      socket.emit('flagTile', { row, col });
    } else {
      console.log('Cannot flag: Socket not connected, player locked, or game over.');
    }
  };

  const handleChordCell = (row: number, col: number) => {
    if (socket && isConnected && !isPlayerLocked && !isGameOver) {
      console.log(`Sending chordClick event for cell: (${row}, ${col})`);
      socket.emit('chordClick', { row, col });
    } else {
      console.log('Cannot chord: Socket not connected, player locked, or game over.');
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

  useEffect(() => {
    if (socket && isConnected && gameId) {
      console.log(`Socket connected, attempting to join game: ${gameId}`);
      socket.emit('joinGame', gameId);

      // Set up event listeners
      const handleGameState = (data: GameStatePayload) => {
        console.log('Game state received!', data);
        setPlayerId(data.playerId || socket.id);
        if (data.boardState) {
          console.log('Setting initial board state:', data.boardState);
          setBoard(data.boardState);
        }
        if (data.players) {
          console.log('Setting players:', data.players);
          setPlayers(data.players);
        }
        if (data.message) {
          console.log('Server message:', data.message);
        }
        setIsGameOver(data.gameOver || false);
        setWinner(data.winner);
      };

      const handleUpdateBoard = (data: UpdateBoardPayload) => {
        console.log('Received board update');
        setBoard(data.board);
      };

      const handleUpdatePlayers = (data: UpdatePlayersPayload) => {
        console.log('Received player update', data.players);
        setPlayers(data.players);
        if (!playerId && socket.id && data.players[socket.id]) {
            setPlayerId(socket.id);
        }
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

      // Register event handlers
      socket.on('gameState', handleGameState);
      socket.on('updateBoard', handleUpdateBoard);
      socket.on('updatePlayers', handleUpdatePlayers);
      socket.on('updateLeaderboard', handleUpdateLeaderboard);
      socket.on('gameOver', handleGameOver);
      socket.on('playerLocked', handlePlayerLocked);
      socket.on('playerUnlocked', handlePlayerUnlocked);

      return () => {
        console.log('Removing socket listeners...');
        socket.off('gameState', handleGameState);
        socket.off('updateBoard', handleUpdateBoard);
        socket.off('updatePlayers', handleUpdatePlayers);
        socket.off('updateLeaderboard', handleUpdateLeaderboard);
        socket.off('gameOver', handleGameOver);
        socket.off('playerLocked', handlePlayerLocked);
        socket.off('playerUnlocked', handlePlayerUnlocked);
      };
    }
  }, [socket, isConnected, gameId, playerId]);

  // --- Render ---
  return (
    <div>
      <h1>Multiplayer Minesweeper</h1>
      <p>Status: {isConnected ? 'Connected' : 'Disconnected'}</p>
      {isConnected && playerId && <p>Your Player ID: {playerId}</p>}
      {isConnected && gameId && <p>Game ID: {gameId}</p>}
      {isGameOver && (
        <h2>Game Over! {winner ? `Winner: ${players[winner]?.username || winner}` : 'No winner.'}</h2>
      )}
      {isPlayerLocked && (
        <p style={{ color: 'red', fontWeight: 'bold' }}>
          You are locked out! Wait until {new Date(players[playerId!]?.lockedUntil!).toLocaleTimeString()}
        </p>
      )}
      <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
        <div>
          <h2>Board</h2>
          {/* Render the Board component */}
          <Board
            boardData={board}
            onRevealCell={handleRevealCell}
            onFlagCell={handleFlagCell}
            onChordCell={handleChordCell}
            isPlayerLocked={isPlayerLocked}
          />
        </div>
        <div>
          <h2>Players</h2>
          {/* Placeholder for PlayerList component */}
          <ul>
            {Object.values(players).map(p => (
              <li key={p.id} style={{ color: p.isLocked ? 'grey' : 'inherit' }}>
                {p.username || p.id.substring(0, 6)}
                (Score: {p.score})
                {p.isLocked ? ` (Locked until ${new Date(p.lockedUntil!).toLocaleTimeString()})` : ''}
                {p.id === playerId ? <strong> (You)</strong> : ''}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2>Leaderboard</h2>
          {/* Placeholder for Leaderboard component */}
          <ol>
            {leaderboard.map((entry, index) => (
              <li key={entry.playerId || index}>
                {entry.username || entry.playerId.substring(0, 6)}: {entry.score}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

export default App;