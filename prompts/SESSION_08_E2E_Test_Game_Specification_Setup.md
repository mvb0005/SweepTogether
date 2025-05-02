# Session 8: E2E Test Game Specification & Setup Framework

**NOTE: The original prompt for this session is not available.**

## Session Notes

In this session, we enhanced E2E tests to allow specifying the target game instance via `gameId` and provided a framework for setting up specific game configurations or states before tests run.

### Backend (`backend/src/server.ts`) Changes

- Added a new HTTP `POST /configure/:gameId` endpoint
- This endpoint accepts `gameId` in the URL path and a JSON body like `{ "config": { "rows": R, "cols": C, "mines": M }, "initialBoard": [...] }`
- The received configuration (including the optional `initialBoard`) is stored temporarily in a `pendingGameConfigs` map, keyed by `gameId`
- Modified the `joinGame` socket handler:
  - When creating a new game state (if `games.get(gameId)` is null), it checks `pendingGameConfigs` for the `gameId`
  - If a pending config exists, it's used to create the game (using `initialBoard` if provided, otherwise generating a board with the specified dimensions/mines)
  - The pending config is then removed from the map
  - If no pending config exists, the default generation logic is used

### E2E Support (`cypress/support/commands.js`)

- Created a new custom command: `cy.setupGame(gameId, config)`
- The command accepts a `gameId` and a `config` object (which can include `rows`, `cols`, `mines`, and optionally `initialBoard`)
- It sends a `POST` request to the `/configure/:gameId` backend endpoint with the structured payload
- After the request successfully completes (status 200), it visits the game page using `cy.visit(`/game/${gameId}`)`

### E2E Tests (`cypress/e2e/*.cy.js`)

- Updated `game_config.cy.js` to use `cy.setupGame` to define board dimensions before visiting
- Created `fixed_board.cy.js` which uses `cy.setupGame` to provide a specific `initialBoard` layout along with dimensions/mines
- Tests now generate unique `gameId`s for each run

This enhanced testing framework enables more controlled and predictable testing scenarios by allowing tests to set up specific game configurations (dimensions, mine count, or even exact board layouts) before interacting with the frontend.