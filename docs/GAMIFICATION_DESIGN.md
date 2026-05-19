# SweepTogether — Gamification Design Document

> Status: **Draft** — open for discussion, nothing here is committed to.  
> Last updated: 2026-05-18

---

## Vision

SweepTogether is currently an infinite shared minesweeper world. The core loop — reveal, flag, flood-fill — is solid. The goal of gamification is to give players **destinations**, **progression**, and **narrative** without breaking the minesweeper mechanic that makes it interesting.

The north star: a player opens the game, sees a colourful map with regions they haven't reached, chooses a direction to explore, and feels a sense of discovery and reward when they get there.

---

## Concept 1 — Biomes

### What it is
The infinite world is divided into named regions, each with distinct visual identity and gameplay properties. Biome assignment is deterministic from world coordinates (seeded, like mine placement), so every player sees the same biome map.

### Layout options

#### Option A: Ring-based
Difficulty scales with distance from world origin. Zone (0,0) is always "Meadow" (easy). Each concentric ring is a harder biome.

```
      [Volcanic]
   [Tundra][Tundra]
[Desert][Forest][Desert]
   [Forest][Meadow][Forest]
[Desert][Forest][Desert]
   [Tundra][Tundra]
      [Volcanic]
```

**Pros**
- Trivially clear progression — go outward to find harder content
- Easy to reason about mine density as a function of ring distance
- No need to hand-craft a map; pure math

**Cons**
- The world is symmetric and predictable — no surprises
- Players will always start in the same direction
- Feels less like a real "map"

#### Option B: Voronoi regions
Seed points are scattered using a second noise layer. Each world coordinate belongs to the nearest seed point; that seed's biome type is assigned by its distance from origin.

**Pros**
- Organic, irregular shapes — feels like a real world map
- Neighbouring biomes can vary in difficulty, creating interesting "shortcuts"
- Much more visually interesting than rings

**Cons**
- Biome boundaries are harder to communicate to players ("where does Forest end?")
- Progression is less clear — a player might accidentally step into a hard biome
- Harder to design loot room placement around

#### Option C: Ring + Voronoi noise (recommended)
Ring distance determines the biome *tier*. Simplex noise warps the boundary by ±30–50 tiles. You get predictable progression with organic-looking edges.

**Pros**
- Best of both: clear difficulty gradient with natural-looking borders
- Biome "peninsulas" create interesting geography (a Forest finger jutting into Desert)
- Implementation is straightforward: `ring = floor(distance / zoneRadius)`, then add noise offset

**Cons**
- Slightly more complex than pure rings
- Biome boundaries still show up on screen as a visual colour change; needs a smooth transition

### Proposed biome table (starting point)

| Ring | Name     | Colour       | Mine density | Theme                    |
|------|----------|--------------|-------------|--------------------------|
| 0    | Meadow   | `#81C784`    | 10%         | Open, easy, flood-fills everywhere |
| 1    | Forest   | `#388E3C`    | 15%         | Standard minesweeper density |
| 2    | Desert   | `#F9A825`    | 20%         | Sparse reveals, more flags |
| 3    | Tundra   | `#78909C`    | 25%         | High density, careful play |
| 4+   | Volcanic | `#C62828`    | 30%+        | Punishing; rewards skill |

Zone radius (how many chunks wide each ring is) is a tuning parameter — probably 16–24 chunks (512–768 tiles) per ring feels right for a multiplayer world.

### Biome cell rendering

Unrevealed cells show the biome background colour. Revealed cells show the standard white + number. The biome tint gives the world a colourful, map-like appearance even in explored areas.

New render states needed:
- `unrevealed-biome-N` (tinted background, no number)
- `biome-boundary` (optional: a slightly different edge cell to mark transitions)

---

## Concept 2 — Mine Mazes

### What it is
In certain regions (or as a biome type), mines are placed structurally rather than randomly. A maze generator carves corridors through a field of 100% mine density. The mine clusters form the *walls*; the carved paths are safe tunnels.

### How it works mechanically
The existing minesweeper mechanic is preserved completely:

- **Inside a tunnel** (zero adjacent mines): flood-fill reveals the whole corridor instantly when any cell is clicked. The player "opens" a tunnel in one click.
- **Tunnel edge cells** (1–4 adjacent mines): tell the player how close the wall is. "1" means you're touching the wall. "4" means you're at a corner.
- **Wall cells** (mines): clicking one hits the mine. The numbers guide you to stay in the path.

