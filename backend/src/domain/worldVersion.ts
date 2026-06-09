/**
 * World generation schema version.
 *
 * Increment this integer whenever you make a change that alters mine placement.
 * On server startup, if the value stored in MongoDB for a game differs from this
 * constant, GameStateService.createGame() will drop all persisted chunk data and
 * pending fills for that game and log a warning — players start fresh on the new
 * world automatically.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ MUST increment                                                          │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │ • cell_roll() or seed_u32() in native/src/chunk_gen.rs                  │
 * │ • MINE_DENSITY in native/src/chunk_gen.rs                               │
 * │ • WorldGenerator.isMine() or generateChunkLayout() in                  │
 * │   src/domain/worldGenerator.ts (the JS fallback path)                  │
 * │ • CHUNK_SIZE in src/types/chunkTypes.ts                                 │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │ Do NOT increment (output-preserving changes)                            │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │ • Performance refactors with identical output (e.g. bordered-grid opt) │
 * │ • Flood-fill algorithm, player movement, scoring, frontend changes     │
 * │ • New chunk metadata fields (revealed, flagged buffers are compatible) │
 * │ • Pregen tool changes (custom chunks carry their own mine data)        │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Version history:
 *   1 — original JS WorldGenerator (simplex noise, MINE_DENSITY 0.16)
 *   2 — Rust cell_roll axis-correlation fix: packed (x,y) together before
 *       XOR-fold so cell_roll(s,x,y) ≠ cell_roll(s,y,x) structurally
 */
export const WORLD_GEN_VERSION = 2;
