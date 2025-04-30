describe('Minesweeper App', () => {
  let gameId;

  beforeEach(() => {
    // Generate a unique, descriptive gameId for each test run
    const specName = Cypress.spec.name.replace('.cy.js', '');
    gameId = `e2e-${specName}-${Date.now()}`;

    // Visit the frontend URL with the specific gameId
    cy.visit(`/game/${gameId}`);
  });

  it('loads the homepage successfully', () => {
    // Check if the main elements are present
    cy.get('h1').should('contain', 'Multiplayer Minesweeper');
    cy.get('#board').should('be.visible');
    cy.get('#leaderboard').should('be.visible');
    cy.get('#chat').should('be.visible');

    // Check if the board has rendered initially (wait for hidden cells)
    cy.get('#board .cell.hidden', { timeout: 20000 }).should('have.length.greaterThan', 0);
  });
});