The player learns to read numbers differently: instead of "how many mines around this cell?" they also read it as "am I in a safe corridor or at the edge?"

### Maze generation options

#### Option A: Classic maze algorithm (recursive backtracker / Prim's)
Generate a perfect maze on a coarse grid (e.g., one cell = 3×3 tiles of open space, 1 tile thick walls), then render it at world scale. 

**Pros**
- Guaranteed connected, no isolated chambers
- Proven algorithms, easy to implement deterministically from a seed
- Can generate interesting branching structures

**Cons**
- Perfect mazes feel sterile — only one path between any two points
- Corridors are uniform width; no sense of grandeur
- 3-wide corridors still flood-fill, but single-wide corridors (1 tile) would not — need to be at least 3 wide

#### Option B: Cave-style (cellular automata)
Apply seeded random to a grid, then run cellular automata "smooth" passes to create organic cave shapes.

**Pros**
- Organic, natural-looking cavern structure
- Large open chambers form naturally — good for loot rooms
- Players can't predict the exact layout, only the general style

**Cons**
- Can produce disconnected rooms
- Hard to guarantee a path to a loot room
- Less "maze-like", more "cave system"

#### Option C: Hand-authored structure chunks (recommended for first pass)
Pre-design a set of structure templates (e.g., 64×64 tile rooms and corridors) that can be placed and rotated. The world generator places these at biome boundaries or loot-room positions, connecting them with noise.

This is similar to what the existing `pregen-text.ts` tool already does for writing text in mines.

**Pros**
- Complete creative control over what structures look like
- Can guarantee loot rooms are reachable
- Can design iconic landmarks (a spiral maze, a figure-8 room, etc.)
- No risk of generation failures

**Cons**
- Doesn't scale to the whole world — only specific placed structures
- Requires design work per template
- World between structures is still just noise-based

### Mine maze pros and cons (concept-level)

| | Pro | Con |
|---|-----|-----|
| Gameplay | Flood-fill rewards corridor exploration; numbers take on new meaning | Corridors trivially reveal; no per-cell thought needed inside |
| Visual | World looks structured, navigable, like a dungeon map | Could clash with the random-noise aesthetic of open biomes |
| Technical | WorldGenerator already supports custom mine placement via `Uint8Array` layout | Need maze generation logic; deterministic from seed is a hard requirement |
| Multiplayer | One player opening a corridor reveals it for everyone — great for co-op | First-mover advantage is huge; later players just walk an open hall |

---

## Concept 3 — Loot Rooms

### What it is
Special sealed chambers — completely mine-free — hidden at the ends of tunnels or within mazes. Discovering and "clearing" a loot room grants a reward.

