# Session 36: Player Sessions & Navigation

## Goal

Add player session tracking and navigation features so users can easily find activity on the infinite board.

## Deferred From

Session 35 (MongoDB Persistence). The chunk/game persistence layer must be complete before this session begins.

## Features to Implement

### 1. Player Session Tracking

A lightweight `sessions` collection tracks each connected player's current viewport center. Updated on pan, expired on disconnect.

```typescript
// sessions collection
{
  _id: string;           // playerId (socket.id)
  gameId: string;
  x: number;            // world coordinates (not chunk coords)
  y: number;
  updatedAt: Date;       // TTL index — expire after 60s of inactivity
}
```

- **TTL index** on `updatedAt` (60s) so stale sessions auto-expire in MongoDB
- **2D index** on `(gameId, loc: [x, y])` for spatial queries
- Updated via a `updateViewport` socket event emitted by the client on pan (debounced ~500ms)
- Deleted on socket disconnect

### 2. "Where Is Everyone?" Query

Socket event `getActivePlayers` → returns list of `{ playerId, x, y }` for all sessions in the game updated within the last 30s. Client renders dots on a minimap overlay.

### 3. Named Locations / Bookmarks

```typescript
// locations collection
{
  _id: ObjectId;
  gameId: string;
  name: string;
  x: number;
  y: number;
  createdBy: string;    // playerId
  createdAt: Date;
  loc: [number, number]; // [x, y] for 2D index
}
```

- **2D index** on `(gameId, loc)`
- Socket events: `createLocation`, `getNearbyLocations` (returns locations within radius of current viewport)
- Client: UI to name and save current position, list of nearby named places

### 4. Jump to Active Area

Socket event `getHotspot` → finds the chunk with the highest `updatedAt` in the last hour (from chunks collection), returns its world coordinates. Client pans viewport to that location.

### 5. URL-based Navigation

Frontend already supports `?x=N&y=N` query params as viewport center on load. Ensure this is wired to `ViewportProvider`'s `initialCenter`.

## Indexes Required

```javascript
// sessions
db.sessions.createIndex({ updatedAt: 1 }, { expireAfterSeconds: 60 })
db.sessions.createIndex({ gameId: 1, loc: "2d" })

// locations  
db.locations.createIndex({ gameId: 1, loc: "2d" })
db.locations.createIndex({ gameId: 1, createdAt: -1 })
```

## Notes

- Session updates should be debounced on the client (~500ms) to avoid flooding the server on fast pans
- The `loc` field on sessions should be updated atomically with `updatedAt` in a single `updateOne`
- Named locations should be capped per game (e.g. max 1000) to prevent abuse
- "Jump to hotspot" can also use the `sessions` collection as a faster alternative to querying chunks
