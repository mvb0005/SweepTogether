# Minesweeper Infinite TODO

## Player Sessions & Navigation (parked)

Prerequisite: Session 35 MongoDB persistence (done).

- [ ] **Player session tracking** — `sessions` collection with TTL index (60s), updated via `updateViewport` socket event (debounced ~500ms on client), deleted on disconnect
- [ ] **"Where is everyone?"** — `getActivePlayers` socket event returns `{ playerId, x, y }[]` for sessions active in last 30s; client renders minimap dots
- [ ] **Named locations / bookmarks** — `locations` collection with 2D index; `createLocation` / `getNearbyLocations` socket events; client UI to save and browse named spots
- [ ] **Jump to active area** — `getHotspot` socket event finds chunk with highest `updatedAt` in last hour; client pans to it
- [ ] **URL-based navigation** — wire `?x=N&y=N` query params to `ViewportProvider`'s `initialCenter`
- [ ] **Indexes**: TTL on `sessions.updatedAt`, 2D on `sessions.(gameId, loc)`, 2D on `locations.(gameId, loc)`

## Integration Tests as Sidecar

✅ Created dedicated integration test container infrastructure:
- `Dockerfile.integration-tests` - Containerized integration test environment
- `integration-tests/run-tests.sh` - Test runner with configurable parameters
- `docker-compose.sidecar-tests.yml` - Example deployment with sidecar tests

### How to Use Integration Tests

The integration test container can be deployed as a sidecar alongside your application to ensure deployed code is working properly. Key features:

1. **Standalone Container**: Tests run in an isolated environment
2. **Configurable**: Set target URL, retry parameters, and test patterns via environment variables
3. **Health Checks**: Waits for application readiness before running tests
4. **Reporting**: Generates HTML test reports in the mounted volume

### Running the Tests

```bash
# Run the full stack with integration tests
docker-compose -f docker-compose.sidecar-tests.yml up
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| TARGET_URL | URL of the app to test | http://nginx:80 |
| RETRY_COUNT | Number of attempts to connect | 3 |
| RETRY_INTERVAL | Seconds between retries | 10 |
| TEST_PATTERN | Glob pattern for test files | **/*.spec.js |
| REPORT_PATH | Path for test reports | /app/reports |
| DEBUG | Enable verbose output | false |

### Deployment Options

1. **One-time Validation**: Run tests once after deployment
2. **Scheduled Testing**: Keep container running and test on schedule
3. **CI/CD Integration**: Use as part of deployment pipeline

### Future Enhancements

- [ ] Add Prometheus metrics endpoint to expose test results
- [ ] Implement Slack/Teams notifications for test failures
- [ ] Add more comprehensive application tests
- [ ] Configure for Kubernetes deployment with helm chart

## Backend Code Review Action Items (Session 27)

Based on the code review conducted in Session 27, the following items need addressing:

-   **[Current Session] [Critical] Refactor `worldGenerator.ts` for Concurrency:**
    -   Modify `worldGenerator.ts` to encapsulate its state (RNG, noise function, caches) instead of using shared global variables.
    -   This could involve creating a class or factory function that returns a generator instance seeded per gameId.
    -   Update `GameStateService` to manage these per-game generator instances.
-   **[Medium] Add Linting/Formatting:**
    -   Install ESLint and Prettier (`npm install --save-dev eslint prettier eslint-config-prettier eslint-plugin-prettier @typescript-eslint/eslint-plugin @typescript-eslint/parser`).
    -   Configure ESLint (`.eslintrc.js`) and Prettier (`.prettierrc.js` or `package.json`).
    -   Add a `lint` script to `backend/package.json`.
    -   Run the linter and fix reported issues.
-   **[Low] Refactor `PlayerActionService` Result Handling:**
    -   Extract the common logic for handling `MineHitResult` (updating player status, score, grid, sending updates) into a private helper method.
    -   Extract the common logic for handling successful reveals (updating score, grid, sending updates) into another private helper method.
    -   Call these helpers from `handleRevealTile` and `handleChordClick`.
-   **[Low] Add Runtime Input Validation:**
    -   Install `zod` (`npm install zod`).
    -   Define Zod schemas for incoming socket event payloads (`RevealTilePayload`, `FlagTilePayload`, `ChordClickPayload`, etc.) likely in `src/infrastructure/network/socketEvents.ts` or a dedicated validation file.
    -   Use the schemas to parse and validate incoming data in `socketHandlers.ts` before publishing to the event bus. Emit errors for invalid data.
-   **[Future] Implement Authentication/Authorization:**
    -   Replace reliance on `socket.id` with a proper user authentication mechanism (e.g., JWT, sessions) when moving towards a production-ready system.