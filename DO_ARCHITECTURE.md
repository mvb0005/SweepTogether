# SweepTogether — Cloudflare Durable Objects Architecture

## Overview

This document describes a target architecture for migrating SweepTogether from the current Node.js + MongoDB + Socket.IO stack to Cloudflare Workers + Durable Objects. The goal is a globally distributed, horizontally scalable, stateful real-time game with zero operational overhead.

---

## Topology

```
Browser (WebSocket)
       │
       ▼
[Cloudflare Worker — edge gateway]
  - Routes WS upgrade to a Session DO
  - Looks up game room, creates Session DO stub
       │
       ▼
[Session Durable Object]  ← one per connected player
  - Owns the WebSocket connection lifetime
  - Manages which Chunk DOs the player is subscribed to
  - Forwards player actions (reveal / flag / chord) to Chunk DOs via RPC
  - Receives delta broadcasts from Chunk DOs and forwards to player
  - Hibernates when player disconnects (no compute billed while offline)
       │
       ├──── RPC ────▶  [Chunk Durable Object: chunk_0_0]
       ├──── RPC ────▶  [Chunk Durable Object: chunk_1_0]
       └──── RPC ────▶  [Chunk Durable Object: chunk_-1_1]
                              │
                        SQLite (per-chunk)
                        In-memory cache
```

Each Durable Object has a single-threaded execution model, so all state mutations inside a Chunk DO are naturally serialized — no optimistic concurrency retries needed.

---

## Durable Object Types

### 1. Session DO

**ID:** `session:<socketId>` or `session:<userId>` (one per connection)

**Responsibility:** Own the WebSocket, translate player actions to Chunk DO RPCs, fan out deltas from Chunk DOs back to the player.

**State:** Entirely in-memory (no SQLite needed). If it evicts, the player's WebSocket is already dead.

```typescript
class SessionDO implements DurableObject {
  private ws: WebSocket | null = null;
  private gameId: string = '';
  private playerId: string = '';
  private subscribedChunks: Map<string, DurableObjectStub> = new Map();

  async fetch(request: Request): Promise<Response> {
    const upgrade = request.headers.get('Upgrade');
    if (upgrade === 'websocket') {
      const { 0: client, 1: server } = new WebSocketPair();
      server.accept();
      this.ws = server;
      server.addEventListener('message', e => this.onMessage(e.data));
      server.addEventListener('close', () => this.onDisconnect());
      return new Response(null, { status: 101, webSocket: client });
    }
    // RPC from Chunk DOs: broadcast a delta to this player
    if (request.url.endsWith('/delta')) {
      const delta = await request.json();
      this.ws?.send(JSON.stringify(delta));
      return new Response('ok');
    }
    return new Response('not found', { status: 404 });
  }

  private async onMessage(raw: string): Promise<void> {
    const msg = JSON.parse(raw);
    switch (msg.type) {
      case 'join':        return this.handleJoin(msg);
      case 'subscribe':   return this.handleSubscribe(msg);
      case 'unsubscribe': return this.handleUnsubscribe(msg);
      case 'reveal':      return this.handleReveal(msg);
      case 'flag':        return this.handleFlag(msg);
      case 'chord':       return this.handleChord(msg);
    }
  }

  private getChunkStub(chunkX: number, chunkY: number): DurableObjectStub {
    const key = `${chunkX}_${chunkY}`;
    if (!this.subscribedChunks.has(key)) {
      const id = this.env.CHUNK_DO.idFromName(`${this.gameId}_${key}`);
      this.subscribedChunks.set(key, this.env.CHUNK_DO.get(id));
    }
    return this.subscribedChunks.get(key)!;
  }

  private async handleSubscribe(msg: { chunkX: number; chunkY: number }): Promise<void> {
    const stub = this.getChunkStub(msg.chunkX, msg.chunkY);
    // Chunk DO returns full initial state + registers this Session DO as subscriber
    const state = await stub.subscribe(this.sessionUrl());
    this.ws?.send(JSON.stringify({ type: 'chunkState', ...state }));
  }

  private sessionUrl(): string {
    return `https://session-do/${this.env.SESSION_DO.idFromString(this.ctx.id.toString())}/delta`;
  }
}
```

**Hibernation:** Use `this.ctx.acceptWebSocket(server)` (Hibernation API) so the DO can sleep between messages — Cloudflare only bills compute when a message arrives or an alarm fires.

---

### 2. Chunk DO

**ID:** `chunk:<gameId>_<chunkX>_<chunkY>`

**Responsibility:** Own the authoritative state for one chunk. Persist to SQLite. Broadcast deltas to all subscribed Session DOs. Execute local flood fill and propagate across chunk boundaries.

---

## Chunk DO SQLite Schema

```sql
-- Written once on first access; never updated.
-- Encodes isMine (bit 0) and adjacentMines (bits 1-4) for all cells.
-- Blob is CHUNK_SIZE² bytes: 0xFF = mine, 0-8 = adjacentMines.
CREATE TABLE IF NOT EXISTS mine_layout (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data BLOB NOT NULL
);

