# Session 41: Flood Fill Queue, Persistence Sync, and Chunk Memory Fixes

## Original Prompt
Optimize flood fill and chunk load under sustained panning; fix OOM from unbounded in-memory state; ensure reveals persist to Mongo and survive eviction.

## Session Notes
- Replaced per-click synchronous global BFS with `enqueueFill` / `drainFillQueue`: multi-seed bulk BFS, caps (`MAX_FILL_REVEALS_PER_RUN=50k`), yield every 2k steps, continuation re-queue.
- `persistBulkFillResults` syncs full in-memory chunk buffers via `ChunkRepository.syncChunkState` for all touched chunks; uses `__world__` player id when no socket player.
- Memory leak fixes: removed unbounded `deferredChunks` / `noiseMinesCache` retention on eviction; `releaseUnsubscribedChunks` drops materialized chunks after Mongo sync; `prunePendingFills` caps orphan pending fills.
- Chunk load path: `persistedChunkIds` skips Mongo for known noise chunks; `loadChunkFromDb` coalesces concurrent loads; Mongo `load()` uses projection; buffer passthrough in `buildChunkFromData`.
- Extracted `chunkWire.ts` with `serializeChunkWireFromBuffers` and wire cache invalidation.
- `socketHandlers`: coalesced `subscribeToChunks`, fill seed collection, async eviction after subscribe.
- Added `backend/scripts/chunk-load-perf.ts` (burst/sustained/fill/marathon modes) and `mongo-audit.mjs`; npm `perf:chunks:*` and `audit:mongo` scripts; Makefile `perf-chunks*` targets.
- Backend telemetry ingest (`telemetryService`, `telemetryEvents` socket handler) added for downstream A/B metrics.

## Deferred / Incomplete
- Native Rust `flood_fill` not implemented — JS BFS still runs on main thread (yield helps but does not eliminate blocking).
- End-to-end buffer-native chunks not started — still materialize `Cell[][]` after load.
- Some pre-existing unit test failures in `gameStateService.test.ts` (mock coordinate helpers) not addressed.
