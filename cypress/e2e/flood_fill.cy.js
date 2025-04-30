// File: cypress/e2e/flood_fill.cy.js
describe('Flood Fill Feature', () => {
  it('should reveal adjacent blank and numbered cells when a blank cell is clicked', () => {
    const gameId = `test-flood-fill-${Date.now()}`;

    // Board: (M=Mine, .=Hidden)
    // Calculated adjacent mines:
    // 0 0 0 0
    // 0 1 1 1
    // 0 1 M 1
    // 0 1 1 1
    // Click on (0, 3) should reveal a large area based on flood fill.

    // Define mine locations
    const mineLocations = [
      { row: 2, col: 2 }
    ];

    const testConfig = {
      rows: 4,
      cols: 4,
      mines: 1,
      mineLocations: mineLocations
    };

    cy.setupGame(gameId, testConfig);

    // Click the blank cell at (0, 3)
    cy.get('#board .cell[data-row="0"][data-col="3"]').click();

    // --- Assertions updated based on corrected flood fill behavior ---

    // Row 0: All revealed, all blank (0)
    cy.get('#board .cell[data-row="0"][data-col="0"]').should('have.class', 'revealed').and('not.contain.text');
    cy.get('#board .cell[data-row="0"][data-col="1"]').should('have.class', 'revealed').and('not.contain.text');
    cy.get('#board .cell[data-row="0"][data-col="2"]').should('have.class', 'revealed').and('not.contain.text');
    cy.get('#board .cell[data-row="0"][data-col="3"]').should('have.class', 'revealed').and('not.contain.text'); // Clicked cell

    // Row 1: All revealed: blank (0), '1', '1', '1'
    cy.get('#board .cell[data-row="1"][data-col="0"]').should('have.class', 'revealed').and('not.contain.text'); // Blank
    cy.get('#board .cell[data-row="1"][data-col="1"]').should('have.class', 'revealed').and('contain.text', '1');
    cy.get('#board .cell[data-row="1"][data-col="2"]').should('have.class', 'revealed').and('contain.text', '1');
    cy.get('#board .cell[data-row="1"][data-col="3"]').should('have.class', 'revealed').and('contain.text', '1'); // Revealed by flood fill boundary

    // Row 2: blank (0), '1', hidden (mine), '1'
    cy.get('#board .cell[data-row="2"][data-col="0"]').should('have.class', 'revealed').and('not.contain.text'); // Blank
    cy.get('#board .cell[data-row="2"][data-col="1"]').should('have.class', 'revealed').and('contain.text', '1');
    cy.get('#board .cell[data-row="2"][data-col="2"]').should('have.class', 'hidden'); // Mine
    cy.get('#board .cell[data-row="2"][data-col="3"]').should('have.class', 'hidden'); // Adjacent to mine, not reached by flood fill

    // Row 3: blank (0), '1', hidden, hidden
    cy.get('#board .cell[data-row="3"][data-col="0"]').should('have.class', 'revealed').and('not.contain.text'); // Blank
    cy.get('#board .cell[data-row="3"][data-col="1"]').should('have.class', 'revealed').and('contain.text', '1');
    cy.get('#board .cell[data-row="3"][data-col="2"]').should('have.class', 'hidden'); // Adjacent to mine, not reached by flood fill
    cy.get('#board .cell[data-row="3"][data-col="3"]').should('have.class', 'hidden'); // Adjacent to mine, not reached by flood fill
  });
});
