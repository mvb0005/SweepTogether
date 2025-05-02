import { getCellValue } from './worldGenerator';

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
 * Prints a portion of the generated world grid to the console for testing/visualization.
 * @param width The width of the grid section to print.
 * @param height The height of the grid section to print.
 * @param startX The starting X coordinate (top-left corner).
 * @param startY The starting Y coordinate (top-left corner).
 */
export function printTestGrid(width: number, height: number, startX: number = 0, startY: number = 0): void {
    console.log(`--- Test Grid (${width}x${height}) starting at (${startX}, ${startY}) ---`);
    for (let y = startY; y < startY + height; y++) {
        let rowString = '';
        for (let x = startX; x < startX + width; x++) {
            const value = getCellValue(x, y);
            // Add padding for alignment
            const displayValue = typeof value === 'number' ? value.toString() : value;
            rowString += displayValue.padStart(2, ' ') + ' ';
        }
        console.log(rowString);
    }
    console.log('------------------------------------------');
}