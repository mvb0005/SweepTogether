# Session 36: Custom Chunk Generation

## Goal

Introduce a `chunkConfig` discriminated union to the chunk schema so specific chunks (or sections of chunks) can have hand-authored mine layouts instead of noise-generated ones. Build a pre-gen tool that handles edge blending correctly.

## Design

### ChunkConfig type

```typescript
type ChunkConfig =
  | { type: 'noise' }                 // default — worldGenerator handles everything
  | { type: 'custom'; mines: Binary } // 256-byte buffer: 1=mine, 0=open
```

Stored on `ChunkDocument`:

```typescript
{
  _id: "gameId_chunkX_chunkY",
  chunkConfig: { type: 'noise' },     // omitted = 'noise'
  revealed: Binary,
  flagged: Binary,
  // ...existing fields
}
```

### Runtime loading (chunkRepository / getChunk)

When building the in-memory `Chunk` object from a document:

```typescript
if (doc.chunkConfig?.type === 'custom') {
  // use mines buffer instead of worldGenerator for isMine
  // adjacentMines still recalculated live at reveal time (executeLocalFloodFill already does this)
} else {
  // current path: call worldGenerator for each cell
}
```

No other runtime changes needed. Flood fill, persistence, and broadcasting are unaware of the difference.

### Pre-gen tool

A standalone script (`tools/pregen-chunks.ts`) that:

1. Accepts a game ID, seed, and a chunk region descriptor (e.g. a 2D array of mine layouts or a JSON config)
2. For **interior chunks** of the custom section: writes `chunkConfig: { type: 'custom', mines: <buffer> }` directly
3. For **edge chunks** of the custom section: builds the mines buffer by:
   - Filling interior cells (local 1..N-2, 1..N-2) from the authored layout
   - Filling border cells (outer ring) by calling `worldGenerator(globalX, globalY).isMine` — so adjacent noise chunks never see a seam
4. Optionally pre-populates `revealed` with a `__world__` playerIndex (0) for cells the author wants pre-revealed
5. Writes all chunk docs to MongoDB via `chunkRepository.saveChunk()`

### Reserved playerIndex for pre-revealed cells

If any cells should be pre-revealed (e.g. a cleared area), the `players` array on the chunk doc includes `"__world__"` at index 0. The client renders these as revealed with no player attribution.

## Files to Change

| File | Change |
|------|--------|
| `backend/src/types/chunkTypes.ts` | Add `ChunkConfig` type |
| `backend/src/infrastructure/persistence/db.ts` | Add `chunkConfig` field to `ChunkDocument` |
| `backend/src/infrastructure/persistence/chunkRepository.ts` | Branch on `chunkConfig.type` when building `Chunk` from doc |
| `backend/src/domain/Chunk.ts` | Accept optional `minesOverride: Uint8Array` in constructor, skip worldGenerator if provided |
| `tools/pregen-chunks.ts` | New: pre-gen script with edge blending |

## Edge Blending Rule

For a custom section of M×N chunks:
- Interior chunks `(1..M-2, 1..N-2)`: fully custom, all 256 cells from authored layout
- Edge chunks (outermost ring): authored layout for interior cells only; outer ring cells use `worldGenerator`

This ensures that noise-generated neighbours of the custom section always compute correct `adjacentMines` for their border cells — the seam is invisible to the runtime.

## Notes

- `adjacentMines` is never stored in the custom buffer — it is always recalculated live at reveal time by `executeLocalFloodFill` (already implemented), so cross-chunk border correctness is handled automatically during gameplay
- The pre-gen tool is the sole enforcer of the edge blending invariant; the schema and runtime are intentionally unaware of it
- Pre-gen tool should validate that no mine is placed on a cell that would be unreachable (completely surrounded by mines) unless that is intentional
