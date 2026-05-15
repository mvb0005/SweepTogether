# Session 37: Make `getChunk` Async

## Problem

`getChunk` is synchronous. When it's called for a chunk not yet in memory (e.g. during cross-chunk flood fill), it creates a fresh `Chunk` using `worldGenerator` — without checking MongoDB. This means custom chunk configs (`chunkConfig.type === 'custom'`) are silently ignored for any chunk that wasn't subscribed to before flood fill touched it.

The current `subscribeToChunk` path works by accident: it calls `getChunk` (sync, creates with worldGenerator), then immediately calls `applyPersistedChunkState` (async, patches isMine + revealed/flagged). This only works because `chunk` is an object reference and we `await` before reading it. It's a two-step hack.

The correct fix: make `getChunk` async so it fetches from MongoDB on a cache miss, checks `chunkConfig`, and builds the right `Chunk` in one step. Then `applyPersistedChunkState` is deleted.

## Design

### Persistence loader

Rather than coupling `ChunkManager` directly to MongoDB, inject an async callback at construction time:

```typescript
// in chunkTypes.ts
export type ChunkPersistenceLoader = (
  chunkX: number,
  chunkY: number
) => Promise<{
  mines?: Uint8Array;          // defined → custom chunk
  revealedIndices: Set<number>;
  flaggedIndices: Set<number>;
} | null>;                     // null → no persisted doc, use worldGenerator
```

### `ChunkManager.getChunk` becomes async

```typescript
async getChunk(chunkX: number, chunkY: number): Promise<IChunk> {
  const chunkId = this.getChunkId(chunkX, chunkY);
  if (this.chunks.has(chunkId)) return this.chunks.get(chunkId)!;

  let mines: Uint8Array | undefined;
  let revealedIndices = new Set<number>();
  let flaggedIndices  = new Set<number>();

  if (this.persistenceLoader) {
    const data = await this.persistenceLoader(chunkX, chunkY);
    if (data) {
      mines          = data.mines;
      revealedIndices = data.revealedIndices;
      flaggedIndices  = data.flaggedIndices;
    }
  }

  const chunk = new Chunk(
    chunkX, chunkY, this.chunkSize,
    this.worldGenerator,   // always the base generator
    mines,                 // overrides isMine when defined
    this.broadcastChunkUpdate
  );

  for (const idx of revealedIndices) {
    const lx = idx % this.chunkSize, ly = Math.floor(idx / this.chunkSize);
    const cell = chunk.getTile(lx, ly);
    if (cell) chunk.setTile(lx, ly, { ...cell, revealed: true });
  }
  for (const idx of flaggedIndices) {
    const lx = idx % this.chunkSize, ly = Math.floor(idx / this.chunkSize);
    const cell = chunk.getTile(lx, ly);
    if (cell) chunk.setTile(lx, ly, { ...cell, flagged: true });
  }

  this.chunks.set(chunkId, chunk);
  return chunk;
}
```

### `IChunkManager` interface

```typescript
getChunk(chunkX: number, chunkY: number): Promise<IChunk>;
```

### `GameStateService.createGame` wires the loader

```typescript
const persistenceLoader: ChunkPersistenceLoader = async (chunkX, chunkY) => {
  const doc = await getChunkRepository().load(gameId, chunkX, chunkY);
  if (!doc) return null;
  return {
    mines: ChunkRepository.decodeMines(doc),
    ...ChunkRepository.decode(doc),
  };
};
// pass to ChunkManager constructor
```

## Files to Change

| File | Change |
|------|--------|
| `backend/src/types/chunkTypes.ts` | Add `ChunkPersistenceLoader` type; `IChunkManager.getChunk` → `Promise<IChunk>` |
| `backend/src/domain/ChunkManager.ts` | Add optional `persistenceLoader` param; `getChunk` becomes async |
| `backend/src/domain/Chunk.ts` | `await boardManager.getChunk(...)` in `executeLocalFloodFill` |
| `backend/src/application/GameStateService.ts` | Wire persistence loader in `createGame`; `await getChunk` at all call sites; delete `applyPersistedChunkState` and `loadCustomChunkConfigs` |
| `backend/src/application/playerActionService.ts` | `await getChunk` |
| `backend/src/application/gameUpdateService.ts` | `await getChunk` |
| `backend/src/infrastructure/network/socketHandlers.ts` | `await getChunk`; remove `applyPersistedChunkState` calls |
| `backend/src/tests/**` | Update mocks: `getChunk: jest.fn().mockResolvedValue(chunk)` |

## Call Sites (all mechanical — just add `await`)

All callers are already in `async` functions. Approximately 12 call sites across 6 files.

## What Gets Deleted

- `GameStateService.applyPersistedChunkState` — replaced by loader logic inside `getChunk`
- `GameStateService.loadCustomChunkConfigs` — never needed once `getChunk` is lazy
- `socketHandlers.ts` calls to `applyPersistedChunkState`
- `socketServer.ts` — dead code superseded by `socketHandlers.ts` since Session 32

---

## Session Notes (2026-05-14)

### What Was Actually Done

The async `getChunk` design was implemented as specified, plus several related fixes discovered during implementation.

**Core changes:**
- `IChunkManager.getChunk` now returns `Promise<IChunk>`. `ChunkManager.getChunk` checks the in-memory cache first, then calls the injected `persistenceLoader` on a miss. A private `buildChunkFromData` helper is shared between `getChunk` and the new `preloadMany`.
- `socketServer.ts` deleted — it had grown stale with missing `await` calls and was fully superseded by `socketHandlers.ts`.
- All `applyPersistedChunkState` call sites removed from `socketHandlers.ts`.

**Bulk preloading (`preloadMany`):**
- `ChunkRepository.loadMany(gameId, coords)` runs a single `find({ $in: ids })` instead of N individual queries.
- `ChunkManager.preloadMany(docs[])` populates the cache in one pass.
- `GameStateService.bulkPreloadChunks(gameId, coords)` orchestrates both — called by `subscribeToChunks` before the per-chunk loop so every subsequent `getChunk` is a cache hit.

**Flood fill fix (reads chunk tiles, not WorldGenerator):**
- `runGlobalFloodFill` was querying `getCell()` → WorldGenerator, silently ignoring custom mine overrides. Fixed to read directly from `chunkManager.getChunkById().getTile()`.

**Custom chunk buffer encoding (`0xFF = mine, 0–8 = adjacentMines`):**
- `Chunk` constructor with `minesOverride` now reads `val === 0xFF ? mine : val as adjacentMines`.
- `pregen-chunks.ts` maze generator rewritten with a two-pass approach: pass 1 builds 0/1 mine layouts (outer-face cells of edge chunks use `worldGen.isMine()` to preserve the noise seam), pass 2 encodes 0xFF/adjacentMines querying `worldGen` for out-of-maze neighbours.

**Test updates:** All tests updated to `mockResolvedValue` for async `getChunk`, buffer encoding updated `1`→`0xFF`, `preloadMany: jest.fn()` added to all `IChunkManager` mocks.

### Deferred / Incomplete

- Flood fill still blocks the event loop synchronously. Not addressed here.
- `pendingFills` map grows unbounded for unvisited chunks. Not addressed here.
