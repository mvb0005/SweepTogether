/**
 * Pre-generation tool: writes a perfect maze of connected rooms to MongoDB.
 *
 * Each chunk = one maze "room" (14×14 open interior, 1-cell mine walls on borders).
 * Adjacent rooms share a 3-cell-wide doorway (cols/rows 6–8) on each open passage.
 * The middle doorway cell always has adjacentMines=0, so ONE click floods the
 * entire maze.
 *
 * Run via Docker (requires the sweeptogether_minesweeper-net network):
 *   make pregen
 *
 * Or manually:
 *   docker run --rm \
 *     -v "$(pwd)/backend/src:/usr/src/app/src" \
 *     -v "$(pwd)/tools:/usr/src/app/tools" \
 *     --network sweeptogether_minesweeper-net \
 *     -e MONGO_URL="mongodb://mongo_user:mongo_password@mongo:27017/?authSource=admin" \
 *     -e DB_NAME="minesweeper_infinite" \
 *     -e GAME_ID="default" \
 *     sweeptogether-backend-test \
 *     node_modules/.bin/ts-node tools/pregen-chunks.ts
 */

import { MongoClient } from 'mongodb';
import { WorldGenerator } from '../src/domain/worldGenerator';
import { ChunkRepository } from '../src/infrastructure/persistence/chunkRepository';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MONGO_URL  = process.env.MONGO_URL  ?? 'mongodb://mongo_user:mongo_password@mongo:27017/?authSource=admin';
const DB_NAME    = process.env.DB_NAME    ?? 'minesweeper_infinite';
const GAME_ID    = process.env.GAME_ID    ?? 'default';
const WORLD_SEED = process.env.WORLD_SEED ?? GAME_ID;
const CHUNK_SIZE = 16;

// Maze dimensions and top-left chunk coordinate
const MAZE_COLS  = 7;
const MAZE_ROWS  = 7;
const ORIGIN_X   = -3; // chunk X of maze column 0
const ORIGIN_Y   = -3; // chunk Y of maze row 0
const MAZE_SEED  = 42; // deterministic; change for a different layout

// ---------------------------------------------------------------------------
// Maze generation (recursive backtracking, seeded LCG)
// ---------------------------------------------------------------------------

const NORTH = 1, SOUTH = 2, EAST = 4, WEST = 8;

function generateMaze(cols: number, rows: number, seed: number): number[][] {
  const passages: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const visited:  boolean[][] = Array.from({ length: rows }, () => new Array(cols).fill(false));

  let s = seed;
  function rand(): number {
    s = (Math.imul(s, 1664525) + 1013904223) | 0;
    return (s >>> 0) / 0x100000000;
  }

  const dirs = [
    { dr: -1, dc:  0, bit: NORTH, opp: SOUTH },
    { dr:  1, dc:  0, bit: SOUTH, opp: NORTH },
    { dr:  0, dc:  1, bit: EAST,  opp: WEST  },
    { dr:  0, dc: -1, bit: WEST,  opp: EAST  },
  ];

  function dfs(row: number, col: number): void {
    visited[row][col] = true;
    const shuffled = [...dirs].sort(() => rand() - 0.5);
    for (const { dr, dc, bit, opp } of shuffled) {
      const nr = row + dr, nc = col + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && !visited[nr][nc]) {
        passages[row][col] |= bit;
        passages[nr][nc]   |= opp;
        dfs(nr, nc);
      }
    }
  }

  dfs(0, 0);
  return passages;
}

function printMaze(passages: number[][], cols: number, rows: number): void {
  // Top border
  let top = '+';
  for (let c = 0; c < cols; c++) top += '---+';
  console.log(top);

  for (let r = 0; r < rows; r++) {
    // Cell row: left border + east walls
    let row = '|';
    for (let c = 0; c < cols; c++) {
      row += '   ';
      row += (passages[r][c] & EAST) ? ' ' : '|';
    }
    console.log(row);

    // South walls
    let south = '+';
    for (let c = 0; c < cols; c++) {
      south += (passages[r][c] & SOUTH) ? '   +' : '---+';
    }
    console.log(south);
  }
}

// ---------------------------------------------------------------------------
// Chunk mine layout
// ---------------------------------------------------------------------------

type ChunkLayout = number[][];

/**
 * Builds a 16×16 mine buffer for a single chunk.
 *
 * Border rule: cells on the outer ring (lx=0/15 or ly=0/15) are mines unless
 * they fall in the 3-wide doorway (cells 6,7,8) of an open passage.
 *
 * Why 3 cells wide? The middle cell (7) has eight neighbours; with a 3-cell
 * doorway all neighbours are also open, giving adjacentMines=0 so flood fill
 * propagates across the boundary.
 */
