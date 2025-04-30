/**
 * UI module for handling DOM interactions and display updates.
 */

/**
 * Player status types for CSS classes
 */
const PLAYER_STATUS = {
  ACTIVE: 'active',
  LOCKED_OUT: 'locked-out'
};

/**
 * Renders the entire game board based on the provided state.
 * 
 * @param {Array<Array<Object>>} boardState - 2D array of cell states from the server
 * @param {Object} boardConfig - Configuration details for the board (rows, cols, etc.)
 * @param {Function} onCellClick - Callback for cell left-click actions (reveal)
 * @param {Function} onCellRightClick - Callback for cell right-click actions (flag)
 */
export function renderBoard(boardState, boardConfig, onCellClick, onCellRightClick) {
    console.log('renderBoard called with boardState (first row sample):', boardState ? boardState[0] : 'null', 'and boardConfig:', boardConfig);
    const boardElement = document.getElementById('board');
    boardElement.innerHTML = ''; // Clear previous board
    
    if (!boardConfig || !boardState) {
        console.error('renderBoard received invalid data');
        return;
    }
    
    boardElement.style.gridTemplateColumns = `repeat(${boardConfig.cols}, 30px)`;

    for (let r = 0; r < boardConfig.rows; r++) {
        for (let c = 0; c < boardConfig.cols; c++) {
            const cellElement = document.createElement('div');
            cellElement.classList.add('cell');
            cellElement.dataset.row = r;
            cellElement.dataset.col = c;

            const cellData = boardState[r][c]; // Get the ClientCell object

            // Clear previous state classes and content
            cellElement.classList.remove('hidden', 'revealed', 'mine', 'flagged');
            cellElement.textContent = '';
            // Remove specific mine count classes
            cellElement.className = cellElement.className.replace(/mines-\d+/g, '').trim();

            if (cellData.revealed) {
                cellElement.classList.add('revealed');
                if (cellData.isMine) {
                    cellElement.classList.add('mine');
                    cellElement.textContent = '💣';
                } else if (cellData.adjacentMines !== undefined && cellData.adjacentMines > 0) {
                    cellElement.classList.add(`mines-${cellData.adjacentMines}`);
                    cellElement.textContent = cellData.adjacentMines.toString();
                }
                // If revealed and not a mine and 0 adjacent mines, it remains blank
            } else {
                cellElement.classList.add('hidden');
                if (cellData.flagged) {
                    cellElement.classList.add('flagged');
                    cellElement.textContent = '🚩';
                }
            }

            // Add click listener to reveal tile
            cellElement.addEventListener('click', () => {
                // Allow clicking hidden, unflagged cells OR revealed number cells (for chord clicks)
                if ((!cellData.revealed && !cellData.flagged) || (cellData.revealed && cellData.adjacentMines > 0)) {
                    console.log(`Clicked actionable cell: (${r}, ${c}) - revealed: ${cellData.revealed}, flagged: ${cellData.flagged}, adjacentMines: ${cellData.adjacentMines}`);
                    onCellClick(r, c);
                } else {
                    console.log(`Clicked non-actionable cell: (${r}, ${c}) - revealed: ${cellData.revealed}, flagged: ${cellData.flagged}, adjacentMines: ${cellData.adjacentMines}`);
                }
            });

            // Add right-click listener to flag/unflag tile
            cellElement.addEventListener('contextmenu', (e) => {
                e.preventDefault(); // Prevent context menu
                // Only allow flagging/unflagging hidden cells
                if (!cellData.revealed) {
                    console.log(`Right-clicked hidden cell: (${r}, ${c}) - toggling flag`);
                    onCellRightClick(r, c);
                } else {
                    console.log(`Right-clicked revealed cell: (${r}, ${c}) - ignoring`);
                }
            });

            boardElement.appendChild(cellElement);
        }
    }
    console.log('renderBoard finished.');
}

/**
 * Updates the leaderboard display with player information.
 * Includes player status and score information.
 * 
 * @param {Object} players - Object containing player data
 */
