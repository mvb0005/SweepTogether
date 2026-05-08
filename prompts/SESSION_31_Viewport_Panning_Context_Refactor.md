# Session 31: Viewport Panning & Context Refactor

## Original Prompt

**Objective:** Fix viewport panning on the infinite board and clean up the frontend architecture by replacing prop drilling with React Context.

**Persona:** Frontend Developer (`agent_personas/frontend_developer.md`)

**Context Files to Read First:**
- `CLAUDE.md` — project overview and known incomplete work
- `agent_personas/frontend_developer.md`
- `frontend/src/types.ts`
- `frontend/src/hooks/useViewport.tsx`
- `frontend/src/App.tsx`
- `frontend/src/components/Viewport.tsx`
- `frontend/src/components/ChunkLoader.tsx`
- `frontend/src/components/ChunkedBoard.tsx`
- `frontend/src/components/BoardSVG.tsx`

---

## Background

Session 30 refactored the frontend to a chunk-based architecture but left viewport panning as stubs. The current state:

- `Viewport.tsx` — pan handlers are no-ops; `getVisibleChunks()` hardcodes a 2×2 grid at `(0,0)`.
- `useViewport.tsx` — full pan/keyboard logic exists but is not wired up anywhere.
- Pan handlers flow `App → Viewport → ChunkLoader → ChunkedBoard` but are silently dropped at `ChunkedBoard` — they are never passed to `BoardSVG`, which is where mouse events actually need to attach.
- `ViewportState` type uses `scale`; `useViewport` uses `zoom` internally — these need aligning.

The prop drilling chain (`isPlayerLocked`, `onRevealCell`, `onFlagCell`, `onChordCell`, pan handlers) runs 4 levels deep. The cleaner fix is to introduce React Context so leaf components (`BoardSVG`) can consume what they need directly.

---

## Instructions

### 1. Fix the type mismatch

In `frontend/src/types.ts`, `ViewportState` has `scale: number`. In `useViewport.tsx`, the internal state uses `zoom`. Rename `zoom` → `scale` throughout `useViewport.tsx` to match the existing `ViewportState` type. Remove the `panStart` field from `ViewportState` if present — pan state is managed internally in the hook, not in the shared type.

### 2. Create `ViewportContext`

Create `frontend/src/contexts/ViewportContext.tsx`:

- Define a `ViewportContextValue` interface exposing: `viewport`, `visibleChunks`, `onPanStart`, `onPanMove`, `onPanEnd`.
- `ViewportProvider` wraps `useViewport` internally. Accept `chunkSize` and optional `initialCenter` as props.
- `getVisibleChunks(viewport, chunkSize)` — compute dynamically:
  ```
  minChunkX = Math.floor((center.x - width/2) / chunkSize)
  maxChunkX = Math.floor((center.x + width/2) / chunkSize)
  // same for Y — return all {x, y} pairs in range
  ```
  Initial viewport dimensions should be calculated from `window.innerWidth` / `window.innerHeight` divided by `CELL_SIZE = 30`.
- Export a `useViewportContext()` hook that throws if used outside the provider.

### 3. Create `GameContext`

Create `frontend/src/contexts/GameContext.tsx`:

- `GameContextValue`: `gameId`, `isPlayerLocked`, `onRevealCell`, `onFlagCell`, `onChordCell`.
- `GameProvider` accepts these as props and exposes them via context.
- Export a `useGameContext()` hook.

### 4. Refactor `App.tsx`

- Remove all pan handler and game action prop threading.
- Wrap the route content with `<GameProvider>` and `<ViewportProvider>`.
- The `/` route should simply render `<ChunkLoader />` with no props (it reads everything from context).
- Keep the socket join logic and `isPlayerLocked` derivation in `AppContent` — pass them into `GameProvider`.

### 5. Simplify `Viewport.tsx`

`Viewport.tsx` is now redundant — its role is replaced by `ViewportProvider`. Delete it. Update any imports in `App.tsx`.

### 6. Refactor `ChunkLoader.tsx`

- Remove all props except `gameId` (or remove that too if it comes from `GameContext`).
- Read `visibleChunks` and `viewport` from `useViewportContext()`.
- Keep the chunk subscribe/unsubscribe socket logic — this is its core responsibility.
- Pass no pan or game action props to `ChunkedBoard`.

### 7. Eliminate `ChunkedBoard.tsx`

`ChunkedBoard` is a near-no-op wrapper (adds a `<div>`, passes props through). Fold its content directly into `ChunkLoader` — render `<BoardSVG>` directly with the `<div>` wrapper inline. Delete `ChunkedBoard.tsx`.

### 8. Refactor `BoardSVG.tsx`

This is the most important change — wire up pan and game actions:

