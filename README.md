# Multiplayer Minesweeper

A real-time, multiplayer version of the classic Minesweeper game, built with Node.js, Socket.IO, vanilla JavaScript, and Docker. Players compete on the same board to find mines first and earn points.

## Features

*   **Real-time Multiplayer:** See updates from other players instantly on the same board.
*   **Competitive Scoring:** Earn points for being the 1st, 2nd, or 3rd player to correctly flag a mine.
*   **Penalty System:** Lose points and face a temporary lockout for clicking on a mine.
*   **Delayed Mine Reveal:** Correctly flagged mines are only revealed to everyone after a short delay or once three players have flagged them.
*   **Classic Mechanics:** Includes standard Minesweeper actions like revealing cells, flagging mines, flood fill (for empty areas), and chord clicking (revealing neighbors of a numbered cell).
*   **Server-Authoritative:** All game logic is handled and validated server-side to prevent cheating.
*   **Containerized:** Easily run the entire application stack (backend, frontend, proxy) using Docker Compose.

*(For a detailed list of implemented features and future plans, see [TODO.md](TODO.md).)*

## Tech Stack

*   **Backend:** Node.js, TypeScript, Socket.IO
*   **Frontend:** Vanilla JavaScript, HTML, CSS
*   **Containerization:** Docker, Docker Compose
*   **Testing:** Cypress (for End-to-End tests)
*   **Proxy:** Nginx (within Docker setup)

## Running Locally

1.  **Prerequisites:**
    *   Docker Desktop (or Docker Engine + Docker Compose) installed.
2.  **Clone the repository (if you haven't already):**
    ```bash
    git clone <your-repository-url>
    cd Mines
    ```
3.  **Build and run the containers:**
    ```bash
    docker-compose up --build
    ```
    This command will build the Docker images for the backend, frontend, and Cypress tests (if not already built) and start the services.
4.  **Access the application:**
    Open your web browser and navigate to `http://localhost:8080`.

## Development Process

This project was developed iteratively over several sessions, primarily using AI assistance. The process involved:

1.  Initial setup of the project structure, Docker configuration, and basic WebSocket communication.
2.  Implementing core server-side game logic (board generation, player actions).
3.  Building the frontend UI and connecting it to the backend via WebSockets.
4.  Adding multiplayer features (shared board state, game rooms).
5.  Implementing advanced game mechanics (flood fill, chord click).
6.  Developing the scoring and penalty systems.
7.  Writing End-to-End tests using Cypress to verify functionality.
8.  Refactoring and improving code structure along the way.

*(Detailed notes on each development session can be found in [SESSIONS.md](SESSIONS.md).)*

## AI Assistance Disclaimer

This project was significantly developed with the assistance of AI programming agents within Visual Studio Code.

*   **VS Code Version:** 1.90.0
*   **AI Models Used (Agent Mode):**
    *   Google Gemini 2.5 Pro (Preview)
    *   Anthropic Claude 3.7 Sonnet

The AI was used for code generation, debugging, refactoring, explaining concepts, writing tests, and planning development steps. While the AI provided substantial contributions, the overall direction, requirements, and final integration were guided by the human developer.
