import { Collection, Binary } from 'mongodb';
import { CHUNK_SIZE } from '../../types/chunkTypes';

/** MongoDB returns Binary on read even when you stored a Buffer. This normalises both. */
function toBuffer(val: Buffer | Binary): Buffer {
  if (Buffer.isBuffer(val)) return val;
  // Binary.buffer is a Node.js Buffer in the official driver
  return (val as Binary).buffer as unknown as Buffer;
}

const CELLS_PER_CHUNK = CHUNK_SIZE * CHUNK_SIZE; // 256

export interface ChunkDocument {
  _id: string;           // "gameId_chunkX_chunkY"
  gameId: string;
  chunkX: number;
  chunkY: number;
  version: number;
  /** chunk-local player IDs; index into this array is what revealed/flagged buffers store */
  players: string[];
  /** 256-byte buffer: -1 (0xFF) = unrevealed, 0..63 = playerIndex who revealed */
  revealed: Buffer;
  /** 256-byte buffer: -1 (0xFF) = unflagged, 0..63 = playerIndex who flagged */
  flagged: Buffer;
  loc: [number, number];
  updatedAt: Date;
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
    return this.collection.findOne({ _id: this.id(gameId, chunkX, chunkY) });
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
          loc: [chunkX, chunkY] as [number, number],
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
      if (!doc) return;

      const buf = toBuffer(doc.revealed);
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
      if (!doc) return;

      const buf = toBuffer(doc.flagged);
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
   * Loads the revealed/flagged state from a persisted chunk document as a flat map.
   * Returns sets of cell indices that are revealed or flagged.
   */
  static decode(doc: ChunkDocument): { revealedIndices: Set<number>; flaggedIndices: Set<number> } {
    const revealedIndices = new Set<number>();
    const flaggedIndices = new Set<number>();

    const rev = toBuffer(doc.revealed);
    const flg = toBuffer(doc.flagged);

    for (let i = 0; i < CELLS_PER_CHUNK; i++) {
      if (rev.readInt8(i) !== -1) revealedIndices.add(i);
      if (flg.readInt8(i) !== -1) flaggedIndices.add(i);
    }

    return { revealedIndices, flaggedIndices };
  }
}
