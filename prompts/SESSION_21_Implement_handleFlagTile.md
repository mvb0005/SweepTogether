# Session 21: Implement handleFlagTile in PlayerActionService

## Original Prompt

Adopt the Backend Developer persona from `/mnt/c/Users/mvb/code/Mines/agent_personas/backend_developer.md`.

**Context:** Review `/mnt/c/Users/mvb/code/Mines/AGENT_CONTEXT.md`, focusing on sections 3 (Architecture), 4 (Key Files), and 7 (Testing Guidelines). In Session 19, we refactored the `PlayerActionService` to handle the `REVEAL_TILE` action with the new infinite world logic, and in Session 20, we added comprehensive tests for that functionality. Now we need to implement similar logic for the `FLAG_TILE` action.

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

## Session Notes

In this session, we implemented the `handleFlagTile` functionality in `PlayerActionService` using the new infinite world logic.

### Implementation Steps

1. Added `flagPlacePoints` and `flagRemovePoints` properties to the `ScoringConfig` interface in `types.ts`
2. Implemented the `handleFlagTile` method in `PlayerActionService`:
   - Integrated with `gridLogic.toggleFlag` for the core flag toggling behavior
   - Added proper validation of game state and player status
   - Implemented persistence with `gameStateService.updateGridCell` 
   - Added scoring calculation for flag placement and removal
   - Sent appropriate updates via `gameUpdateService`
3. Created comprehensive test file at `playerActionService.flagTile.test.ts` with 8 test cases:
   - Successfully flagging a cell
   - Successfully unflagging a previously flagged cell
   - Attempting to flag an already revealed cell
   - Player lockout cases (active, locked, expired lockout)
   - Error handling (game not found, player not found, error during toggleFlag)

### Refactoring for Code Reuse

- Extracted common validation logic into a reusable `validateAction` helper method
- This improved maintainability and readability
- Made it easier to implement future action handlers like `handleChordClick`

### Key Design Decisions

- Added new scoring properties to support flag actions
- Used the same pattern as `handleRevealTile` for consistency
- Extracted shared validation logic to reduce code duplication

### Outcome

Players can now flag and unflag cells with proper scoring and state updates. The code is well-structured for future expansion, particularly for implementing the `handleChordClick` functionality in a future session.