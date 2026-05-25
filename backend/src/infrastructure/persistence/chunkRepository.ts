import { Collection, Binary } from 'mongodb';
import { CHUNK_SIZE } from '../../types/chunkTypes';

/** MongoDB returns Binary on read even when you stored a Buffer. This normalises both. */
export function chunkDocBuffer(val: Buffer | Binary | undefined): Buffer {
  if (!val) return emptyBuffer();
  if (Buffer.isBuffer(val)) return val;
  return (val as Binary).buffer as unknown as Buffer;
}

const CELLS_PER_CHUNK = CHUNK_SIZE * CHUNK_SIZE;

export interface ChunkDocument {
  _id: string;           // "gameId_chunkX_chunkY"
  gameId: string;
  chunkX: number;
  chunkY: number;
  version: number;
  /** chunk-local player IDs; index into this array is what revealed/flagged buffers store */
  players: string[];
  /** CELLS_PER_CHUNK-byte buffer: -1 (0xFF) = unrevealed, 0..63 = playerIndex who revealed */
  revealed: Buffer;
  /** CELLS_PER_CHUNK-byte buffer: -1 (0xFF) = unflagged, 0..63 = playerIndex who flagged */
  flagged: Buffer;
  updatedAt: Date;
  chunkConfig?: { type: 'noise' } | { type: 'custom'; mines: Binary }; // Binary from 'mongodb'
}

function emptyBuffer(): Buffer {
  return Buffer.alloc(CELLS_PER_CHUNK, 0xff); // 0xFF = readInt8 → -1
}

function cellIndex(localX: number, localY: number): number {
  return localY * CHUNK_SIZE + localX;
}

export class ChunkRepository {
  constructor(private readonly collection: Collection<ChunkDocument>) {}

  private id(gameId: string, chunkX: number, chunkY: number): string {
    return `${gameId}_${chunkX}_${chunkY}`;
  }

  async load(gameId: string, chunkX: number, chunkY: number): Promise<ChunkDocument | null> {
    return this.collection.findOne(
      { _id: this.id(gameId, chunkX, chunkY) },
      { projection: { revealed: 1, flagged: 1, chunkConfig: 1 } },
    );
  }

  async loadMany(gameId: string, coords: { chunkX: number; chunkY: number }[]): Promise<Map<string, ChunkDocument>> {
    if (coords.length === 0) return new Map();
    const ids = coords.map(({ chunkX, chunkY }) => this.id(gameId, chunkX, chunkY));
    const docs = await this.collection.find(
      { _id: { $in: ids } },
      { projection: { revealed: 1, flagged: 1, chunkConfig: 1 } },
    ).toArray();
    return new Map(docs.map(doc => [doc._id, doc as ChunkDocument]));
  }

  /** Returns all persisted chunk _ids for a game (lightweight index for skipping DB on noise chunks). */
  async listIds(gameId: string): Promise<Set<string>> {
    const docs = await this.collection.find({ gameId }, { projection: { _id: 1 } }).toArray();
    return new Set(docs.map(doc => doc._id as string));
  }

