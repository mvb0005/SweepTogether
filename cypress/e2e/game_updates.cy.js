describe('Multiplayer Minesweeper - Game Updates', () => {
  let gameId; // Define gameId variable in the scope of the describe block

  beforeEach(() => {
    // Generate a unique, descriptive gameId for each test run
    const specName = Cypress.spec.name.replace('.cy.js', '');
    gameId = `e2e-${specName}-${Date.now()}`;

    // Visit the frontend URL with the specific gameId
    cy.visit(`/game/${gameId}`);

    // Wait for the initial board to render (presence of hidden cells)
    // This implicitly waits for socket connection, joinGame, and initial gameState
    cy.get('#board .cell.hidden', { timeout: 20000 }).should('have.length.greaterThan', 0);
  });

  it('should reveal a cell when clicked', () => {
    // Define the coordinates of the cell to click
    const targetRow = 0;
    const targetCol = 0;
    const targetCellSelector = `#board .cell[data-row="${targetRow}"][data-col="${targetCol}"]`;

    // 1. Ensure the target cell is initially hidden
    cy.get(targetCellSelector).should('have.class', 'hidden');

    // 2. Click the target cell
    cy.get(targetCellSelector).click();

    // 3. Wait for the update and assert the cell is no longer hidden
    cy.get(targetCellSelector, { timeout: 10000 })
      .should('not.have.class', 'hidden');

    // Optional: Add further assertions if possible, e.g., check if it has 'revealed'
    cy.get(targetCellSelector).should('have.class', 'revealed');

    // Optional: Check if leaderboard updates (if a score change is expected)
    // cy.get('#scores li').should('contain', 'some_expected_score_change');
  });

  // Add more tests here, e.g.:
  // - Test flagging a cell
  it('should toggle a flag on a hidden cell with right-click', () => {
    const targetRow = 1;
    const targetCol = 1;
    const targetCellSelector = `#board .cell[data-row="${targetRow}"][data-col="${targetCol}"]`;

    // 1. Ensure the target cell is initially hidden and not flagged
    cy.get(targetCellSelector).should('have.class', 'hidden').and('not.have.class', 'flagged');
    cy.get(targetCellSelector).should('not.contain.text', '🚩');

    // 2. Right-click the target cell to flag it
    cy.get(targetCellSelector).rightclick();

    // 3. Wait for update and assert it is flagged
    cy.get(targetCellSelector, { timeout: 5000 })
      .should('have.class', 'flagged')
      .and('contain.text', '🚩');
    // It should still be hidden visually (though DOM might change slightly)
    cy.get(targetCellSelector).should('have.class', 'hidden');

    // 4. Right-click again to unflag
    cy.get(targetCellSelector).rightclick();

    // 5. Wait for update and assert it is no longer flagged
    cy.get(targetCellSelector, { timeout: 5000 })
      .should('not.have.class', 'flagged')
      .and('not.contain.text', '🚩');
    cy.get(targetCellSelector).should('have.class', 'hidden');
  });

  // - Test clicking a mine results in a 'game over' state
  // Note: This requires knowing a mine location or a way to trigger game over reliably.
  // For now, we assume clicking (0,0) might hit a mine sometimes, but it's flaky.
  // A better approach involves controlling the board generation on the backend for tests.

  // - Test leaderboard updates correctly after scoring events (requires scoring logic)
});