export function updateLeaderboard(players) {
    const scoresElement = document.getElementById('leaderboard');
    // Find the UL element within the leaderboard div
    const listElement = scoresElement ? scoresElement.querySelector('ul') : null;
    if (!listElement) {
        console.error('Could not find UL element within #leaderboard');
        return;
    }
    
    listElement.innerHTML = ''; // Clear previous scores from the UL
    
    // Sort players by score and create list items
    Object.values(players)
        .sort((a, b) => b.score - a.score)
        .forEach(player => {
            const item = document.createElement('li');
            item.dataset.playerId = player.id;
            
            // Add status class
            if (player.status) {
                item.classList.add(`player-${player.status}`);
            }
            
            // Create player name/score text
            const nameSpan = document.createElement('span');
            nameSpan.classList.add('player-name');
            nameSpan.textContent = player.username || player.id.substring(0, 6); // Use username or shortened ID
            
            const scoreSpan = document.createElement('span');
            scoreSpan.classList.add('player-score');
            scoreSpan.textContent = player.score || '0'; // Ensure score is displayed or default to '0'
            
            // Create status indicator
            const statusSpan = document.createElement('span');
            statusSpan.classList.add('status-indicator');
            
            if (player.status === PLAYER_STATUS.LOCKED_OUT && player.lockedUntil) {
                const remainingSeconds = Math.ceil((player.lockedUntil - Date.now()) / 1000);
                if (remainingSeconds > 0) {
                    statusSpan.textContent = `🔒 ${remainingSeconds}s`;
                }
            } else {
                statusSpan.textContent = '🟢';
            }
            
            // Assemble the list item with better spacing
            item.appendChild(nameSpan);
            
            // Add colon and space for visual separation
            const separator = document.createTextNode(': ');
            item.appendChild(separator);
            
            item.appendChild(scoreSpan);
            item.appendChild(statusSpan);
            
            listElement.appendChild(item);
        });
}

/**
 * Updates a single player's status in the leaderboard.
 * 
 * @param {string} playerId - The ID of the player to update 
 * @param {string} status - The new status of the player
 * @param {number} lockedUntil - Optional timestamp when lockout ends
 */
export function updatePlayerStatus(playerId, status, lockedUntil) {
    const listItem = document.querySelector(`#leaderboard ul li[data-player-id="${playerId}"]`);
    if (!listItem) return;
    
    // Update status class
    listItem.classList.remove('player-active', 'player-locked-out');
    listItem.classList.add(`player-${status}`);
    
    // Update status indicator
    const statusSpan = listItem.querySelector('.status-indicator');
    if (statusSpan) {
        if (status === PLAYER_STATUS.LOCKED_OUT && lockedUntil) {
            const remainingSeconds = Math.ceil((lockedUntil - Date.now()) / 1000);
            if (remainingSeconds > 0) {
                statusSpan.textContent = `🔒 ${remainingSeconds}s`;
                
                // Start countdown timer
                const countdownInterval = setInterval(() => {
                    const newRemaining = Math.ceil((lockedUntil - Date.now()) / 1000);
                    if (newRemaining <= 0) {
                        statusSpan.textContent = '🟢';
                        clearInterval(countdownInterval);
                    } else {
                        statusSpan.textContent = `🔒 ${newRemaining}s`;
                    }
                }, 1000);
            }
        } else {
            statusSpan.textContent = '🟢';
        }
    }
}

/**
 * Updates a player's score with animation.
 * 
 * @param {string} playerId - The ID of the player
 * @param {number} newScore - The new score
 * @param {number} scoreDelta - The score change
 * @param {string} reason - The reason for the score change
 */
export function updatePlayerScore(playerId, newScore, scoreDelta, reason) {
    const listItem = document.querySelector(`#leaderboard ul li[data-player-id="${playerId}"]`);
    if (!listItem) return;
    
    // Update the score text
    const scoreSpan = listItem.querySelector('.player-score');
    if (scoreSpan) {
        scoreSpan.textContent = newScore;
        
        // Add animation class based on score change
        if (scoreDelta > 0) {
            scoreSpan.classList.add('score-increase');
            setTimeout(() => {
                scoreSpan.classList.remove('score-increase');
            }, 1500);
        } else if (scoreDelta < 0) {
            scoreSpan.classList.add('score-decrease');
            setTimeout(() => {
                scoreSpan.classList.remove('score-decrease');
            }, 1500);
        }
    }
    
    // Show a floating score change
    showScoreAnimation(listItem, scoreDelta, reason);
}