### What a loot room looks like on the map
- A rectangular or irregular chamber of zero-mine cells
- Surrounded by a ring of mine-wall (so it doesn't flood-fill from outside)
- Contains one or more **loot cells** — a new cell type that gives a reward when revealed
- The entrance is a narrow gap in the mine wall (1–3 tiles wide)

### What "clearing" a loot room means
Options:
- **Reveal the loot cell** (simplest) — a single special cell in the room; revealing it triggers the reward
- **Reveal all cells in the room** — forces players to systematically clear the chamber
- **Reveal the room and plant a flag** — a ceremony-style action to claim it

The first option is most exciting — it rewards finding the room, not grinding through it.

### Reward models

#### Option A: Score bonus
Loot room grants a large point bonus. 

**Pros:** Simple, integrates with existing score system  
**Cons:** Score is already meaningless globally; multiplayer first-mover gets all points

#### Option B: Biome unlock
Discovering a loot room in biome X unlocks the next biome ring.

**Pros:** Clear progression gating; gives loot rooms strategic importance  
**Cons:** One player unlocks it for everyone — good or bad depending on design intent

#### Option C: Cosmetic unlocks
Loot rooms unlock player cosmetics — flag styles, cursor colours, player name colours.

**Pros:** Multiplayer-friendly (everyone can have their own cosmetics); not a first-mover problem  
**Cons:** Requires a cosmetics system and frontend rendering for personalised player identity

#### Option D: Map reveal (recommended)
Discovering a loot room reveals a portion of the world map — shows biome locations and the positions of other loot rooms within a radius.

**Pros:** Directly incentivises exploration; rewards are information, not power  
**Cons:** Requires a "world map" UI overlay that doesn't currently exist

### New cell types required

| Cell type | Description | Render |
|-----------|-------------|--------|
| `loot` | Special reward cell; revealed like normal but triggers reward | Gold/chest icon |
| `chest-opened` | Post-reveal state of a loot cell | Open chest icon |
| `entrance` | Narrow gap cell marking a room entrance | Optional — could just be a normal gap |

### Loot room multiplayer problem
In a shared world, loot rooms will be claimed by the first player to reach them. Options:
- **Shared reward** — loot room rewards everyone currently online (co-op)
- **Instance per player** — each player has their own state (complex; world is no longer shared)
- **Respawn timer** — loot rooms refill after N hours
- **Abundance** — so many loot rooms that first-mover doesn't matter

The easiest design choice is shared reward with co-op framing: "your group discovered the treasure room." This fits the existing multiplayer ethos.

---

## Concept 4 — New Visual Elements

Everything new that needs to be drawn on the map, beyond what exists today.

### Current render states
| State | Visual |
|-------|--------|
| Hidden | Grey cell |
| Revealed (0) | White, no number |
| Revealed (1–8) | White + coloured number |
| Flagged | Grey + flag icon |
| Mine (hit) | Red + mine icon |

### New render states needed

| State | Visual | Notes |
|-------|--------|-------|
| Hidden (biome-tinted) | Biome colour instead of grey | One render state per biome |
| Loot cell (hidden) | Slightly golden tint | Hints something is here |
| Loot cell (revealed) | Open chest icon | Post-discovery |
| Locked zone | Dark grey + fog/hatching | Blocks vision and interaction |
| Locked zone boundary | Animated shimmer or dashed line | Communicates "you can unlock this" |
| Mine wall (maze context) | Different visual to random mine | Heavier, more deliberate look |
| Entrance cell | Subtle arch or gap indicator | Points players toward a room |
| Biome boundary | Colour gradient between two biomes | 1–3 tile wide transition band |

### Canvas renderer implications
The current `CanvasBoard` renders cells with a flat colour lookup. Supporting biomes requires:
1. The chunk data to include biome ID per cell (or derivable from coordinates)
2. The renderer to have a colour table keyed by biome × reveal state
3. New icons: chest, locked-zone indicator

This is a moderate change to the frontend — the data pipeline needs biome info attached to chunk state, or the frontend derives it from coordinates (preferred — no extra wire data).

---

## Concept 5 — Progression & Unlocks

### The unlock graph
Biomes form a directed graph. You start at the centre, unlock outward.

```
Meadow → Forest → Desert → Tundra → Volcanic
```

With Voronoi layout, it becomes a proper graph where specific biome instances have specific neighbours.

### Unlock conditions — options

| Condition | Description | Pros | Cons |
|-----------|-------------|------|------|
| % of adjacent biome revealed | Reveal 30% of the neighbouring biome's tiles | Simple, encourages thorough exploration | Hard to compute for irregular Voronoi shapes |
| Loot room discovered | Find a loot room in the adjacent biome | Clear goal, exciting moment of unlock | Requires loot room system to exist first |
| Score threshold | Reach N points in the current biome | Rewards skilled play | Score is currently too easy to game |
| Boundary cell revealed | Reveal any cell on the biome boundary | Minimal — just walk up to the edge | Trivial to achieve; doesn't feel earned |
| Combination | Reveal 20% + find one loot room | Balanced | More complex to implement and communicate |

**Recommendation for first version:** boundary cell revealed — it's trivial to implement and gives you the UI scaffolding (locked/unlocked state) without designing a full progression system yet. Swap in a harder condition later.

### Shared vs individual progress

| Model | Description | Pros | Cons |
|-------|-------------|------|------|
| Fully shared | One player's unlock affects all players | True co-op; work together toward goals | One player can rush and unlock for everyone |
| Per-player | Each player tracks their own unlocks | Individual progression | World is no longer truly shared; complex |
| Server-wide milestone | Unlock triggers when N players have each contributed | Requires group effort | Complex to implement and communicate |

**Recommendation:** Fully shared for now. The game is co-op by nature — shared unlocks fit the ethos.

### Locked zone behaviour
When a biome is locked:
- The cells are visually present (shown in a locked-zone render state)
- Reveal and flag actions are rejected server-side
- Players can see the biome exists and its colour, but can't play in it

This creates the map-exploration feel without hiding content entirely.

---

## Concept 6 — Biome Variant Mechanics

Down the road, biomes can have different *rules*, not just different densities.

| Biome variant | Rule change | Experience |
|---------------|-------------|------------|
| **Standard** | Normal minesweeper | Baseline |
| **Fog** | AdjacentMines numbers hidden; only revealed by chord-click | Requires flagging before revealing |
| **Dark** | Only cells within radius 5 of revealed cells are visible | Creates a torch-lit dungeon feel |
| **Mirrored** | The board is reflected — x becomes -x | Disorienting navigation |
| **Dense corridor** | The maze biome — structured layouts | Exploration over deduction |
| **Boss room** | A single massive mine-dense chamber with a loot room | Climactic challenge |

These are all post-MVP — they require frontend rendering changes and server-side rule enforcement per biome type.

---

## Technical Challenges

### 1. Deterministic biome assignment
The biome for any world coordinate must be computed identically by the server (for mine density, rule enforcement, loot room placement) and the frontend (for colour rendering without extra wire data). The existing `WorldGenerator` is already seeded this way — biome logic should live there.

### 2. Maze generation — seeded and deterministic
Maze generation must produce the same maze given the same seed and position. Classic algorithms (recursive backtracker) are naturally deterministic when seeded. The challenge is making them infinite — the maze can't be generated all at once. Solution: generate each biome zone's maze independently using `hash(gameId + zoneX + zoneY)` as a seed.

### 3. Loot room state persistence
Loot rooms need a persistent "claimed" state in MongoDB. The schema is straightforward (`{ gameId, roomId, claimedAt, claimedBy }`), but room IDs must be derivable from coordinates.

### 4. Unlock state persistence
Per-biome unlock state needs to be stored. A simple `{ gameId, biomeId, unlockedAt }` collection works.

### 5. Frontend biome derivation
The frontend currently knows world coordinates of each cell. Given those coordinates, it can derive biome ID locally (same math as server). This avoids sending biome data over the wire — a clean design.

### 6. Locked zone enforcement
The server must reject reveal/flag actions on locked cells. This means every action handler needs to check biome unlock state before processing. A lightweight cache of unlock states in memory avoids hitting MongoDB on every action.

---

## What to Build First

### Phase 0 — Biome colours only (lowest risk, immediate visual impact)
- Derive biome ID from world coordinates on the frontend
- Map biome ID to a background colour in the canvas renderer
- No server changes; no new persistence; no locking

**Deliverable:** The world looks like a colourful biome map. Nothing else changes.

### Phase 1 — Different mine densities per biome
- `WorldGenerator.isMine()` uses biome density instead of a fixed constant
- Server change only; frontend just sees different mine patterns

**Deliverable:** Outer biomes are noticeably harder.

### Phase 2 — Biome locking
- Locked zones shown in a distinct render state
- Server rejects actions in locked zones
- Simple unlock condition (boundary cell revealed)
- MongoDB stores unlock state

**Deliverable:** Players have to walk up to a locked biome to unlock it.

### Phase 3 — Loot rooms
- Hand-author 3–5 loot room templates
- Place them deterministically in each biome zone
- New `loot` cell type
- Shared reward on discovery (score bonus to start)

**Deliverable:** Players have destinations to explore toward.

### Phase 4 — Mine mazes
- Maze-biome zone type that uses structured mine placement
- Recursive backtracker maze gen, seeded per zone
- Corridors connect to loot rooms

**Deliverable:** A whole biome that plays like a dungeon crawler.

### Phase 5 — Biome mechanics variants
- Fog biome, Dark biome, etc.
- Requires per-biome rule enforcement on server and frontend

---

## Open Questions

1. **Zone size**: How many chunks wide is one biome? 16 chunks = 512 tiles. Does that feel like enough to be a "place"?

2. **Biome boundary style**: Hard edge (instant colour change at boundary) or gradient transition (3–5 tiles blend)? Gradient is prettier but needs an extra render pass.

3. **Loot room density**: One loot room per zone? Multiple? Rare enough to be exciting, common enough that players find them.

4. **Cosmetics vs functional rewards**: Do loot rooms ever give gameplay advantages (unlock speed boost, extra flag capacity) or only cosmetics/progression? Gameplay advantages are polarising in multiplayer.

5. **Biome names and lore**: Just functional names (Meadow, Forest) or something with more flavour? This is a visual game — good names help with identity.

6. **World map UI**: Should there be a minimap or overview screen showing biome layout? Without it, players may not know how to navigate toward goals.