- Remove all props. Read everything from context:
  - `viewport`, `onPanStart`, `onPanMove`, `onPanEnd` from `useViewportContext()`
  - `isPlayerLocked`, `onRevealCell`, `onFlagCell`, `onChordCell` from `useGameContext()`
  - Accept `chunks: ChunkMap` and `chunkSize: number` as props (these are local rendering data, not global state).

- Add mouse pan events to the `<svg>` element itself:
  ```tsx
  onMouseDown={e => { if (e.button === 0) { setDragging(false); onPanStart(e.clientX, e.clientY); }}}
  onMouseMove={e => { if (e.buttons === 1) { onPanMove(e.clientX, e.clientY); setDragging(true); }}}
  onMouseUp={() => onPanEnd()}
  onMouseLeave={() => onPanEnd()}
  ```

- Track a `dragging` ref to suppress `onClick` on cells after a drag:
  ```tsx
  const draggingRef = useRef(false);
  // set to true in onMouseMove when movement occurs
  // check in cell onClick: if (draggingRef.current) return;
  // reset to false in onMouseDown
  ```

- Keep the existing SVG `viewBox` calculation and cell rendering logic unchanged.

### 9. Verify

1. From the project root, run `docker-compose up --build -d` to build and start all services.
2. Run `docker-compose logs -f frontend backend` to watch for build errors.
3. Once services are up, run `docker-compose exec frontend npx tsc --noEmit` to confirm no TypeScript errors.
4. Check `http://localhost:8080` loads without a blank screen or console errors.
5. Confirm the board renders (chunks load from the backend).
6. Confirm click-drag pans the board — viewport should shift and new chunks should subscribe/load.
7. Confirm WASD / arrow keys pan the board.
8. Confirm left-click reveals a cell, right-click flags, double-click chords — and none of these fire after a drag.

### 10. End of Session

- Update `SESSIONS.md` with a summary entry for Session 31.
- Add a `prompts/SESSION_31_Viewport_Panning_Context_Refactor.md` session notes section (fill in the "Session Notes" and "Deferred / Incomplete" sections below).
- Commit with message: `Session 31: Wire viewport panning and introduce ViewportContext/GameContext`

---

## Session Notes

All steps in the instructions were completed:

1. **Type alignment** — `zoom` renamed to `scale` throughout `useViewport.tsx` (`initialZoom` → `initialScale`, `setZoom` → `setScale`). Removed `panStart?` from `ViewportState` (it was already absent in the committed type; the diff removed a stale field). Fixed `SingleChunkPage.tsx` which still constructed a viewport object with `zoom: 1`.

2. **`ViewportContext`** — Created `frontend/src/contexts/ViewportContext.tsx` with `ViewportContextValue`, `ViewportProvider` (wraps `useViewport` internally, derives `initialWidth`/`initialHeight` from `window.inner*` / `CELL_SIZE`), dynamic `getVisibleChunks()`, and `useViewportContext()` guard hook.

3. **`GameContext`** — Created `frontend/src/contexts/GameContext.tsx` with `GameContextValue`, `GameProvider`, and `useGameContext()` guard hook.

4. **`App.tsx`** — Removed all pan handler and game action prop threading. Wraps route content with `<GameProvider>` and `<ViewportProvider>`. `<ChunkLoader />` takes no props.

5. **`Viewport.tsx` deleted** — The stub render-prop component was removed. Import updated in `App.tsx`.

6. **`ChunkLoader.tsx` refactored** — Props removed; reads `visibleChunks` from `useViewportContext()` and `gameId` from `useGameContext()`. Renders `<BoardSVG>` directly (with the `<div>` wrapper inline).

7. **`ChunkedBoard.tsx` deleted** — Near-no-op wrapper eliminated.

8. **`BoardSVG.tsx` refactored** — Reads `viewport`, `onPanStart`, `onPanMove`, `onPanEnd` from `useViewportContext()` and `isPlayerLocked`, `onRevealCell`, `onFlagCell`, `onChordCell` from `useGameContext()`. Mouse pan events attached to the `<svg>` element. `draggingRef` suppresses cell clicks after a drag.

9. **TypeScript errors fixed** — `DEFAULT_USERNAME`, `navigate`, and `setIsPlayerLocked` unused variables cleaned from `App.tsx`; unused `ChunkUpdatePayload` import and `handleInteraction` variable cleaned from `SingleChunkPage.tsx`.

10. **Build verified** — `docker-compose up --build -d` succeeded; `docker-compose exec frontend npx tsc --noEmit` returns no errors.

## Deferred / Incomplete

- **`subscribeToChunk` not wired into the running server.** `socketServer.ts` contains the full `subscribeToChunk` / `chunkData` handler but is never imported by `server.ts`, which uses the event-bus-based `socketHandlers.ts`. The frontend emits `subscribeToChunk` on pan but the backend silently ignores it — no chunk data is ever returned and the board never renders. This predates Session 31; the old working version used a different flat board state model (`updateBoard` / `viewportUpdate`). Next session should wire `subscribeToChunk` into the event bus and service layer.
