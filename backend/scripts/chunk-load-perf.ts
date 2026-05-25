/**
 * Chunk load + flood-fill benchmark against a running backend (no mocks).
 *
 * Sustained fill+pan (default): fresh game, mega-fill verify, reveal while panning, Mongo check
 *   npm run perf:chunks:sustained
 *   PERF_DURATION_SEC=60 npm run perf:chunks:sustained
 *
 * Burst peak throughput:
 *   npm run perf:chunks:burst
 *
 * Fill-only check (+ Mongo persistence):
 *   npm run perf:chunks:fill
 *
 * Marathon (5 clients × 10 min): fresh shared game, reveal while panning, Mongo check
 *   npm run perf:chunks:marathon
 *   PERF_DURATION_SEC=60 PERF_CLIENTS=2 npm run perf:chunks:marathon
 *
 * Mega-fill on pregen text (requires make pregen-text, game "default"):
 *   PERF_FILL_GAME_ID=default PERF_REVEAL_CHUNK_X=-5 PERF_REVEAL_CHUNK_Y=-5 PERF_MIN_FILL_CELLS=50000 npm run perf:chunks:fill
 */

import { io, Socket } from 'socket.io-client';
import { MongoClient } from 'mongodb';

interface ChunkCoord {
  chunkX: number;
  chunkY: number;
}

interface WireChunk {
  gameId: string;
  chunkX: number;
  chunkY: number;
  size: number;
  revealed?: number[];
  revealedMines?: number[];
}

interface ScenarioResult {
  name: string;
  chunks: number;
  batches: number;
  totalMs: number;
  chunksPerSec: number;
  msPerChunk: number;
  missing: number;
}

interface FillResult {
  name: string;
  revealX: number;
  revealY: number;
  revealedCells: number;
  chunkUpdates: number;
  fillMs: number;
  passed: boolean;
}

interface SustainedResult {
  name: string;
  durationSec: number;
  clients: number;
  steps: number;
  requested: number;
  received: number;
  sustainedChunksPerSec: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  latencyMaxMs: number;
  errors: number;
  missing: number;
  fill?: FillResult;
  subscribeFillCells: number;
  clientResults?: ClientPanResult[];
}

interface ClientPanResult extends Omit<SustainedResult, 'name' | 'clients' | 'fill' | 'clientResults'> {
  clientIndex: number;
  originX: number;
  originY: number;
  direction: PanDirection;
  revealsAttempted: number;
}

interface PersistSnapshot {
  chunks: number;
  chunksWithReveals: number;
  revealedCells: number;
  pendingFillDocs: number;
}

type PanDirection = 'east' | 'west' | 'north' | 'south';

interface ClientConfig {
  originX: number;
  originY: number;
  direction: PanDirection;
}

const MARATHON_CLIENTS: ClientConfig[] = [
  { originX: 50_000, originY: 50_000, direction: 'east' },
  { originX: -50_000, originY: 50_000, direction: 'west' },
  { originX: 50_000, originY: -50_000, direction: 'north' },
  { originX: -50_000, originY: -50_000, direction: 'south' },
  { originX: 80_000, originY: 80_000, direction: 'east' },
];

const BACKEND_URL = process.env.PERF_BACKEND_URL ?? 'http://localhost:3001';
const MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://mongo_user:mongo_password@localhost:27017/minesweeper_infinite?authSource=admin';
const CHUNK_COUNT = parseInt(process.env.PERF_CHUNK_COUNT ?? '400', 10);
const BATCH_SIZE = parseInt(process.env.PERF_BATCH_SIZE ?? '100', 10);
const ORIGIN_X = parseInt(process.env.PERF_ORIGIN_X ?? '50000', 10);
const ORIGIN_Y = parseInt(process.env.PERF_ORIGIN_Y ?? '50000', 10);
const CONNECT_TIMEOUT_MS = parseInt(process.env.PERF_CONNECT_TIMEOUT_MS ?? '10000', 10);
const LOAD_TIMEOUT_MS = parseInt(process.env.PERF_LOAD_TIMEOUT_MS ?? '120000', 10);
const JSON_OUTPUT = process.env.PERF_JSON === '1';

const MODE = process.argv[2] ?? 'sustained';
const IS_MARATHON = MODE === 'marathon';

