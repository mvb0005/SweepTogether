# Multiplayer Minesweeper TODO

## Game Requirements

*   [ ] The game is multiplayer minesweeper.
*   [X] Every player sees the same board at the same time. (Implemented - Session 3, 7, 10)
*   [X] Players earn points by solving mines first, second, or third. (Implemented - Session 14)
    *   [X] More points are awarded for earlier places (1st > 2nd > 3rd). (Implemented - Session 14)
*   [X] Mine reveals are delayed: Only update all players with the mine being solved after all 3 winners have answered or a specific time has elapsed. (Implemented - Session 14)
*   [X] Players lose points and are locked out for a period of time for incorrect actions (e.g., clicking a mine). (Implemented - Session 14)

## Tech Requirements

*   [X] **Server Authority:** Trust nothing from the client; all game logic must reside and be validated on the server. (Implemented - Session 3, 7, 11)
*   [X] **Real-time Updates:** Use WebSockets (e.g., via Socket.IO) for instant communication between server and clients. (Implemented - Session 2, 3, 7)
*   [ ] **Persistence:** Store game state, player scores, and potentially user accounts in a database.
*   [X] **Containerization:** The entire application (backend, frontend, database) should be containerized using Docker for easy local and cloud deployment. (Implemented - Session 2)
*   [ ] **Cloud Deployment & Cost:** Design with cloud deployment in mind. Consider cost-effectiveness.

## Proposed Tech Stack

*   **Backend:** Node.js, Express.js (Used - Session 2)
*   **Real-time Communication:** Socket.IO (Used - Session 2)
*   **Frontend:** Vanilla JavaScript (Used - Session 2)
*   **Database:** PostgreSQL (Setup - Session 2)
*   **Containerization:** Docker, Docker Compose (Used - Session 2)

## High-Level Plan

1.  [X] **Project Setup:** (Completed - Session 2)
    *   [X] Initialize Node.js backend project (`package.json`).
    *   [X] Set up Express server.
    *   [X] Integrate Socket.IO.
    *   [X] Set up basic HTML/CSS/JS frontend structure.
    *   [X] Configure Dockerfile for backend.
    *   [X] Configure Dockerfile for frontend (or multi-stage build).
    *   [X] Set up PostgreSQL service in Docker Compose.
    *   [X] Configure `docker-compose.yml`.
2.  [X] **Core Game Logic (Server-side):** (Partially Implemented)
    *   [X] Board generation (size, mine placement). (Implemented - Session 3)
    *   [X] Player actions handling (reveal tile, flag tile). (Implemented - Session 3, 11)
    *   [X] Game state management (tracking revealed tiles, flags, game over conditions). (Implemented - Session 3, 7, 11, 12)
    *   [X] Validation of all client actions. (Implemented - Session 3, 7, 11)
3.  [X] **Real-time Communication:** (Partially Implemented)
    *   [X] Emit initial game state to connecting clients. (Implemented - Session 3, 7)
    *   [X] Broadcast board updates to all players in a game room. (Implemented - Session 3, 7, 10, 11)
    *   [X] Handle player connections and disconnections. (Implemented - Session 3, 7, 10)
    *   [X] Implement game room logic if multiple games run concurrently. (Implemented - Session 7)
4.  [X] **Scoring & Penalty Logic (Server-side):** (Implemented - Session 14)
    *   [X] Track reveal order for each mine. (Implemented - Session 14)
    *   [X] Award points based on 1st/2nd/3rd place for reveals. (Implemented - Session 14)
    *   [X] Implement point deduction for errors. (Implemented - Session 14)
    *   [X] Implement player lockout mechanism (duration, state). (Implemented - Session 14)
    *   [X] Manage the delayed reveal update (timer or waiting for 3 winners). (Implemented - Session 14)
5.  [ ] **Persistence:**
    *   [ ] Define database schema (Players, Games, Scores).
    *   [ ] Connect backend to PostgreSQL.
    *   [ ] Save/load player scores.
    *   [ ] Save/load ongoing game states (optional, for resilience).
6.  [X] **Frontend Development:** (Implemented)
    *   [X] Render the game board. (Implemented - Session 6 Plan, Session 7 Fixes)
    *   [X] Handle user input (clicks, flags). (Implemented - Session 6 Plan)
    *   [X] Connect to Socket.IO server. (Implemented - Session 7 Fixes)
    *   [X] Display real-time updates (board changes, scores, player status). (Implemented - Session 6 Plan, Session 10 Fixes, Session 14)
    *   [X] Show player scores and game status. (Implemented - Session 10 Fixes, Session 14)
