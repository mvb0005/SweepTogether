# Session 32: Wire joinGame and subscribeToChunk into the Running Server

## Original Prompt

**Objective:** The board never renders because `joinGame` and `subscribeToChunk` are not handled by the running server. Wire both into `socketHandlers.ts` so the frontend can join a game and receive chunk data.

**Persona:** Backend Developer (`agent_personas/backend_developer.md`)

**Context Files to Read First:**
- `CLAUDE.md` — project overview and known incomplete work
- `agent_personas/backend_developer.md`
- `backend/src/infrastructure/network/server.ts` — entry point, calls `registerSocketHandlers`
- `backend/src/infrastructure/network/socketHandlers.ts` — currently handles only event-bus events
- `backend/src/infrastructure/network/socketServer.ts` — has full `joinGame` and `subscribeToChunk` implementations (not used)
- `backend/src/infrastructure/network/socketEvents.ts` — `SocketEventMap` type
- `backend/src/application/services.ts` — service bootstrap
- `backend/src/application/gameStateService.ts` — `gameExists`, `createGame`, `addPlayer`, `getChunkManager`

---

## Background

The server entry point (`server.ts`) calls `registerSocketHandlers(io, socket, services.eventBus)`. That function dynamically registers handlers only for events that have event bus subscribers — currently `revealTile`, `flagTile`, `chordClick`, `getLeaderboard`, `scoreUpdate`, `gameOver`, `playerDisconnected`.

`joinGame` and `subscribeToChunk` are not in the event bus. Their implementations live in `socketServer.ts`, which is a separate file never imported by `server.ts`. As a result:

- `joinGame` — frontend emits this on connect, backend ignores it, `gameJoined` is never sent back, `isJoined` stays `false`, the board never mounts.
- `subscribeToChunk` — frontend emits this when the viewport changes, backend ignores it, `chunkData` is never sent back, the board never renders.

Both handlers need direct socket access (`socket.join(room)`, `socket.emit(...)`) so they cannot be routed purely through the event bus. The right fix is to handle them directly in `registerSocketHandlers`, which already has `io` and `socket` in scope.

---

## Instructions

### 1. Update `registerSocketHandlers` signature

In `socketHandlers.ts`, add `gameStateService` as a parameter (import `GameStateService` from the application layer):

```typescript
export function registerSocketHandlers(
  io: Server,
  socket: Socket,
  eventBus: EventBus<SocketEventMap>,
  gameStateService: GameStateService
)
```

### 2. Wire `joinGame` directly in `socketHandlers.ts`

Copy the `joinGame` handler from `socketServer.ts` into `registerSocketHandlers`. It should:
- Check if the game exists via `gameStateService.gameExists(gameId)`; if not, create it with a default infinite config via `gameStateService.createGame(...)`
- Add the player via `gameStateService.addPlayer(gameId, playerId, username)`
- Have the socket join the game room: `socket.join(gameId)`
- Store `gameId` on the socket for later use: `socket.data.gameId = gameId`
- Emit `gameJoined` back to the socket with `{ gameId, playerId, players }`
- Broadcast `playerJoined` to the rest of the room

### 3. Wire `subscribeToChunk` directly in `socketHandlers.ts`

Copy the `subscribeToChunk` handler from `socketServer.ts` into `registerSocketHandlers`. It should:
- Validate the game exists
- Get the chunk manager: `gameStateService.getChunkManager(gameId)`
- Get or create the chunk at `(chunkX, chunkY)`
- Join the chunk room: `socket.join(\`${gameId}_chunk_${chunkX}_${chunkY}\`)`
- Process any pending fills for all chunks (the do/while loop already in `socketServer.ts`)
- Emit `chunkData` back to the socket with `{ gameId, chunkX, chunkY, tiles: filteredTiles }`

### 4. Wire `unsubscribeFromChunk` directly in `socketHandlers.ts`

Add a simple handler:
- Leave the chunk room: `socket.leave(\`${gameId}_chunk_${chunkX}_${chunkY}\`)`

### 5. Update `server.ts`

Pass `gameStateService` to `registerSocketHandlers`:

```typescript
const services = initAppServices(io);
io.on('connection', (socket) => {
  registerSocketHandlers(io, socket, services.eventBus, services.gameStateService);
});
```

Check `services.ts` to confirm the exported shape includes `gameStateService` and add it if needed.

### 6. Add event types to `SocketEventMap` (if missing)

In `socketEvents.ts`, add `subscribeToChunk` and `unsubscribeFromChunk` to `SocketEventMap` if they're not already there, so TypeScript is happy.

