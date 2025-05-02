# Session 10: Debugging E2E Test Failures - Round 2

**NOTE: The original prompt for this session is not available.**

## Session Notes

In this session, we addressed remaining E2E test failures in `fixed_board.cy.js` and `game_updates.cy.js`.

### Backend (`backend/src/server.ts`) Fixes

- Identified that `adjacentMines` might not be calculated correctly when using an `initialBoard` provided by tests
  - This led to incorrect state on game over in `fixed_board.cy.js`
  - Added a `calculateAdjacentMines` helper function
  - Ensured `calculateAdjacentMines` is called in `joinGame` both when generating a random board and when using a provided `initialBoard`

- Identified redundant `gameState` broadcast in `joinGame` causing issues
  - The problem was broadcasting once to joiner and once to room, potentially causing timeouts in `game_updates.cy.js`
  - Simplified `joinGame` broadcasting:
    - Emit full `gameState` only to the joining socket
    - Emit a simpler `playerUpdate` event (just the player list) to the rest of the room

### Frontend (`frontend/script.js`) Fixes

- Diagnosed `TypeError: Cannot set properties of null (setting 'innerHTML')` in the browser console during test runs
- Corrected `getElementById` call to use `'leaderboard'` instead of the old `'scores'` ID
- Modified `updateLeaderboard` function to correctly target the `<ul>` element *within* the `#leaderboard` div
- Added a socket listener for the new `playerUpdate` event to ensure the leaderboard updates when players join/leave

After applying these fixes to backend logic for `initialBoard` handling and broadcasting, and the frontend fixes for leaderboard element selection and event handling, all E2E tests passed successfully.