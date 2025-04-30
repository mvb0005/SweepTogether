// Import UI functions
import { 
  renderBoard, 
  updateLeaderboard, 
  updatePlayerScore, 
  updatePlayerStatus,
  highlightRevealedMine,
  markPendingMine,
  clearPendingMine,
  showMessage,
  disableBoard
} from './ui.js';

import {
  connectSocket,
  onSocketEvent,
  sendJoinGame,
  sendRevealTile,
  sendFlagTile,
  getSocketId
} from './network.js';

// Connect to the WebSocket server
const socket = connectSocket();

// Keep track of game state
let currentGameId = null;
let boardConfig = null;
let pendingMines = new Set(); // Store coordinates of mines pending reveal

/**
 * Extracts game ID from URL path or generates a simple one.
 * Assumes paths like /game/<gameId> or /
 */
function getGameIdFromUrl() {
    const path = window.location.pathname;
    const match = path.match(/^\/game\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
        return match[1];
    }
    // Handle root path or invalid paths - generate a simple ID for now
    console.log('No valid game ID in URL, generating temporary one.');
    return `temp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
}

/**
 * Called when cells in the game board are clicked.
 * 
 * @param {number} row - The row of the clicked cell
 * @param {number} col - The column of the clicked cell
 */
function handleCellClick(row, col) {
    console.log(`Cell clicked: (${row}, ${col})`);
    sendRevealTile(row, col);
}

/**
 * Called when cells in the game board are right-clicked.
 * 
 * @param {number} row - The row of the right-clicked cell
 * @param {number} col - The column of the right-clicked cell
 */
function handleCellRightClick(row, col) {
    console.log(`Cell right-clicked: (${row}, ${col})`);
    sendFlagTile(row, col);
}

/**
 * Updates the pending mines display.
 * 
 * @param {Array} pendingReveals - Array of {row, col} for pending mines
 */
function updatePendingMines(pendingReveals) {
    // Clear any mines that are no longer pending
    for (const coords of pendingMines) {
        const [row, col] = coords.split(',').map(Number);
        const stillPending = pendingReveals.some(
            mine => mine.row === row && mine.col === col
        );
        
        if (!stillPending) {
            clearPendingMine(row, col);
            pendingMines.delete(coords);
        }
    }
    
    // Add new pending mines
    for (const mine of pendingReveals) {
        const coords = `${mine.row},${mine.col}`;
        if (!pendingMines.has(coords)) {
            markPendingMine(mine.row, mine.col);
            pendingMines.add(coords);
        }
    }
}

// --- Socket Event Handlers ---

// Handle connection event
onSocketEvent('connect', (socketId) => {
    console.log('Connected to server with ID:', socketId);
    currentGameId = getGameIdFromUrl();
    console.log(`Attempting to join game: ${currentGameId}`);
    sendJoinGame(currentGameId);
});

// Handle disconnection
onSocketEvent('disconnect', () => {
    console.log('Disconnected from server.');
    document.getElementById('board').innerHTML = '<p>Disconnected. Attempting to reconnect...</p>';
    currentGameId = null;
    boardConfig = null;
});

// Handle game state updates
onSocketEvent('gameState', (state) => {
    console.log('Received gameState:', state);
    
    // Update the board if we have valid data
    if (state.boardState && state.boardConfig) {
        boardConfig = state.boardConfig; // Store for later use
        renderBoard(state.boardState, state.boardConfig, handleCellClick, handleCellRightClick);
    } else {
        console.error('Received gameState is missing required properties', state);
    }
    
    // Update players list
    if (state.players) {
        updateLeaderboard(state.players);
    }
    
    // Update any pending mine reveals
    if (state.pendingReveals) {
        updatePendingMines(state.pendingReveals);
    }
    
    // Handle game over state
    if (state.gameOver) {
        disableBoard();
        const message = state.message || (state.winner ? 
            `Game over! Player ${state.winner} wins!` : 
            'Game over!');
        showMessage(message);
    }
    
    // Show message if provided
    if (state.message) {
        console.log(`Game message: ${state.message}`);
    }
});

// Handle player updates
onSocketEvent('playerUpdate', (players) => {
    console.log('Received playerUpdate:', players);
    updateLeaderboard(players);
});

// Handle score updates
onSocketEvent('scoreUpdate', (update) => {
    console.log('Received scoreUpdate:', update);
    const { playerId, newScore, scoreDelta, reason } = update;
    updatePlayerScore(playerId, newScore, scoreDelta, reason);
});

// Handle player status updates
onSocketEvent('playerStatusUpdate', (update) => {
    console.log('Received playerStatusUpdate:', update);
    const { playerId, status, lockedUntil } = update;
    updatePlayerStatus(playerId, status, lockedUntil);
});

// Handle mine revealed events
onSocketEvent('mineRevealed', (data) => {
    console.log('Received mineRevealed:', data);
    const { row, col, revealedBy } = data;
    
    // Remove from pending mines if it was there
    const coords = `${row},${col}`;
    if (pendingMines.has(coords)) {
        pendingMines.delete(coords);
    }
    
    // Highlight the revealed mine
    highlightRevealedMine(row, col, revealedBy);
});

// Handle game over
onSocketEvent('gameOver', (data) => {
    console.log('Game Over:', data);
    
    // Render final board state if provided
    if (data.boardState && boardConfig) {
        renderBoard(data.boardState, boardConfig, handleCellClick, handleCellRightClick);
    }
    
    // Disable further interaction
    disableBoard();
    
    // Show game over message
    showMessage(data.message || 'Game Over!');
});

// Handle errors
onSocketEvent('error', (error) => {
    console.error('Server error:', error.message);
    showMessage(`Error: ${error.message}`, 'error');
});

// Set up the chat form
const form = document.getElementById('form');
const input = document.getElementById('input');
if (form && input) {
    form.addEventListener('submit', function(e) {
        e.preventDefault();
        if (input.value) {
            socket.emit('chat message', input.value);
            input.value = '';
        }
    });
}

// Handle chat messages
onSocketEvent('chat message', (msg) => {
    const messages = document.getElementById('messages');
    if (messages) {
        const item = document.createElement('li');
        item.textContent = msg;
        messages.appendChild(item);
        messages.scrollTop = messages.scrollHeight;
    }
});
