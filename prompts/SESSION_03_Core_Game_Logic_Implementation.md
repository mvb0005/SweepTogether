# Session 3: Core Game Logic Implementation

**NOTE: The original prompt for this session is not available.**

## Session Notes

In this session, we began implementing the core server-side game logic in TypeScript. The focus was on establishing the fundamental game mechanics.

### Refactoring to TypeScript

- Refactored `backend/server.js` to `backend/src/server.ts`
- Fixed initial syntax errors and compilation issues in `server.ts`
- Converted CommonJS `require` statements to ES Module `import` statements

### Type Definitions

- Added basic TypeScript type definitions for game entities:
  - `Cell`: Represents a single cell on the board
  - `Board`: The full game board structure
  - `RevealedBoard`: The board state exposed to clients
  - `Player`: Individual player information
  - `Players`: Collection of players in the game
- Applied these types to core game state variables (`board`, `revealedBoard`, `players`)

### Game Logic Implementation

- Implemented the `generateBoard` function:
  - Random mine placement
  - Calculation of adjacent mine counts for each cell
- Added basic server-side handling for the `revealTile` socket event:
  - Input validation (checking boundaries, already revealed)
  - Marking the tile as revealed
  - Basic game over logic (detecting if a mine was clicked)
  - Broadcasting updated game state (`gameState`) or game over (`gameOver`) events

### Player Management

- Added basic handling for player connection (`connection`) and disconnection (`disconnect`) events
- Implemented player tracking via the `players` object
- Ensured Express app, HTTP server, and Socket.IO server are correctly initialized and typed