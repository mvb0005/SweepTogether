# Session 35: MongoDB Persistence & Spatial Indexing

## Design Decisions (pre-implementation)

### Why only store delta state

`isMine` and `adjacentMines` are fully deterministic given the game seed and `(x, y)` coordinates. Only `revealed` and `flagged` are mutable and need persistence. This keeps chunk documents tiny.

### Chunk document schema

```typescript
{
  _id: string;           // "gameId_chunkX_chunkY"
  gameId: string;
  chunkX: number;
  chunkY: number;
  version: number;       // optimistic concurrency
  players: string[];     // chunk-local player IDs, max 64, index = playerIndex stored in buffers
  revealed: Binary;      // 256 bytes, Int8: -1=unrevealed, 0..63=playerIndex
  flagged: Binary;       // 256 bytes, Int8: -1=unflagged,  0..63=playerIndex
  loc: [number, number]; // [chunkX, chunkY] for 2D spatial index
  updatedAt: Date;
}
```

### Game document schema

```typescript
{
  _id: string;      // gameId
  seed: number;     // WorldGenerator seed — stored once, never changes
  config: GameConfig;
  createdAt: Date;
}
```

Seed is generated randomly on first game creation and stored permanently. All servers load it on startup so WorldGenerator produces identical boards.

### Why per-chunk player index (not global)

Any given chunk is touched by at most a small number of players. A chunk-local index (max 64 = 6 bits) means values always fit in Int8, keeping both buffers at exactly 256 bytes. The players array on the chunk document maps index → player ID.

### Concurrency: optimistic locking with version field

```
1. findOne chunk from MongoDB
2. Run flood fill BFS on in-memory buffer
3. Check all target cells are -1 in buffer
4. Set target cells to playerIndex in buffer
5. updateOne with { version: currentVersion } filter
6. If modifiedCount === 0: concurrent write detected → retry from step 1
```

Two servers racing on the same connected component: one commits (increments version), the other retries, finds cells already claimed, and bails out. No transactions, no locks.

### Write-before-broadcast invariant

All chunk mutations are persisted to MongoDB **before** emitting `chunkData` or `chunksData` to clients. Clients never see state that isn't durable. On reconnect/resubscribe, clients always get fresh state from MongoDB.

### PendingFills persistence

PendingFills stored in MongoDB (separate collection or embedded per chunk). Loaded on game startup. Ensures cross-chunk flood fill propagation survives server crashes.

```typescript
// pendingFills collection
{
  _id: string;       // "gameId_chunkX_chunkY"
  gameId: string;
  chunkX: number;
  chunkY: number;
  entries: { localX: number; localY: number }[];
}
```

### Spatial index

```javascript
db.chunks.createIndex({ gameId: 1, loc: "2d" })
db.chunks.createIndex({ gameId: 1, updatedAt: -1 })
```

`$box` query on `loc` returns all chunks in a viewport bounding box. `updatedAt` index supports "recently active chunks" queries.

## Files Changed

- `backend/src/infrastructure/persistence/db.ts` — new `ChunkDocument` and `GameDocument` schemas, updated indexes, new `ChunkRepository` class replacing old `MongoGameRepository` chunk methods
- `backend/src/infrastructure/persistence/chunkRepository.ts` — new file: `loadChunk`, `saveChunk` (with optimistic retry), `getOrAddPlayerIndex`, `savePendingFills`, `loadPendingFills`
- `backend/src/infrastructure/persistence/gameRepository.ts` — new file: `loadGame`, `createGame` (with seed generation)
- `backend/src/application/gameStateService.ts` — wire `ChunkRepository` for load/save on chunk access and mutation
- `backend/src/infrastructure/network/server.ts` — load game seed from MongoDB on startup, pass to `WorldGenerator`
- `backend/src/domain/worldGenerator.ts` — accept seed as constructor argument (verify already done in Session 28)

## Deferred / Incomplete

- Player session tracking and navigation (Session 36)
- MongoDB chunk cache invalidation across multiple servers (needs Redis Socket.IO adapter — future session)
- `pendingFills` TTL / cleanup for chunks that are never subscribed
