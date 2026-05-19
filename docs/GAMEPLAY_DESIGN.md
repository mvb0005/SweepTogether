# SweepTogether — Gameplay Design

**Status:** Draft for review. Audits and extends the user's biome / movement / embedded-puzzle ideas.
**Pairs with:** `CLAUDE.md` (tech), `PLANNING.md` (roadmap), `SESSIONS.md` (history).

---

## 1. Design Pillars

Three commitments that everything below has to serve. If a feature contradicts one of these, the feature loses.

1. **The world is one shared space, not a collection of rooms.** Every player is somewhere on the same infinite grid. Discoveries are persistent and visible to everyone who walks past.
2. **The map itself is the puzzle.** Difficulty, structure, and reward come from *where* you are, not from a menu. A player who never opens a settings screen should still feel meaningful variation as they move.
3. **There is something to find.** The fractal/geometric structure isn't decoration — it encodes biome locations. A player who pays attention can predict where the interesting stuff is. The game rewards pattern recognition at two levels: the local Minesweeper level, and the global world level.

---

## 2. Movement & Camera

### What changes

The current frontend supports free pan via click-drag and WASD/arrows. Per the prompt, we constrain navigation to **discrete 4-directional movement** centred on a player avatar.

- The player has a position `(px, py)` in world coordinates. Initially `(0, 0)`.
- Arrow keys / WASD move the player one cell in that direction. Hold to repeat (with sensible repeat delay — ~120ms feels right; tune in playtest).
- The camera centres on the player and smoothly interpolates (200–300ms ease-out) when the player moves. No instantaneous jumps.
- The viewport still drives chunk subscription as it does today (Session 34). The "visible chunks + buffer + direction bias" logic carries over unchanged — the only difference is that the viewport centre is now derived from player position rather than free pan.

### Why this matters for design

Constrained movement makes spatial structure *legible*. With free pan, the player teleports their attention; with stepwise movement, they experience distance. That experience is what makes a biome feel like a place rather than a screen.

Mouse interactions (reveal/flag/chord) continue to work on any visible cell — you can still click ahead of where you stand. We're constraining the avatar, not the cursor.

### Open questions

- Should revealing a cell require the player to be adjacent? **Recommendation: no, at least in the main world.** Forcing adjacency turns reveal into a movement puzzle and slows the game's core loop too much. Some biomes (see §5) may impose adjacency as a local rule.
- Diagonal movement? **Recommendation: no.** Four directions is cleaner, keeps the geometric biome layout (§4) honest, and matches the orthogonal grid.

---

## 3. The Main World — Calm by Design

