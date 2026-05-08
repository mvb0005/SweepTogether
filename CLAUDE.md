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

**Frontend** uses a chunk-based model: the board is divided into 16×16 chunks. The client subscribes only to visible chunks via Socket.IO.

## Key Files

| Path | Purpose |
|------|---------|
| `backend/src/infrastructure/network/server.ts` | Entry point |
| `backend/src/infrastructure/network/socketHandlers.ts` | Socket event routing |
| `backend/src/application/` | Service layer (game, player actions, score, leaderboard) |
| `backend/src/domain/` | Core logic (gridLogic, worldGenerator, BoardManager, Chunk) |
| `frontend/src/App.tsx` | Routes + socket join logic |
| `frontend/src/components/Viewport.tsx` | Render-prop wrapper for viewport state **(stub — pan handlers are no-ops)** |
| `frontend/src/hooks/useViewport.tsx` | Full pan/keyboard navigation logic **(not yet wired to Viewport.tsx)** |
| `frontend/src/components/ChunkLoader.tsx` | Chunk subscribe/unsubscribe + data fetching |
| `frontend/src/components/ChunkedBoard.tsx` | Renders visible chunks |

## Known Incomplete Work

- **`subscribeToChunk` not handled by the running server.** `socketServer.ts` has the full handler but is never imported by `server.ts` (which uses the event-bus-based `socketHandlers.ts`). The frontend emits `subscribeToChunk` on pan but the backend silently ignores it — no chunk data is returned and the board never renders. Next session: wire `subscribeToChunk` into the event bus and service layer.

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
