/**
 * Main entry point for the Minesweeper application.
 * Initializes the game and sets up any global components.
 */

import { initGame } from './gameClient.js';

// Initialize the game when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing game client...');
    initGame();
});