/**
 * Creates an animated score change notification.
 * 
 * @param {HTMLElement} targetElement - The element to anchor the animation to
 * @param {number} scoreChange - The score change value
 * @param {string} reason - The reason for the score change
 */
function showScoreAnimation(targetElement, scoreChange, reason) {
    const animation = document.createElement('div');
    animation.classList.add('score-animation');
    
    if (scoreChange > 0) {
        animation.classList.add('positive');
        animation.textContent = `+${scoreChange}`;
    } else {
        animation.classList.add('negative');
        animation.textContent = scoreChange;
    }
    
    // Add tooltip with reason
    animation.title = reason;
    
    // Append the animation to the target element rather than positioning it absolutely
    targetElement.appendChild(animation);
    
    // Animate and remove
    setTimeout(() => {
        animation.classList.add('fade-out');
        setTimeout(() => {
            if (animation.parentNode) {
                animation.parentNode.removeChild(animation);
            }
        }, 500);
    }, 1000);
}

/**
 * Highlights a mine that has been safely revealed (flagged correctly).
 * 
 * @param {number} row - The row of the mine
 * @param {number} col - The column of the mine
 * @param {Array} revealedBy - List of players who revealed the mine
 */
export function highlightRevealedMine(row, col, revealedBy) {
    const cell = document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
    if (!cell) return;
    
    // Add a special class for revealed mines
    cell.classList.add('mine-solved');
    
    // Create tooltip with player info
    let tooltipText = 'Revealed by:\n';
    revealedBy.forEach(player => {
        tooltipText += `${player.position}. ${player.playerId.substring(0, 6)} (+${player.points}pts)\n`;
    });
    
    cell.title = tooltipText;
    
    // Apply animation
    cell.classList.add('mine-reveal-animation');
    setTimeout(() => {
        cell.classList.remove('mine-reveal-animation');
    }, 2000);
}

/**
 * Highlights a pending mine that has been flagged but not yet revealed.
 * 
 * @param {number} row - The row of the mine
 * @param {number} col - The column of the mine
 */
export function markPendingMine(row, col) {
    const cell = document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
    if (!cell) return;
    
    // Add a special class for pending mines
    cell.classList.add('mine-pending');
    
    // Add a pulsing animation
    cell.classList.add('pulse-animation');
}

/**
 * Removes pending status from a mine (either revealed or unflagged).
 * 
 * @param {number} row - The row of the mine
 * @param {number} col - The column of the mine
 */
export function clearPendingMine(row, col) {
    const cell = document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
    if (!cell) return;
    
    // Remove pending classes
    cell.classList.remove('mine-pending', 'pulse-animation');
}

/**
 * Updates the chat display with a new message.
 * 
 * @param {string} message - The message to display
 */
export function addChatMessage(message) {
    const messagesElement = document.getElementById('messages');
    if (!messagesElement) {
        console.error('Could not find messages element');
        return;
    }
    
    const item = document.createElement('li');
    item.textContent = message;
    messagesElement.appendChild(item);
    messagesElement.scrollTop = messagesElement.scrollHeight; // Scroll to bottom
}

/**
 * Displays a message to the user.
 * 
 * @param {string} message - The message to display
 * @param {string} type - The type of message ('alert', 'info', etc.)
 */
export function showMessage(message, type = 'alert') {
    if (type === 'alert') {
        alert(message);
    } else {
        console.log(`Message (${type}): ${message}`);
        // Could implement other message display types (toast, banner, etc.)
    }
}

/**
 * Disables interaction with the game board.
 * Useful when a game ends.
 */
export function disableBoard() {
    const boardElement = document.getElementById('board');
    boardElement.classList.add('disabled');
    // Could also add a visual overlay or other indication
}