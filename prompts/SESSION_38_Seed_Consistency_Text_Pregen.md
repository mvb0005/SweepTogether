# Session 38: Seed Consistency & "SweepTogether" Text Pregen

## Original Prompt

> Looks right to me! Lets now spell out SweepTogether. I don't care how big it is, remember the board is infinite! No maze please, just simple and mostly empty. The mines should just be 1 wide to make the letters. Does that make sense? They will be much thinner. Ok, I think the approach you should use is generate the text then try to place it in chunks. Remember custom chunks must have their borders with the random chunks follow the established rules. As a matter of fact, can we add some validations for the custom chunk uploading to make sure the edges match as expected.

## Session Notes

### Problem 1 — Seed Mismatch Between Pregen Tool and Server

After the maze was generated and the server restarted, numbers on noise chunks bordering the maze were wrong. Root cause: `GameRepository.createOrLoad` generated a random 32-bit integer seed (`Math.random() * 2**31`) and stored it as a number. The server passed `String(numericSeed)` to `WorldGenerator`. Meanwhile `pregen-chunks.ts` used `WorldGenerator(GAME_ID)` = `WorldGenerator("default")` directly. Two completely different noise functions → outer-face mine values stored in custom chunks didn't match what the server computed for those positions.

**Fix:**
- `GameDocument.seed` changed from `number` to `string`.
- `createOrLoad` now stores `gameId` as the seed (`$setOnInsert: { seed: gameId }`) — deterministic and human-readable.
- `gameStateService.createGame` drops the `String()` conversion; `seedStr` is used directly.
- `pregen-chunks.ts` and `pregen-text.ts` both call `gameRepo.createOrLoad(GAME_ID, ...)` before writing chunks, so the game document is always written with the correct seed before the server first reads it.

After this fix, `WorldGenerator("default")` is used by both the pregen tool and the server for every game whose ID is `"default"`.

### Problem 2 — Maze Removed, Text Added

The user wanted the board to be "simple and mostly empty" — no maze — and to spell out "SweepTogether" using 1-cell-wide mine strokes.

**Approach — stroke font with Bresenham lines:**

A 5×7 pixel font is defined (same letter shapes as the maze's chunk-level font). Each font pixel is scaled by `S = 16` cells, so adjacent font pixels are `S` cells apart. For every pair of 8-connected adjacent ON pixels, a Bresenham line is drawn between their scaled cell positions. This produces 1-cell-wide mine strokes connecting the pixel "joints," giving each letter a clean thin-line appearance.

Per-letter dimensions with S=16:
- Width: `(5−1) × 16 = 64` cells
- Height: `(6) × 16 = 96` cells  
- Letter gap: `2 × S = 32` cells

Total text region: **80 chunks wide × 10 chunks tall** (64 chunks of text + 2-chunk PAD on each side), centred around global (0, 0).

**Seam rules (enforced and validated):**

The three rules established for the maze are applied identically:

1. **Outer face preservation** — `applyOuterFaceSeam` iterates every outer-edge chunk and, for cells on the noise-facing face, adds them to the mine set if `worldGen.isMine()` returns true. This ensures noise chunks outside the region compute correct `adjacentMines` for their border cells.

2. **No custom mines on noise-facing borders** — Letter mine strokes are placed at interior positions; the 2-chunk PAD of open background means no letter mine ever reaches the outer face.

3. **AdjacencyMines includes noise mines** — `isMineAt(gx, gy)` checks the mine set for in-region cells and falls back to `worldGen.isMine()` for out-of-region cells; `buildBuffer` uses `isMineAt` for all 8 neighbours of every open cell.

**Seam validation (`validateSeam`):**

Runs before every `saveCustomChunk` call. For each of the four faces of a chunk that borders a noise chunk (not in `regionChunks`), every face cell's mine status is compared against `worldGen.isMine()`. Any mismatch is logged as a `SEAM ERROR`. All 800 chunks in this session produced `All seams valid.`

**Result:** 3,625 letter mine cells, 800 pregenerated chunks. Clicking the open background around the text reveals it with the mine letter shapes visible as 1-cell-wide mine strokes.

### Files Changed

| File | Change |
|------|--------|
| `backend/src/infrastructure/persistence/gameRepository.ts` | `seed: number → string`; `createOrLoad` stores `gameId` as seed |
| `backend/src/application/gameStateService.ts` | Drop `String()` conversion; use seed string directly |
| `tools/pregen-text.ts` | New tool — Bresenham stroke font, seam rules, seam validation |
| `Makefile` | New `pregen-text` target |
| `tools/pregen-chunks.ts` | Calls `gameRepo.createOrLoad` to write game doc with correct seed |

### Running the Text Pregen

```bash
make pregen-text
```

Drops and recreates all text chunks. Requires `make pregen-text` after any `db.dropDatabase()`. After running, restart the backend to clear the in-memory chunk cache:

```bash
docker-compose restart backend
```

The text is centred around global (0, 0) — visible immediately on load.

### Custom Chunk Seam Rules (Canonical Summary)

These rules apply to **any** pregenerated region. `pregen-text.ts` implements all three; `pregen-chunks.ts` (maze) implements the same logic.

1. The outer-face cells of custom chunks that border noise chunks must mirror `worldGen.isMine()` — so noise chunks compute correct `adjacentMines` for their border cells without knowing about the custom region.
2. No authored mine may be placed on a noise-facing border cell unless `worldGen` also places a mine there. (With PAD ≥ 1 chunk of open background, this is guaranteed by construction.)
3. When computing `adjacentMines` for cells in custom chunks, out-of-region neighbours must be looked up via `worldGen.isMine()`.

`validateSeam` in `pregen-text.ts` enforces rule 1 at save time and can be reused for any future pregen tool.

## Deferred / Incomplete

- The open background in the text region is one large flood-fill region. Clicking anywhere in it will reveal all connected open cells — potentially a very large BFS. The async/chunked flood fill work needed to fix the scalability concern (noted in CLAUDE.md) is not done here.
- The maze from `pregen-chunks.ts` is no longer generated by default (`make pregen` still exists but generates the maze; `make pregen-text` is the primary tool now). Consider whether `make pregen` should be removed or kept for testing.