const DURATION_SEC = parseFloat(process.env.PERF_DURATION_SEC ?? (IS_MARATHON ? '600' : '30'));
const STEP_MS = parseInt(process.env.PERF_STEP_MS ?? '150', 10);
const STEP_CHUNKS = parseInt(process.env.PERF_STEP_CHUNKS ?? '40', 10);
const STEP_BAND = parseInt(process.env.PERF_STEP_BAND ?? '6', 10);
const MAX_SUBSCRIBED = parseInt(process.env.PERF_MAX_SUBSCRIBED ?? '500', 10);
const CLIENTS = parseInt(process.env.PERF_CLIENTS ?? (IS_MARATHON ? '5' : '1'), 10);
const WAVE_TIMEOUT_MS = parseInt(process.env.PERF_WAVE_TIMEOUT_MS ?? (IS_MARATHON ? '60000' : '30000'), 10);
const PROGRESS_INTERVAL_MS = parseInt(process.env.PERF_PROGRESS_INTERVAL_MS ?? '60000', 10);
const SKIP_FILL = process.env.PERF_SKIP_FILL === '1';
const SHARED_GAME_ID = process.env.PERF_GAME_ID ?? '';
const MARATHON_REVEAL = process.env.PERF_MARATHON_REVEAL !== '0';
const REVEAL_EVERY_STEP = process.env.PERF_REVEAL_EVERY_STEP !== '0';
const FILL_REVEAL_CHUNK_X = parseInt(process.env.PERF_REVEAL_CHUNK_X ?? String(ORIGIN_X), 10);
const FILL_REVEAL_CHUNK_Y = parseInt(process.env.PERF_REVEAL_CHUNK_Y ?? String(ORIGIN_Y), 10);
const MIN_FILL_CELLS = parseInt(process.env.PERF_MIN_FILL_CELLS ?? '500', 10);
const MIN_PERSIST_CELLS = parseInt(
  process.env.PERF_MIN_PERSIST_CELLS ?? String(MIN_FILL_CELLS * (IS_MARATHON ? CLIENTS : 1)),
  10,
);
const PERSIST_WAIT_MS = parseInt(process.env.PERF_PERSIST_WAIT_MS ?? '90000', 10);
const SKIP_PERSIST_CHECK = process.env.PERF_SKIP_PERSIST_CHECK === '1';
const FILL_WAIT_MS = parseInt(process.env.PERF_FILL_WAIT_MS ?? '30000', 10);
const FILL_PAN_ORIGIN_X = parseInt(process.env.PERF_FILL_PAN_ORIGIN_X ?? String(FILL_REVEAL_CHUNK_X), 10);
const FILL_PAN_ORIGIN_Y = parseInt(process.env.PERF_FILL_PAN_ORIGIN_Y ?? String(FILL_REVEAL_CHUNK_Y), 10);

const FILL_GAME_ID = process.env.PERF_FILL_GAME_ID ?? '';

const DEFAULT_BURST = 'cold-single,warm-single,cold-batched';
const DEFAULT_SUSTAINED = 'sustained-fill-pan';
const DEFAULT_MARATHON = 'sustained-multi-pan';
const SCENARIOS = (process.env.PERF_SCENARIOS ??
  (MODE === 'burst' ? DEFAULT_BURST
    : MODE === 'fill' ? 'fill-verify'
    : MODE === 'marathon' ? DEFAULT_MARATHON
    : MODE === 'all' ? `${DEFAULT_BURST},${DEFAULT_SUSTAINED}`
    : DEFAULT_SUSTAINED)
).split(',').filter(Boolean);

function getClientConfigs(): ClientConfig[] {
  const raw = process.env.PERF_CLIENT_ORIGINS;
  if (raw) {
    return raw.split(',').map((entry, i) => {
      const parts = entry.trim().split(':');
      const originX = parseInt(parts[0], 10);
      const originY = parseInt(parts[1], 10);
      const direction = (parts[2] ?? 'east') as PanDirection;
      if (Number.isNaN(originX) || Number.isNaN(originY)) {
        throw new Error(`Invalid PERF_CLIENT_ORIGINS entry "${entry}" — use chunkX:chunkY[:direction]`);
      }
      return { originX, originY, direction };
    });
  }
  return MARATHON_CLIENTS.slice(0, CLIENTS);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function snapshotPersistence(gameId: string): Promise<PersistSnapshot> {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  try {
    const db = client.db('minesweeper_infinite');
    const chunks = db.collection('chunks');
    const pendingFills = db.collection('pendingFills');

    const totalChunks = await chunks.countDocuments({ gameId });
    const pendingFillDocs = await pendingFills.countDocuments({ gameId });

    let chunksWithReveals = 0;
    let revealedCells = 0;
    const cursor = chunks.find({ gameId }, { projection: { revealed: 1 } });
    for await (const doc of cursor) {
      const buf = (doc.revealed as { buffer?: Buffer })?.buffer ?? doc.revealed as Buffer | undefined;
      if (!buf) continue;
      let count = 0;
      for (let i = 0; i < buf.length; i++) {
        if (buf[i] !== 255) count++;
      }
      if (count > 0) {
        chunksWithReveals++;
        revealedCells += count;
      }
    }

    return { chunks: totalChunks, chunksWithReveals, revealedCells, pendingFillDocs };
  } finally {
    await client.close();
  }
}

async function waitForPersistence(
  gameId: string,
  minCells: number,
  timeoutMs: number,
): Promise<PersistSnapshot> {
  const deadline = Date.now() + timeoutMs;
  let last = await snapshotPersistence(gameId);
  let stablePasses = 0;

  while (Date.now() < deadline) {
    if (last.revealedCells >= minCells) {
      stablePasses++;
      if (stablePasses >= 3) return last;
    } else {
      stablePasses = 0;
    }
    await sleep(1000);
    last = await snapshotPersistence(gameId);
  }
  return last;
}

function printPersistenceResult(
  gameId: string,
  before: PersistSnapshot,
  after: PersistSnapshot,
  minCells: number,
): void {
  const delta = after.revealedCells - before.revealedCells;
  console.log('\nMongo persistence verification');
  console.log('─'.repeat(72));
  console.log(`  Game:              ${gameId}`);
  console.log(`  Chunks written:    ${after.chunks} (+${after.chunks - before.chunks})`);
  console.log(`  Chunks w/ reveals: ${after.chunksWithReveals} (+${after.chunksWithReveals - before.chunksWithReveals})`);
  console.log(`  Revealed cells:    ${after.revealedCells} (+${delta})`);
  console.log(`  Pending fill docs: ${after.pendingFillDocs} (+${after.pendingFillDocs - before.pendingFillDocs})`);
  console.log(`  Required:          >= ${minCells} persisted cells`);
  console.log(`  Status:            ${after.revealedCells >= minCells ? 'PASS' : 'FAIL'}`);
  console.log('─'.repeat(72));
}

async function verifyPersistence(
  gameId: string,
  before: PersistSnapshot,
  clientRevealedCells: number,
): Promise<void> {
  if (SKIP_PERSIST_CHECK) return;

  const minCells = Math.min(MIN_PERSIST_CELLS, clientRevealedCells);
  const after = await waitForPersistence(gameId, minCells, PERSIST_WAIT_MS);
  printPersistenceResult(gameId, before, after, minCells);

  if (after.revealedCells < minCells) {
    throw new Error(
      `Persistence verification failed: ${after.revealedCells} < ${minCells} cells in Mongo for game "${gameId}" ` +
      `(increase PERF_PERSIST_WAIT_MS if disconnect flush is still running)`,
    );
  }
}

function chunkKey(c: ChunkCoord): string {
  return `${c.chunkX}_${c.chunkY}`;
}

function countRevealed(wire: WireChunk): number {
  return (wire.revealed?.length ?? 0) + (wire.revealedMines?.length ?? 0);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

function gridChunks(originX: number, originY: number, count: number): ChunkCoord[] {
  const side = Math.ceil(Math.sqrt(count));
  const chunks: ChunkCoord[] = [];
  for (let dy = 0; dy < side && chunks.length < count; dy++) {
    for (let dx = 0; dx < side && chunks.length < count; dx++) {
      chunks.push({ chunkX: originX + dx, chunkY: originY + dy });
    }
  }
  return chunks;
}

function bandChunks(originX: number, originY: number, width: number, height: number): ChunkCoord[] {
  const chunks: ChunkCoord[] = [];
  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) {
      chunks.push({ chunkX: originX + dx, chunkY: originY + dy });
    }
  }
  return chunks;
}