### 7. Verify

1. Run `docker-compose up --build -d` from the project root.
2. Watch logs: `docker-compose logs -f backend`.
3. Open `http://localhost:8080` — the "Joining game..." message should resolve and the board should appear.
4. Confirm chunks load (no "Loading chunks..." stuck state).
5. Pan the board (click-drag or WASD) — new chunks should load as you move.
6. Left-click a cell to reveal it, right-click to flag.
7. Check the backend logs for `[subscribeToChunk]` lines confirming subscriptions are received.

### 8. End of Session

- Update `SESSIONS.md` with a Session 32 entry.
- Fill in "Session Notes" and "Deferred / Incomplete" sections below.
- Commit: `Session 32: Wire joinGame and subscribeToChunk into socketHandlers`

---

## Session Notes

### What changed

**Socket wiring (subagent work):**
- **`socketEvents.ts`**: Added `subscribeToChunk` and `unsubscribeFromChunk` to `SocketEventMap`.
- **`socketHandlers.ts`**: Added `gameStateService: GameStateService` as a fourth parameter. Wired `joinGame`, `subscribeToChunk`, and `unsubscribeFromChunk` as direct handlers (before the event-bus loop). `joinGame` now uses `socket.id` as the `playerId` key so it matches the `socketId` used by `validateAction` in `PlayerActionService`.
- **`src/server.ts`** (real docker-compose entry point): Replaced `setupSocketServer(io)` with `io.on('connection', ...) → registerSocketHandlers(...)`, making `socketHandlers.ts` the single authoritative handler.
- **`src/infrastructure/network/server.ts`**: Updated to pass `services.gameStateService` to `registerSocketHandlers`.

**GameUpdateService (post-subagent fix):**
- **`gameUpdateService.ts`**: Implemented all stub methods. Injected `io: Server` and `gameStateService` into the constructor. `sendTilesUpdate` groups affected cells by chunk, fetches full chunk tiles from `ChunkManager`, and emits `chunkData` to each chunk room. `sendTileUpdate` delegates to `sendTilesUpdate`. `sendError` emits to the individual socket. `sendPlayerStatusUpdate` and `sendScoreUpdate` emit to the game room.
- **`services.ts`**: Updated `GameUpdateService` constructor call to pass `io` and `gameStateService`.

**Player key fix:**
- `joinGame` was storing players under `username` but `validateAction` looked them up by `socket.id`. Fixed by using `socket.id` as `playerId` in `joinGame`.

**Cross-chunk flood fill propagation:**
- **`gameStateService.ts` (`runGlobalFloodFill`)**: When the BFS flood fill reaches a cell in an unloaded chunk, it now stores the entry point (local coordinates) in `chunkManager.pendingFills` so the fill can resume when that chunk is later subscribed.
- **`ChunkManager.ts` (`processPendingFillsForChunk`)**: Now captures the return value of `executeLocalFloodFill` and calls `addPendingFillsToChunks` with the result, so fills cascade correctly into further adjacent chunks.
- **`socketHandlers.ts` (`subscribeToChunk`)**: Replaced the eager do/while-all-chunks loop with a targeted call that processes pending fills for the subscribed chunk only. Fills into further unloaded chunks remain pending until those chunks are subscribed.

### Discoveries

- The docker-compose entry point was `src/server.ts`, not `src/infrastructure/network/server.ts` — the session prompt had the wrong file. The subagent found and fixed this.
- `runGlobalFloodFill` had its own BFS implementation completely separate from `ChunkManager.revealAndPropagate`. It was correctly stopping at unloaded chunk boundaries but never writing those entry points to `chunkManager.pendingFills` — so `subscribeToChunk` always found an empty pending fills map.
- An eager do/while loop processing all pending fills on every `subscribeToChunk` caused an infinite cascade. The fix is to process only the subscribed chunk's pending fills; further propagation waits for the next subscription.

### Verification

- Board renders on `http://localhost:8080`. ✓
- Clicking a cell reveals it and triggers flood fill across loaded chunks. ✓
- Scrolling/panning loads new chunks and continues flood fill propagation from stored entry points. ✓
- Right-click flags a cell; double-click chords. ✓

## Deferred / Incomplete

- `socketServer.ts` still exists and is no longer used. Delete in a future cleanup session.
- Player validation (`validatePlayer`) is not replicated in `socketHandlers.ts`; `revealTile`/`flagTile`/`chordClick` go through the event bus without player validation. Pre-existing behaviour.
- No persistent state across server restarts — game state is in-memory only. MongoDB persistence is wired up structurally but not fully integrated.
