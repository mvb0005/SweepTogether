// File: cypress/e2e/chord_click.cy.js
describe('Chord Click Feature', () => {
  it('should reveal adjacent hidden cells when clicking a revealed number with matching adjacent flags', () => {
    const gameId = `test-chord-click-${Date.now()}`;

    // Board: (M=Mine, .=Hidden, 0-8=Revealed Number)
    // . . .
    // M . .
    // . . .
    // Click on (2, 0) after flagging (1,0). Should reveal (1,1) and (2,1).

    // Define mine locations
    const mineLocations = [
      { row: 1, col: 0 }
    ];

    const testConfig = {
      rows: 3,
      cols: 3,
      mines: 1,
      mineLocations: mineLocations // Added
    };

    cy.setupGame(gameId, testConfig);

    // --- Manual setup after initial load ---
    // Flag (1,0)
    cy.get('#board .cell[data-row="1"][data-col="0"]').rightclick();
    // Reveal (2,0)
    cy.get('#board .cell[data-row="2"][data-col="0"]').click();
    // --- End Manual setup ---

    // Verify initial state (flags, revealed numbers)
    cy.get('#board .cell[data-row="1"][data-col="0"]').should('have.class', 'flagged').and('contain.text', '🚩');
    cy.get('#board .cell[data-row="2"][data-col="0"]').should('have.class', 'revealed').and('contain.text', '1');
    cy.get('#board .cell[data-row="1"][data-col="1"]').should('have.class', 'hidden');
    cy.get('#board .cell[data-row="2"][data-col="1"]').should('have.class', 'hidden');

    // Click the revealed number '1' at (2, 0) again (Chord Click)
    cy.get('#board .cell[data-row="2"][data-col="0"]').click();

    // Assertions: Check which cells should be revealed by the chord click
    cy.get('#board .cell[data-row="1"][data-col="1"]').should('have.class', 'revealed').and('contain.text', '1'); // Adjacent to mine
    cy.get('#board .cell[data-row="2"][data-col="1"]').should('have.class', 'revealed').and('contain.text', '1'); // Adjacent to mine

    // Assertions: Check cells that should NOT be revealed or changed by the first chord click
    cy.get('#board .cell[data-row="0"][data-col="0"]').should('have.class', 'hidden');
    cy.get('#board .cell[data-row="0"][data-col="1"]').should('have.class', 'hidden');
    cy.get('#board .cell[data-row="0"][data-col="2"]').should('have.class', 'hidden');
    cy.get('#board .cell[data-row="1"][data-col="0"]').should('have.class', 'flagged'); // Flag should remain
    cy.get('#board .cell[data-row="1"][data-col="2"]').should('have.class', 'hidden');
    cy.get('#board .cell[data-row="2"][data-col="0"]').should('have.class', 'revealed'); // Original click target
    cy.get('#board .cell[data-row="2"][data-col="2"]').should('have.class', 'hidden');

    // --- Second Chord Click ---
    // Click the revealed number '1' at (1, 1)
    cy.log('Performing second chord click on (1, 1)');
    cy.get('#board .cell[data-row="1"][data-col="2"]').click();

    // Assertions: Check cells revealed by the second chord click
    // Board state should now be:
    // 1 1 0
    // F 1 0
    // 1 1 0
    cy.get('#board .cell[data-row="0"][data-col="0"]').should('have.class', 'hidden')
    cy.get('#board .cell[data-row="0"][data-col="1"]').should('have.class', 'revealed').and('contain.text', '1');
    cy.get('#board .cell[data-row="0"][data-col="2"]').should('have.class', 'revealed').and('contain.text', ''); // Should be 0 and revealed
    cy.get('#board .cell[data-row="1"][data-col="2"]').should('have.class', 'revealed').and('contain.text', ''); // Should be 0 and revealed
    cy.get('#board .cell[data-row="2"][data-col="2"]').should('have.class', 'revealed').and('contain.text', ''); // Should be 0 and revealed

    // Assertions: Check cells that should remain unchanged after the second chord click
    cy.get('#board .cell[data-row="1"][data-col="0"]').should('have.class', 'flagged'); // Flag should remain
    cy.get('#board .cell[data-row="1"][data-col="1"]').should('have.class', 'revealed'); // Second click target
    cy.get('#board .cell[data-row="2"][data-col="0"]').should('have.class', 'revealed'); // First click target
    cy.get('#board .cell[data-row="2"][data-col="1"]').should('have.class', 'revealed'); // Revealed by first chord click
  });

  // Add other tests for chord click (no-op, game over) here...
  it('should do nothing if flag count does not match the number', () => {
    const gameId = `test-chord-noop-${Date.now()}`;
    const mineLocations = [{ row: 1, col: 0 }];
    const testConfig = { rows: 3, cols: 3, mines: 1, mineLocations };
    cy.setupGame(gameId, testConfig);

    // Reveal (2,0) which is a '1'
    cy.get('#board .cell[data-row="2"][data-col="0"]').click();
    cy.get('#board .cell[data-row="2"][data-col="0"]').should('have.class', 'revealed').and('contain.text', '1');

    // No flags are set, so flag count (0) != cell number (1)
    // Chord click on (2,0) should do nothing
    cy.get('#board .cell[data-row="2"][data-col="0"]').click();

    // Assert that neighbors are still hidden
    cy.get('#board .cell[data-row="1"][data-col="0"]').should('have.class', 'hidden'); // Mine
    cy.get('#board .cell[data-row="1"][data-col="1"]').should('have.class', 'hidden');
    cy.get('#board .cell[data-row="2"][data-col="1"]').should('have.class', 'hidden');
  });

  it('should trigger game over if chord click reveals a mine', () => {
    // Board: (M=Mine, .=Hidden, 0-8=Revealed Number)
    // . . .
    // M . .
    // . . .
    // Flag (2,1) incorrectly, then click on (2,0) to reveal a number.
    // Then chord click (2,0) should trigger game over by revealing the mine at (1,0).
    
    const gameId = `test-chord-game-over-${Date.now()}`;
    const mineLocations = [
      { row: 1, col: 0 },
    ];
    const testConfig = {
      rows: 3,
      cols: 3,
      mines: 1,
      mineLocations
    };
    cy.setupGame(gameId, testConfig);
    
    // Flag (2,1) - This is an incorrect flag
    cy.get('#board .cell[data-row="2"][data-col="1"]').rightclick();
    
    // Reveal (2,0)
    cy.get('#board .cell[data-row="2"][data-col="0"]').click();
    
    // Verify initial state (flags, revealed numbers)
    cy.get('#board .cell[data-row="2"][data-col="0"]').should('have.class', 'revealed').and('contain.text', '1');
    cy.get('#board .cell[data-row="2"][data-col="1"]').should('have.class', 'flagged').and('contain.text', '🚩');
    cy.get('#board .cell[data-row="1"][data-col="0"]').should('have.class', 'hidden'); // Mine
    cy.get('#board .cell[data-row="1"][data-col="1"]').should('have.class', 'hidden');
    
    // Click the revealed number '1' at (2, 0) again (Chord Click)
    // This should reveal the mine at (1,0) because the flag at (2,1) is incorrect
    cy.get('#board .cell[data-row="2"][data-col="0"]').click();

    // Assertions: Check that game over is triggered via alert
    cy.on('window:alert', (str) => {
      expect(str).to.include('Game over');
    });

    // Assertions: Check that the whole board is revealed
    // Row 0
    cy.get('#board .cell[data-row="0"][data-col="0"]').should('have.class', 'revealed').and('contain.text', '1');
    cy.get('#board .cell[data-row="0"][data-col="1"]').should('have.class', 'revealed').and('contain.text', '1');
    cy.get('#board .cell[data-row="0"][data-col="2"]').should('have.class', 'revealed');
    
    // Row 1
    cy.get('#board .cell[data-row="1"][data-col="0"]')
      .should('have.class', 'revealed')
      .and('have.class', 'mine')
      .and('contain.text', '💣'); // The revealed mine
    
    cy.get('#board .cell[data-row="1"][data-col="1"]').should('have.class', 'revealed');
    cy.get('#board .cell[data-row="1"][data-col="2"]').should('have.class', 'revealed');
    
    // Row 2
    cy.get('#board .cell[data-row="2"][data-col="0"]').should('have.class', 'revealed'); // Original click
    
    // The incorrect flag should be revealed after game over
    cy.get('#board .cell[data-row="2"][data-col="1"]')
      .should('have.class', 'revealed')
      .and('not.have.class', 'flagged'); // Should no longer show as flagged after game over
    
    cy.get('#board .cell[data-row="2"][data-col="2"]').should('have.class', 'revealed');
  });
});
