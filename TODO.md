# Multiplayer Minesweeper TODO

## Outstanding Requirements & Tasks

*   **Persistence:**
    *   [ ] Define database schema (Players, Games, Scores).
    *   [ ] Connect backend to PostgreSQL.
    *   [ ] Save/load player scores.
    *   [ ] Save/load ongoing game states (optional, for resilience).
    *   [ ] Implement user accounts and persistence.
    *   [ ] Add login/registration system.
*   **Cloud Deployment:**
    *   [ ] Design with cloud deployment in mind. Consider cost-effectiveness.
    *   [ ] Refine Dockerfiles for production.
    *   [ ] Choose a cloud provider (AWS, GCP, Azure).
    *   [ ] Select services (e.g., AWS Fargate/EC2, RDS; GCP Cloud Run/Compute Engine, Cloud SQL; Azure App Service/VMs, Azure SQL).
    *   [ ] Set up deployment pipeline (optional, e.g., GitHub Actions).
    *   [ ] Implement monitoring and scaling solutions.
*   **Testing:**
    *   [ ] `penalty_system.cy.js`: Write E2E tests for the penalty system (hitting mines, lockout).
    *   [x] Add unit tests for core backend game logic.
    *   [ ] Implement load testing for multiplayer scenarios.
*   **Frontend Refactor (React/TS):**
    *   [x] Migrate frontend from vanilla JS to React + Vite + TypeScript
    *   [ ] Add CSS styling to React components (`style.css`)
    *   [ ] Implement PlayerList component in React
    *   [ ] Implement Leaderboard component in React
    *   [ ] Refine UI/UX (game status messages, win/lose indication, etc.)
    *   [ ] Implement player name setting
    *   [ ] Implement chat functionality
    *   [ ] Add unit/integration tests for React components
    *   [ ] Update Cypress tests for the new React frontend
    *   [ ] Implement persistent leaderboard storage (e.g., database)
    *   [ ] Add game creation/selection UI (instead of just URL based)
*   **UI/UX Polish:**
    *   [ ] Enhance visual design with modern styling (e.g., CSS Modules, Tailwind CSS, Styled Components).
    *   [ ] Add animations for game events (reveals, flags, explosions).
    *   [ ] Implement sound effects.
*   **Additional Features:**
    *   [ ] Custom game configuration options for players (e.g., board size, mine density).
    *   [ ] Chat system for multiplayer communication.
    *   [ ] Achievement system.

## Infinite World Mode Overhaul

*   **Concept:** Transform the game into a single, persistent, infinitely scrollable world shared by all players.

*   **World Generation:**
    *   [x] Implement a deterministic noise function (e.g., Perlin, Simplex) seeded globally to determine mine placement based on coordinates (x, y).
    *   [x] Add configuration for mine density adjustment via the noise function threshold.
    *   [x] Backend calculates cell values (mine count) on demand based on the noise function for requested areas.
    *   [x] Implement performance optimization via caching for frequently accessed cell values.

*   **Player View & Interaction:**
    *   [ ] Frontend: Implement panning (mouse drag, WASD) and potentially zooming for navigating the infinite grid.
    *   [ ] Frontend: Render only the visible portion ("viewport") of the grid.
    *   [ ] Backend: Track each player's viewport coordinates.
    *   [ ] Backend: Send real-time updates (reveals, flags) only to players whose viewports overlap the affected area.
    *   [ ] Optimize network communication for viewport-specific updates.

*   **Game Objective & Failure:**
    *   [ ] Goal: Accumulate points on a global leaderboard.
    *   [ ] Clicking a mine: Temporary lockout, point penalty, mine revealed globally.
    *   [ ] Scoring: Award points for revealing numbers where adjacent mines are correctly flagged. Define precise scoring logic for the infinite context.

*   **Multiplayer & Leaderboard:**
    *   [ ] Implement a global leaderboard.
    *   [ ] Feature: Click player on leaderboard to navigate view to their last significant activity area.
    *   [ ] Frontend: Display colored outlines/indicators for actions performed by different players within the viewport.
    *   [ ] Consider implementing a "local" leaderboard for players currently viewing nearby areas.

*   **Persistence & Data Storage:**
    *   [ ] **Do not store mine locations.** Derive them from the noise function.
    *   [ ] **Store player actions:** Record reveals and flags with user ID, coordinates (x, y), and timestamp.
    *   [ ] **Efficient Spatial Querying:**
        *   [ ] Research and choose a storage solution optimized for spatial queries (e.g., PostgreSQL with PostGIS, MongoDB with geospatial indexes, custom Quadtree/Geohashing implementation).
        *   [ ] Design database schema for storing player actions efficiently.
        *   [ ] Implement backend logic to query actions within specific rectangular viewport boundaries.
        *   [ ] Ensure database indexes support efficient spatial lookups.
    *   [ ] Store player scores and lockout status persistently.

*   **Refactoring:**
    *   [ ] Adapt existing backend game logic (`game.ts`, `board.ts`, `socketHandlers.ts`) for the infinite model.
    *   [ ] Adapt existing frontend components (`Board.tsx`, `Cell.tsx`) for viewport rendering and infinite scrolling.
    *   [ ] Update `types.ts` (both frontend and backend) for new data structures (e.g., viewport coordinates, infinite coordinates).

*(See [README.md](README.md) for project overview, features, and setup. See [SESSIONS.md](SESSIONS.md) for detailed development history.)*


