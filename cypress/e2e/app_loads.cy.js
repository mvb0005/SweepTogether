describe('Minesweeper App', () => {
  let gameId;

  beforeEach(() => {
    // Generate a unique, descriptive gameId for each test run
    const specName = Cypress.spec.name.replace('.cy.js', '');
    gameId = `e2e-${specName}-${Date.now()}`;

    // Configure a game with default settings
    cy.setupGame(gameId, {
      rows: 10,
      cols: 10,
      mines: 15
    });
  });

  it('loads the homepage successfully', () => {
    // Check if the main elements are present
    cy.get('h1').should('contain', 'Multiplayer Minesweeper');
    
    // Using the correct board selector - since we know it's in a div after h2 that says "Board"
    cy.contains('h2', 'Board').should('be.visible');
    
    // Check for players section
    cy.contains('h2', 'Players').should('be.visible');
    
    // Check for leaderboard section
    cy.contains('h2', 'Leaderboard').should('be.visible');
    
    // Check if the board has rendered initially (wait for cells to appear)
    cy.get('.cell', { timeout: 20000 }).should('have.length.greaterThan', 0);
  });
});