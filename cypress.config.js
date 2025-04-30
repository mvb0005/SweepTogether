// cypress.config.js
const { defineConfig } = require("cypress");

module.exports = defineConfig({
  e2e: {
    // Default baseUrl for Docker environment (using service name)
    // Can be overridden by CYPRESS_BASE_URL environment variable for local runs
    baseUrl: process.env.CYPRESS_BASE_URL || 'http://localhost:8080',
    setupNodeEvents(on, config) {
      // implement node event listeners here
    },
  },
});
