import { DurableObject } from 'cloudflare:workers';
import { WorldGenerator } from './world-generator';
import {
  CHUNK_SIZE,
  Env,
  ChunkStateResponse,
  ChunkDelta,
  CellState,
  RevealedCell,
  FlaggedCell,
} from './types';

export class ChunkDO extends DurableObject<Env> {
  private readonly sql: SqlStorage;
  private readonly chunkX: number;
  private readonly chunkY: number;
  private readonly gameId: string;

  // Hot in-memory cache — mirrors SQLite, rebuilt on cold start
  private mineLayout: Uint8Array | null = null;
  private readonly revealed = new Map<number, string>(); // cellIndex → playerId
  private readonly flagged  = new Map<number, string>();
  private readonly subscribers = new Set<string>();      // sessionDO ID strings
  private readonly pendingFills = new Set<number>();     // deferred flood-fill origins

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;

    // Parse name format: "gameId:chunkX:chunkY"
    const name = ctx.id.name!;
    const firstColon = name.indexOf(':');
    const rest = name.slice(firstColon + 1);
    const secondColon = rest.indexOf(':');
    this.gameId = name.slice(0, firstColon);
    this.chunkX = parseInt(rest.slice(0, secondColon), 10);
    this.chunkY = parseInt(rest.slice(secondColon + 1), 10);

