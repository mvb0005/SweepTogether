/**
 * Game client module for handling game state and client-side logic.
 */

import * as UI from './ui.js';
import * as Network from './network.js';

// Game state variables
let currentGameId = null;
let boardConfig = null;
let isGameOver = false;
let pendingMines = new Set(); // Track mines that are pending reveal

/**
 * Initializes the game client.
 */
export function initGame() {
    // Initialize socket connection
    Network.connectSocket();
    
    // Set up event handlers for socket events
    setupSocketEventHandlers();
    
    // Setup chat submission handler
    setupChatHandler();
    
    // Start the game by detecting or generating a game ID and joining
    joinGame();
}

/**
 * Sets up all socket event handlers.
 */
function setupSocketEventHandlers() {
    // Handle initial connection
    Network.onSocketEvent('connect', (socketId) => {
        console.log('Connected with socket ID:', socketId);
    });
    
    // Handle disconnection
    Network.onSocketEvent('disconnect', () => {
        UI.showMessage('Disconnected from server. Attempting to reconnect...', 'info');
    });
    
    // Handle errors
    Network.onSocketEvent('error', (error) => {
        UI.showMessage(`Error: ${error.message}`, 'alert');
    });
    
    // Handle game state updates
    Network.onSocketEvent('gameState', (state) => {
        console.log('Received gameState update:', state);
        
        // Store the board configuration
        if (state.boardConfig) {
            boardConfig = state.boardConfig;
        }
        
        // Update game over state
        if (state.gameOver !== undefined) {
            isGameOver = state.gameOver;
        }
        
        // Render board if we have both board state and config
        if (state.boardState && boardConfig) {
            UI.renderBoard(
                state.boardState, 
                boardConfig, 
                handleCellClick, 
                handleCellRightClick
            );
            
            // Disable board if game is over
            if (isGameOver) {
                UI.disableBoard();
            }
        }
        
        // Update player scores
        if (state.players) {
            UI.updateLeaderboard(state.players);
        }
        
        // Show any messages from the server
        if (state.message) {
            UI.addChatMessage(state.message);
        }
        
        // Handle pending mine reveals
        if (state.pendingReveals) {
            // Keep track of pending mine locations
            const newPendingSet = new Set();
            
            state.pendingReveals.forEach(coord => {
                const key = `${coord.row},${coord.col}`;
                newPendingSet.add(key);
                
                // If this is a new pending mine, mark it
                if (!pendingMines.has(key)) {
                    UI.markPendingMine(coord.row, coord.col);
                }
            });
            
            // Remove mines that are no longer pending
            pendingMines.forEach(key => {
                if (!newPendingSet.has(key)) {
                    const [row, col] = key.split(',').map(Number);
                    UI.clearPendingMine(row, col);
                }
            });
            
            pendingMines = newPendingSet;
        }
    });
    
    // Handle player updates
    Network.onSocketEvent('playerUpdate', (players) => {
        UI.updateLeaderboard(players);
    });
    
    // Handle player status updates
    Network.onSocketEvent('playerStatusUpdate', (statusUpdate) => {
        UI.updatePlayerStatus(
            statusUpdate.playerId,
            statusUpdate.status,
            statusUpdate.lockedUntil
        );
    });
    
    // Handle score updates
    Network.onSocketEvent('scoreUpdate', (scoreUpdate) => {
        UI.updatePlayerScore(
            scoreUpdate.playerId,
            scoreUpdate.newScore,
            scoreUpdate.scoreDelta,
            scoreUpdate.reason
        );
    });
    
    // Handle mine revealed events
    Network.onSocketEvent('mineRevealed', (mineReveal) => {
        // Remove from pending set if it was there
        const key = `${mineReveal.row},${mineReveal.col}`;
        if (pendingMines.has(key)) {
            pendingMines.delete(key);
            UI.clearPendingMine(mineReveal.row, mineReveal.col);
        }
        
        // Highlight the revealed mine with player contribution info
        UI.highlightRevealedMine(
            mineReveal.row,
            mineReveal.col,
            mineReveal.revealedBy
        );
        
        // Add a message to the chat
        const topPlayer = mineReveal.revealedBy.find(p => p.position === 1);
        if (topPlayer) {
            UI.addChatMessage(`Mine at (${mineReveal.row}, ${mineReveal.col}) revealed! First found by: ${topPlayer.playerId.substring(0, 6)}`);
        } else {
            UI.addChatMessage(`Mine at (${mineReveal.row}, ${mineReveal.col}) revealed!`);
        }
    });
    
    // Handle game over
    Network.onSocketEvent('gameOver', (data) => {
        isGameOver = true;
        
        // Render final board state
        if (data.boardState && boardConfig) {
            UI.renderBoard(
                data.boardState, 
                boardConfig, 
                handleCellClick, 
                handleCellRightClick
            );
            UI.disableBoard();
        }
        
        // Show game over message
        UI.showMessage(data.message || 'Game Over!', 'alert');
        // Also add to chat log
        UI.addChatMessage(`GAME OVER: ${data.message || 'Game Over!'}`);
    });
    
    // Handle chat messages
    Network.onSocketEvent('chat message', (msg) => {
        UI.addChatMessage(msg);
    });
}

/**
 * Sets up the chat form submission handler.
 */
function setupChatHandler() {
    const form = document.getElementById('form');
    const input = document.getElementById('input');
    
    if (form && input) {
        form.addEventListener('submit', function(e) {
            e.preventDefault();
            if (input.value) {
                Network.sendChatMessage(input.value);
                input.value = '';
            }
        });
    }
}

/**
 * Extracts game ID from URL path or generates a simple one.
 * 
 * @returns {string} The game ID
 */
function getGameIdFromUrl() {
    const path = window.location.pathname;
    const match = path.match(/^\/game\/([a-zA-Z0-9_-]+)/);
    
    if (match && match[1]) {
        return match[1];
    }
    
    // Generate a temporary ID if none in URL
    console.log('No valid game ID in URL, generating temporary one.');
    return `temp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
}

/**
 * Joins or creates a game.
 */
function joinGame() {
    currentGameId = getGameIdFromUrl();
    console.log(`Joining game with ID: ${currentGameId}`);
    Network.sendJoinGame(currentGameId);
}

/**
 * Handles left-click on a cell (reveal action).
 * 
 * @param {number} row - The row of the clicked cell
 * @param {number} col - The column of the clicked cell
 */
function handleCellClick(row, col) {
    if (isGameOver) {
        console.log('Game is over, ignoring cell click');
        return;
    }
    
    Network.sendRevealTile(row, col);
}

/**
 * Handles right-click on a cell (flag action).
 * 
 * @param {number} row - The row of the clicked cell
 * @param {number} col - The column of the clicked cell
 */
function handleCellRightClick(row, col) {
    if (isGameOver) {
        console.log('Game is over, ignoring cell right-click');
        return;
    }
    
    Network.sendFlagTile(row, col);
}

/**
 * Gets the current game ID.
 * 
 * @returns {string|null} The current game ID or null
 */
export function getCurrentGameId() {
    return currentGameId;
}

/**
 * Gets the current board configuration.
 * 
 * @returns {Object|null} The current board configuration or null
 */
export function getBoardConfig() {
    return boardConfig;
}

/**
 * Checks if the game is over.
 * 
 * @returns {boolean} Whether the game is over
 */
export function isGameFinished() {
    return isGameOver;
}