The area around the origin is, deliberately, almost trivial Minesweeper. Mine density ~5–8% (vs. classic Beginner's 12.5%). Wide open flood-fill regions. The point of the main world is not to challenge — it's to:

- Onboard new players without explanation.
- Give experienced players a low-stakes traversal layer between biomes.
- Make biomes feel distinct by contrast. If the whole map were dense, biomes would lose punch.

The main world is the *connective tissue*. Biomes are the *destinations*.

**Implementation:** the existing `WorldGenerator` already controls mine density via simplex noise threshold. Lower the global density and let biome layers override it locally (see §4.3).

---

## 4. Biomes — Fractal Geometry as Map

This is the heart of the prompt and deserves the most attention. Three problems to solve simultaneously:

- **Where do biomes appear?** They need to be discoverable and (per the prompt) follow a formula that a curious player can reverse-engineer.
- **What does a biome contain?** Different rules, densities, embedded puzzles, rewards.
- **How is a biome bounded?** Walls, gates, transitions — so the player feels they've *entered* something.

### 4.1 The Biome Lattice

A biome's *location* is determined by a deterministic function of world coordinates and the world seed. The function is the "mystery" — once a player figures it out, they can predict where the next biome of a given type will appear.

Concrete proposal: **gaussian-integer lattice + hash classification.**

```
For each biome center candidate at lattice point L = (a · u + b · v) for integers a, b
where u = (R, 0) and v = (R/2, R·√3/2)  (hex lattice, spacing R ≈ 80–120 cells)

biome_type = hash(seed, a, b) mod N_types        // which biome
biome_size = base_size + hash2(seed, a, b) mod variance
biome_active = hash3(seed, a, b) < density_threshold   // not every lattice point spawns
```

A hex lattice (rather than a square one) gives more direction variety while staying regular enough to reverse-engineer. The lattice spacing `R` is the player's "wavelength" — they learn that biomes appear roughly every R cells, and they can compass-navigate between them.

**The mystery:** the player doesn't see the lattice. They see biomes scattered through the world. Pay attention long enough — note distances between biomes, compare angles — and the hex grid becomes visible. That's the "figure out the formula" moment the prompt asks for.

**Fractal layer:** for advanced/secret biomes, place a *second* lattice with much larger spacing (e.g. R² or R · φ for golden-ratio spacing) overlaid on the first. Rare biomes at the intersection of the two lattices. This gives a self-similar feel without needing actual recursive subdivision.

### 4.2 Biome Footprint Shape

A biome isn't a circle around its center — that would be visually boring and waste the "geometric nature" hook. Instead, each biome type has a characteristic *shape* drawn from a small palette:

| Shape | Visual | Used for |
|---|---|---|
| **Filled hexagon** | Solid region, hex-aligned to the lattice | Classic embedded-puzzle vaults (§5.1) |
| **Ring / annulus** | Hollow ring around the center | Maze-like biomes; the center is reward |
| **Cross / plus** | Four arms extending N/S/E/W | Biomes with directional gates |
| **Sierpinski-like** | Recursive triangular subdivision | "Hard mode" biomes — fractal interior |
| **Voronoi cell** | Boundary defined by nearest-lattice-point | Wilderness biomes that flow into each other |

Pick the shape from the biome type. The shape becomes a visual signature — players learn to recognise "oh, that ring on the horizon means there's a maze biome here."

### 4.3 How Biome Generation Layers on Mine Placement

The current `WorldGenerator.isMine(x, y)` uses one simplex noise field with a threshold. The biome system adds three layers, evaluated in order:

1. **Biome lookup:** is `(x, y)` inside a biome footprint? If yes, which biome and how deep into it?
2. **Biome rule:** the biome supplies its own `isMine` predicate. Options:
   - **Density override:** same simplex noise, different threshold (e.g. 25% in a hard biome).
   - **Embedded puzzle:** the cell's mine state is read from a pre-baked puzzle grid (§5).
   - **Pattern:** mines placed in a geometric pattern (concentric rings, spiral, checkerboard with gaps).
3. **Wall layer:** is `(x, y)` a wall cell? Walls are unrevealable, unflaggable, and rendered distinctly (§5.2).

Caching still works the same way — `WorldGenerator` already caches per `(x, y)`, and biome lookup is deterministic from `(x, y)` + seed.

### 4.4 Biome Type Sketches

Not a final list — a starting palette to validate the framework. Each is one biome *type*; many instances of each appear across the world.

- **The Quiet Fields** — main world default. ~6% mines, large open spaces. No biome footprint; this is the "negative space."
- **The Garden** — filled hexagon, ~10% mines, but mines arranged in petal patterns that radiate from the center. Reward at center: a small permanent score boost or a flag-cosmetic.
- **The Vault** — filled hexagon surrounded by a thick wall. Inside: an embedded classic Minesweeper puzzle (§5.1). Enter via one gate (§5.3). Reward scales with puzzle difficulty.
- **The Spiral** — ring shape, mines along a logarithmic spiral. Walking the spiral path reveals safely. Stepping off the path is a guess.
- **The Sierpinski** — recursive triangle, three sub-triangles each containing either a smaller version or a high-difficulty puzzle. The fractal *is* the gameplay.
- **The Causeway** — cross/plus shape, very low mine density along the arms, used as fast-travel between dense regions. Reward: nothing intrinsic, but they connect other biomes.
- **The Anomaly** — rare (golden-lattice). Rules differ: e.g. number cells show *adjacent flags* instead of adjacent mines, or chord clicks behave differently. Big reward for solving.

---

## 5. Embedded Classical Puzzles

The prompt specifically asks about embedding open-source minesweeper puzzles. This is the cleanest single feature on the list — it gives the game discrete, hand-authored *destinations* with verifiable difficulty.

### 5.1 The Puzzle Source

`hellpig/minesweeper-puzzle-generator` (GitHub) generates puzzles with **unique solutions** across a difficulty spectrum from trivial to "the actual hardest possible." Critically: the difficulty can be selected between puzzle-minesweeper.com's easy, their hard, and the actual hardest possible. Generation is slow at the top end — a 50×50 puzzle of the hardest difficulty should be generated in the range from a couple minutes to a couple days — so we pre-generate offline and ship a library, not generate on demand.

Also worth knowing: minesweeper is computationally hard in the general case (Minesweeper is NP-complete — meaning it belongs to the same class of computational problems as the traveling salesman problem), which is part of why curated puzzles are more interesting than infinite random mines at the high end.

**Pipeline:**

1. Run the generator offline to produce ~50–200 puzzles per difficulty tier (Easy, Medium, Hard, Expert, Brutal). Sizes from 9×9 up to 30×30.
2. Store as JSON: `{ id, size, difficulty, mines: [[x,y]…], solution: [[x,y, value]…] }`.
3. Ship the library with the backend. Vaults reference a puzzle by `id`.

License check: the generator is on GitHub — verify its license before bundling output. The *generated puzzles* themselves aren't copyrightable as data, but the generator code is. Either keep generation offline (no code redistribution issue) or fork under whatever the upstream license requires.

### 5.2 Walls

A new cell type: `WALL`. Walls are:

- Generated by the biome system, not by `worldGenerator.isMine`.
- Unrevealable, unflaggable. Click does nothing.
- Block flood fill — the BFS in `runGlobalFloodFill` treats walls as "revealed" boundaries (it never tries to expand through them).
- Rendered as solid blocks with a biome-specific colour. They give biomes visual identity at a glance.

A walled vault embedding a 16×16 puzzle is a 16×16 puzzle area with a 1-cell wall ring around it, plus a gate. The wall ring is part of the biome footprint.

### 5.3 Gates

A gate is a wall cell with a special state. Gates have:

- **Position** — one cell, somewhere on the vault wall. Determined by the biome's hash so it's deterministic.
- **Entry requirement** — what the player needs to pass through. Options:
  - **Free** — just walk in. (Easy vaults.)
  - **Score requirement** — current session score ≥ N.
  - **Flag count** — player has placed at least N correct flags this session.
  - **Key item** — player has collected a key from another biome (introduces a dependency graph).
  - **Group entry** — N players must be standing adjacent to the gate simultaneously. (Co-op mechanic; fits the multiplayer premise.)
- **Reward on completion** — the prize for solving the embedded puzzle:
  - Score bonus (scaled to difficulty).
  - A key item that unlocks gated biomes elsewhere.
  - A cosmetic (flag colour, avatar style).
  - A persistent marker — the vault, once solved, stays solved for everyone. The world remembers.

Entry requirements and rewards are biome-type-keyed, with some per-instance variation from the hash. Avoid making every gate unique — players need to be able to learn "Vaults of type X want Y."

### 5.4 Completion semantics

A vault is "complete" when all non-mine cells inside the wall are revealed. Hitting a mine inside a vault has bigger stakes than in the open world:

- Larger score penalty.
- Vault resets after 60 seconds (re-generates the same puzzle — it's curated, not random).
- Optional: short lockout from re-entering the vault.

This makes vault attempts feel deliberate, not casual.

---

## 6. Frontend Polish — Concrete List

The prompt asks for "frontend polish." Below is a prioritised list. The first group is necessary for the gameplay above to land; the second group is finish.

### Must-have (gameplay-enabling)

1. **Player avatar rendering.** A coloured token at `(px, py)`. Other players' avatars rendered in their colours when within the viewport. Read positions from a new `playerPositions` event.
2. **Movement input.** Replace free pan as the primary movement mode with arrow/WASD stepping. Click-drag pan still available as a "look ahead" gesture but doesn't move the avatar.
3. **Camera follow.** Smooth ease-out interpolation between camera positions on player move. CSS `transform: translate` on the SVG with a 200ms transition handles this well — no manual animation loop needed.
4. **Wall rendering.** Walls as filled rects with a biome-coloured fill and a slight inner shadow / bevel. Visually unambiguous: walls do not look like unrevealed cells.
5. **Biome border indication.** When the player crosses into a biome, a brief subtle vignette or border-tint animation on the viewport. Plus the biome name appears centred and fades out (Zelda-style location label). Don't over-do this.
6. **Gate state UI.** When the player approaches a gate, a small floating tooltip near the gate shows entry requirement and reward. Removes "what does this thing do" confusion entirely.

### Polish (quality)

7. **Reveal animations.** A short scale-bounce on newly revealed cells. Stagger flood-fill reveals by distance from the click origin so a flood looks like it spreads (don't make this slow — total animation < 400ms even for huge floods).
8. **Number cell typography.** Use the classic Minesweeper colour palette (1=blue, 2=green, 3=red, etc.) but with a modern sans-serif. Numbers are the densest information in the game; they have to read instantly.
9. **Score popups.** When a player gains points, a `+N` floats up from the cell with a fade-out. Familiar pattern, works.
10. **Other-player activity.** When another player reveals or flags a cell in your viewport, a brief ripple/glow on that cell tinted with their colour. Makes the multiplayer feel alive without needing avatars to be visible.
11. **Minimap.** Tiny overview in the corner showing nearby biomes within a few hundred cells. Helps players develop intuition about the biome lattice (§4.1) — this is the "find the formula" feedback loop.
12. **Sound.** A handful of restrained samples: click, reveal, flag, mine-explosion, gate-open. Mute toggle is mandatory.
13. **Mobile / touch.** Tap = reveal, long-press = flag, two-finger pan, on-screen D-pad for movement. Not free, but not enormous either.

### Skip-for-now (until core is solid)

- Persistent player accounts. Avatars are session-only.
- Chat. Adds moderation surface area.
- Spectator mode. Falls out naturally from the read-only nature of the world; doesn't need its own UI.

---

## 7. The "Cohesion" Question

The prompt asks for cohesive gameplay. Where does that come from?

A few decisions cohere the loop:

- **One verb at the core: reveal.** Movement, flagging, chording, and gate-entry are all in service of safely revealing more of the world. The game is *legible* because there is one thing you are doing.
- **Persistent shared state.** The same vault doesn't reset for each player. Discoveries are real. This is the multiplayer premise actually paying off — without persistence, multiplayer is just chat with extra steps.
- **Difficulty as geography.** Players don't pick "Hard mode" — they walk toward it. The world's spatial structure *is* the difficulty curve. Beginners stay near the origin; veterans hunt for golden-lattice anomalies.
- **The mystery layer.** The lattice formula is a meta-puzzle on top of the moment-to-moment puzzles. It rewards a different kind of player — one who pays attention to structure across sessions — without alienating players who don't. They still get vaults and biomes; they just don't predict them.

---

## 8. Build Order

A suggested sequencing. Each step is a session-sized chunk in the project's existing workflow.

1. **Player avatar + 4-directional movement.** No biomes yet. Just place a token, move it with arrow keys, follow it with the camera. Multiplayer position sync.
2. **Walls as a cell type.** Backend cell type + frontend rendering + flood-fill respects walls. No biomes yet — test by hardcoding a square wall somewhere.
3. **Biome lattice.** Implement the hex lattice + hash classification. Add a single biome type (a simple density-override biome like The Garden). Render its footprint visibly. Verify it's deterministic and that the same biome appears in the same place for two clients.
4. **Vault biome + first puzzle.** Wall ring + gate (free entry initially) + one hardcoded curated puzzle. End-to-end: walk to vault, enter, solve, get reward.
5. **Puzzle library pipeline.** Offline puzzle generation (fork hellpig generator), JSON library, vault references puzzle by id.
6. **Gate entry requirements + rewards.** Score gate, key items, group entry.
7. **Three more biome types.** Spiral, Sierpinski, Anomaly. Validates the framework handles variety.
8. **Polish pass.** Animations, sound, minimap, biome labels.

Steps 1–4 are the minimum to claim "this is the game." Everything after is depth.

---

## 9. Open Questions for the User

Before building, decisions are needed on:

- **Movement speed:** instant-snap, smooth interpolation, or stepped-with-cooldown? Affects feel a lot.
- **Death penalty in the open world vs. vaults:** currently lockout is the same everywhere. Should open-world death be lighter?
- **Persistent score vs. session score:** does walking away from the game cost you everything? Implications for the "score-required" gates.
- **Should walls be destructible** by some action? (I'd vote no — destroying them defeats the biome boundary.)
- **Biome lattice spacing R:** 80? 120? Affects how often biomes appear and how dense the world feels. Worth playtesting two values.
- **Mystery preservation:** do we want a "how does the world work" page in the UI, or is the lattice meant to be discovered entirely organically? My instinct: organic, with one cryptic hint somewhere in-world.

---

## 10. Out of Scope (deliberately)

To keep this doc honest, things I'm *not* proposing:

- Combat between players.
- A levelling system or skill trees.
- Procedural quest generation.
- In-game economy / trading.
- Anything seasonal or live-ops-style.

These can all be retrofitted if the core lands. Adding them now would mean designing systems before we know the core feels good.
