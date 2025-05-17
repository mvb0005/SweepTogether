import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSocket } from '../hooks/useSocket';
import Board from './Board';
import { ChunkMap, ChunkUpdatePayload, chunkCoordsToKey } from '../types';
import './SingleChunkPage.css';

const SingleChunkPage: React.FC = () => {
  const { gameId: initialGameId, x, y } = useParams();
  const navigate = useNavigate();
  const chunkX = Number(x);
  const chunkY = Number(y);
  const CHUNK_SIZE = 16;

  // Use the same socket logic as App
  const { socket, isConnected } = useSocket();
  const [chunks, setChunks] = useState<ChunkMap>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentGameId, setCurrentGameId] = useState<string | undefined>(initialGameId);

  // Join game when component mounts
  useEffect(() => {
    if (!socket || !isConnected || !currentGameId) {
      console.log('Cannot join game:', { socket: !!socket, isConnected, currentGameId });
      return;
    }

    const joinGame = () => {
      console.log('Joining game:', currentGameId);
      socket.emit('joinGame', { gameId: currentGameId, username: 'Anonymous' });
    };

    const handleJoinError = (error: any) => {
      console.error('Error joining game:', error);
      // If game doesn't exist, create it
      if (error.details?.includes('Game not found')) {
        console.log('Game not found, creating new game');
        socket.emit('createGame', {
          gameConfig: {
            isInfiniteWorld: true,
            rows: 16,  // Match CHUNK_SIZE
            cols: 16,  // Match CHUNK_SIZE
            mines: 40  // Standard minesweeper ratio
          },
          username: 'Anonymous'
        });
      } else {
        setError(`Failed to join game: ${error.message || 'Unknown error'}`);
        setIsLoading(false);
      }
    };

    const handleGameCreated = (data: any) => {
      console.log('Game created:', data);
      setCurrentGameId(data.gameId);
      // After game is created, try joining again
      joinGame();
    };

    const handleGameJoined = (data: any) => {
      console.log('Game joined:', data);
      setIsLoading(false);
    };

    socket.on('joinError', handleJoinError);
    socket.on('gameCreated', handleGameCreated);
    socket.on('gameJoined', handleGameJoined);

    // Initial attempt to join
    joinGame();

    return () => {
      socket.off('joinError', handleJoinError);
      socket.off('gameCreated', handleGameCreated);
      socket.off('gameJoined', handleGameJoined);
    };
  }, [socket, isConnected, currentGameId]);

  // Calculate center position for the viewport
  const center = {
    x: chunkX * CHUNK_SIZE + Math.floor(CHUNK_SIZE / 2),
    y: chunkY * CHUNK_SIZE + Math.floor(CHUNK_SIZE / 2)
  };

  // Use a fixed viewport matching the chunk
  const viewport = {
    center,
    width: CHUNK_SIZE,
    height: CHUNK_SIZE,
    zoom: 1
  };

  // Subscribe to just this chunk
  useEffect(() => {
    if (!socket || !isConnected || !currentGameId) return;

    setIsLoading(true);
    setError(null);

    console.log('Subscribing to chunk:', { chunkX, chunkY });
    socket.emit('subscribeToChunk', { gameId: currentGameId, chunkX, chunkY });

    const handleChunkData = (data: any) => {
      console.log('Received chunk data:', data);
      const chunkKey = chunkCoordsToKey({ x: data.chunkX, y: data.chunkY });
      setChunks(prev => ({
        ...prev,
        [chunkKey]: {
          coords: { x: data.chunkX, y: data.chunkY },
          cells: data.tiles.map((row: any[]) => 
            row.map(cell => ({
              x: cell.x,
              y: cell.y,
              revealed: cell.revealed,
              flagged: cell.flagged,
              // Only include mine info if the cell is revealed
              ...(cell.revealed && {
                isMine: cell.isMine,
                adjacentMines: cell.adjacentMines
              })
            }))
          )
        }
      }));
      setIsLoading(false);
    };

    const handleError = (error: any) => {
      console.error('Error loading chunk:', error);
      setError('Failed to load chunk data. Please try again.');
      setIsLoading(false);
    };

    socket.on('chunkData', handleChunkData);
    socket.on('error', handleError);

    return () => {
      console.log('Unsubscribing from chunk:', { chunkX, chunkY });
      socket.off('chunkData', handleChunkData);
      socket.off('error', handleError);
    };
  }, [socket, isConnected, chunkX, chunkY, currentGameId]);

  // Board interaction handlers
  const handleRevealCell = (x: number, y: number) => {
    if (!socket || !isConnected || !currentGameId) return;
    console.log('Revealing cell:', { x, y });
    socket.emit('revealTile', {
      gameId: currentGameId,
      playerId: 'Anonymous', // We should get this from the game state
      x,
      y
    });
  };

  const handleFlagCell = (x: number, y: number) => {
    if (!socket || !isConnected || !currentGameId) return;
    console.log('Flagging cell:', { x, y });
    socket.emit('flagTile', {
      gameId: currentGameId,
      playerId: 'Anonymous', // We should get this from the game state
      x,
      y
    });
  };

  const handleChordCell = (x: number, y: number) => {
    if (!socket || !isConnected || !currentGameId) return;
    console.log('Chord clicking cell:', { x, y });
    socket.emit('chordClick', {
      gameId: currentGameId,
      playerId: 'Anonymous', // We should get this from the game state
      x,
      y
    });
  };

  // Listen for board updates
  useEffect(() => {
    if (!socket || !isConnected || !currentGameId) return;

    const handleBoardUpdate = (data: any) => {
      console.log('Received board update:', data);
      // Update the chunk data with the new cell states
      const chunkKey = chunkCoordsToKey({ x: chunkX, y: chunkY });
      setChunks(prev => {
        const currentChunk = prev[chunkKey];
        if (!currentChunk) return prev;

        const updatedCells = currentChunk.cells.map(row => 
          row.map(cell => {
            const updatedCell = data.cells.find((c: any) => c.x === cell.x && c.y === cell.y);
            if (updatedCell) {
              return {
                x: cell.x,
                y: cell.y,
                revealed: updatedCell.revealed,
                flagged: updatedCell.flagged,
                ...(updatedCell.revealed && {
                  isMine: updatedCell.isMine,
                  adjacentMines: updatedCell.adjacentMines
                })
              };
            }
            return cell;
          })
        );

        return {
          ...prev,
          [chunkKey]: {
            ...currentChunk,
            cells: updatedCells
          }
        };
      });
    };

    socket.on('boardUpdate', handleBoardUpdate);

    return () => {
      socket.off('boardUpdate', handleBoardUpdate);
    };
  }, [socket, isConnected, currentGameId, chunkX, chunkY]);

  // Board interaction handlers (no-op or alert)
  const noop = () => {};
  const handleInteraction = () => {
    alert('Please use the main game view to interact with cells.');
  };

  if (!currentGameId) {
    return (
      <div className="single-chunk-page">
        <div className="error-message">
          Invalid game ID. Please return to the main game.
        </div>
        <button onClick={() => navigate('/game/default')} className="back-button">
          Back to Game
        </button>
      </div>
    );
  }

  return (
    <div className="single-chunk-page">
      <div className="chunk-header">
        <h2>Chunk ({chunkX}, {chunkY})</h2>
        <button onClick={() => navigate(`/game/${currentGameId}`)} className="back-button">
          Back to Game
        </button>
      </div>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="loading-message">
          Loading chunk data...
        </div>
      ) : (
        <div className="chunk-container">
          <Board
            chunkMap={chunks}
            chunkSize={CHUNK_SIZE}
            viewport={viewport}
            onRevealCell={handleRevealCell}
            onFlagCell={handleFlagCell}
            onChordCell={handleChordCell}
            isPlayerLocked={false}
            onPanStart={noop}
            onPanMove={noop}
            onPanEnd={noop}
          />
        </div>
      )}
    </div>
  );
};

export default SingleChunkPage; 