-- One row per revealed cell. INSERT OR IGNORE is the entire update API.
-- Enables bulk multi-value inserts for flood fill.
CREATE TABLE IF NOT EXISTS reveals (
  cell_index INTEGER PRIMARY KEY,  -- localY * CHUNK_SIZE + localX
  player_id  TEXT NOT NULL,
  revealed_at INTEGER NOT NULL     -- Unix ms
);

-- One row per flagged cell.
CREATE TABLE IF NOT EXISTS flags (
  cell_index INTEGER PRIMARY KEY,
  player_id  TEXT NOT NULL,
  flagged_at INTEGER NOT NULL
);

-- Cross-chunk flood fill work deferred until someone subscribes.
-- Rows are deleted after processing.
CREATE TABLE IF NOT EXISTS pending_fills (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  cell_index INTEGER NOT NULL,
  enqueued_at INTEGER NOT NULL
);

-- Single-row subscriber registry (JSON array of Session DO fetch URLs).
-- Kept in memory too; this is only for crash recovery (rare for DOs).
CREATE TABLE IF NOT EXISTS subscribers (
  id   INTEGER PRIMARY KEY CHECK (id = 1),
  urls TEXT NOT NULL DEFAULT '[]'
);
```

**Why individual rows instead of a packed buffer?**

SQLite's row-level locking and `INSERT OR IGNORE` semantics make individual rows the correct primitive for this data:
- `INSERT OR IGNORE INTO reveals VALUES (?,?),(?,?)...` atomically marks N cells in one statement
- `SELECT cell_index FROM reveals` on subscribe gives the initial state set efficiently
- `COUNT(*)` gives reveal count without scanning a buffer
- Two concurrent flood-fill RPCs can't corrupt each other: both do `INSERT OR IGNORE` and both succeed idempotently

---

## In-Memory Chunk DO Cache

The DO keeps a hot cache of the chunk's state for the duration it remains warm (i.e., while players are subscribed). This avoids SQLite reads on every reveal/broadcast.

```typescript
class ChunkDO implements DurableObject {
  private env: Env;
  private ctx: DurableObjectState;
  private sql: SqlStorage;

  // Write-once, populated on first access
  private mineLayout: Uint8Array | null = null;

  // Hot state — mirrors SQLite, kept current for zero-read broadcast
  private revealed: Map<number, string> = new Map(); // cell_index → playerId
  private flagged:  Map<number, string> = new Map();

  // Active subscribers: Session DO fetch URLs
  private subscribers: Set<string> = new Set();

