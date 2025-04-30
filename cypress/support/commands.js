// ***********************************************
// This example commands.js shows you how to
// create various custom commands and overwrite
// existing commands.
//
// For more comprehensive examples of custom
// commands please read more here:
// https://on.cypress.io/custom-commands
// ***********************************************
//
//
// -- This is a parent command --
// Cypress.Commands.add('login', (email, password) => { ... })
//
//
// -- This is a child command --
// Cypress.Commands.add('drag', { prevSubject: 'element'}, (subject, options) => { ... })
//
//
// -- This is a dual command --
// Cypress.Commands.add('dismiss', { prevSubject: 'optional'}, (subject, options) => { ... })
//
//
// -- This will overwrite an existing command --
// Cypress.Commands.overwrite('visit', (originalFn, url, options) => { ... })

/**
 * Custom command to set up a game with a specific configuration before visiting the page.
 * @param {string} gameId - The unique identifier for the game.
 * @param {object} config - The game configuration object (e.g., { rows: number, cols: number, mines: number }).
 */
Cypress.Commands.add('setupGame', (gameId, config) => {
  // Separate mineLocations from the rest of the config for the request body structure
  const { mineLocations, ...restConfig } = config;
  const requestBody = {
      config: restConfig, // Send rows, cols, mines under 'config'
      ...(mineLocations && { mineLocations: mineLocations }) // Conditionally add 'mineLocations' at the top level
  };
  console.log('setupGame request body:', requestBody); // Log for debugging

  cy.request({
    method: 'POST',
    url: `/configure/${gameId}`,
    body: requestBody, // Send the structured body
    failOnStatusCode: false
  }).then((response) => {
    expect(response.status).to.eq(200);
  });

  // Visit the game page
  cy.visit(`/game/${gameId}`);
});