    ctx.blockConcurrencyWhile(async () => {
      this.initSchema();
      this.loadHotCache();
    });
  }

  // ── Schema ──────────────────────────────────────────────────────────────────

  private initSchema(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS mine_layout (
        id   INTEGER PRIMARY KEY CHECK (id = 1),
        data BLOB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reveals (
        cell_index INTEGER PRIMARY KEY,
        player_id  TEXT    NOT NULL,
        revealed_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS flags (
        cell_index INTEGER PRIMARY KEY,
        player_id  TEXT    NOT NULL,
        flagged_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pending_fills (
        cell_index  INTEGER PRIMARY KEY,
        enqueued_at INTEGER NOT NULL
      );
    `);
  }

  private loadHotCache(): void {
    const layoutRows = [...this.sql.exec<{ data: ArrayBuffer }>(
      'SELECT data FROM mine_layout WHERE id = 1'
    )];
    if (layoutRows.length > 0) {
      this.mineLayout = new Uint8Array(layoutRows[0].data);
    }

    for (const row of this.sql.exec<{ cell_index: number; player_id: string }>(
      'SELECT cell_index, player_id FROM reveals'
    )) {
      this.revealed.set(row.cell_index, row.player_id);
    }

    for (const row of this.sql.exec<{ cell_index: number; player_id: string }>(
      'SELECT cell_index, player_id FROM flags'
    )) {
      this.flagged.set(row.cell_index, row.player_id);
    }

    for (const row of this.sql.exec<{ cell_index: number }>(
      'SELECT cell_index FROM pending_fills'
    )) {
      this.pendingFills.add(row.cell_index);
    }
  }

  // ── Mine layout ─────────────────────────────────────────────────────────────

  private getOrComputeLayout(): Uint8Array {
    if (this.mineLayout) return this.mineLayout;

    const wg = new WorldGenerator(this.gameId);
    this.mineLayout = wg.computeChunkLayout(this.chunkX, this.chunkY);
    this.sql.exec('INSERT OR IGNORE INTO mine_layout VALUES (1, ?)', this.mineLayout);
    return this.mineLayout;
  }

  // ── RPC: Session DO → Chunk DO ───────────────────────────────────────────────

  async subscribe(sessionDoId: string): Promise<ChunkStateResponse> {
    this.subscribers.add(sessionDoId);

    // Drain any pending fills before sending state snapshot
    if (this.pendingFills.size > 0) {
      const origins = [...this.pendingFills];
      this.pendingFills.clear();
      this.sql.exec('DELETE FROM pending_fills');
      const { newReveals, boundary } = this.runBFS(origins, '__propagation__');
      this.persistReveals(newReveals, '__propagation__');
      this.propagateBoundary(boundary, '__propagation__').catch(console.error);
    }

    return this.buildStateSnapshot();
  }

  async unsubscribe(sessionDoId: string): Promise<void> {
    this.subscribers.delete(sessionDoId);
  }

  async reveal(origins: number[], playerId: string): Promise<{ mineHit: boolean }> {
    const layout = this.getOrComputeLayout();

    // Mine check on the clicked cell only (origins[0])
    const clickedIdx = origins[0];
    if (layout[clickedIdx] === 0xff) {
      if (!this.revealed.has(clickedIdx)) {
        this.persistReveals([clickedIdx], playerId);
        const lx = clickedIdx % CHUNK_SIZE;
        const ly = Math.floor(clickedIdx / CHUNK_SIZE);
        await this.broadcastDelta({
          chunkX: this.chunkX,
          chunkY: this.chunkY,
          revealed: [{ index: clickedIdx, isMine: true, adjacentMines: 0, playerId }],
          mineHit: {
            worldX: this.chunkX * CHUNK_SIZE + lx,
            worldY: this.chunkY * CHUNK_SIZE + ly,
          },
        });
      }
      return { mineHit: true };
    }

    const { newReveals, boundary } = this.runBFS(origins, playerId);
    if (newReveals.length > 0) {
      this.persistReveals(newReveals, playerId);
      const revealedCells: RevealedCell[] = newReveals.map(i => ({
        index: i,
        isMine: false,
        adjacentMines: layout[i],
        playerId,
      }));
      await this.broadcastDelta({ chunkX: this.chunkX, chunkY: this.chunkY, revealed: revealedCells });
      this.propagateBoundary(boundary, playerId).catch(console.error);
    }
    return { mineHit: false };
  }

  async toggleFlag(cellIndex: number, playerId: string): Promise<void> {
    if (this.revealed.has(cellIndex)) return;

    if (this.flagged.has(cellIndex)) {
      this.sql.exec('DELETE FROM flags WHERE cell_index = ?', cellIndex);
      this.flagged.delete(cellIndex);
      await this.broadcastDelta({ chunkX: this.chunkX, chunkY: this.chunkY, unflagged: [cellIndex] });
    } else {
      this.sql.exec('INSERT OR REPLACE INTO flags VALUES (?, ?, ?)', cellIndex, playerId, Date.now());
      this.flagged.set(cellIndex, playerId);
      await this.broadcastDelta({ chunkX: this.chunkX, chunkY: this.chunkY, flagged: [{ index: cellIndex, playerId }] });
    }
  }

  // RPC: called by neighbour Chunk DOs for cross-chunk flood fill propagation
  async floodFill(origins: number[], playerId: string): Promise<void> {
    if (this.subscribers.size === 0) {
      const now = Date.now();
      for (const idx of origins) {
        if (!this.pendingFills.has(idx)) {
          this.sql.exec('INSERT OR IGNORE INTO pending_fills VALUES (?, ?)', idx, now);
          this.pendingFills.add(idx);
        }
      }
      return;
    }

    const layout = this.getOrComputeLayout();
    const { newReveals, boundary } = this.runBFS(origins, playerId);
    if (newReveals.length > 0) {
      this.persistReveals(newReveals, playerId);
      const revealedCells: RevealedCell[] = newReveals.map(i => ({
        index: i,
        isMine: false,
        adjacentMines: layout[i],
        playerId,
      }));
      await this.broadcastDelta({ chunkX: this.chunkX, chunkY: this.chunkY, revealed: revealedCells });
      this.propagateBoundary(boundary, playerId).catch(console.error);
    }
  }

  // ── BFS flood fill ───────────────────────────────────────────────────────────

  private runBFS(origins: number[], playerId: string): {
    newReveals: number[];
    boundary: Map<string, number[]>; // "cx:cy" → cellIndices in neighbour
  } {
    const layout = this.getOrComputeLayout();
    const newReveals: number[] = [];
    const boundary = new Map<string, number[]>();

    const queue = [...origins];
    const visited = new Set<number>(this.revealed.keys());

    while (queue.length > 0) {
      const idx = queue.pop()!;
      if (visited.has(idx)) continue;
      visited.add(idx);

      if (layout[idx] === 0xff) continue; // skip mines

      newReveals.push(idx);
      if (layout[idx] > 0) continue; // numbered cell — stop BFS here

      // Empty cell — expand to all 8 neighbours
      const lx = idx % CHUNK_SIZE;
      const ly = Math.floor(idx / CHUNK_SIZE);

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = lx + dx;
          const ny = ly + dy;

          if (nx >= 0 && nx < CHUNK_SIZE && ny >= 0 && ny < CHUNK_SIZE) {
            const nIdx = ny * CHUNK_SIZE + nx;
            if (!visited.has(nIdx)) queue.push(nIdx);
          } else {
            // Cross-chunk neighbour
            const ncx = this.chunkX + (nx < 0 ? -1 : nx >= CHUNK_SIZE ? 1 : 0);
            const ncy = this.chunkY + (ny < 0 ? -1 : ny >= CHUNK_SIZE ? 1 : 0);
            const nlx = ((nx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
            const nly = ((ny % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
            const nIdx = nly * CHUNK_SIZE + nlx;
            const key = `${ncx}:${ncy}`;
            if (!boundary.has(key)) boundary.set(key, []);
            if (!boundary.get(key)!.includes(nIdx)) boundary.get(key)!.push(nIdx);
          }
        }
      }
    }

    return { newReveals, boundary };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private persistReveals(indices: number[], playerId: string): void {
    if (indices.length === 0) return;
    const now = Date.now();
    // SQLite in Workers caps bound parameters per statement; batch to stay safe.
    const BATCH = 100;
    for (let start = 0; start < indices.length; start += BATCH) {
      const batch = indices.slice(start, start + BATCH);
      const placeholders = batch.map(() => '(?, ?, ?)').join(', ');
      this.sql.exec(
        `INSERT OR IGNORE INTO reveals (cell_index, player_id, revealed_at) VALUES ${placeholders}`,
        ...batch.flatMap(i => [i, playerId, now])
      );
    }
    for (const i of indices) this.revealed.set(i, playerId);
  }

  private buildStateSnapshot(): ChunkStateResponse {
    const layout = this.getOrComputeLayout();
    const cells: CellState[] = [];

    for (const [index, playerId] of this.revealed) {
      const isMine = layout[index] === 0xff;
      cells.push({
        index,
        isMine,
        adjacentMines: isMine ? 0 : layout[index],
        revealedBy: playerId,
      });
    }
    for (const [index, playerId] of this.flagged) {
      if (!this.revealed.has(index)) {
        const existing = cells.find(c => c.index === index);
        if (existing) {
          existing.flaggedBy = playerId;
        } else {
          const isMine = layout[index] === 0xff;
          cells.push({
            index,
            isMine,
            adjacentMines: isMine ? 0 : layout[index],
            flaggedBy: playerId,
          });
        }
      }
    }

    return { chunkX: this.chunkX, chunkY: this.chunkY, cells };
  }

  private async propagateBoundary(
    boundary: Map<string, number[]>,
    playerId: string
  ): Promise<void> {
    if (boundary.size === 0) return;
    await Promise.allSettled(
      [...boundary.entries()].map(async ([key, origins]) => {
        const colonIdx = key.indexOf(':');
        const cx = parseInt(key.slice(0, colonIdx), 10);
        const cy = parseInt(key.slice(colonIdx + 1), 10);
        const stub = this.env.CHUNK_DO.get(
          this.env.CHUNK_DO.idFromName(`${this.gameId}:${cx}:${cy}`)
        );
        await (stub as any).floodFill(origins, playerId);
      })
    );
  }

  private async broadcastDelta(delta: ChunkDelta): Promise<void> {
    const dead: string[] = [];
    await Promise.allSettled(
      [...this.subscribers].map(async sessionDoId => {
        try {
          const stub = this.env.SESSION_DO.get(
            this.env.SESSION_DO.idFromString(sessionDoId)
          );
          await (stub as any).onChunkDelta(delta);
        } catch {
          dead.push(sessionDoId);
        }
      })
    );
    for (const d of dead) this.subscribers.delete(d);
  }
}
