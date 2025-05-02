# Agent Context: Multiplayer Minesweeper

**Last Updated:** 2025-05-02

## 1. Project Overview & Goals
- **Goal:** Build a real-time, multiplayer Minesweeper game with an infinite, persistent world.
- **Current Focus:** Refactoring the backend for the infinite world model, specifically integrating `gridLogic.ts`, `worldGenerator.ts`, and `SpatialHashGrid.ts` into the service layer (`GameStateService`, `PlayerActionService`). See `TODO.md` for detailed tasks.

## 2. Technology Stack
- **Backend:** Node.js, TypeScript, Socket.IO, Jest, SimplexNoise.js, MongoDB (planned)
- **Frontend:** React, TypeScript, Vite, Socket.IO Client, CSS
- **Testing:** Jest (Unit), Cypress (E2E)
- **Infra:** Docker, Nginx

## 3. Architecture Highlights
- **Backend:** Event-driven (using `InMemoryEventBus`), Service-oriented (`src/application`), Domain-driven concepts (`src/domain`).
- **Infinite World:** Uses `worldGenerator.ts` (Simplex noise) for deterministic mine placement and `SpatialHashGrid.ts` (`src/domain/spatialHashGrid.ts`) managed by `GameStateService` (`src/application/gameStateService.ts`) to store revealed/flagged state.
- **Real-time:** Uses Socket.IO for client-server communication (`src/infrastructure/network/`).

## 4. Key Files & Folders
- **Backend Entry:** `src/infrastructure/network/server.ts`
- **Socket Handling:** `src/infrastructure/network/socketHandlers.ts`
- **Core Domain Logic:** `src/domain/` (esp. `gridLogic.ts`, `worldGenerator.ts`, `types.ts`)
- **State/Service Logic:** `src/application/` (esp. `gameStateService.ts`, `playerActionService.ts`)
- **Frontend Entry:** `frontend/src/main.tsx`
- **UI Components:** `frontend/src/components/`
- **Tests:** `backend/src/tests/`, `cypress/e2e/`
- **Agent Personas:** `agent_personas/`
- **Workflow Tracking:** `TODO.md`, `SESSIONS.md`, `SESSION_GUIDELINES.md`, `PLANNING.md`

## 5. Common Commands (from `/mnt/c/Users/mvb/code/Mines`)
- **Run Dev Env:** `docker-compose up --build`
- **Backend Tests:** `cd backend && npm test`
- **Backend Lint:** `cd backend && npm run lint` (Assuming this exists)
- **E2E Tests:** `npx cypress run` or `npx cypress open`

## 6. Coding Standards & Preferences
- Use TypeScript strict mode.
- Follow existing linting rules (ESLint/Prettier if configured).
- Prefer functional components and hooks in React.
- Use async/await for asynchronous operations.
- Add unit tests for new domain/service logic.

## 7. Testing Guidelines & Best Practices

- **Unit Test Structure:**
  - Document test scenarios at the top of each test file for better readability
  - Follow the AAA pattern (Arrange, Act, Assert) in individual test cases
  - Group related tests with descriptive `describe` blocks
  - Use clear test names that explain the expected behavior

- **Code Coverage:**
  - Run tests with coverage using `cd backend && npm test -- --coverage`
  - Target 90% statement coverage and 80% branch coverage for critical code
  - Use HTML reports in `backend/coverage/lcov-report/index.html` for detailed analysis
  - Don't chase coverage blindly - focus on meaningful test cases

- **Mocking Best Practices:**
  - Mock external dependencies (services, databases) but not the code under test
  - For event-driven services, extract handler functions through mock subscription calls
  - Verify behavior through function calls and parameters, not implementation details
  - Reset mocks between tests with `jest.clearAllMocks()` to prevent test pollution

- **Jest Commands:**
  - Run specific tests: `npm test -- --testPathPattern=filename.test.ts`
  - Run tests in watch mode: `npm test -- --watch`
  - Update snapshots: `npm test -- -u`

## 8. Agent Personas

Select the appropriate persona file based on the task. The **Prompt Engineering Expert** can be used to generate detailed prompts for other personas.

- [Prompt Engineering Expert](./agent_personas/prompt_engineering_expert.md)
- [Backend Developer](./agent_personas/backend_developer.md)
- [Frontend Developer](./agent_personas/frontend_developer.md)
- [Testing Expert](./agent_personas/testing_expert.md)
- [Persistence Expert](./agent_personas/persistence_expert.md)
- [DevOps Engineer](./agent_personas/devops_engineer.md)

## 9. Collaboration Workflow (Session-Based)

We use a structured, session-based workflow to track progress and maintain context. Refer to `PLANNING.md` for the overall project roadmap and `SESSION_GUIDELINES.md` for detailed instructions on session structure and ending procedures.

**Workflow Steps:**
1.  **Propose Goal:** The AI proposes a goal for the next session (a logically contained unit of work, often derived from `PLANNING.md`).
2.  **Confirm Goal:** The user confirms or modifies the goal.
3.  **Start Session:**
    *   AI edits `TODO.md` to mark the current session's goal.
    *   AI adopts the **Prompt Engineering Expert** persona to generate a detailed prompt for the session's task. This prompt includes:
        *   The working persona to adopt (e.g., Backend Developer).
        *   Specific context files to review (`AGENT_CONTEXT.md`, relevant persona files).
        *   Detailed, step-by-step instructions for the task.
        *   Verification steps (e.g., run tests, check errors).
        *   A reminder to consider context updates.
4.  **Execute Session:** AI executes the generated prompt, performing the task and verification.
5.  **End Session:**
    *   AI updates `SESSIONS.md` with a summary of actions, decisions, and outcomes.
    *   AI updates `AGENT_CONTEXT.md` and/or persona files if significant changes, decisions, or new patterns emerged.
    *   AI stages changes and creates a Git commit with a descriptive message (reflecting success or failure, e.g., `feat: Implement X (tests passing)` or `refactor: Start Y (tests failing)`).
    *   AI proposes the goal for the *next* session.

**Efficiency Considerations:**
*   **Context Accuracy:** Keep `AGENT_CONTEXT.md` and persona files up-to-date. Periodic "Context Review" sessions might be useful.
*   **Session Granularity:** Aim for logically contained but meaningful units of work. Adjust as needed.
*   **Error Handling:** Clearly log failures in `SESSIONS.md` and Git commits. The next session may need to address the failure.
*   **User Intent:** Clearly state high-level goals before prompt generation.
*   **Pre-computation/Analysis:** For complex tasks, consider a planning step where the AI first analyzes code and proposes a plan before generating the implementation prompt.

## 10. Session Guidelines & Documentation

The `SESSION_GUIDELINES.md` document provides detailed guidance on how to structure, execute, and document development sessions for this project. This document should be consulted when:

- **Starting a new session:** To understand the expected structure and planning approach
- **Ending a session:** To follow the proper procedure for documentation and handoff
- **Writing tests:** For guidance on test coverage expectations
- **Updating documentation:** For format and content guidelines

Key aspects covered in the guidelines include:
- Session structure (planning, implementation, testing, documentation)
- End-of-session procedures
- Test coverage expectations
- Documentation standards for session files
- Commit message conventions

Following these guidelines ensures consistency, maintains clear documentation of project progress, and facilitates knowledge transfer between sessions.