  /**
   * Creates an empty chunk document if one doesn't exist.
   * Safe to call concurrently — $setOnInsert is idempotent.
   */
  async ensure(gameId: string, chunkX: number, chunkY: number): Promise<void> {
    await this.collection.updateOne(
      { _id: this.id(gameId, chunkX, chunkY) },
      {
        $setOnInsert: {
          _id: this.id(gameId, chunkX, chunkY),
          gameId, chunkX, chunkY,
          version: 0,
          players: [],
          revealed: emptyBuffer(),
          flagged: emptyBuffer(),
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
  }

  /**
   * Returns the chunk-local player index for playerId, adding them if not present.
   * Uses findOneAndUpdate so concurrent calls serialize safely.
   */
  async getOrAddPlayerIndex(gameId: string, chunkX: number, chunkY: number, playerId: string): Promise<number> {
    const id = this.id(gameId, chunkX, chunkY);

    // Try to add the player (no-op if already present or chunk at capacity)
    const result = await this.collection.findOneAndUpdate(
      { _id: id, players: { $ne: playerId }, $expr: { $lt: [{ $size: '$players' }, 64] } },
      { $push: { players: playerId } },
      { returnDocument: 'after' }
    );

    const doc = result ?? await this.collection.findOne({ _id: id });
    return doc!.players.indexOf(playerId);
  }

  /**
   * Merges in-memory revealed/flagged chunk buffers into MongoDB.
   * Only writes cells currently unrevealed/unflagged in the persisted doc.
   */
  async syncChunkState(
    gameId: string,
    chunkX: number,
    chunkY: number,
    revealedBuf: Buffer,
    flaggedBuf: Buffer,
    playerId: string,
  ): Promise<{ revealed: number; flagged: number }> {
    await this.ensure(gameId, chunkX, chunkY);
    const playerIndex = await this.getOrAddPlayerIndex(gameId, chunkX, chunkY, playerId);
    if (playerIndex < 0) return { revealed: 0, flagged: 0 };

    const revealCells: { localX: number; localY: number }[] = [];
    for (let i = 0; i < CELLS_PER_CHUNK; i++) {
      if (revealedBuf[i] !== 0xff) {
        revealCells.push({ localX: i % CHUNK_SIZE, localY: Math.floor(i / CHUNK_SIZE) });
      }
    }
    if (revealCells.length > 0) {
      await this.revealCells(gameId, chunkX, chunkY, revealCells, playerIndex);
    }

    let flaggedCount = 0;
    for (let i = 0; i < CELLS_PER_CHUNK; i++) {
      if (flaggedBuf[i] === 0xff) continue;
      const localX = i % CHUNK_SIZE;
      const localY = Math.floor(i / CHUNK_SIZE);
      await this.setFlagged(gameId, chunkX, chunkY, localX, localY, playerIndex, true);
      flaggedCount++;
    }

    return { revealed: revealCells.length, flagged: flaggedCount };
  }

  /**
   * Persists revealed cells for a chunk using optimistic concurrency.
   * Retries if a concurrent write incremented the version.
   * Only sets cells that are currently unrevealed (-1) in the buffer.
   */
  async revealCells(
    gameId: string,
    chunkX: number,
    chunkY: number,
    localCells: { localX: number; localY: number }[],
    playerIndex: number
  ): Promise<void> {
    const id = this.id(gameId, chunkX, chunkY);

    for (let attempt = 0; attempt < 5; attempt++) {
      const doc = await this.collection.findOne({ _id: id });
      if (!doc) {
        console.warn(`[revealCells] chunk doc missing: ${id}`);
        return;
      }

      const buf = chunkDocBuffer(doc.revealed);
      let changed = false;
      for (const { localX, localY } of localCells) {
        const idx = cellIndex(localX, localY);
        if (buf.readInt8(idx) === -1) {
          buf.writeInt8(playerIndex, idx);
          changed = true;
        }
      }
      if (!changed) return;

      const result = await this.collection.updateOne(
        { _id: id, version: doc.version },
        { $set: { revealed: buf, updatedAt: new Date() }, $inc: { version: 1 } }
      );
      if (result.modifiedCount > 0) return;
      // version mismatch — retry
    }
  }

  /**
   * Sets or clears a flagged cell atomically.
   * set=true flags it, set=false unflags it.
   */
  async setFlagged(
    gameId: string,
    chunkX: number,
    chunkY: number,
    localX: number,
    localY: number,
    playerIndex: number,
    set: boolean
  ): Promise<void> {
    const id = this.id(gameId, chunkX, chunkY);

    for (let attempt = 0; attempt < 5; attempt++) {
      const doc = await this.collection.findOne({ _id: id });
      if (!doc) {
        console.warn(`[revealCells] chunk doc missing: ${id}`);
        return;
      }

      const buf = chunkDocBuffer(doc.flagged);
      const idx = cellIndex(localX, localY);
      buf.writeInt8(set ? playerIndex : -1, idx);

      const result = await this.collection.updateOne(
        { _id: id, version: doc.version },
        { $set: { flagged: buf, updatedAt: new Date() }, $inc: { version: 1 } }
      );
      if (result.modifiedCount > 0) return;
    }
  }

  /**
   * Upserts a chunk document with a custom mine layout.
   * Used by the pre-gen tool to write hand-authored chunk configurations.
   */
  async saveCustomChunk(
    gameId: string,
    chunkX: number,
    chunkY: number,
    mines: Uint8Array,
    preRevealedIndices?: number[]
  ): Promise<void> {
    const id = this.id(gameId, chunkX, chunkY);
    const revealedBuf = Buffer.alloc(CELLS_PER_CHUNK, 0xff);
    const players: string[] = [];

    if (preRevealedIndices && preRevealedIndices.length > 0) {
      players.push('__world__');
      for (const idx of preRevealedIndices) {
        revealedBuf.writeInt8(0, idx); // playerIndex 0 = __world__
      }
    }

    await this.collection.updateOne(
      { _id: id },
      {
        $set: {
          _id: id,
          gameId, chunkX, chunkY,
          version: 0,
          players,
          revealed: revealedBuf,
          flagged: emptyBuffer(),
          updatedAt: new Date(),
          chunkConfig: { type: 'custom', mines: new Binary(Buffer.from(mines)) },
        },
      },
      { upsert: true }
    );
  }

  /**
   * Returns the custom mine layout buffer if the document has chunkConfig.type === 'custom',
   * otherwise returns undefined (indicating noise-generated mines should be used).
   */
  static decodeMines(doc: ChunkDocument): Uint8Array | undefined {
    if (doc.chunkConfig?.type !== 'custom') return undefined;
    const buf = doc.chunkConfig.mines;
    return new Uint8Array(Buffer.isBuffer(buf) ? buf : (buf as Binary).buffer as unknown as Buffer);
  }

  /**
   * Loads the revealed/flagged state from a persisted chunk document as a flat map.
   * Returns sets of cell indices that are revealed or flagged.
   */
  static decode(doc: ChunkDocument): { revealedIndices: Set<number>; flaggedIndices: Set<number> } {
    const revealedIndices = new Set<number>();
    const flaggedIndices = new Set<number>();

    const rev = chunkDocBuffer(doc.revealed);
    const flg = chunkDocBuffer(doc.flagged);

    for (let i = 0; i < CELLS_PER_CHUNK; i++) {
      if (rev[i] !== 0xff) revealedIndices.add(i);
      if (flg[i] !== 0xff) flaggedIndices.add(i);
    }

    return { revealedIndices, flaggedIndices };
  }
}
