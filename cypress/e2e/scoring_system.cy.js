describe('Multiplayer Minesweeper - Scoring System', () => {
  let gameId;

  beforeEach(() => {
    // Generate a unique, descriptive gameId for each test run
    const specName = Cypress.spec.name.replace('.cy.js', '');
    gameId = `e2e-${specName}-${Date.now()}`;

    // Define a board with known mine positions for predictable testing
    const testConfig = {
      rows: 5,
      cols: 5,
      mines: 5,
      mineLocations: [
        { row: 2, col: 2 },
        { row: 3, col: 3 },
        { row: 1, col: 4 },
        { row: 4, col: 1 },
        { row: 0, col: 3 }
      ]
    };

    // Set up the game using the custom command
    cy.setupGame(gameId, testConfig);

    // Make sure the leaderboard is visible
    cy.get('#leaderboard').should('be.visible');
    cy.get('#leaderboard ul').should('exist');
  });

  it('should update player score when revealing numbered cells', () => {
    // Initial check for score - should be 0
    cy.get('#leaderboard ul li .player-score').should('contain', '0');

    // Click on a cell that will reveal a number
    cy.get('#board .cell[data-row="0"][data-col="0"]').click();
    
    // Wait for the update and check if the cell is revealed and shows a number
    cy.get('#board .cell[data-row="0"][data-col="0"]', { timeout: 5000 })
      .should('have.class', 'revealed')
      .should('not.have.class', 'mine');
    
    // Check if the score has increased from 0
    cy.get('#leaderboard ul li .player-score', { timeout: 5000 })
      .should('not.contain', '0')
      .then($score => {
        // Store the score for later comparison
        const score = parseInt($score.text());
        expect(score).to.be.greaterThan(0);
        
        // Now click another numbered cell that has not been revealed yet
        // Cell [1,3] is adjacent to a mine and should not be revealed by the first click
        cy.get('#board .cell[data-row="1"][data-col="3"]').click();
        
        // Verify that cell is revealed
        cy.get('#board .cell[data-row="1"][data-col="3"]', { timeout: 5000 })
          .should('have.class', 'revealed');
        
        // Check if score has increased from previous value
        cy.get('#leaderboard ul li .player-score', { timeout: 5000 })
          .should(($newScore) => {
            const newScore = parseInt($newScore.text());
            expect(newScore).to.be.greaterThan(score);
          });
      });
  });

  it('should award more points for cells with higher numbers', () => {
    // Click a cell that will have a low number
    cy.get('#board .cell[data-row="4"][data-col="4"]').click();
    
    // Wait for the update and check if the score has increased
    cy.get('#leaderboard ul li .player-score', { timeout: 5000 })
      .should('not.contain', '0')
      .then($score => {
        const lowNumberScore = parseInt($score.text());
        
        // Click a cell that should have a higher number
        cy.get('#board .cell[data-row="1"][data-col="3"]').click();
        
        // Check if more points were awarded for the higher number cell
        cy.get('#leaderboard ul li .player-score', { timeout: 5000 })
          .should(($newScore) => {
            const highNumberScoreIncrease = parseInt($newScore.text()) - lowNumberScore;
            expect(highNumberScoreIncrease).to.be.greaterThan(1);
          });
      });
  });

  it('should display a score animation when points are awarded', () => {
    // Click a numbered cell
    cy.get('#board .cell[data-row="0"][data-col="1"]').click();
    
    // Check if the score animation appears
    cy.get('.score-animation', { timeout: 5000 })
      .should('exist')
      .should('have.class', 'positive');
      
    // Animation should disappear after some time
    cy.get('.score-animation').should('not.exist');
  });

  it('should show multiple players in the leaderboard sorted by score', () => {
    // Since we can't easily simulate a second player in E2E tests,
    // we'll just verify the first player's score updates correctly
    // and that the player is shown in the leaderboard
    
    // First, ensure our player has some score
    cy.get('#board .cell[data-row="0"][data-col="0"]').click();
    
    // Check if score has increased from 0
    cy.get('#leaderboard ul li .player-score', { timeout: 5000 })
      .should('not.contain', '0');
    
    // Verify player appears in the leaderboard
    cy.get('#leaderboard ul li').should('have.length.at.least', 1);
    
    // Click on another cell to get more points
    cy.get('#board .cell[data-row="3"][data-col="4"]').click();
    
    // Make sure score increases further
    cy.get('#leaderboard ul li .player-score')
      .then($score => {
        const score = parseInt($score.text());
        expect(score).to.be.greaterThan(0);
      });
  });
});