# SweepTogether — Build Step Designs

**Companion to:** `GAMEPLAY_DESIGN.md` (§8 Build Order)
**Purpose:** Each step is fleshed out to the point a session prompt could be written from it. Decisions are made; the user can override any of them, but no step assumes "we'll figure that out later."

---

## Defaults I'm assuming (resolving §9 of the design doc)

These can be flipped, but every step below is written against them:

- **Movement:** stepped with a short cooldown (~120ms between moves while held). Camera smooth-eases over 200ms.
- **Open-world death:** lighter — short lockout (3s) + small score penalty. Vault death: heavy — 15s lockout + larger penalty + vault re-locks for 60s.
- **Score:** session-only initially. Persistent score is a later feature requiring accounts.
- **Walls:** indestructible. Period.
- **Biome lattice spacing R:** 96 cells. Six chunks at chunk-size 16. Tunable constant.
- **Mystery:** organic discovery only. No in-UI explanation of biome math. One cryptic in-world hint somewhere (a stele or marker) at most.

---

# Step 1 — Player Avatar + 4-Directional Movement

**Goal:** A token follows you around. Other players' tokens show up in your viewport. Camera follows. No biomes yet, no walls — just movement on the existing infinite Minesweeper grid.

## Backend

### New state on the server

Each player gets `(x, y)` coordinates in their `Player` record (`backend/src/domain/types.ts`). Default to `(0, 0)` on join. Add a `lastMoveAt: number` timestamp for rate limiting.

### New socket events

| Event | Direction | Payload | Notes |
|---|---|---|---|
| `movePlayer` | C → S | `{ dx: -1\|0\|1, dy: -1\|0\|1 }` | Exactly one of dx/dy is nonzero. Reject diagonals. |
| `playerMoved` | S → C | `{ playerId, x, y }` | Broadcast to game room. |
| `playerPositions` | S → C | `Array<{ playerId, username, x, y, color }>` | Sent on `gameJoined`. Initial snapshot. |

### Validation in `socketHandlers.ts`

1. Verify the player exists in the game (this is also the right moment to plug the gap noted in `CLAUDE.md` about missing player validation on actions — same lookup applies here).
2. Reject if `now - lastMoveAt < 100ms` (server-side rate limit; client cooldown is 120ms so a well-behaved client never hits this).
3. Reject if `|dx| + |dy| !== 1` (orthogonal only).
4. Update position, broadcast `playerMoved` to the game room.

No movement cost, no collision, nothing fancy. The player can walk onto any cell including revealed/flagged/mine cells. Walking onto a mine does **not** trigger it — revealing does. Movement and reveal are independent verbs.

### Player colours

Assign deterministically from `socket.id` hash → one of ~12 distinguishable colours. Store on the player record. Send in `playerPositions`.

## Frontend

### New context: `PlayerContext`

Wraps `GameContext` (or extends it — your call, but I'd add a separate context so the avatar concerns don't leak everywhere). Exposes:

```ts
{
  self: { x, y, color, username },
  others: Map<playerId, { x, y, color, username }>,
  move: (dx, dy) => void,    // emits movePlayer
}
```

### Input handling

A `useKeyboardMovement` hook attached at the `ChunkLoader` level (or higher):

- `ArrowUp`/`w` → `move(0, -1)`. Down → `(0, 1)`. Left → `(-1, 0)`. Right → `(1, 0)`.
- Internal `lastMoveLocal` timestamp gates emission at 120ms. Holding a key fires at that cadence.
- Cancel free-pan as primary nav: drag-pan still works (you may want to peek elsewhere), but every move recenters the camera on self.

### Camera follow

The existing `ViewportContext` exposes `viewport.center`. Add an effect: when `self.{x,y}` changes, animate `viewport.center` toward `(self.x * CELL_SIZE, self.y * CELL_SIZE)` over ~200ms. Use `requestAnimationFrame` with an easing function — `easeOutQuad` is fine.