  // Pending cross-chunk fill origins queued during offline period
  private pendingFills: Set<number> = new Set();
```

**Cache lifecycle:**
1. **Cold start** (no subscribers, DO just woke): load `mine_layout`, `reveals`, `flags`, `pending_fills` from SQLite in a single `ctx.blockConcurrencyWhile` init.
2. **Warm** (≥1 subscriber): all mutations go to cache first, then SQLite, then broadcast.
3. **Eviction** (DO hibernates): cache is lost. Next wake re-hydrates from SQLite. SQLite is the source of truth.

```typescript
constructor(ctx: DurableObjectState, env: Env) {
  this.ctx = ctx;
  this.env = env;
  this.sql = ctx.storage.sql;

  ctx.blockConcurrencyWhile(async () => {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS mine_layout (id INTEGER PRIMARY KEY CHECK (id=1), data BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS reveals (cell_index INTEGER PRIMARY KEY, player_id TEXT NOT NULL, revealed_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS flags   (cell_index INTEGER PRIMARY KEY, player_id TEXT NOT NULL, flagged_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS pending_fills (id INTEGER PRIMARY KEY AUTOINCREMENT, cell_index INTEGER NOT NULL, enqueued_at INTEGER NOT NULL);
    `);
    this.loadHotCache();
  });
}

private loadHotCache(): void {
  const layout = this.sql.exec('SELECT data FROM mine_layout WHERE id=1').one();
  if (layout) this.mineLayout = new Uint8Array(layout.data as ArrayBuffer);

  for (const row of this.sql.exec('SELECT cell_index, player_id FROM reveals')) {
    this.revealed.set(row.cell_index as number, row.player_id as string);
  }
  for (const row of this.sql.exec('SELECT cell_index, player_id FROM flags')) {
    this.flagged.set(row.cell_index as number, row.player_id as string);
  }
  for (const row of this.sql.exec('SELECT cell_index FROM pending_fills')) {
    this.pendingFills.add(row.cell_index as number);
  }
}
```

---

## Mine Layout — Write-Once Pattern

Mines are deterministic. `WorldGenerator(seed).isMine(globalX, globalY)` always returns the same answer. Therefore mine layout is computed once and stored as a blob:

```typescript
private getMineLayout(): Uint8Array {
  if (this.mineLayout) return this.mineLayout;

  // Compute from WorldGenerator (pure function, no I/O)
  const layout = computeMineLayout(this.chunkX, this.chunkY, this.gameId);
  this.mineLayout = layout;

  // Persist synchronously within blockConcurrencyWhile or via storage.put
  this.sql.exec('INSERT OR IGNORE INTO mine_layout VALUES (1, ?)', layout);
  return layout;
}
```

`computeMineLayout` runs `WorldGenerator` for all `CHUNK_SIZE²` cells, building the same byte buffer as the current backend. Custom pre-gen chunks override this by writing directly to the `mine_layout` table before the server ever sees them — same pattern as today's `saveCustomChunk`.

---

## Bulk Update Pattern — Flood Fill

Flood fill is the critical write path. A single click can reveal thousands of cells across many chunks. The optimized path:

### Local BFS (within one Chunk DO)

```typescript
private revealCells(origins: number[], playerId: string): number[] {
  const layout = this.getMineLayout();
  const toReveal: number[] = [];
  const queue = [...origins];
  const visited = new Set<number>(this.revealed.keys());

  while (queue.length > 0) {
    const idx = queue.pop()!;
    if (visited.has(idx)) continue;
    visited.add(idx);

    const adjacentMines = layout[idx] & 0x0F;
    const isMine = layout[idx] === 0xFF;
    if (isMine) continue;

    toReveal.push(idx);
    if (adjacentMines === 0) {
      for (const nIdx of neighbors(idx, CHUNK_SIZE)) queue.push(nIdx);
    }
  }

  // Single bulk INSERT for entire flood fill within this chunk
  if (toReveal.length > 0) {
    const now = Date.now();
    // Build multi-value parameterized statement
    const placeholders = toReveal.map(() => '(?,?,?)').join(',');
    const values = toReveal.flatMap(i => [i, playerId, now]);
    this.sql.exec(
      `INSERT OR IGNORE INTO reveals VALUES ${placeholders}`,
      ...values
    );
    for (const i of toReveal) this.revealed.set(i, playerId);
  }

  // Return boundary cells that need to propagate to adjacent chunks
  return this.collectBoundaryPropagations(toReveal, layout);
}
```

**One SQL statement per chunk per flood fill event** — not one per cell.

### Cross-Chunk Propagation

When BFS reaches a chunk boundary with an open cell (adjacentMines=0), propagate to the adjacent Chunk DO:

```typescript
private async propagateToNeighbors(
  boundaryPropagations: { chunkX: number; chunkY: number; cellIndex: number }[]
): Promise<void> {
  // Group by target chunk
  const byChunk = new Map<string, number[]>();
  for (const { chunkX, chunkY, cellIndex } of boundaryPropagations) {
    const key = `${chunkX}_${chunkY}`;
    if (!byChunk.has(key)) byChunk.set(key, []);
    byChunk.get(key)!.push(cellIndex);
  }

  // Fan out RPCs in parallel — each Chunk DO handles its own BFS
  await Promise.all([...byChunk.entries()].map(([key, cells]) => {
    const [cx, cy] = key.split('_').map(Number);
    const stub = this.getChunkStub(cx, cy);
    return stub.floodFill({ origins: cells, playerId: this.lastPlayerId });
  }));
}
```

### Lazy Pending Fills

If an adjacent Chunk DO has no subscribers when propagation arrives:

```typescript
async floodFill(req: { origins: number[]; playerId: string }): Promise<void> {
  if (this.subscribers.size === 0) {
    // Store for later — process when someone subscribes
    const now = Date.now();
    const placeholders = req.origins.map(() => '(?,?)').join(',');
    const values = req.origins.flatMap(i => [i, now]);
    this.sql.exec(`INSERT INTO pending_fills (cell_index, enqueued_at) VALUES ${placeholders}`, ...values);
    for (const i of req.origins) this.pendingFills.add(i);
    return;
  }
  // Subscribers present — run BFS immediately
  const boundary = this.revealCells(req.origins, req.playerId);
  this.broadcastDelta(req.origins);
  await this.propagateToNeighbors(boundary);
}
```

On subscribe, drain pending fills before sending initial state:

```typescript
async subscribe(sessionUrl: string): Promise<ChunkState> {
  this.subscribers.add(sessionUrl);

  // Drain pending fills before snapshotting state
  if (this.pendingFills.size > 0) {
    const pending = [...this.pendingFills];
    this.pendingFills.clear();
    this.sql.exec('DELETE FROM pending_fills');
    const boundary = this.revealCells(pending, '__propagation__');
    await this.propagateToNeighbors(boundary);
  }

  return this.buildInitialState();
}
```

---

## WebSocket Delta Protocol

All messages are JSON. Types:

### Client → Server (via Session DO)

```typescript
// Subscribe to a chunk (when it enters viewport)
{ type: 'subscribe',   chunkX: number, chunkY: number }

// Stop listening (chunk left viewport — DO keeps state, just removes subscriber)
{ type: 'unsubscribe', chunkX: number, chunkY: number }

// Player actions
{ type: 'reveal', worldX: number, worldY: number }
{ type: 'flag',   worldX: number, worldY: number }
{ type: 'chord',  worldX: number, worldY: number }
```

### Server → Client (from Session DO, sourced from Chunk DOs)

```typescript
// Full chunk snapshot on subscribe
{
  type: 'chunkState',
  chunkX: number,
  chunkY: number,
  cells: {
    index: number,        // localY * CHUNK_SIZE + localX
    adjacentMines: number,
    isMine: boolean,
    revealedBy?: string,
    flaggedBy?: string,
  }[]
}

// Delta: only the cells that changed
{
  type: 'chunkDelta',
  chunkX: number,
  chunkY: number,
  revealed?: { index: number, adjacentMines: number, isMine: boolean, playerId: string }[],
  flagged?:  { index: number, playerId: string }[],
  unflagged?: { index: number }[],
}
```

**Delta broadcast from Chunk DO to all subscribers:**

```typescript
private broadcastDelta(revealedIndices: number[], playerId: string): void {
  const layout = this.getMineLayout();
  const delta = {
    type: 'chunkDelta',
    chunkX: this.chunkX,
    chunkY: this.chunkY,
    revealed: revealedIndices.map(i => ({
      index: i,
      adjacentMines: layout[i] === 0xFF ? 0 : layout[i],
      isMine: layout[i] === 0xFF,
      playerId,
    })),
  };
  const body = JSON.stringify(delta);

  // Fire-and-forget to all Session DOs
  for (const url of this.subscribers) {
    fetch(url, { method: 'POST', body }).catch(() => {
      // Session DO is gone (player disconnected) — clean up
      this.subscribers.delete(url);
    });
  }
}
```

---

## Chunk Size Recommendation

**Recommended: 128×128 cells per chunk.**

| Metric | 32×32 | 64×64 | 128×128 |
|--------|-------|-------|---------|
| Cells per chunk | 1,024 | 4,096 | 16,384 |
| Mine layout blob | 1 KB | 4 KB | 16 KB |
| Reveals at 10% density | ~100 rows | ~410 rows | ~1,640 rows |
| DO wakes per viewport pan | ~9 (3×3) | ~4 (2×2) | ~1 (usually stays in 1) |
| Cross-chunk RPC per flood fill | frequent | occasional | rare |
| Initial state JSON | ~5 KB | ~20 KB | ~80 KB |

128×128 dramatically reduces cross-chunk RPC overhead — the main latency source. A viewport at 1×zoom shows roughly one chunk; even at 0.5× zoom only 4 chunks are visible. The 16 KB mine layout blob is within SQLite's sweet spot and well under the 128 KB DO RPC limit.

The 16 KB initial state is acceptable: compressed over WebSocket it's ~3 KB and sent once on subscribe.

---

## Cost Model

**Cloudflare pricing (2025):**
- Workers requests: $0.30/million (first 10M free)
- DO requests: $0.15/million (first 1M free)
- DO compute: $12.50/million GB-s (first 400k GB-s free)
- DO storage reads: $0.20/million  
- DO storage writes: $1.00/million
- Egress: free within Cloudflare network; $0.09/GB to internet (first 1 GB free)

**Per active player estimate (100 active players, 1M cell reveals/day):**

| Component | Volume | Cost/day |
|-----------|--------|----------|
| WebSocket messages (Session DO wake) | 500k/player/day | ~$0.03 |
| Chunk DO wakes (subscribe + reveal RPCs) | 2M | ~$0.30 |
| SQLite writes (reveals bulk-inserted) | 1M rows/day | ~$1.00 |
| SQLite reads (subscribe cold start) | 50k reads | ~$0.01 |
| Egress (delta JSON to browsers) | 500 MB | ~$0.04 |
| **Total/day** | | **~$1.40** |

At 1,000 active players: ~$14/day (~$420/month). Far below equivalent compute costs on traditional VMs/containers. The DO hibernation model means idle chunks cost nothing.

**Free tier covers:**
- ~50 concurrent players with moderate activity at zero cost
- Spikes well above this are absorbed by free tier allowances

---

## Migration Path

### Phase 1: Parallel run (no user impact)
1. Write `wrangler.toml` with `CHUNK_DO` and `SESSION_DO` bindings
2. Port `WorldGenerator` to TypeScript Worker-compatible module (already TS, just needs `seedrandom` bundled)
3. Implement Chunk DO with SQLite schema — unit test via Miniflare
4. Implement Session DO with WebSocket hibernate API
5. Point a `/v2` endpoint at the Worker; validate against current game state

### Phase 2: Pre-gen tool migration
- Run `pregen-text.ts` equivalent as a Worker fetch handler that bulk-writes to Chunk DOs via RPC
- Custom chunks write directly to `mine_layout` table in the target Chunk DO

### Phase 3: Cutover
- Drain current MongoDB writes, snapshot `revealed`/`flagged` state, import to DO SQLite via migration worker
- Update DNS / nginx to point at Cloudflare Worker
- Remove Node.js/MongoDB stack

### Not needed for DO migration:
- Socket.IO → native WebSockets (simpler, no long-poll fallback needed on CF)
- Session state → DO in-memory (no Redis/sticky sessions)
- Horizontal scaling → automatic (each Chunk DO is its own process)

---

## Open Questions

1. **Game rooms:** Currently single "default" game. In DO model, `gameId` is the namespace prefix for all chunk IDs. Adding rooms = adding a `GameRegistry` DO that maps room codes to seeds and tracks player counts.

2. **Player identity:** Current system uses ephemeral socket IDs. DO model benefits from durable player IDs (Cloudflare Access, or just a persistent localStorage UUID) so Session DOs can resume cleanly after reconnect.

3. **Score/leaderboard:** Best as its own `Leaderboard DO` per game — receives reveal count events from Chunk DOs, maintains sorted ranking in SQLite. One DO can handle thousands of events/second.

4. **Game-over condition:** With infinite world, "game over" (hit a mine) is per-player. The mine's Chunk DO knows isMine; it returns a `{ hitMine: true }` response to the reveal RPC, Session DO sends `{ type: 'gameOver' }` to that player and sets them to locked state.

5. **Admin / pre-gen:** The pregen tools would become authenticated Worker fetch handlers — POST to `/admin/pregen` triggers bulk chunk writes. Wrangler secret for auth.

6. **Chunk DO eviction timing:** Cloudflare evicts DOs after ~10s of inactivity. A chunk with no subscribers evicts quickly; that's fine — SQLite persists. The next wake re-hydrates in <1ms for a cold SQLite read of ~200 rows.
