# Project Planning: Multiplayer Minesweeper

**Last Updated:** 2025-05-02

This document outlines the high-level plan and future milestones for the project. It complements `TODO.md` (which tracks the current session goal) and `SESSIONS.md` (which logs completed work).

## Phase 1: Core Backend Refactor & Infinite World (In Progress)

- [x] Initial Project Setup (Node, TS, Docker, Basic Socket.IO)
- [x] E2E Test Setup (Cypress)
- [x] Core Game Logic (Fixed Board - Reveal, Flag, Flood Fill, Chord Click)
- [x] Frontend Migration (Vanilla JS -> React/Vite/TS)
- [x] Infinite World Generation (Simplex Noise, Caching)
- [x] Persistence Switch (Postgres -> MongoDB Setup)
- [x] Event-Driven Architecture Refactor (EventBus, Services Bootstrap)
- [x] Spatial Hash Grid Implementation (`SpatialHashGrid.ts`)
- [x] Game State Service Integration (`gameStateService.ts` with `SpatialHashGrid` & `worldGenerator`)
- [ ] **Player Action Service Integration:**
    - [ ] Refactor `REVEAL_TILE` handler (using `gridLogic.revealCell`, `gameStateService.getCell`, `gameStateService.updateGridCells`)
    - [ ] Refactor `FLAG_TILE` handler (using `gridLogic.toggleFlag`, `gameStateService.getCell`, `gameStateService.updateGridCell`)
    - [ ] Refactor `CHORD_CLICK` handler (using `gridLogic.chordClick`, `gameStateService.getCell`, `gameStateService.updateGridCells`)
- [ ] **Scoring & Player Status Integration:**
    - [ ] Implement `ScoreService` (subscribes to relevant events, updates scores).
    *   [ ] Implement `PlayerStatusService` (handles lockouts, game over status).
    - [ ] Ensure `PlayerActionService` interacts correctly with scoring/status services (likely via events).
- [ ] **Persistence Implementation:**
    - [ ] Define MongoDB schemas (`Game`, `Player`, `ChunkData`?)
    - [ ] Implement `GameRepository` interface using MongoDB.
    - [ ] Integrate repository calls into services (e.g., `GameManagementService` to load/save games, `GameStateService` to load/save chunks).

## Phase 2: Frontend Enhancements

- [ ] **Infinite Board Rendering & Navigation:**
    - [ ] Implement viewport logic (`useViewport` hook) for panning/zooming.
    - [ ] Fetch and render board data based on the current viewport.
    - [ ] Optimize rendering for large/infinite boards.
- [ ] **UI Components:**
    - [ ] Implement Player List component.
    - [ ] Implement Leaderboard component (real-time updates).
    - [ ] Implement Game Configuration UI (if allowing users to create games).
- [ ] **Visual Polish:**
    - [ ] Apply CSS styling for a modern Minesweeper theme.
    - [ ] Add animations (e.g., score updates, cell reveals).
- [ ] **User Experience:**
    - [ ] Implement player login/authentication.
    - [ ] Add user feedback for actions (loading states, errors).

## Phase 3: Testing & Deployment

- [ ] **Comprehensive Testing:**
    - [ ] Expand Unit Test coverage (backend services, domain logic).
    - [ ] Expand E2E Test coverage (infinite world interactions, all UI features).
    - [ ] Consider Load Testing.
- [ ] **Deployment:**
    - [ ] Choose Cloud Provider (AWS/GCP/Azure).
    - [ ] Set up production infrastructure (database, backend instances, frontend hosting).
    - [ ] Configure CI/CD pipeline (GitHub Actions?).
    - [ ] Implement Monitoring & Logging.

## Backlog / Future Ideas

- [ ] Different Game Modes (e.g., time attack, limited mines).
- [ ] Spectator Mode.
- [ ] User Profiles / Statistics.
- [ ] Matchmaking / Lobby System (if moving away from single global game).
