# Session 4: E2E Test Setup with Cypress

**NOTE: The original prompt for this session is not available.**

## Session Notes

In this session, we set up Cypress for End-to-End testing and resolved several initial execution errors.

### Cypress Installation and Configuration

- Installed Cypress (`npm install --save-dev cypress`)
- Initialized npm in the root directory (`npm init -y`) as it was missing
- Initialized Cypress (`npx cypress open`), creating `cypress.config.js` and the `cypress/` directory structure
- Configured `baseUrl` in `cypress.config.js` to `http://localhost:8080` to match the frontend service exposed by Docker Compose

### Test Spec Creation

- Created basic test specifications:
  - `cypress/e2e/app_loads.cy.js`: Verify the application loads correctly
  - `cypress/e2e/game_updates.cy.js`: Test game state updates

### Error Resolution

- Encountered `Cannot find module 'cypress'` error due to missing root `package.json`
  - Resolved by running `npm init -y` and reinstalling Cypress
- Encountered `ReferenceError: io is not defined` because Nginx wasn't proxying Socket.IO requests
  - Resolved by adding `frontend/nginx.conf` and updating `frontend/Dockerfile`

This session established the foundation for automated end-to-end testing, ensuring that we can verify the application's functionality from the user's perspective through browser-based tests.