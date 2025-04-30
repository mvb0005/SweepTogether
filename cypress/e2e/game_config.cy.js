describe('Game Configuration Test', () => {
  it('should load a game with specific dimensions set via setupGame', () => {
    // Generate a unique gameId for this test run
    const gameId = `test-config-${Date.now()}`;
    const testConfig = {
      rows: 5,
      cols: 6,
      mines: 3
    };

    // Use the custom command to set up the game and visit the page
    cy.setupGame(gameId, testConfig);

    // Wait for the board to be rendered
    cy.get('#board').should('be.visible');

    // Assert the total number of cells matches rows * cols
    cy.get('#board .cell').should('have.length', testConfig.rows * testConfig.cols);

    // Assert CSS Grid properties (optional but more robust for grid layout)
    // Use the computed value that the browser returns
    const expectedColumns = Array(testConfig.cols).fill('30px').join(' ');
    cy.get('#board').should('have.css', 'grid-template-columns', expectedColumns);
    // Note: Checking grid-template-rows might be less reliable if using 'auto'
  });
});
