// File: /mnt/c/Users/mvb/code/Mines/cypress/e2e/fixed_board.cy.js

describe('Fixed Board State Test', () => {
  it('should load and interact with a predefined 4x3 board state', () => {
    const gameId = `test-fixed-4x3-${Date.now()}`;

    // Board Layout:
    // Row 0: Mine, 1, 0
    // Row 1: 1   , 1, 0
    // Row 2: 1   , 1, 0
    // Row 3: Mine, 1, 0

    // Define mine locations instead
    const mineLocations = [
      { row: 0, col: 0 },
      { row: 3, col: 0 }
    ];

    const testConfig = {
      rows: 4,
      cols: 3,
      mines: 2,
      mineLocations: mineLocations // Added
    };

    // 1. Set up the game
    cy.setupGame(gameId, testConfig);

    // 2. Verify board dimensions
    cy.get('#board').should('be.visible');
    cy.get('#board .cell').should('have.length', testConfig.rows * testConfig.cols); // 4x3 = 12 cells
    cy.get('#board .cell[data-row="3"][data-col="2"]').should('exist'); // Check last cell exists

    // 3. Click cell (1, 1) and verify it reveals '1'
    cy.get('#board .cell[data-row="1"][data-col="1"]').click();
    cy.get('#board .cell[data-row="1"][data-col="1"]')
      .should('have.class', 'revealed')
      .and('contain.text', '1');

    // 4. Click cell (0, 2) and verify flood fill reveals the right two columns
    cy.get('#board .cell[data-row="0"][data-col="2"]').click();

    // Verify revealed cells from flood fill
    // Note: The expected text content might change slightly if adjacentMines calculation differs
    // based purely on mineLocations vs. the full initialBoard. Double-check assertions.
    const cellsToCheck = [
      { r: 0, c: 1, text: '1' }, { r: 0, c: 2, text: '' }, // Row 0
      { r: 1, c: 1, text: '1' }, { r: 1, c: 2, text: '' }, // Row 1
      { r: 2, c: 1, text: '1' }, { r: 2, c: 2, text: '' }, // Row 2
      { r: 3, c: 1, text: '1' }, { r: 3, c: 2, text: '' }  // Row 3
    ];

    cellsToCheck.forEach(({ r, c, text }) => {
      const cellSelector = `#board .cell[data-row="${r}"][data-col="${c}"]`;
      cy.get(cellSelector).should('have.class', 'revealed');
      if (text) {
        cy.get(cellSelector).should('contain.text', text);
      } else {
        cy.get(cellSelector).should('not.contain.text', '1'); // Ensure blank cells are blank
        cy.get(cellSelector).should('not.contain.text', '💣');
      }
    });

    // Verify mines remain hidden
    cy.get('#board .cell[data-row="0"][data-col="0"]').should('have.class', 'hidden');
    cy.get('#board .cell[data-row="3"][data-col="0"]').should('have.class', 'hidden');

    // 5. Flag the mine at (0, 0)
    cy.get('#board .cell[data-row="0"][data-col="0"]')
      .rightclick();
    cy.get('#board .cell[data-row="0"][data-col="0"]')
      .should('have.class', 'flagged')
      .and('contain.text', '🚩');

    // 6. Click the mine at (3, 0) to trigger game over
    cy.get('#board .cell[data-row="3"][data-col="0"]').click();

    // 7. Verify game over state - both mines revealed
    cy.get('#board .cell[data-row="0"][data-col="0"]') // The flagged mine
      .should('have.class', 'revealed')
      .and('have.class', 'mine')
      .and('contain.text', '💣');
    cy.get('#board .cell[data-row="3"][data-col="0"]') // The clicked mine
      .should('have.class', 'revealed')
      .and('have.class', 'mine')
      .and('contain.text', '💣');

    // 8. Verify a flood-filled cell remains revealed
    cy.get('#board .cell[data-row="2"][data-col="2"]')
      .should('have.class', 'revealed')
      .and('not.contain.text', '1'); // Should still be blank

    // Optional: Check for game over alert/message if implemented
    // cy.on('window:alert', (str) => {
    //   expect(str).to.contain('Game Over');
    // });
  });
});
