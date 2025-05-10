import { GameState, Cell } from '../domain/types';
import { GetCellFunction } from '../domain/game';

/**
 * A collection of fun adjectives for generating player names
 */
const adjectives = [
  'Brave', 'Swift', 'Clever', 'Mighty', 'Lucky', 'Sneaky', 'Dancing', 
  'Jumping', 'Flying', 'Dashing', 'Glowing', 'Curious', 'Witty', 'Nimble',
  'Cheerful', 'Bouncy', 'Sparkly', 'Fuzzy', 'Dazzling', 'Wild', 'Jolly',
  'Quirky', 'Mellow', 'Wise', 'Spunky', 'Zippy', 'Zany', 'Snazzy', 'Crafty'
];

/**
 * A collection of fun animals for generating player names
 */
const animals = [
  'Panda', 'Tiger', 'Eagle', 'Dolphin', 'Fox', 'Wolf', 'Owl', 'Penguin',
  'Koala', 'Raccoon', 'Elephant', 'Giraffe', 'Lion', 'Monkey', 'Squirrel',
  'Kangaroo', 'Hedgehog', 'Octopus', 'Chameleon', 'Panther', 'Flamingo',
  'Narwhal', 'Unicorn', 'Dragon', 'Phoenix', 'Sloth', 'Otter', 'Llama',
  'Walrus', 'Badger', 'Platypus', 'Wombat', 'Axolotl', 'Capybara', 'Dolphin',
];

/**
 * Generate a random fun name combining an adjective and an animal
 */
export function generateRandomName(): string {
  const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const animal = animals[Math.floor(Math.random() * animals.length)];
  return `${adjective}${animal}`;
}

/**
 * Generates a text-based representation of a portion of the game board.
 * @param gameState The current game state.
 * @param getCellFn The function to retrieve cell data.
 * @param centerX The center x-coordinate of the view.
 * @param centerY The center y-coordinate of the view.
 * @param viewWidth The width of the view (number of cells).
 * @param viewHeight The height of the view (number of cells).
 * @returns A promise resolving to a string representing the board section.
 */
export async function generateBoardTextRepresentation(
    gameState: GameState,
    getCellFn: GetCellFunction,
    centerX: number,
    centerY: number,
    viewWidth: number,
    viewHeight: number
): Promise<string> {
    let output = '';
    
    // Calculate the start and end coordinates for the view
    const startX = centerX - Math.floor((viewWidth - 1) / 2);
    const endX = centerX + Math.floor(viewWidth / 2);
    const startY = centerY - Math.floor((viewHeight - 1) / 2);
    const endY = centerY + Math.floor(viewHeight / 2);

    for (let y = startY; y < endY; y++) { // Loop up to endY (exclusive)
        let rowString = '';
        for (let x = startX; x < endX; x++) { // Loop up to endX (exclusive)
            const cell = await getCellFn(gameState, x, y);
            if (cell?.isMine) {
                rowString += ' M ';
            } else {
                // Use a space for 0, otherwise the number
                rowString += ` ${cell?.adjacentMines === 0 ? ' ' : cell?.adjacentMines} `;
            }
        }
        output += rowString + '\n';
    }
    return output;
}

/**
 * Prints a portion of the generated world grid to the console for testing/visualization.
 * @param width The width of the grid section to print.
 * @param height The height of the grid section to print.
 * @param startX The starting X coordinate (top-left corner).
 * @param startY The starting Y coordinate (top-left corner).
 */
/*
export function printTestGrid(width: number, height: number, startX: number = 0, startY: number = 0): void {
    console.log(`--- Test Grid (${width}x${height}) starting at (${startX}, ${startY}) ---`);
  console.log("NOTE: printTestGrid currently cannot display cell values due to worldGenerator refactoring.");
    for (let y = startY; y < startY + height; y++) {
        let rowString = '';
        for (let x = startX; x < startX + width; x++) {
          rowString += '?? '; // Placeholder for unknown value
        }
        console.log(rowString);
    }
    console.log('------------------------------------------');
}
*/