7.  [ ] **Deployment Strategy:**
    *   [ ] Refine Dockerfiles for production.
    *   [ ] Choose a cloud provider (AWS, GCP, Azure).
    *   [ ] Select services (e.g., AWS Fargate/EC2, RDS; GCP Cloud Run/Compute Engine, Cloud SQL; Azure App Service/VMs, Azure SQL).
    *   [ ] Set up deployment pipeline (optional, e.g., GitHub Actions).

## Cloud Cost Estimation Factors (Example: AWS)

*   **Compute:**
    *   EC2 instances (pay per hour/second, depends on instance type/size) OR
    *   Fargate (pay per vCPU/memory per second for containers) OR
    *   App Runner/Elastic Beanstalk (managed services, potentially simpler but less flexible).
    *   *Estimate:* Small instances/low resource allocation initially. Cost scales with concurrent users/games. ~$10-50/month for low traffic.
*   **Database:**
    *   RDS for PostgreSQL (pay per hour, storage, data transfer). Reserved instances can save costs. Aurora Serverless v2 scales automatically.
    *   *Estimate:* Smallest RDS instance ~$15-20/month + storage/transfer. Serverless might be cheaper at very low usage but scales cost quickly.
*   **Networking:**
    *   Data Transfer Out (costs vary by region, often first ~100GB/month free). WebSocket traffic can increase this.
    *   Load Balancer (if needed for scaling/availability). ~$15-25/month.
*   **Other:**
    *   Potentially caching (ElastiCache for Redis) if performance becomes an issue.
*   **Overall:** Start-up costs can be kept low using free tiers or smallest instances/services. Costs will primarily depend on the number of concurrent players and game activity. A rough initial estimate for low traffic might be **$30-100/month**, scaling upwards significantly with popularity. GCP and Azure have similar service types and pricing structures.

## Core Gameplay Features

*   [X] **Flood Fill:** Clicking a hidden, non-mine cell with 0 adjacent mines recursively reveals all adjacent hidden, non-flagged cells until numbered cells are hit. (Implemented - Session 11)
*   [X] **Chord Click:** Clicking a revealed numbered cell, where the number of adjacent flagged cells matches the cell's number, reveals all other adjacent hidden, non-flagged cells. (Implemented - Session 11)
*   [X] **Game Over Reveal:** Reveal the entire board when a mine is hit. (Implemented - Session 12)
*   [X] **Scoring System:** Award points based on order of mine revelation (1st, 2nd, 3rd place). (Implemented - Session 14)
*   [X] **Penalty System:** Deduct points and lock out players temporarily for hitting mines. (Implemented - Session 14)
*   [X] **Delayed Mine Reveal:** Show correctly flagged mines to all players after a delay or when three players have flagged it. (Implemented - Session 14)

## E2E Tests

*   `app_loads.cy.js`: Basic test that the application loads. (Added - Session 4)
*   `game_updates.cy.js`: Tests basic interactions like revealing and flagging single cells. (Added - Session 4)
*   `game_config.cy.js`: Tests setting game configuration via the backend endpoint. (Added - Session 8)
*   `fixed_board.cy.js`: Tests interaction with a predefined board state. (Added - Session 8)
*   `flood_fill.cy.js`: Tests the flood fill mechanism when clicking a blank cell. (Added - Session 11)
*   `chord_click.cy.js`: Tests the chord click mechanism (clicking revealed numbers). (Added - Session 11)
*   [X] `scoring_system.cy.js`: Tests the scoring system for correctly revealing mines. (Fixed - Session 14)
*   [ ] `penalty_system.cy.js`: Tests the penalty system for hitting mines directly.

## Next Steps

1. **Database Integration:**
   * Implement user accounts and persistence
   * Store high scores and game history
   * Add login/registration system

2. **UI Polish:**
   * Enhance visual design with modern styling
   * Add animations for game events
   * Implement sound effects

3. **Additional Features:**
   * Custom game configuration options for players
   * Chat system for multiplayer communication
   * Achievement system

4. **Cloud Deployment:**
   * Prepare production-ready Docker configuration
   * Set up continuous deployment pipeline
   * Implement monitoring and scaling solutions

5. **Enhanced Testing:**
   * Create E2E tests for scoring and penalty functionality
   * Add unit tests for core game logic
   * Implement load testing for multiplayer scenarios

See `SESSIONS.md` for detailed historical session notes.