A subtle thing: with smooth camera, the *visible chunks* lag the *target chunks*. Subscribe based on the **target** position, not the animated position, so chunks for where you're going arrive before you actually look at them.

### Avatar rendering in `BoardSVG.tsx`

Two render passes over players:

1. **Self last** so it's on top.
2. Each avatar is a circle, `r = CELL_SIZE * 0.3`, filled with the player's colour, with a 2px stroke (white or dark, contrast with cell). Username label above for `others`, none for `self` (you know who you are).

Avatars don't intercept clicks — `pointer-events: none` on the avatar layer.

### Score popups & ripples can wait

Don't pile features on. Step 1 is just movement.

## Tests

- Unit: server rejects diagonals, rejects rate-limited moves, accepts valid moves and broadcasts.
- Manual: open two browsers, watch each other's avatars move in real time.

## Out of scope for Step 1

- No movement cost. No stamina. No collision with walls (walls don't exist yet).
- No "you're too far from the cursor to click that" — clicks work anywhere visible.
- No teleportation, no home button, no waypoints.

---

# Step 2 — Walls as a Cell Type

**Goal:** Introduce an unrevealable, unflaggable, flood-fill-blocking cell type. No biomes producing walls yet — we hardcode a wall ring somewhere near origin to verify rendering and flood behaviour.

## Backend

### Cell type extension

In `backend/src/domain/types.ts`, the cell representation likely already has flags like `revealed`, `flagged`, `isMine`. Add:

```ts
type CellKind = 'normal' | 'wall';
```

…and route it through whatever the existing `Cell` type is. Keep this minimal — the backend doesn't need to know *which* biome's wall this is, just that it's a wall.

### Wall source of truth

Walls are generated, not stored as user state. Add a `getWall(x, y): boolean` to `WorldGenerator` (or a sibling class — see below). For Step 2 this is a hardcoded predicate: return `true` for cells on a 30×30 square centred at, say, `(200, 0)`. The point is to verify the plumbing.

(I'd actually create a new `BiomeGenerator` class now, even as a stub, because Step 3 fleshes it out. `BiomeGenerator.getCellModifier(x, y)` returns `{ kind: 'wall' } | { kind: 'normal', mineOverride?: boolean }`. This keeps walls and mine-density-overrides on the same path.)

### Flood fill

`runGlobalFloodFill` in `gameStateService.ts` and `executeLocalFloodFill` in `ChunkManager.ts` both walk neighbour cells. Add a wall check at the start of each visit:

```ts
if (biomeGen.getCellModifier(x, y).kind === 'wall') {
  // do not reveal, do not enqueue neighbours
  continue;
}
```

This is the only place flood fill needs to know about walls. Walls aren't revealed; they're just stopped at.

### Player actions on walls

`PlayerActionService.handleRevealTile` and `handleFlagTile` must check for walls first and silently no-op. Don't emit an error — just nothing happens. (Errors would be noisy when players misclick.)

### `chunkData` payload

When the server serialises a chunk for the client, include wall cells with `kind: 'wall'`. They occupy the same tile slot as a normal cell.

## Frontend

### Chunk model

Extend the frontend's tile type to include `kind: 'wall' | 'normal'`.

### Rendering in `BoardSVG`

A wall cell:
- Filled `<rect>` with a slate/charcoal colour (e.g. `#3a3a4a`).
- An inner inset of 1px in a slightly darker shade for a chiselled look.
- No hover effect.
- `pointer-events: none` so clicks pass through to nothing rather than triggering reveal animations.

A subtle but important detail: walls are not the same as unrevealed cells. Unrevealed cells invite interaction; walls forbid it. Make them look architectural, not interactive.

### Movement and walls

Player can stand on walls? **No.** Update Step 1's movement validation: if the target cell is a wall, reject the move. Server-side reject + client-side prediction reject. This is the first taste of biome-imposed rules.

(A small UX nicety: if the player holds a direction into a wall, *don't* keep firing rejected requests at the server. The client should know its own wall map for the visible region and short-circuit.)

## Tests

- Unit: flood fill stops at a wall ring. Reveal/flag on wall is a no-op. Move onto wall is rejected.
- Manual: walk around the hardcoded wall ring at `(200, 0)`. Try to click through it. Try to flood-fill across it.

---

# Step 3 — Biome Lattice + First Biome (The Garden)

**Goal:** Real biome generation. Deterministic, hex-lattice-based, with one biome type implemented end-to-end. Visible biome footprint on the client.

## Backend

### Lattice math

In `BiomeGenerator`, the core function:

```ts
// Given a world cell (x, y), find which biome (if any) it belongs to.
// Returns null if it's in the negative-space main world.
function getBiomeAt(x, y, seed): BiomeInstance | null
```

Implementation:

1. Hex lattice basis vectors at spacing `R = 96`:
   `u = (R, 0)`, `v = (R/2, R * √3/2) ≈ (48, 83.14)`.
2. Convert `(x, y)` to lattice coordinates `(a, b)` (rounded — use the standard pixel-to-hex algorithm).
3. Check the candidate lattice point and its 6 neighbours. For each:
   - `active = hash(seed, a, b, "active") < ACTIVE_THRESHOLD` (default 0.5 — half the lattice points spawn biomes).
   - If active: compute biome type, size, etc. from hashes.
   - Test if `(x, y)` is inside the biome's footprint (shape-dependent, see below).
4. Return the first match, or null.

The 7-cell check (centre + 6 neighbours) is necessary because a biome's footprint can extend past its lattice centre toward neighbours.

### Garden footprint

For Step 3, only one biome type: The Garden. Hex-shaped, radius 12 cells (in hex distance). A point `(x, y)` is in the garden iff hex-distance from biome centre ≤ 12.

### Mine density override

Inside a Garden:
- Base density 10% (vs. ~6% outside).
- Mines arranged in a 6-petal radial pattern: high density along 6 radial spokes from centre, low between. Compute spoke membership from angle.

Implementation: `BiomeGenerator.getCellModifier(x, y)` returns `{ kind: 'normal', mineOverride: true }` for cells the garden wants to be mines, `{ kind: 'normal', mineOverride: false }` for cells it wants to be safe, `{ kind: 'normal' }` (no override) elsewhere.

`WorldGenerator.isMine` consults the biome modifier first:

```ts
const mod = biomeGen.getCellModifier(x, y);
if (mod.mineOverride !== undefined) return mod.mineOverride;
return defaultSimplexMineCheck(x, y);
```

### Caching

Biome lookup is more expensive than simplex (7-point hex check). Cache `getBiomeAt` results by `(x, y)`. Existing FIFO cache pattern in `WorldGenerator` is fine.

A nicer cache: key by **chunk** coordinates, not cell coordinates. Most cells in a chunk share biome answers. `getBiomesIntersectingChunk(cx, cy)` returns the (≤7) biomes overlapping a chunk; per-cell lookup checks against that small list. Big win on 16×16 chunks.

### Chunk payload

The `chunkData` event needs biome info so the client can render boundaries and labels. Add to the payload:

```ts
biomes: Array<{
  id: string,        // hash(seed, a, b)
  type: 'garden',    // for Step 3, always this
  centerX, centerY,  // world coordinates
  size: 12,
}>
```

Only include biomes whose footprint intersects the chunk being sent. Avoids flooding the client with global biome info.

## Frontend

### Biome rendering

Two visual layers under the cells:

1. **Biome fill:** a translucent tinted overlay across all cells belonging to a biome. Garden uses a soft green at 15% opacity. Renders before cells.
2. **Biome border:** a path stroke around the biome footprint. For hex-shaped biomes, this is the outer edge of the hex. Stroke 2px in a darker biome colour.

Both come for free from the biome data in `chunkData` — the client computes the cell-membership predicate the same way the server does (deterministic from seed + biome centre).

### Biome label

When the player's position enters a biome they weren't in last frame, briefly show the biome name centred on screen. CSS-only: position fixed, fade in over 300ms, hold 1.5s, fade out 500ms. Don't queue these — if the player rapidly crosses borders, only the most recent label shows.

### Determinism check

Open two clients, walk both to the same coordinates. Verify they see the same biomes in the same places. This is the moment to catch any seed-handling bug — it gets exponentially harder to find later.

## Tests

- Unit: lattice math (point at `(0,0)` → in biome iff `(0,0)` is active; point far away → null). Test all 6 neighbour cases.
- Unit: two clients with same seed produce identical biome maps over a 1000-cell sample.
- Manual: walk around, find biomes, observe radial mine patterns.

---

# Step 4 — Vault Biome + First Embedded Puzzle

**Goal:** A walled biome containing a hand-authored Minesweeper puzzle. Walk in via the gate (free entry for now), solve, get a reward.

## Backend

### Vault biome type

Footprint: a filled hexagon (radius ~10) wrapped in a 1-cell-thick wall. Wall is a hex ring; one cell on the wall is the gate (its position is `hash(seed, biomeId, "gate") mod 6` → which of 6 hex edges, then mid-edge).

### Puzzle embedding

A vault references a puzzle by id. For Step 4 we ship **one** hardcoded puzzle as JSON:

```ts
{
  id: 'tutorial-vault-1',
  size: { width: 18, height: 18 },   // must fit inside the vault hex
  difficulty: 'easy',
  mines: [[3,4], [7,2], ...]
}
```

The puzzle's `(0,0)` maps to a specific cell inside the vault — the top-left corner of the puzzle's bounding box, anchored at the vault centre minus `(size/2)`. Cells inside the bounding box use the puzzle's mine data. Cells inside the vault but outside the puzzle bounding box are safe non-mine cells (or just walls, depending on vault sizing — easier to size the puzzle to fill the vault).

`BiomeGenerator.getCellModifier` for a vault cell:

```ts
if (cell is on the wall ring) return { kind: 'wall', wallType: 'vault' };
if (cell is the gate) return { kind: 'wall', wallType: 'gate', gate: { ... } };
if (cell is inside the puzzle area) {
  return { kind: 'normal', mineOverride: puzzle.mines.includes([lx, ly]) };
}
```

### Gate as a special wall

In Step 2, walls block movement. The gate is a wall with an override: `canPlayerEnter(playerId, gate): boolean`. For Step 4, this always returns `true` (free entry). Step 6 generalises this.

When a player steps onto a gate cell, server allows it. The gate itself is still rendered as a wall, just visually distinct (a door, a coloured panel — see frontend below).

### Vault completion detection

A vault is complete when every non-mine cell inside the puzzle bounding box is revealed. Track this in game state per vault instance:

```ts
gameState.vaults: Map<biomeId, { revealedCount: number, totalSafeCount: number, completed: boolean }>
```

On every reveal inside a vault, increment and check. On completion: emit `vaultCompleted` event with reward payload, broadcast to room.

### Reward (placeholder)

For Step 4 the reward is just a score bonus: `+200 * difficulty_multiplier`. Easy = 1×, Medium = 2×, etc. Real reward variety comes in Step 6.

### Mine hit inside a vault

Heavier penalty (Step 4 just uses `-50` instead of the open-world `-10`). Vault re-locks: for 60 seconds, the gate's `canPlayerEnter` returns false. The puzzle state resets — re-reveal all cells inside on next entry.

## Frontend

### Vault rendering

- Wall ring: same wall rendering as Step 2 but tinted with vault colour (deep blue).
- Gate cell: rendered as a wall but with a coloured "door" inset — a brighter rectangle inside the wall cell. When closed (vault locked), red. When open, green.
- Vault interior: subtle tint distinguishing it from the open world.

### Gate proximity tooltip

When the player is adjacent to the gate, show a floating tooltip near the gate:
```
The Vault of [hash-derived name]
Difficulty: Easy
Entry: Free
Reward: +200 score
```

Use a hash-derived name (a small word list, joined deterministically) for flavour. "Vault of the Quiet Spiral", etc.

### Vault completion celebration

When `vaultCompleted` fires for a vault visible to the player:
- The gate animates open (red → green).
- A score popup fires at the centre.
- Brief screen flash / particle burst on the vault.
- Vault interior tint changes to a "solved" colour.

Don't make this slow — sub-1-second total.

### Puzzle pipeline isn't real yet

Step 4 hardcodes the single puzzle in source. Step 5 is the actual library pipeline. Keep them separate so Step 4 is end-to-end-testable without depending on an offline generation pipeline.

## Tests

- Unit: vault footprint math (cells correctly identified as wall/gate/interior).
- Unit: completion detection fires exactly once.
- Manual: walk to vault, enter via gate, solve, see celebration, get score. Hit a mine, verify re-lock and reset.

---

# Step 5 — Puzzle Library Pipeline

**Goal:** Replace the hardcoded puzzle with a real library. Hundreds of puzzles across difficulties, served from disk.

## Offline generation

A new directory `tools/puzzle-generator/` (not part of the running backend — a build-time tool).

1. Fork `hellpig/minesweeper-puzzle-generator`. Verify its licence first — fork accordingly, retain attribution.
2. Write a wrapper script that:
   - Generates N puzzles per difficulty × size combination. Suggested matrix:
     | Difficulty | Sizes | Count each |
     |---|---|---|
     | Easy | 9×9, 12×12 | 50 |
     | Medium | 12×12, 16×16 | 50 |
     | Hard | 16×16, 20×20 | 30 |
     | Expert | 20×20, 25×25 | 20 |
     | Brutal | 25×25, 30×30 | 10 |
   - Total ~600 puzzles. Generation runs for hours-to-days at Brutal — that's fine, it's offline. Resumable: write each puzzle to disk as it completes.
3. Normalise output to a single JSON format:
   ```ts
   {
     id: string,       // uuid
     difficulty: 'easy'|'medium'|'hard'|'expert'|'brutal',
     size: { width, height },
     mines: Array<[x, y]>,
     // optional: known solution path for tutorial mode
   }
   ```
4. Bundle as `backend/data/puzzles.json` (or one file per difficulty, lazy-loaded).

## Backend integration

### Puzzle loader

A `PuzzleLibrary` service:

```ts
class PuzzleLibrary {
  getRandom(difficulty: Difficulty, maxSize: { w, h }): Puzzle
  get(id: string): Puzzle | null
}
```

Loads from JSON at server start. Indexes by `(difficulty, size)` for fast lookup.

### Vault → puzzle binding

When a vault biome instance is first generated, deterministically pick a puzzle:

```ts
puzzle = puzzleLibrary.getByHash(hash(seed, biomeId), difficulty, maxSize);
```

Where `getByHash` selects a puzzle index by hash so the same vault always gets the same puzzle. Difficulty is determined by the vault instance (hash-derived, weighted toward easier near origin — see "difficulty as distance" below).

### Difficulty as distance from origin

Vaults near origin should be Easy. Far away, Brutal. A simple linear mapping:

```ts
distance = √(centerX² + centerY²)
difficultyIndex = clamp(floor(distance / 500), 0, 4)
// 0 = Easy, 4 = Brutal
```

Some hash-driven jitter (±1 difficulty level) prevents perfect predictability.

This is one of the most important design hooks in the whole system: it makes outward exploration the difficulty curve. New players can't accidentally walk into Brutal on their first session.

### Vault sizing

The vault's interior must fit its puzzle. Either size the vault to match the puzzle, or pad with safe cells. I prefer matching: vault size derives from puzzle size + 1-cell wall ring + 1-cell breathing room. That makes vault size a visible difficulty cue from outside.

## Frontend

No changes for Step 5 — the wire format is the same as Step 4 from the client's perspective. The client doesn't know whether the puzzle came from a hardcoded source or a library.

A tiny exception: the gate tooltip now needs to display the *actual* difficulty derived from the puzzle. That data was already in the gate payload.

## Tests

- Unit: `PuzzleLibrary.getByHash` returns the same puzzle for the same hash.
- Unit: difficulty-by-distance mapping correctness.
- Manual: walk a few hundred cells, find multiple vaults, verify difficulty trends upward.

---

# Step 6 — Gate Entry Requirements + Reward Variety

**Goal:** Gates are no longer free-entry. Different vault types want different things. Rewards diversify beyond score.

## Entry requirement types

Implement five gate types. The gate's type is hash-derived from `(seed, biomeId)`.

| Type | Requirement | Where |
|---|---|---|
| `free` | none | common, especially near origin |
| `score` | session score ≥ N | mid-range vaults |
| `flags` | placed ≥ N correct flags this session | medium vaults |
| `key` | possess key item type X | far/hard vaults; keys come from other vaults |
| `group` | ≥ N players adjacent to gate simultaneously | rare, distinctive |

Distribution: weight toward `free` near origin, toward `key` and `group` far out.

### Backend representation

```ts
type GateRequirement =
  | { kind: 'free' }
  | { kind: 'score', amount: number }
  | { kind: 'flags', amount: number }
  | { kind: 'key', keyType: string }
  | { kind: 'group', count: number };

type Gate = {
  position: { x, y },
  requirement: GateRequirement,
  reward: Reward,
};
```

### Validation on entry attempt

When a player tries to move onto a gate cell, server checks the requirement against current state and either allows the move or rejects with a reason. Client shows the reason as a tooltip near the gate.

For `group`: server periodically checks which players are adjacent to which gates. If ≥ N qualifying players are adjacent and one of them attempts to move in, all qualifying players are allowed to enter simultaneously. (Implementation nicety: requires a small "intent to enter" handshake — the player presses a key facing the gate, the server checks, all eligible players step through together.)

## Reward variety

Four reward types:

| Reward | Effect | Notes |
|---|---|---|
| `score` | + score | Default for easy vaults. |
| `key` | grant key item | Unlocks `key`-gated vaults elsewhere. Show a notification: "you found the Iron Key." |
| `cosmetic` | flag colour / avatar style | Persistent for session. Could persist longer with accounts. |
| `marker` | place a permanent named beacon visible on minimap | Shared visibility. The world remembers. |

Reward type is hash-derived from the vault, weighted by difficulty (Brutal vaults more likely to give keys/markers; Easy vaults give score).

### Key item dependency graph

This is the moment the world becomes genuinely interconnected. A `key`-gated vault wants the key from a specific earlier vault. Generation needs to ensure the dependency is reachable — i.e. somewhere within a reasonable distance, there's a vault that gives the required key.

Simple approach: each `key`-gated vault hashes to a "key type number" 1..K. The world reliably generates `key`-granting vaults of each type at moderate frequency (say, 1 in 8 vaults grants a key, with types distributed evenly). Players might need to wander before finding the right one — that *is* the gameplay.

A smarter approach (Step 6.5 or later): explicit graph generation that guarantees specific dependencies are placed within N cells of each other. Out of scope for first pass.

## Frontend

### Gate tooltip extension

The proximity tooltip now shows the actual requirement and reward, both human-readable:

```
The Vault of the Restless Tide
Difficulty: Hard
Entry: requires 1500 score (you have 1240)
Reward: Iron Key
```

Colour the requirement line red if not met, green if met.

### Inventory UI

A small panel showing collected keys, cosmetics, and active markers. Bottom-corner of the viewport. Click a marker to flash its location on the minimap.

### Group-entry coordination

When the player is at a group-gate but undermanned, show:
```
3 of 4 players needed at this gate
```
With small avatar dots indicating who's currently present. This signals to other nearby players that something is happening — natural coordination prompt.

## Tests

- Unit: each requirement type's validator.
- Unit: key item persistence in player state.
- Manual: walk to a score-gated vault, accumulate score, enter. Test key chain. Test group entry with two browser windows.

---

# Step 7 — Three More Biome Types

**Goal:** Validate the framework with biome variety. Add Spiral, Sierpinski, Anomaly.

The framework should now absorb new biome types with minimal core changes. Each new biome implements `BiomeStrategy`:

```ts
interface BiomeStrategy {
  type: BiomeTypeName;
  containsPoint(x, y, instance): boolean;
  getCellModifier(x, y, instance): CellModifier;
  getMetadata(instance): { name, color, ... };
}
```

`BiomeGenerator` dispatches to the appropriate strategy.

## The Spiral

- **Footprint:** ring (annulus). Outer radius 18, inner radius 14.
- **Mine layout:** mines along a logarithmic spiral inside the ring. Cells on the spiral path are safe. Stepping off the path = high mine density.
- **Reward:** centre of the ring is empty space — walking to centre via the spiral grants a marker.
- **Special rule:** none. Just an exploration puzzle.

The maths: for a cell at `(x, y)` relative to the biome centre, compute `(r, θ)` polar. The spiral path is `r = a · e^(b · θ)` for fixed `a, b`. A cell is "on the path" if `|r - a · e^(b · θ_normalised)| < 1.5`.

## The Sierpinski

- **Footprint:** equilateral triangle, side ~30.
- **Subdivision:** recursive. The triangle is divided into 4 sub-triangles. The 3 outer sub-triangles each either recurse or contain an embedded puzzle. The centre sub-triangle is a wall region.
- **Recursion depth:** 2 (so up to 9 leaf sub-triangles). Determined by biome hash.
- **Walls:** the borders between sub-triangles. Creates a recursive maze.
- **Reward:** completing all puzzles in the structure grants a particularly good marker plus score.

The fractal nature comes from the recursive subdivision. Players see a triangle, walk in, find smaller triangles inside, find still smaller triangles inside those. The geometry is the discovery.

Implementation: a recursive function `subTriangleAt(point, triangleBounds, depth)` returns which leaf the point falls into. `getCellModifier` calls it.

## The Anomaly

- **Footprint:** Voronoi cell defined by the golden-lattice overlay (§4.1 of the design doc — the rare second lattice).
- **Special rule (pick one per instance, hash-determined):**
  - **Inverted numbers:** number cells show adjacent flag count, not adjacent mine count.
  - **No flood fill:** cells reveal individually only. Chord still works.
  - **Reverse chord:** chord clicks place flags on adjacent unflagged cells (within the rule's bounds).
  - **Visible mines:** mines are visible from outside but become invisible inside. Flag from memory.
- **Reward:** key item of a high tier, or a unique cosmetic.
- **Mine layout:** density and pattern from the base simplex, no override — the rule change is the entire puzzle.

Anomalies are rare and weird. The point is that the framework supports rule overrides cleanly. To enable this, `BiomeStrategy` extends:

```ts
interface BiomeStrategy {
  // ... existing
  modifyAction?(action: PlayerAction, instance): PlayerAction | null;
  modifyDisplay?(cell: Cell, instance): CellDisplay;
}
```

`PlayerActionService` and the frontend renderer consult these if defined. This is the right place to put the action/display overrides — biome-local, not global.

## Tests

- Unit: each strategy's containsPoint and getCellModifier.
- Unit: Anomaly's modifyAction transformations.
- Manual: find one of each, verify they feel distinct.

---

# Step 8 — Polish Pass

The features are done. This step is craft. Order by impact:

## Animations

- **Reveal:** scale from 0.7 → 1.0 over 120ms with `easeOutBack`. Stagger by Manhattan distance from the click origin: `delay = min(distance * 8ms, 300ms)`. Cap at 300ms — flood fills shouldn't feel slow.
- **Flag:** the flag icon scales from 0 → 1 with a small bounce. 150ms.
- **Mine explosion:** all mines on the affected board reveal with a 30ms-staggered shake.
- **Avatar move:** the avatar translates between cells over 150ms (matches camera ease).
- **Gate open:** the door inset flips colour with a 200ms scale-pulse.

CSS transitions over JS animation where possible. Use `will-change: transform` on the SVG elements that move.

## Sound

Six samples, all <100KB, OGG and MP3:
- `reveal.ogg` — soft click
- `flag.ogg` — sharper tick
- `mine.ogg` — restrained boom (not cartoonish)
- `gate-open.ogg` — small chime
- `step.ogg` — barely audible footstep, optional, gated behind a setting
- `vault-complete.ogg` — short triumphant flourish

Mute toggle in the top-right. Persist mute state to `localStorage`.

A `useSounds` hook with `play(name)`. Throttle reveals — if 100 cells flood, you don't want 100 click sounds. One sound per click event, regardless of fan-out.

## Minimap

A 200×200px panel in the bottom-right. Shows:
- Player position as a pulsing dot in the centre (the minimap centres on the player).
- Other players as their colour dots.
- Discovered biomes as their shape + tint, within ~500 cells.
- Markers (rewards from Step 6) as labelled pins.
- A faint hex grid overlay aligned to the biome lattice. This is the *biggest* gameplay-side polish item — the hex grid is the visual hint toward the lattice formula. Make it discoverable but not blatant.

## Biome name labels

Already in Step 3 but polish them: better fade curve, drop-shadow, faint typewriter effect (one character at a time over 200ms total).

## Number cell typography

Adopt the classic Minesweeper colour palette. Use a clean geometric sans (Inter, system-ui). Bold weight. Anti-alias-aware: numbers at small sizes need pixel-perfect rendering, so consider an SVG `<text>` with `font-feature-settings: "tnum"` for tabular numerals.

## Other-player activity ripples

When another player reveals or flags a cell in your viewport: a 200ms ripple expanding from that cell in their colour. Subtle, ~40% peak opacity. This is what makes the multiplayer "feel" alive without adding new mechanics.

## Mobile

Tap = reveal. Long-press (300ms) = flag. Two-finger pan. On-screen D-pad in the bottom-left for movement. Tap targets minimum 44px — the cells may need to upscale on mobile.

A "look-mode" toggle: when on, taps don't reveal (so you can pan without accidental clicks). Default off; some players will want it.

## Settings panel

Mute, sound volume, animation speed (1×, 0.5×, off — accessibility), reduced-motion auto-detect from `prefers-reduced-motion`, minimap toggle, look-mode toggle. Settings persist to `localStorage`.

## Performance

By this point, profile. Likely hotspots:
- React re-renders on chunk updates. Memoise `<BoardSVG>` per chunk if not already.
- Avatar updates causing full board re-renders. Avatars should be a separate SVG layer with its own component, not part of the chunk render path.
- Hex distance calculations inside biome lookups. Cache aggressively.

## Tests

Polish is largely manual. But:
- Unit: sound throttling (one reveal sound per click event regardless of flood size).
- Unit: minimap coordinate transforms.
- Visual regression: snapshot of biome rendering against fixtures.

---

# Sequencing notes

Steps 1–4 are foundational. Each *changes the shape* of the game. Steps 5–8 add depth without changing what the game fundamentally is.

If at any point a step reveals that an assumption was wrong (e.g. "stepwise movement actually feels terrible"), pause and reconsider before continuing — the build order assumes each step's design holds. Reworking step 1 after step 4 is built will be expensive.

I'd budget roughly:
- Step 1: 1 session
- Step 2: 1 session
- Step 3: 2 sessions (lattice math + tuning is finicky)
- Step 4: 2 sessions (vault + gate + completion is a lot of plumbing)
- Step 5: 1 session of integration, plus offline generation time
- Step 6: 2 sessions (requirements + rewards + inventory UI)
- Step 7: 2 sessions (three biomes is a lot, even with the framework)
- Step 8: 2–3 sessions of focused polish

Total: 13–14 sessions. About double the duration of the work to date. Reasonable for the scope of "make this an actual game."
