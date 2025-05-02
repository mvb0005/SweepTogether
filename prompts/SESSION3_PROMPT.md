Adopt the Backend Developer persona from `/mnt/c/Users/mvb/code/Mines/agent_personas/backend_developer.md`.

**Context:** Review `/mnt/c/Users/mvb/code/Mines/AGENT_CONTEXT.md`, focusing on sections 3 (Architecture), 4 (Key Files), and 7 (Testing Guidelines). In Session 1, we refactored the `PlayerActionService` to handle the `REVEAL_TILE` action with the new infinite world logic, and in Session 2, we added comprehensive tests for that functionality. Now we need to implement similar logic for the `FLAG_TILE` action.

**Task:**
1. Read the current implementation of `handleFlagTile` in `backend/src/application/playerActionService.ts` (currently a TODO stub).
2. Read the relevant functions in `backend/src/domain/gridLogic.ts` (`toggleFlag`) and `backend/src/application/gameStateService.ts` (`getCell`, `updateGridCell`).
3. Implement the `handleFlagTile` function in `playerActionService.ts`:
   a. Retrieve the `GameState` using `gameStateService`.
   b. Validate the game state and player status (similar to `handleRevealTile`).
   c. Call `toggleFlag` from `gridLogic.ts`, passing the `gameState`, coordinates, and `gameStateService.getCell`.
   d. Handle the result:
     - If `null`, do nothing (already revealed cell or invalid coordinates).
     - If a valid cell is returned, update the game state using `gameStateService.updateGridCell`.
     - Update player score based on the scoringConfig (add points for flagging).
     - Publish relevant events through `gameUpdateService` (`SCORE_UPDATE`, `TILE_UPDATE`).

**Verification:**
1. After implementing `handleFlagTile`, run unit tests to check for any compilation errors.
2. Create a new test file at `backend/src/tests/unit/playerActionService.flagTile.test.ts` to test the new functionality:
   a. Use the test structure from `playerActionService.test.ts` as a template.
   b. Include tests for successfully flagging/unflagging a cell, attempting to flag a revealed cell, and edge cases.
   c. Run the tests with coverage to ensure good test coverage of the new functionality.

**Context Update:** Add a summary of the implementation to `SESSIONS.md` when complete, noting any design decisions or patterns that differ from the `handleRevealTile` implementation.