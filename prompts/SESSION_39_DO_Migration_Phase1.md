# Session 39: Cloudflare Workers DO Migration — Phase 1

## Original Prompt

> Ok, do you think we are ready for this major refactor? Are we able to run multiple agents at once to implement all this? … No need to worry about cutover, this is still very much a dev where none of the data matters … ok get started and godspeed.

## Session Notes

Full backend replacement: Node.js + MongoDB + Socket.IO → Cloudflare Workers + Durable Objects + SQLite.
The architecture is documented in `DO_ARCHITECTURE.md`.

### What was built

**`worker/`** — new Cloudflare Worker project replacing the entire Node.js backend.

| File | Purpose |
|------|---------|
| `worker/wrangler.toml` | Worker config, DO bindings, v1 migration (SessionDO KV, ChunkDO SQLite) |
| `worker/src/types.ts` | `CHUNK_SIZE=32`, message protocol types, `Env` interface |
| `worker/src/world-generator.ts` | `WorldGenerator` ported from backend; uses inline mulberry32 PRNG (replaces `seedrandom`) + `simplex-noise`. Mine layout same algorithm, **different deterministic output** than the old backend (new PRNG) — acceptable since data doesn't matter. |
| `worker/src/chunk-do.ts` | `ChunkDO extends DurableObject` — SQLite schema (`mine_layout`, `reveals`, `flags`, `pending_fills`), write-once mine layout blob, BFS flood fill, bulk multi-value `INSERT OR IGNORE`, lazy pending fills for offline chunks, delta broadcast to Session DOs via RPC |
| `worker/src/session-do.ts` | `SessionDO extends DurableObject` — native WebSocket (`server.accept()`, not hibernation), routes `join/subscribe/unsubscribe/reveal/flag/chord` to Chunk DO RPCs, exposes `onChunkDelta` RPC for Chunk DO to push updates |
| `worker/src/index.ts` | Edge Worker — routes `/ws` upgrades to new Session DOs, CORS headers |

**Durable Object naming convention:**
- Chunk DO: `"${gameId}:${chunkX}:${chunkY}"` (e.g. `"default:0:0"`, `"default:-3:2"`)
- Session DO: `newUniqueId()` per connection

**Frontend** — Socket.IO completely removed, replaced with native WebSocket:

| File | Change |
|------|--------|
| `frontend/src/hooks/useSocket.tsx` | Full rewrite — native WebSocket with auto-reconnect (2s backoff), message queue for pre-connect sends, `on`/`off`/`send` API compatible with existing consumers |
| `frontend/src/App.tsx` | New protocol (`join/reveal/flag/chord` messages), durable `localStorage` player ID, fixed `CHUNK_SIZE=16→32` in ViewportProvider |
| `frontend/src/components/ChunkLoader.tsx` | Handles `chunkState` (full snapshot on subscribe) and `chunkDelta` (live updates); builds and patches the 2D cell grid; rAF-batched state updates retained |
| `frontend/src/components/SingleChunkPage.tsx` | Stubbed to redirect → `/` (legacy debug page, incompatible with new protocol) |
| `frontend/src/vite-env.d.ts` | Added `/// <reference types="vite/client" />` to fix CSS import type error |
| `frontend/.env.development` | `VITE_WORKER_WS_URL=ws://localhost:8787` |

Both `worker/` and `frontend/` pass `tsc --noEmit` clean.

### How to run (dev)

```bash
# Terminal 1 — Worker (local Miniflare simulation — SQLite DOs require local mode)
cd worker && npm run dev          # wrangler dev → localhost:8787

# Terminal 2 — Frontend
cd frontend && npm run dev        # Vite → localhost:3000
```

The frontend connects to `ws://localhost:8787/ws` via `VITE_WORKER_WS_URL`.

> Note: `wrangler dev --remote` does NOT support SQLite Durable Objects. Use local mode for dev, `wrangler deploy` for production.

## Deferred / Incomplete

- **Chord click** not implemented — `handleChord` in `session-do.ts` is a no-op. Needs cross-chunk neighbour flag state queries.
- **Node.js backend** (`backend/`) is not deleted yet — kept until DO backend is confirmed working end-to-end.
- **Pregen tools** (`tools/pregen-text.ts`, `tools/pregen-chunks.ts`) still write to MongoDB; need to be ported to write Chunk DO SQLite (via an admin HTTP endpoint on the Worker).
- **Flood fill correctness at chunk boundaries** needs live testing — the diagonal-neighbour cross-chunk case has subtle modular arithmetic that should be verified empirically.
- **`noUnusedLocals`/`noUnusedParameters`** warnings from legacy frontend files (`Board.tsx`, `BoardSVG.tsx`) — not deleted since they may be referenced by tests.
- **Production env var** `VITE_WORKER_WS_URL` needs to be set to the deployed Worker URL before shipping.
