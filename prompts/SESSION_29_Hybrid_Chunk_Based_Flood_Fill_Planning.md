# Session 28: Hybrid Chunk-Based Flood Fill Planning

## Original Prompt

> Ok, I've decided on a hybrid approach. I want us to consider a chunk based approach. We start by flood filling everything in a chunk, and updating the neighboring chunks with the tiles that we can continue to flood fill later. Each user should be "subscribed" to a set of chunks. We need to flood fill into at least every chunk users are viewing. When a user pans their viewport, they essentially subscribe (and unsubscribe from now hidden chunks) to the chunks that they now see. If the chunk they scroll to has pending flood fills, we execute those before serving the chunk.
>
> Does this approach make sense? It will be our next session. This is a very complex feature with a ton of moving parts and room for error. I want you to suggest ideas you have that can make this easier. This will be our next session.

## Session Notes

This session focused on discussing the user's proposed hybrid chunk-based flood fill approach and outlining a plan for its implementation. The approach is sound and offers a good balance for managing large game boards.

### Initial Simplification Ideas Discussed:

1.  **Clear Data Structures & State Management:**
    *   **Chunk Definition:** `Chunk` class (grid, coordinates, pending fills, state).
    *   **Board/World Manager:** Central entity for chunk management.
    *   **Pending Fill Queue per Chunk:** Localized pending fill lists.

2.  **Well-Defined APIs & Interactions:**
    *   `Board.getChunk(chunkX, chunkY)`
    *   `Chunk.addPendingFill(localX, localY)`
    *   `Chunk.processPendingFills()`
    *   `Board.propagateFill(fromChunk, toChunkCoordinates, entryPointInToChunk)`

3.  **Phased Implementation Strategy:**
    *   Intra-chunk fill -> Inter-chunk propagation -> Viewport subscription & lazy processing.

4.  **Simplify "Subscription" Model Initially:** Implicit activation by viewport.

5.  **Event-Driven Updates for Neighbors:** Add to neighbor's pending list.

6.  **Coordinate Systems:** Clarity between global and local coordinates.

7.  **Idempotency:** Ensure processing pending fills multiple times is safe.

8.  **Focus on Happy Path:** Defer complex edge cases.

9.  **Testing & Debugging Aids:** Visual debug modes, unit/integration tests.

### Refined Plan for Next Implementation Session (Session 29)

**Goal for Session 29:** Implement the initial phase of the hybrid chunk-based flood fill mechanism.

**1. Core Data Structures:**

*   **`Chunk` Class/Interface:**
    *   **Properties:**
        *   `id` (e.g., string representation of coordinates like `"x_y"`).
        *   `coordinates` (e.g., `{ x: number, y: number }`).
        *   `tiles` (2D array representing the grid of tiles within this chunk).
        *   `pendingFills` (List of objects, e.g., `{ localX: number, localY: number, originalMineCountHint: number }`).
        *   `state` (e.g., `UNLOADED`, `LOADED_CLEAN`, `DIRTY_PENDING_FILLS`, `PROCESSING`, `UP_TO_DATE`).
    *   **Methods (Conceptual):**
        *   `constructor(x, y, size, initialTileData)`
        *   `getTile(localX, localY)`, `setTile(localX, localY, tileState)`
        *   `addPendingFill(localX, localY, originalMineCountHint)`
        *   `processPendingFills(boardManager)`
        *   `executeLocalFloodFill(startX, startY, originalMineCountHint, boardManager)`

*   **`BoardManager` (or an existing service like `GameService` augmented):**
    *   **Properties:**
        *   `chunks` (Map or dictionary: `chunkId -> Chunk` instance).
        *   `chunkSize` (dimensions of a chunk).
    *   **Methods (Conceptual):**
        *   `getChunk(globalX, globalY)`
        *   `ensureChunkLoaded(chunkX, chunkY)`
        *   `propagateFillToNeighbor(fromChunk: Chunk, neighborChunkX: number, neighborChunkY: number, entryLocalX: number, entryLocalY: number, originalMineCountHint: number)`
        *   `convertGlobalToChunkLocalCoords(globalX, globalY)`
        *   `convertChunkLocalToGlobalCoords(chunkX, chunkY, localX, localY)`

**2. Phased Implementation Steps for Session 29:**

*   **Phase 1: `Chunk` Class Basics & Intra-Chunk Flood Fill Logic**
    *   Define `Chunk` class with properties.
    *   Implement `executeLocalFloodFill`: performs flood fill within chunk boundaries; calls `boardManager.propagateFillToNeighbor` on boundary crossing.
    *   Implement `addPendingFill` and basic `processPendingFills`.
    *   Unit tests for `Chunk` logic.

*   **Phase 2: `BoardManager` Stub & Chunk Management**
    *   Define `BoardManager` with `chunks` map and `chunkSize`.
    *   Implement `getChunk(globalX, globalY)`: calculates chunk coords, creates/retrieves chunk.
    *   Implement `propagateFillToNeighbor`: gets/creates neighbor chunk, calls `addPendingFill` on it.
    *   Unit tests for `BoardManager` logic.

*   **Phase 3: Connecting User Actions (Reveal Tile) to the New System**
    *   Modify `PlayerActionService.handleRevealTile`:
        1.  Get target chunk via `boardManager.getChunk()`.
        2.  Convert global to local coordinates.
        3.  Call `targetChunk.addPendingFill()`.
        4.  Immediately call `targetChunk.processPendingFills()`.

*   **Phase 4: Viewport-Triggered Processing (Conceptual/Deferred)**
    *   Focus on correct propagation queuing first. Manual trigger for processing pending fills in neighbors for initial testing.

**Simplifications for Session 29:**
*   No chunk unloading.
*   Single user focus.
*   Synchronous processing.
*   Basic chunk initialization (e.g., all hidden).
*   In-memory state (no persistence).

**Testing Strategy for Session 29:**
*   Unit Tests: `Chunk.executeLocalFloodFill`, `BoardManager.propagateFillToNeighbor`.
*   Integration Tests (Backend):
    1.  Reveal in middle of chunk.
    2.  Reveal near boundary: verify current chunk fill and pending fill added to neighbor.
    3.  (Optional) Manually trigger neighbor's `processPendingFills` and verify continuation.

This plan sets the stage for the implementation work in the next session.
