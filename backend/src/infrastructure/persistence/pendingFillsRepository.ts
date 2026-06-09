import { Collection } from 'mongodb';

interface PendingFillEntry {
  localX: number;
  localY: number;
}

export interface PendingFillDocument {
  _id: string;        // "gameId_chunkX_chunkY"
  gameId: string;
  chunkX: number;
  chunkY: number;
  entries: PendingFillEntry[];
}

export class PendingFillsRepository {
  constructor(private readonly collection: Collection<PendingFillDocument>) {}

  private id(gameId: string, chunkId: string): string {
    return `${gameId}_${chunkId}`;
  }

  async save(gameId: string, chunkId: string, entries: PendingFillEntry[]): Promise<void> {
    const [chunkX, chunkY] = chunkId.split('_').map(Number);
    await this.collection.updateOne(
      { _id: this.id(gameId, chunkId) },
      {
        $set: { entries, chunkX, chunkY, gameId },
        $setOnInsert: { _id: this.id(gameId, chunkId) },
      },
      { upsert: true }
    );
  }

  async delete(gameId: string, chunkId: string): Promise<void> {
    await this.collection.deleteOne({ _id: this.id(gameId, chunkId) });
  }

  /** Deletes every pending-fill document for a game. Used when world schema version changes. */
  async dropAllForGame(gameId: string): Promise<number> {
    const result = await this.collection.deleteMany({ gameId });
    return result.deletedCount;
  }

  async loadAll(gameId: string): Promise<Map<string, PendingFillEntry[]>> {
    const docs = await this.collection.find({ gameId }).toArray();
    const result = new Map<string, PendingFillEntry[]>();
    for (const doc of docs) {
      result.set(`${doc.chunkX}_${doc.chunkY}`, doc.entries);
    }
    return result;
  }
}
