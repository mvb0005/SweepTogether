/**
 * Network module for handling all WebSocket communication.
 */

let socket;
let eventHandlers = {};

/**
 * Initializes the WebSocket connection.
 * 
 * @returns {Object} The socket.io instance
 */
export function connectSocket() {
    // Connect to the origin - Nginx will proxy /socket.io/ requests to the backend
    socket = io();
    console.log('Socket connection initialized');
    
    // Set up the basic socket event listeners
    socket.on('connect', () => {
        console.log('Connected to server with ID:', socket.id);
        if (eventHandlers.connect) {
            eventHandlers.connect(socket.id);
        }
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from server.');
        if (eventHandlers.disconnect) {
            eventHandlers.disconnect();
        }
    });

    socket.on('error', (error) => {
        console.error('Server error:', error.message);
        if (eventHandlers.error) {
            eventHandlers.error(error);
        }
    });

    return socket;
}

/**
 * Registers an event handler for a specific socket event.
 * 
 * @param {string} event - The event name
 * @param {Function} handler - The callback function to handle the event
 */
export function onSocketEvent(event, handler) {
    if (!socket) {
        console.error('Socket not initialized. Call connectSocket() first.');
        return;
    }
    
    eventHandlers[event] = handler;
    socket.on(event, handler);
}

/**
 * Sends a join game action to the server.
 * 
 * @param {string} gameId - The ID of the game to join
 */
export function sendJoinGame(gameId) {
    if (!socket) {
        console.error('Socket not initialized. Call connectSocket() first.');
        return;
    }
    
    console.log(`Sending joinGame event for game: ${gameId}`);
    socket.emit('joinGame', gameId);
}

/**
 * Sends a reveal tile action to the server.
 * 
 * @param {number} row - The row of the cell to reveal
 * @param {number} col - The column of the cell to reveal
 */
export function sendRevealTile(row, col) {
    if (!socket) {
        console.error('Socket not initialized. Call connectSocket() first.');
        return;
    }
    
    console.log(`Sending revealTile event for cell: (${row}, ${col})`);
    socket.emit('revealTile', { row, col });
}

/**
 * Sends a flag tile action to the server.
 * 
 * @param {number} row - The row of the cell to flag/unflag
 * @param {number} col - The column of the cell to flag/unflag
 */
export function sendFlagTile(row, col) {
    if (!socket) {
        console.error('Socket not initialized. Call connectSocket() first.');
        return;
    }
    
    console.log(`Sending flagTile event for cell: (${row}, ${col})`);
    socket.emit('flagTile', { row, col });
}

/**
 * Sends a chat message to the server.
 * 
 * @param {string} message - The message to send
 */
export function sendChatMessage(message) {
    if (!socket) {
        console.error('Socket not initialized. Call connectSocket() first.');
        return;
    }
    
    console.log(`Sending chat message: ${message}`);
    socket.emit('chat message', message);
}

/**
 * Gets the current socket ID.
 * 
 * @returns {string|null} The socket ID or null if not connected
 */
export function getSocketId() {
    return socket && socket.connected ? socket.id : null;
}