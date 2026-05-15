/**
 * Pre-generation tool: writes "SweepTogether" as 1-cell-wide mine strokes.
 *
 * Each font pixel maps to a cell position (spaced S cells apart).
 * Adjacent ON pixels are connected with a 1-cell-wide Bresenham line of mines.
 * The surrounding region is fully open background; no other mines are placed.
 *
 * Seam rules enforced and validated before every save:
 *   1. Outer face of any custom chunk bordering noise mirrors worldGen mine values.
 *   2. AdjacencyMines counts noise-world neighbours via worldGen.
 *
 * Run via: make pregen-text
 */

import { MongoClient } from 'mongodb';
import { WorldGenerator } from '../src/domain/worldGenerator';
import { ChunkRepository } from '../src/infrastructure/persistence/chunkRepository';
import { GameRepository } from '../src/infrastructure/persistence/gameRepository';

const MONGO_URL  = process.env.MONGO_URL  ?? 'mongodb://mongo_user:mongo_password@mongo:27017/?authSource=admin';
const DB_NAME    = process.env.DB_NAME    ?? 'minesweeper_infinite';
const GAME_ID    = process.env.GAME_ID    ?? 'default';
const WORLD_SEED = process.env.WORLD_SEED ?? GAME_ID;
const CS         = 16; // chunk size in cells

// ---------------------------------------------------------------------------
// Font  (5w × 7h).  'X' = mine pixel  '.' = background pixel
// ---------------------------------------------------------------------------

const LW = 5, LH = 7;

const FONT: Record<string, string[]> = {
  S: ['.XXX.', 'X....', 'X....', '.XXX.', '....X', '....X', '.XXX.'],
  W: ['X...X', 'X...X', 'X.X.X', 'X.X.X', 'X.X.X', '.X.X.', '.X.X.'],
  E: ['XXXXX', 'X....', 'X....', 'XXXX.', 'X....', 'X....', 'XXXXX'],
  P: ['XXXX.', 'X...X', 'X...X', 'XXXX.', 'X....', 'X....', 'X....'],
  T: ['XXXXX', '..X..', '..X..', '..X..', '..X..', '..X..', '..X..'],
  O: ['.XXX.', 'X...X', 'X...X', 'X...X', 'X...X', 'X...X', '.XXX.'],
  G: ['.XXX.', 'X....', 'X....', 'X..XX', 'X...X', 'X...X', '.XXX.'],
  H: ['X...X', 'X...X', 'X...X', 'XXXXX', 'X...X', 'X...X', 'X...X'],
  R: ['XXXX.', 'X...X', 'X...X', 'XXXX.', 'X.X..', 'X..X.', 'X...X'],
};

const TEXT = 'SWEEPTOGETHER';

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

const S           = 16; // cells per font-pixel step — sets letter size
const LETTER_GAP  = 2 * S; // cell gap between letters

const LETTER_CELL_W = (LW - 1) * S;  // 64 cells wide per letter
const LETTER_CELL_H = (LH - 1) * S;  // 96 cells tall per letter

// Total text span in cells
const TEXT_CELL_W = TEXT.length * LETTER_CELL_W + (TEXT.length - 1) * LETTER_GAP;

// Chunk region (text + PAD chunk padding on all sides)
const PAD_CHUNKS  = 2;
const PAD_CELLS   = PAD_CHUNKS * CS;
const REGION_W    = Math.ceil(TEXT_CELL_W / CS) + 2 * PAD_CHUNKS;   // chunks
const REGION_H    = Math.ceil(LETTER_CELL_H / CS) + 2 * PAD_CHUNKS; // chunks

const ORIG_CX = -Math.floor(REGION_W / 2); // centre around chunk 0
const ORIG_CY = -Math.floor(REGION_H / 2);

// Global cell origin where first letter starts
const TEXT_GX = ORIG_CX * CS + PAD_CELLS;
const TEXT_GY = ORIG_CY * CS + PAD_CELLS;

