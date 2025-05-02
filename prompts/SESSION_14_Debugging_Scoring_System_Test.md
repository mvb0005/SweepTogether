# Session 14: Debugging Scoring System Test

**NOTE: The original prompt for this session is not available.**

## Session Notes

In this session, we fixed a failing test in the `scoring_system.cy.js` file related to how points are awarded for revealing cells.

### Issue Analysis

- Identified the issue in the `scoring_system.cy.js` test where it expected points to increase when clicking on already revealed cells
- Analyzed the test's expectations and the current implementation of the scoring system
- Determined that the issue was in the test itself rather than the backend implementation, which correctly only awards points for newly revealed cells

### Test Fix

- Modified the test to click on cell [1,3] for the second click instead of [1,0]
- This change was necessary because cell [1,0] would have already been revealed by the first click's flood fill
- Cell [1,3] is a numbered cell that wasn't already revealed, properly testing the scoring system

### Outcome

- The fix ensures that each click in the test reveals a new numbered cell
- This properly tests the scoring system without changing the backend behavior
- Confirms that the scoring logic correctly awards points only for newly revealed cells

This session highlighted the importance of understanding both the test expectations and the underlying system behavior when debugging test failures.