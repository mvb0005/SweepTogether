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
    *   [ ] Add unit tests for core backend game logic.
    *   [ ] Implement load testing for multiplayer scenarios.
*   **Frontend Refactor (React/TS):**
    *   [ ] Migrate existing vanilla JS logic (`gameClient.js`, `network.js`, `ui.js`) into React components and hooks.
    *   [ ] Convert JavaScript files to TypeScript (`.tsx`, `.ts`).
    *   [ ] Implement state management (e.g., React Context, Zustand, Redux Toolkit) for game state, player info, socket connection.
    *   [ ] Re-implement board rendering using React components.
    *   [ ] Re-implement UI updates based on socket events using React state updates.
    *   [ ] Handle user input (clicks, flags) through React event handlers.
*   **UI/UX Polish:**
    *   [ ] Enhance visual design with modern styling (e.g., CSS Modules, Tailwind CSS, Styled Components).
    *   [ ] Add animations for game events (reveals, flags, explosions).
    *   [ ] Implement sound effects.
*   **Additional Features:**
    *   [ ] Custom game configuration options for players (e.g., board size, mine density).
    *   [ ] Chat system for multiplayer communication.
    *   [ ] Achievement system.

*(See [README.md](README.md) for project overview, features, and setup. See [SESSIONS.md](SESSIONS.md) for detailed development history.)*