// ---------------------------------------------------------------------------
// Bresenham line (yields all integer cells on a line, inclusive)
// ---------------------------------------------------------------------------

function* bresenham(x0: number, y0: number, x1: number, y1: number): Generator<[number, number]> {
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  while (true) {
    yield [x0, y0];
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

// ---------------------------------------------------------------------------
// Build the set of global mine cells (letter strokes only)
// ---------------------------------------------------------------------------

function buildLetterMines(): Set<string> {
  const mines = new Set<string>();

  for (let i = 0; i < TEXT.length; i++) {
    const def = FONT[TEXT[i].toUpperCase()];
    if (!def) continue;

    const lx = TEXT_GX + i * (LETTER_CELL_W + LETTER_GAP);
    const ly = TEXT_GY;

    // Collect scaled positions of all ON pixels
    const on: Array<[number, number, number, number]> = []; // [row, col, gx, gy]
    for (let r = 0; r < def.length; r++)
      for (let c = 0; c < def[r].length; c++)
        if (def[r][c] === 'X')
          on.push([r, c, lx + c * S, ly + r * S]);

    // For each pair of 8-adjacent ON pixels, draw a Bresenham line between them
    for (let a = 0; a < on.length; a++) {
      for (let b = a + 1; b < on.length; b++) {
        const [r1, c1, gx1, gy1] = on[a];
        const [r2, c2, gx2, gy2] = on[b];
        if (Math.abs(r1 - r2) <= 1 && Math.abs(c1 - c2) <= 1) {
          for (const [gx, gy] of bresenham(gx1, gy1, gx2, gy2))
            mines.add(`${gx},${gy}`);
        }
      }
    }
  }

  return mines;
}

// ---------------------------------------------------------------------------
// Extend mine set: outer-face cells of edge chunks mirror worldGen (seam rule 1)
// ---------------------------------------------------------------------------

function applyOuterFaceSeam(mines: Set<string>, wg: WorldGenerator): void {
  for (let r = 0; r < REGION_H; r++) {
    for (let c = 0; c < REGION_W; c++) {
      const isEdge = r === 0 || r === REGION_H - 1 || c === 0 || c === REGION_W - 1;
      if (!isEdge) continue;
      const cx = ORIG_CX + c, cy = ORIG_CY + r;
      for (let ly = 0; ly < CS; ly++) {
        for (let lx = 0; lx < CS; lx++) {
          const outerFace =
            (r === 0          && ly === 0)       ||
            (r === REGION_H-1 && ly === CS - 1)  ||
            (c === 0          && lx === 0)       ||
            (c === REGION_W-1 && lx === CS - 1);
          if (!outerFace) continue;
          const gx = cx * CS + lx, gy = cy * CS + ly;
          if (wg.isMine(gx, gy)) mines.add(`${gx},${gy}`);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Determine if a global cell is a mine, given the pregenerated region
// ---------------------------------------------------------------------------

function isMineAt(gx: number, gy: number, mines: Set<string>, regionChunks: Set<string>, wg: WorldGenerator): boolean {
  const cKey = `${Math.floor(gx / CS)}_${Math.floor(gy / CS)}`;
  return regionChunks.has(cKey) ? mines.has(`${gx},${gy}`) : wg.isMine(gx, gy);
}

// ---------------------------------------------------------------------------
// Build the encoded buffer (0xFF = mine, 0–8 = adjacentMines) for one chunk
// ---------------------------------------------------------------------------

function buildBuffer(cx: number, cy: number, mines: Set<string>, regionChunks: Set<string>, wg: WorldGenerator): Uint8Array {
  const buf = new Uint8Array(CS * CS);
  for (let ly = 0; ly < CS; ly++) {
    for (let lx = 0; lx < CS; lx++) {
      const gx = cx * CS + lx, gy = cy * CS + ly;
      if (mines.has(`${gx},${gy}`)) {
        buf[ly * CS + lx] = 0xFF;
      } else {
        let adj = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++)
            if ((dx | dy) !== 0 && isMineAt(gx + dx, gy + dy, mines, regionChunks, wg)) adj++;
        buf[ly * CS + lx] = adj;
      }
    }
  }
  return buf;
}

// ---------------------------------------------------------------------------
// Seam validation: outer-face mine values must match worldGen
// ---------------------------------------------------------------------------

function validateSeam(buf: Uint8Array, cx: number, cy: number, regionChunks: Set<string>, wg: WorldGenerator): string[] {
  const errors: string[] = [];
  const faces = [
    { ncx: cx,   ncy: cy-1, cells: Array.from({length: CS}, (_, lx) => ({lx, ly: 0})) },
    { ncx: cx,   ncy: cy+1, cells: Array.from({length: CS}, (_, lx) => ({lx, ly: CS-1})) },
    { ncx: cx-1, ncy: cy,   cells: Array.from({length: CS}, (_, ly) => ({lx: 0, ly})) },
    { ncx: cx+1, ncy: cy,   cells: Array.from({length: CS}, (_, ly) => ({lx: CS-1, ly})) },
  ];
  for (const { ncx, ncy, cells } of faces) {
    if (regionChunks.has(`${ncx}_${ncy}`)) continue;
    for (const { lx, ly } of cells) {
      const bufMine   = buf[ly * CS + lx] === 0xFF;
      const worldMine = wg.isMine(cx * CS + lx, cy * CS + ly);
      if (bufMine !== worldMine)
        errors.push(`(${cx},${cy})→(${ncx},${ncy}) [${lx},${ly}]: buf=${bufMine?'mine':'open'} world=${worldMine?'mine':'open'}`);
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`\nBuilding "${TEXT}" with S=${S}, region ${REGION_W}×${REGION_H} chunks at (${ORIG_CX},${ORIG_CY})\n`);

  const mines = buildLetterMines();
  console.log(`Letter mine cells: ${mines.size}`);

  const client = new MongoClient(MONGO_URL);
  await client.connect();
  console.log(`Connected to MongoDB — writing chunks for game "${GAME_ID}"...\n`);

  try {
    const db       = client.db(DB_NAME);
    const repo     = new ChunkRepository(db.collection('chunks') as never);
    const gameRepo = new GameRepository(db.collection('games') as never);
    await gameRepo.createOrLoad(GAME_ID, { rows: 0, cols: 0, mines: 0, isInfiniteWorld: true });
    const wg = new WorldGenerator(WORLD_SEED);

    // Apply seam rule to outer-face cells
    applyOuterFaceSeam(mines, wg);

    // Build set of all chunk keys in this region (for isMineAt / validateSeam)
    const regionChunks = new Set<string>();
    for (let r = 0; r < REGION_H; r++)
      for (let c = 0; c < REGION_W; c++)
        regionChunks.add(`${ORIG_CX + c}_${ORIG_CY + r}`);

    // Generate, validate, and save each chunk
    let saved = 0, seamErrors = 0;
    for (let r = 0; r < REGION_H; r++) {
      for (let c = 0; c < REGION_W; c++) {
        const cx = ORIG_CX + c, cy = ORIG_CY + r;
        const buf = buildBuffer(cx, cy, mines, regionChunks, wg);

        const errs = validateSeam(buf, cx, cy, regionChunks, wg);
        if (errs.length > 0) {
          errs.forEach(e => console.error(`  SEAM ERROR: ${e}`));
          seamErrors += errs.length;
        }

        await repo.saveCustomChunk(GAME_ID, cx, cy, buf);
        saved++;
      }
    }

    if (seamErrors > 0) {
      console.error(`\n⚠  ${seamErrors} seam violation(s) — review above.`);
    } else {
      console.log(`All seams valid.`);
    }
    console.log(`Saved ${saved} chunks. Text centred around global (0,0).`);
    console.log(`Letter size: ${LETTER_CELL_W}×${LETTER_CELL_H} cells, stroke width: 1 cell.`);
  } finally {
    await client.close();
  }
}

main().catch((err: unknown) => {
  console.error('pregen-text failed:', err);
  process.exit(1);
});