function chunksAroundCell(gx: number, gy: number, radius: number): ChunkCoord[] {
  const cs = 32;
  const cx = Math.floor(gx / cs);
  const cy = Math.floor(gy / cs);
  const chunks: ChunkCoord[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      chunks.push({ chunkX: cx + dx, chunkY: cy + dy });
    }
  }
  return chunks;
}

function connect(): Promise<ReturnType<typeof io>> {
  return new Promise((resolve, reject) => {
    const socket = io(BACKEND_URL, {
      transports: ['websocket'],
      reconnection: false,
      timeout: CONNECT_TIMEOUT_MS,
    });

    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`Could not connect to ${BACKEND_URL} within ${CONNECT_TIMEOUT_MS}ms`));
    }, CONNECT_TIMEOUT_MS);

    socket.on('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });

    socket.on('connect_error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Connect failed (${BACKEND_URL}): ${err.message}`));
    });
  });
}

function joinGame(socket: ReturnType<typeof io>, gameId: string, username: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('joinGame timed out')), CONNECT_TIMEOUT_MS);

    socket.once('gameJoined', () => {
      clearTimeout(timer);
      resolve();
    });

    socket.once('error', (payload: { message?: string }) => {
      clearTimeout(timer);
      reject(new Error(payload.message ?? 'joinGame failed'));
    });

    socket.emit('joinGame', { gameId, username });
  });
}

class RevealTracker {
  private byChunk = new Map<string, number>();
  chunkUpdates = 0;

  ingest(data: WireChunk | WireChunk[]): number {
    const batch = Array.isArray(data) ? data : [data];
    let delta = 0;
    for (const wire of batch) {
      const key = `${wire.chunkX}_${wire.chunkY}`;
      const count = countRevealed(wire);
      const prev = this.byChunk.get(key) ?? 0;
      if (count > prev) {
        delta += count - prev;
        this.byChunk.set(key, count);
        this.chunkUpdates++;
      }
    }
    return delta;
  }

  chunkRevealed(chunkX: number, chunkY: number): number {
    return this.byChunk.get(`${chunkX}_${chunkY}`) ?? 0;
  }

  total(): number {
    let sum = 0;
    for (const n of this.byChunk.values()) sum += n;
    return sum;
  }
}

function attachWireListener(
  socket: ReturnType<typeof io>,
  onBatch: (data: WireChunk | WireChunk[]) => void,
): () => void {
  socket.on('chunksData', onBatch);
  socket.on('chunkData', onBatch);
  return () => {
    socket.off('chunksData', onBatch);
    socket.off('chunkData', onBatch);
  };
}