function makeRoomLayout(passageMask: number): ChunkLayout {
  const layout: ChunkLayout = Array.from({ length: CHUNK_SIZE }, () => new Array(CHUNK_SIZE).fill(0));

  for (let ly = 0; ly < CHUNK_SIZE; ly++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const onTop    = ly === 0;
      const onBottom = ly === CHUNK_SIZE - 1;
      const onLeft   = lx === 0;
      const onRight  = lx === CHUNK_SIZE - 1;
      if (!(onTop || onBottom || onLeft || onRight)) continue; // interior — no mine

      const inHDoor = lx >= 6 && lx <= 8; // doorway for top/bottom walls
      const inVDoor = ly >= 6 && ly <= 8; // doorway for left/right walls

      const hasDoor =
        (onTop    && (passageMask & NORTH) && inHDoor) ||
        (onBottom && (passageMask & SOUTH) && inHDoor) ||
        (onLeft   && (passageMask & WEST)  && inVDoor) ||
        (onRight  && (passageMask & EAST)  && inVDoor);

      layout[ly][lx] = hasDoor ? 0 : 1;
    }
  }
  return layout;
}

// ---------------------------------------------------------------------------
// Edge blending
// ---------------------------------------------------------------------------

/**
 * Overwrites cells on the section's outward boundary with noise so neighbouring
 * noise-generated chunks compute correct adjacentMines at the seam.
 *
 * Unlike a naive "override every edge chunk's outer ring", this targets only
 * the single row/column of cells that actually face the outside world, leaving
 * interior-facing sides of edge chunks untouched (and therefore preserving
 * maze doorways between edge chunks and their interior neighbours).
 */
function blendMines(
  col: number, row: number,          // position within maze grid
  chunkX: number, chunkY: number,
  authoredLayout: ChunkLayout,
  worldGen: WorldGenerator,
): Uint8Array {
  const mines = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
  for (let ly = 0; ly < CHUNK_SIZE; ly++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const globalX = chunkX * CHUNK_SIZE + lx;
      const globalY = chunkY * CHUNK_SIZE + ly;

      const facesOutside =
        (col === 0             && lx === 0)             ||
        (col === MAZE_COLS - 1 && lx === CHUNK_SIZE - 1)||
        (row === 0             && ly === 0)             ||
        (row === MAZE_ROWS - 1 && ly === CHUNK_SIZE - 1);

      mines[ly * CHUNK_SIZE + lx] = facesOutside
        ? (worldGen.isMine(globalX, globalY) ? 1 : 0)
        : authoredLayout[ly][lx];
    }
  }
  return mines;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const passages = generateMaze(MAZE_COLS, MAZE_ROWS, MAZE_SEED);

  console.log(`\nMaze (${MAZE_COLS}×${MAZE_ROWS}, seed=${MAZE_SEED}), chunk origin=(${ORIGIN_X},${ORIGIN_Y}):\n`);
  printMaze(passages, MAZE_COLS, MAZE_ROWS);

  const client = new MongoClient(MONGO_URL);
  await client.connect();
  console.log(`\nConnected to MongoDB — writing chunks for game "${GAME_ID}"...\n`);

  try {
    const db     = client.db(DB_NAME);
    const repo   = new ChunkRepository(db.collection('chunks') as never);
    const worldGen = new WorldGenerator(WORLD_SEED);

    let saved = 0;
    for (let row = 0; row < MAZE_ROWS; row++) {
      for (let col = 0; col < MAZE_COLS; col++) {
        const cx = ORIGIN_X + col;
        const cy = ORIGIN_Y + row;

        // Close passages that exit the section boundary (edge blending handles
        // the outer ring so the doorway cells would be noise anyway)
        let mask = passages[row][col];
        if (row === 0)             mask &= ~NORTH;
        if (row === MAZE_ROWS - 1) mask &= ~SOUTH;
        if (col === 0)             mask &= ~WEST;
        if (col === MAZE_COLS - 1) mask &= ~EAST;

        const layout = makeRoomLayout(mask);
        const mines  = blendMines(col, row, cx, cy, layout, worldGen);

        await repo.saveCustomChunk(GAME_ID, cx, cy, mines);

        const dirs: string[] = [];
        if (mask & NORTH) dirs.push('N');
        if (mask & SOUTH) dirs.push('S');
        if (mask & EAST)  dirs.push('E');
        if (mask & WEST)  dirs.push('W');
        console.log(`  chunk (${String(cx).padStart(2)}, ${String(cy).padStart(2)})  passages: ${dirs.join('') || '(dead end)'}`);
        saved++;
      }
    }

    console.log(`\nSaved ${saved} chunks. Navigate to (0,0) to find the maze entrance.`);
  } finally {
    await client.close();
  }
}

main().catch((err: unknown) => {
  console.error('pregen-chunks failed:', err);
  process.exit(1);
});
