/**
 * Pre-generation tool for custom chunk layouts.
 *
 * PROTOTYPE: mine layout and chunk coordinates are hard-coded below.
 * Real usage would accept a JSON config file, e.g.:
 *   ts-node tools/pregen-chunks.ts --config path/to/layout.json
 *
 * Run with:
 *   ts-node tools/pregen-chunks.ts
 */

import { MongoClient } from 'mongodb';
import { WorldGenerator } from '../backend/src/domain/worldGenerator';
import { ChunkRepository } from '../backend/src/infrastructure/persistence/chunkRepository';

// ---------------------------------------------------------------------------
// Config — edit this section or replace with JSON config file parsing
// ---------------------------------------------------------------------------

const MONGO_URL = process.env.MONGO_URL ?? 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME ?? 'sweeptogether';
const COLLECTION_NAME = 'chunks';
const GAME_ID = process.env.GAME_ID ?? 'default';
const WORLD_SEED = process.env.WORLD_SEED ?? GAME_ID;
const CHUNK_SIZE = 16;

type ChunkLayout = number[][]; // 16×16 array of 0 (open) or 1 (mine)

/**
 * Prototype authored layout: all cells open (no mines).
 * Real usage would load this from a JSON file or per-chunk definition.
 */
function makeEmptyLayout(): ChunkLayout {
  return Array.from({ length: CHUNK_SIZE }, () => new Array<number>(CHUNK_SIZE).fill(0));
}

/**
 * Prototype config: a 3×3 block of custom chunks starting at chunk (0,0).
 * Each chunk uses the same empty layout for demonstration purposes.
 */
const CUSTOM_SECTION = {
  startChunkX: 0,
  startChunkY: 0,
  widthInChunks: 3,
  heightInChunks: 3,
  getLayout: (_chunkX: number, _chunkY: number): ChunkLayout => makeEmptyLayout(),
};

// ---------------------------------------------------------------------------
// Edge blending
// ---------------------------------------------------------------------------

/**
 * Edge blending rule:
 * - Interior chunks (not on the outer ring of the custom section): all cells from authored layout.
 * - Edge chunks (on the outer ring): interior cells (1..14, 1..14) from authored layout,
 *   outer ring cells (x=0, x=15, y=0, y=15) from worldGenerator.isMine(globalX, globalY).
 */
function blendMines(
  chunkX: number,
  chunkY: number,
  chunkSize: number,
  authoredLayout: ChunkLayout,
  worldGen: WorldGenerator,
  isEdgeChunk: boolean
): Uint8Array {
  const mines = new Uint8Array(chunkSize * chunkSize);
  for (let ly = 0; ly < chunkSize; ly++) {
    for (let lx = 0; lx < chunkSize; lx++) {
      const globalX = chunkX * chunkSize + lx;
      const globalY = chunkY * chunkSize + ly;
      const isOnOuterRing = lx === 0 || lx === chunkSize - 1 || ly === 0 || ly === chunkSize - 1;
      if (isEdgeChunk && isOnOuterRing) {
        mines[ly * chunkSize + lx] = worldGen.isMine(globalX, globalY) ? 1 : 0;
      } else {
        mines[ly * chunkSize + lx] = authoredLayout[ly][lx];
      }
    }
  }
  return mines;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  console.log(`Connected to MongoDB at ${MONGO_URL}`);

  try {
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);
    const repo = new ChunkRepository(collection as never);
    const worldGen = new WorldGenerator(WORLD_SEED);

    const { startChunkX, startChunkY, widthInChunks, heightInChunks, getLayout } = CUSTOM_SECTION;
    const endChunkX = startChunkX + widthInChunks - 1;
    const endChunkY = startChunkY + heightInChunks - 1;

    let saved = 0;
    for (let cy = startChunkY; cy <= endChunkY; cy++) {
      for (let cx = startChunkX; cx <= endChunkX; cx++) {
        const isEdgeChunk =
          cx === startChunkX || cx === endChunkX ||
          cy === startChunkY || cy === endChunkY;

        const layout = getLayout(cx, cy);
        const mines = blendMines(cx, cy, CHUNK_SIZE, layout, worldGen, isEdgeChunk);

        await repo.saveCustomChunk(GAME_ID, cx, cy, mines);
        console.log(`  Saved chunk (${cx}, ${cy}) [${isEdgeChunk ? 'edge' : 'interior'}]`);
        saved++;
      }
    }

    console.log(`Done. Saved ${saved} custom chunk(s) for game "${GAME_ID}".`);
  } finally {
    await client.close();
  }
}

main().catch((err: unknown) => {
  console.error('pregen-chunks failed:', err);
  process.exit(1);
});