function subscribeAndMeasure(
  socket: ReturnType<typeof io>,
  gameId: string,
  chunks: ChunkCoord[],
  timeoutMs = WAVE_TIMEOUT_MS,
): Promise<{ chunks: number; batches: number; totalMs: number; missing: number }> {
  return new Promise((resolve, reject) => {
    const expected = new Set(chunks.map(chunkKey));
    const received = new Set<string>();
    let batches = 0;
    const t0 = performance.now();

    const onWire = (data: WireChunk | WireChunk[]) => {
      const batch = Array.isArray(data) ? data : [data];
      batches++;
      for (const wire of batch) {
        received.add(`${wire.chunkX}_${wire.chunkY}`);
      }
      if (received.size >= expected.size) {
        cleanup();
        resolve({
          chunks: received.size,
          batches,
          totalMs: performance.now() - t0,
          missing: expected.size - received.size,
        });
      }
    };

    const cleanup = () => {
      clearTimeout(timer);
      socket.off('chunksData', onWire);
      socket.off('chunkData', onWire);
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Wave timed out: received ${received.size}/${expected.size} chunks`));
    }, timeoutMs);

    socket.on('chunksData', onWire);
    socket.on('chunkData', onWire);
    socket.emit('subscribeToChunks', { gameId, chunks });
  });
}

async function waitForFill(
  socket: ReturnType<typeof io>,
  tracker: RevealTracker,
  baseline: number,
  minCells: number,
  timeoutMs: number,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const onWire = (data: WireChunk | WireChunk[]) => {
      tracker.ingest(data);
      if (tracker.total() - baseline >= minCells) {
        cleanup();
        resolve(tracker.total() - baseline);
      }
    };

    const cleanup = () => {
      clearTimeout(timer);
      socket.off('chunksData', onWire);
      socket.off('chunkData', onWire);
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(
        `Fill did not reach ${minCells} revealed cells (got ${tracker.total() - baseline}) within ${timeoutMs}ms`,
      ));
    }, timeoutMs);

    socket.on('chunksData', onWire);
    socket.on('chunkData', onWire);

    if (tracker.total() - baseline >= minCells) {
      cleanup();
      resolve(tracker.total() - baseline);
    }
  });
}

async function runFillVerify(
  socket: ReturnType<typeof io>,
  gameId: string,
  tracker = new RevealTracker(),
  manageListener = true,
): Promise<FillResult> {
  const detach = manageListener ? attachWireListener(socket, data => { tracker.ingest(data); }) : () => {};
  const revealX = FILL_REVEAL_CHUNK_X * 32 + 16;
  const revealY = FILL_REVEAL_CHUNK_Y * 32 + 16;

  try {
    const preload = chunksAroundCell(revealX, revealY, 8);
    await subscribeAndMeasure(socket, gameId, preload);

    const preReveal = tracker.chunkRevealed(FILL_REVEAL_CHUNK_X, FILL_REVEAL_CHUNK_Y);
    if (preReveal > 900) {
      throw new Error(
        `Reveal chunk (${FILL_REVEAL_CHUNK_X},${FILL_REVEAL_CHUNK_Y}) already ${preReveal}/1024 revealed — ` +
        'use a fresh game (default PERF_FILL_GAME_ID) or different PERF_REVEAL_CHUNK_X/Y',
      );
    }

    const baseline = tracker.total();
    const t0 = performance.now();
    socket.emit('revealTile', { gameId, x: revealX, y: revealY });

    const revealedCells = await waitForFill(socket, tracker, baseline, MIN_FILL_CELLS, FILL_WAIT_MS);
    const fillMs = performance.now() - t0;

    return {
      name: 'fill-verify',
      revealX,
      revealY,
      revealedCells,
      chunkUpdates: tracker.chunkUpdates,
      fillMs,
      passed: revealedCells >= MIN_FILL_CELLS,
    };
  } finally {
    detach();
  }
}

class SustainedPanClient {
  readonly subscribed = new Set<string>();
  readonly subscribedOrder: string[] = [];
  private latencies: number[] = [];
  private totalReceived = 0;
  private totalRequested = 0;
  private steps = 0;
  private errors = 0;
  private revealsAttempted = 0;
  private cursorX: number;
  private cursorY: number;
  private readonly revealTracker: RevealTracker;
  private revealBaseline = 0;
  private lastProgressAt = Date.now();

  constructor(
    private readonly socket: ReturnType<typeof io>,
    private readonly gameId: string,
    originX: number,
    originY: number,
    revealTracker: RevealTracker,
    private readonly direction: PanDirection = 'east',
    private readonly clientIndex = 0,
    private readonly revealEveryStep = false,
  ) {
    this.cursorX = originX;
    this.cursorY = originY;
    this.revealTracker = revealTracker;
  }

  markRevealBaseline(): void {
    this.revealBaseline = this.revealTracker.total();
  }

  subscribeFillCells(): number {
    return Math.max(0, this.revealTracker.total() - this.revealBaseline);
  }

  private evictIfNeeded(): void {
    while (this.subscribed.size > MAX_SUBSCRIBED) {
      const evict = this.subscribedOrder.shift();
      if (!evict) break;
      this.subscribed.delete(evict);
      const [x, y] = evict.split('_').map(Number);
      this.socket.emit('unsubscribeFromChunks', {
        gameId: this.gameId,
        chunks: [{ chunkX: x, chunkY: y }],
      });
    }
  }

  private advanceCursor(): void {
    const step = Math.max(1, Math.floor(STEP_CHUNKS / 3));
    switch (this.direction) {
      case 'east': this.cursorX += step; break;
      case 'west': this.cursorX -= step; break;
      case 'north': this.cursorY -= step; break;
      case 'south': this.cursorY += step; break;
    }
  }

  private logProgress(): void {
    const elapsed = ((Date.now() - this.lastProgressAt) / 1000).toFixed(0);
    console.log(
      `[client ${this.clientIndex}] origin=(${this.cursorX},${this.cursorY}) dir=${this.direction} ` +
      `steps=${this.steps} chunks=${this.totalReceived} revealed=${this.subscribeFillCells()} ` +
      `reveals=${this.revealsAttempted} errors=${this.errors} (+${elapsed}s)`,
    );
    this.lastProgressAt = Date.now();
  }

  private nextBand(): { chunks: ChunkCoord[]; revealX: number; revealY: number } {
    const band = bandChunks(this.cursorX, this.cursorY, STEP_CHUNKS, STEP_BAND);
    const revealX = (this.cursorX + Math.floor(STEP_CHUNKS / 2)) * 32 + 16;
    const revealY = (this.cursorY + Math.floor(STEP_BAND / 2)) * 32 + 16;
    this.advanceCursor();
    const chunks = band.filter(c => {
      const key = chunkKey(c);
      if (this.subscribed.has(key)) return false;
      this.subscribed.add(key);
      this.subscribedOrder.push(key);
      return true;
    });
    return { chunks, revealX, revealY };
  }

  private emitReveal(revealX: number, revealY: number): void {
    this.revealsAttempted++;
    this.socket.emit('revealTile', { gameId: this.gameId, x: revealX, y: revealY });
  }

  async run(durationSec: number): Promise<Omit<SustainedResult, 'name' | 'clients' | 'fill' | 'clientResults'>> {
    const endAt = Date.now() + durationSec * 1000;
    this.lastProgressAt = Date.now();

    while (Date.now() < endAt) {
      const { chunks: toSubscribe, revealX, revealY } = this.nextBand();
      if (toSubscribe.length > 0) {
        this.totalRequested += toSubscribe.length;
        this.steps++;
        this.evictIfNeeded();
        try {
          const wave = await subscribeAndMeasure(this.socket, this.gameId, toSubscribe);
          this.latencies.push(wave.totalMs);
          this.totalReceived += wave.chunks;
          if (this.revealEveryStep) {
            this.emitReveal(revealX, revealY);
          }
        } catch {
          this.errors++;
        }
      }
      if (Date.now() - this.lastProgressAt >= PROGRESS_INTERVAL_MS) {
        this.logProgress();
      }
      await sleep(STEP_MS);
    }

    this.logProgress();

    const sorted = [...this.latencies].sort((a, b) => a - b);
    const durationMs = durationSec * 1000;

    return {
      durationSec,
      steps: this.steps,
      requested: this.totalRequested,
      received: this.totalReceived,
      sustainedChunksPerSec: durationMs > 0 ? (this.totalReceived / durationMs) * 1000 : 0,
      latencyP50Ms: percentile(sorted, 50),
      latencyP95Ms: percentile(sorted, 95),
      latencyMaxMs: sorted.length > 0 ? sorted[sorted.length - 1] : 0,
      errors: this.errors,
      missing: this.totalRequested - this.totalReceived,
      subscribeFillCells: this.subscribeFillCells(),
    };
  }

  getRevealsAttempted(): number {
    return this.revealsAttempted;
  }
}

async function kickoffReveal(
  socket: ReturnType<typeof io>,
  gameId: string,
  originX: number,
  originY: number,
  tracker: RevealTracker,
): Promise<number> {
  const revealX = originX * 32 + 16;
  const revealY = originY * 32 + 16;
  const preload = chunksAroundCell(revealX, revealY, 4);
  await subscribeAndMeasure(socket, gameId, preload, 15000);

  const preReveal = tracker.chunkRevealed(originX, originY);
  if (preReveal > 900) {
    throw new Error(`Origin chunk (${originX},${originY}) already ${preReveal}/1024 revealed — use a fresh game`);
  }

  const baseline = tracker.total();
  socket.emit('revealTile', { gameId, x: revealX, y: revealY });
  const minKickoff = Math.min(MIN_FILL_CELLS, 100);
  return waitForFill(socket, tracker, baseline, minKickoff, FILL_WAIT_MS);
}

async function runSingleClientPan(
  clientIndex: number,
  gameId: string,
  config: ClientConfig,
  durationSec: number,
): Promise<ClientPanResult> {
  const socket = await connect();
  const revealTracker = new RevealTracker();
  const detach = attachWireListener(socket, data => { revealTracker.ingest(data); });

  try {
    await joinGame(socket, gameId, `perf-marathon-${clientIndex}`);
    if (MARATHON_REVEAL) {
      const kickoffCells = await kickoffReveal(socket, gameId, config.originX, config.originY, revealTracker);
      console.log(`[client ${clientIndex}] kickoff fill: ${kickoffCells} cells at (${config.originX},${config.originY})`);
    }
    const loader = new SustainedPanClient(
      socket,
      gameId,
      config.originX,
      config.originY,
      revealTracker,
      config.direction,
      clientIndex,
      REVEAL_EVERY_STEP,
    );
    const pan = await loader.run(durationSec);
    return {
      clientIndex,
      originX: config.originX,
      originY: config.originY,
      direction: config.direction,
      revealsAttempted: loader.getRevealsAttempted(),
      ...pan,
    };
  } finally {
    detach();
    socket.close();
  }
}

function aggregateClientResults(results: ClientPanResult[]): SustainedResult {
  const allLatencies = results.flatMap(r =>
    r.steps > 0 ? [r.latencyP50Ms, r.latencyP95Ms, r.latencyMaxMs] : [],
  ).sort((a, b) => a - b);

  const durationSec = results[0]?.durationSec ?? DURATION_SEC;
  const requested = results.reduce((s, r) => s + r.requested, 0);
  const received = results.reduce((s, r) => s + r.received, 0);

  return {
    name: `sustained-multi-pan-x${results.length}`,
    durationSec,
    clients: results.length,
    steps: results.reduce((s, r) => s + r.steps, 0),
    requested,
    received,
    sustainedChunksPerSec: durationSec > 0 ? received / durationSec : 0,
    latencyP50Ms: percentile(allLatencies, 50),
    latencyP95Ms: percentile(allLatencies, 95),
    latencyMaxMs: Math.max(...results.map(r => r.latencyMaxMs), 0),
    errors: results.reduce((s, r) => s + r.errors, 0),
    missing: results.reduce((s, r) => s + r.missing, 0),
    subscribeFillCells: results.reduce((s, r) => s + r.subscribeFillCells, 0),
    clientResults: results,
  };
}

async function runMultiClientMarathon(): Promise<SustainedResult> {
  const configs = getClientConfigs();
  if (configs.length < CLIENTS) {
    throw new Error(`Need ${CLIENTS} client origins but only ${configs.length} configured`);
  }
  const gameId = SHARED_GAME_ID || `perf-marathon-${Date.now()}`;
  const persistBefore = await snapshotPersistence(gameId);

  console.log(`\nMarathon: ${CLIENTS} clients × ${DURATION_SEC}s (${(DURATION_SEC / 60).toFixed(1)} min) on game "${gameId}"`);
  console.log(`  reveal every step: ${REVEAL_EVERY_STEP ? 'yes' : 'no'}`);
  console.log(`  min fill cells:    ${MIN_FILL_CELLS} per client kickoff, ${MIN_FILL_CELLS * CLIENTS} aggregate`);
  console.log(`  min persist cells: ${MIN_PERSIST_CELLS}`);
  for (let i = 0; i < CLIENTS; i++) {
    const c = configs[i];
    console.log(`  client ${i}: origin=(${c.originX}, ${c.originY}) pan=${c.direction}`);
  }
  console.log('');

  const t0 = Date.now();
  const results = await Promise.all(
    Array.from({ length: CLIENTS }, (_, i) =>
      runSingleClientPan(i, gameId, configs[i], DURATION_SEC),
    ),
  );
  const wallSec = (Date.now() - t0) / 1000;
  const aggregate = aggregateClientResults(results);
  aggregate.sustainedChunksPerSec = wallSec > 0 ? aggregate.received / wallSec : 0;

  const minAggregateFill = MIN_FILL_CELLS * CLIENTS;
  if (aggregate.subscribeFillCells < minAggregateFill) {
    throw new Error(
      `Flood fill verification failed: ${aggregate.subscribeFillCells} revealed cells ` +
      `< ${minAggregateFill} (${MIN_FILL_CELLS} × ${CLIENTS} clients)`,
    );
  }

  await verifyPersistence(gameId, persistBefore, aggregate.subscribeFillCells);
  return aggregate;
}

async function runSustainedFillPan(): Promise<SustainedResult> {
  const gameId = FILL_GAME_ID || SHARED_GAME_ID || `perf-fill-${Date.now()}`;
  const persistBefore = await snapshotPersistence(gameId);
  const socket = await connect();
  const revealTracker = new RevealTracker();
  const detach = attachWireListener(socket, data => { revealTracker.ingest(data); });

  try {
    await joinGame(socket, gameId, 'perf-sustained');

    let fill: FillResult | undefined;
    if (!SKIP_FILL && (SCENARIOS.includes('sustained-fill-pan') || SCENARIOS.includes('fill-verify'))) {
      fill = await runFillVerify(socket, gameId, revealTracker, false);
      if (!fill.passed) {
        throw new Error(`Flood fill verification failed: ${fill.revealedCells} < ${MIN_FILL_CELLS} cells`);
      }
      await sleep(2000);
    }

    const loader = new SustainedPanClient(
      socket,
      gameId,
      FILL_PAN_ORIGIN_X,
      FILL_PAN_ORIGIN_Y,
      revealTracker,
      'east',
      0,
      REVEAL_EVERY_STEP,
    );
    loader.markRevealBaseline();
    const pan = await loader.run(DURATION_SEC);

    const result: SustainedResult = {
      name: 'sustained-fill-pan',
      clients: 1,
      fill,
      ...pan,
    };

    if (result.subscribeFillCells < MIN_FILL_CELLS) {
      throw new Error(
        `Flood fill during pan failed: ${result.subscribeFillCells} < ${MIN_FILL_CELLS} cells`,
      );
    }

    await verifyPersistence(gameId, persistBefore, result.subscribeFillCells);
    return result;
  } finally {
    detach();
    socket.close();
  }
}

async function runNoiseSustainedPan(): Promise<SustainedResult> {
  const gameId = `perf-sustained-${Date.now()}`;
  const socket = await connect();

  try {
    await joinGame(socket, gameId, 'perf-noise-pan');
    const loader = new SustainedPanClient(
      socket,
      gameId,
      ORIGIN_X,
      ORIGIN_Y,
      new RevealTracker(),
    );
    const pan = await loader.run(DURATION_SEC);
    return { name: 'sustained-pan', clients: 1, ...pan };
  } finally {
    socket.close();
  }
}

function finalizeBurst(
  name: string,
  requested: number,
  raw: { chunks: number; batches: number; totalMs: number; missing: number },
): ScenarioResult {
  const chunksPerSec = raw.totalMs > 0 ? (raw.chunks / raw.totalMs) * 1000 : 0;
  return {
    name,
    chunks: requested,
    batches: raw.batches,
    totalMs: raw.totalMs,
    chunksPerSec,
    msPerChunk: raw.chunks > 0 ? raw.totalMs / raw.chunks : 0,
    missing: raw.missing,
  };
}

async function runBurstScenario(
  socket: ReturnType<typeof io>,
  name: string,
  gameId: string,
  chunks: ChunkCoord[],
  batched: boolean,
): Promise<ScenarioResult> {
  if (!batched) {
    const raw = await subscribeAndMeasure(socket, gameId, chunks);
    return finalizeBurst(name, chunks.length, raw);
  }

  const t0 = performance.now();
  let batches = 0;
  let received = 0;

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const slice = chunks.slice(i, i + BATCH_SIZE);
    const raw = await subscribeAndMeasure(socket, gameId, slice);
    batches += raw.batches;
    received += raw.chunks;
  }

  return finalizeBurst(name, chunks.length, {
    chunks: received,
    batches,
    totalMs: performance.now() - t0,
    missing: chunks.length - received,
  });
}

function printBurstResults(results: ScenarioResult[], meta: Record<string, string | number>): void {
  if (JSON_OUTPUT) {
    console.log(JSON.stringify({ mode: 'burst', meta, results }, null, 2));
    return;
  }

  console.log('\nChunk load performance — burst (live backend)');
  console.log('─'.repeat(72));
  for (const [k, v] of Object.entries(meta)) console.log(`  ${k}: ${v}`);
  console.log('─'.repeat(72));
  console.log(
    `${'Scenario'.padEnd(18)} ${'Chunks'.padStart(6)} ${'Batches'.padStart(7)} ` +
    `${'Total(ms)'.padStart(10)} ${'Chunks/s'.padStart(10)} ${'ms/chunk'.padStart(9)}`,
  );
  console.log('─'.repeat(72));
  for (const r of results) {
    const miss = r.missing > 0 ? ` (missing ${r.missing})` : '';
    console.log(
      `${r.name.padEnd(18)} ${String(r.chunks).padStart(6)} ${String(r.batches).padStart(7)} ` +
      `${r.totalMs.toFixed(1).padStart(10)} ${r.chunksPerSec.toFixed(0).padStart(10)} ` +
      `${r.msPerChunk.toFixed(3).padStart(9)}${miss}`,
    );
  }
  console.log('─'.repeat(72));
  const best = results.reduce((a, b) => (a.chunksPerSec > b.chunksPerSec ? a : b));
  console.log(`Peak throughput: ${best.chunksPerSec.toFixed(0)} chunks/s (${best.name})\n`);
}

function printFillResult(fill: FillResult): void {
  console.log('\nFlood fill verification');
  console.log('─'.repeat(72));
  console.log(`  Reveal chunk:    (${FILL_REVEAL_CHUNK_X}, ${FILL_REVEAL_CHUNK_Y})`);
  console.log(`  Reveal cell:     (${fill.revealX}, ${fill.revealY})`);
  console.log(`  Revealed cells:  ${fill.revealedCells}`);
  console.log(`  Chunk updates:   ${fill.chunkUpdates}`);
  console.log(`  Fill duration:   ${fill.fillMs.toFixed(1)} ms`);
  console.log(`  Status:          ${fill.passed ? 'PASS' : 'FAIL'}`);
  console.log('─'.repeat(72));
}

function printClientResults(results: ClientPanResult[]): void {
  console.log('─'.repeat(72));
  console.log(
    `${'Client'.padEnd(8)} ${'Origin'.padStart(14)} ${'Dir'.padStart(5)} ` +
    `${'Steps'.padStart(6)} ${'Chunks'.padStart(8)} ${'Revealed'.padStart(9)} ${'Reveals'.padStart(7)} ` +
    `${'Chunks/s'.padStart(9)} ${'p50 ms'.padStart(8)} ${'Err'.padStart(4)}`,
  );
  console.log('─'.repeat(72));
  for (const r of results) {
    console.log(
      `${String(r.clientIndex).padEnd(8)} ` +
      `(${r.originX},${r.originY})`.padStart(14) +
      ` ${r.direction.padStart(5)} ${String(r.steps).padStart(6)} ${String(r.received).padStart(8)} ` +
      `${String(r.subscribeFillCells).padStart(9)} ${String(r.revealsAttempted).padStart(7)} ` +
      `${(r.sustainedChunksPerSec).toFixed(0).padStart(9)} ${r.latencyP50Ms.toFixed(1).padStart(8)} ` +
      `${String(r.errors).padStart(4)}`,
    );
  }
  console.log('─'.repeat(72));
}

function printSustainedResults(result: SustainedResult, meta: Record<string, string | number>): void {
  if (JSON_OUTPUT) {
    console.log(JSON.stringify({ mode: 'sustained', meta, result }, null, 2));
    return;
  }

  if (result.fill) printFillResult(result.fill);

  console.log('\nChunk load performance — sustained (live backend)');
  console.log('─'.repeat(72));
  for (const [k, v] of Object.entries(meta)) console.log(`  ${k}: ${v}`);
  console.log('─'.repeat(72));
  console.log(`  Duration:        ${result.durationSec}s (${(result.durationSec / 60).toFixed(1)} min)`);
  console.log(`  Clients:         ${result.clients}`);
  console.log(`  Pan steps:       ${result.steps}`);
  console.log(`  Chunks requested:${result.requested}`);
  console.log(`  Chunks received: ${result.received} (${result.sustainedChunksPerSec.toFixed(0)} chunks/s aggregate)`);
  console.log(`  Latency p50:     ${result.latencyP50Ms.toFixed(1)} ms`);
  console.log(`  Latency p95:     ${result.latencyP95Ms.toFixed(1)} ms`);
  console.log(`  Latency max:     ${result.latencyMaxMs.toFixed(1)} ms`);
  console.log(`  Subscribe fills: ${result.subscribeFillCells} cells revealed during test`);
  console.log(`  Step errors:     ${result.errors}`);
  if (result.missing > 0) console.log(`  Missing chunks:  ${result.missing}`);

  if (result.clientResults && result.clientResults.length > 1) {
    printClientResults(result.clientResults);
  } else {
    console.log('─'.repeat(72));
  }
  console.log('  Each pan step waits for its wave — continuous completed throughput.\n');
}

async function runBurstScenarios(): Promise<void> {
  const chunks = gridChunks(ORIGIN_X, ORIGIN_Y, CHUNK_COUNT);
  const coldGameId = `perf-cold-${Date.now()}`;
  const batchedGameId = `perf-batched-${Date.now()}`;
  const batchedChunks = gridChunks(ORIGIN_X + 1000, ORIGIN_Y + 1000, CHUNK_COUNT);

  const socket = await connect();
  const results: ScenarioResult[] = [];

  try {
    if (SCENARIOS.includes('cold-single')) {
      await joinGame(socket, coldGameId, 'perf-burst');
      results.push(await runBurstScenario(socket, 'cold-single', coldGameId, chunks, false));
    }
    if (SCENARIOS.includes('warm-single')) {
      if (!SCENARIOS.includes('cold-single')) await joinGame(socket, coldGameId, 'perf-burst');
      results.push(await runBurstScenario(socket, 'warm-single', coldGameId, chunks, false));
    }
    if (SCENARIOS.includes('cold-batched')) {
      await joinGame(socket, batchedGameId, 'perf-batched');
      results.push(await runBurstScenario(socket, 'cold-batched', batchedGameId, batchedChunks, true));
    }

    printBurstResults(results, {
      backend: BACKEND_URL,
      chunkCount: CHUNK_COUNT,
      batchSize: BATCH_SIZE,
      origin: `(${ORIGIN_X}, ${ORIGIN_Y})`,
    });
  } finally {
    socket.close();
  }
}

async function runFillOnly(): Promise<void> {
  const gameId = FILL_GAME_ID || SHARED_GAME_ID || `perf-fill-${Date.now()}`;
  const persistBefore = await snapshotPersistence(gameId);
  const socket = await connect();
  const tracker = new RevealTracker();
  const detach = attachWireListener(socket, data => { tracker.ingest(data); });
  try {
    await joinGame(socket, gameId, 'perf-fill');
    const fill = await runFillVerify(socket, gameId, tracker, false);
    printFillResult(fill);
    if (!fill.passed) {
      throw new Error(`Flood fill verification failed (${fill.revealedCells} < ${MIN_FILL_CELLS})`);
    }
    await verifyPersistence(gameId, persistBefore, fill.revealedCells);
  } finally {
    detach();
    socket.close();
  }
}

async function runSustainedScenarios(): Promise<void> {
  let result: SustainedResult;

  if (SCENARIOS.includes('sustained-multi-pan')) {
    result = await runMultiClientMarathon();
  } else if (SCENARIOS.includes('sustained-fill-pan')) {
    result = await runSustainedFillPan();
  } else if (SCENARIOS.includes('sustained-pan')) {
    result = await runNoiseSustainedPan();
  } else {
    throw new Error(`Unknown sustained scenario: ${SCENARIOS.join(', ')}`);
  }

  printSustainedResults(result, {
    backend: BACKEND_URL,
    gameId: SHARED_GAME_ID || FILL_GAME_ID || 'ephemeral (fresh per run)',
    durationSec: DURATION_SEC,
    clients: CLIENTS,
    stepMs: STEP_MS,
    stepChunks: STEP_CHUNKS,
    stepBand: STEP_BAND,
    revealEveryStep: REVEAL_EVERY_STEP ? 'yes' : 'no',
    marathonReveal: MARATHON_REVEAL ? 'yes' : 'no',
    minFillCells: MIN_FILL_CELLS,
    minPersistCells: MIN_PERSIST_CELLS,
  });
}

async function main(): Promise<void> {
  if (MODE === 'fill') {
    await runFillOnly();
    return;
  }

  const burst = SCENARIOS.some(s => s.startsWith('cold-') || s === 'warm-single');
  const sustained = SCENARIOS.some(s => s.startsWith('sustained'));

  if (burst) await runBurstScenarios();
  if (sustained) await runSustainedScenarios();
  if (!burst && !sustained) {
    throw new Error(`No recognized scenarios: ${SCENARIOS.join(', ')}`);
  }
}

main().catch(err => {
  console.error(err.message ?? err);
  process.exit(1);
});
