# SweepTogether — Claude Context

Real-time multiplayer Minesweeper with an infinite, persistent world. Players share a single infinite board and reveal/flag tiles collaboratively.

## Tech Stack

- **Backend:** Node.js, TypeScript, Socket.IO, MongoDB, Jest
- **Frontend:** React, TypeScript, Vite, Socket.IO Client
- **Infra:** Docker Compose, Nginx reverse proxy

## Running Locally (Docker)

```bash
docker-compose up --build   # Main dev environment — access at http://localhost:8080
cd backend && npm test       # Backend unit tests
cd backend && npm test -- --coverage  # With coverage
```

## Architecture

```
nginx (:8080)
  ├── frontend  (Vite React, :3000)
  └── backend   (Socket.IO + Express, :3001 on host / :3000 in container)
        └── MongoDB (:27017)
```

**Backend** is event-driven (`InMemoryEventBus`) with a service layer (`src/application/`) over domain logic (`src/domain/`). The infinite world uses Simplex noise (`WorldGenerator`) for deterministic mine placement and a `SpatialHashGrid` for revealed/flagged state.

**Frontend** uses a chunk-based model: the board is divided into 32×32 chunks. The client subscribes only to visible chunks via Socket.IO.

## Key Files

| Path | Purpose |
|------|---------|
| `backend/src/infrastructure/network/server.ts` | Entry point |
| `backend/src/infrastructure/network/socketHandlers.ts` | Socket event routing |
| `backend/src/application/` | Service layer (game, player actions, score, leaderboard) |
| `backend/src/domain/` | Core logic (gridLogic, worldGenerator, BoardManager, Chunk) |
| `frontend/src/App.tsx` | Routes, join session, tile actions via Socket.IO |
| `frontend/src/hooks/useSocket.tsx` | Socket.IO connection |
| `frontend/src/hooks/useGameSession.tsx` | `joinGame` / `gameJoined` handshake |
| `frontend/src/hooks/useChunkSubscriptions.tsx` | Chunk subscribe/unsubscribe + live updates |
| `frontend/src/renderer/BoardRenderer.ts` | Canvas 2D board renderer (cells, grid, chunk borders) |
| `frontend/src/contexts/ViewportContext.tsx` | Pan/zoom + chunk subscription regions |
| `frontend/src/components/GameView.tsx` | Game shell (HUD + canvas) |

## Known Incomplete Work

- **Flood fill blocks the event loop.** `runGlobalFloodFill` is synchronous BFS — a large open area stalls Socket.IO for all clients. The "SweepTogether" text creates a single large open background region that triggers a very large flood fill on first click. Needs chunked/yielded execution.
- **Flood fill chunk-border edge case.** Isolated revealed cells can appear at chunk boundaries. The global BFS (`runGlobalFloodFill`) fixes most cases, but back-propagation into already-loaded chunks from a newly activated neighbour may still be incomplete in edge cases.

## Pregen Tools

Two pre-generation tools write custom chunk data to MongoDB before the server starts:

```bash
make pregen-text   # Writes "SweepTogether" as 1-cell-wide mine strokes (primary)
make pregen        # Writes a 7×7 maze (kept for reference/testing)
```

After running either tool, restart the backend to clear the in-memory chunk cache:
```bash
docker-compose restart backend
```

**Custom chunk seam rules** (enforced by both tools, validated by `validateSeam` in `pregen-text.ts`):
1. Outer-face cells of custom chunks bordering noise must mirror `worldGen.isMine()`.
2. No authored mine on a noise-facing border cell unless `worldGen` also places one there.
3. `adjacentMines` for custom cells must count mines from noise neighbours via `worldGen`.

**Seed consistency:** The game document (`games` collection, `seed` field) stores the string `gameId` (`"default"`). Both pregen tools write this document before saving chunks. The server reads the same seed on first `joinGame`, so `WorldGenerator("default")` is used everywhere.

## Scalability Concerns (noted 2026-05-08)

- **Flood fill blocks the event loop.** `runGlobalFloodFill` is a synchronous BFS — a large open area can visit thousands of cells in one call, stalling Socket.IO for all connected clients. The "SweepTogether" text creates a single large open background region that will trigger a very large flood fill on first click. Needs chunked/yielded execution or offloading.
- **Duplicate chunk subscriptions.** Logs show every chunk subscribed twice per connection. `ChunkLoader`'s `useEffect` likely double-fires on connect due to dependency on both `visibleChunks` and `socket`/`isConnected`.
- **No debounce on pan.** Every cell-boundary crossing fires `subscribeToChunk`. Rapid panning floods the server with subscription requests.
- **`pendingFills` grows unbounded.** Fills for chunks nobody ever visits accumulate and are never cleaned up.
- **Single "default" game.** No multi-room support yet.

## Session Workflow

Development is organised into numbered sessions. Before starting work, read:
- `SESSIONS.md` — log of all completed sessions
- `SESSION_GUIDELINES.md` — how to start/end a session (including the mandatory **Deferred / Incomplete** section)
- `AGENT_CONTEXT.md` — deeper project context and coding standards
- `TODO.md` — current action items
- `PLANNING.md` — phase roadmap

Session prompts and notes live in `prompts/SESSION_XX_*.md`.

## Coding Standards

- TypeScript strict mode throughout
- Functional React components and hooks only
- `async/await` for async operations
- Unit tests for all new domain/service logic (target 90% statement coverage)
- AAA pattern in tests, `jest.clearAllMocks()` between tests
- No comments unless the *why* is non-obvious
