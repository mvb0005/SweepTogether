import { Collection } from 'mongodb';
import { GameConfig } from '../../domain/types';

export interface GameDocument {
  _id: string;
  seed: string;
  config: GameConfig;
  createdAt: Date;
  /** World generation schema version — see src/domain/worldVersion.ts. Absent on legacy docs (treated as 1). */
  worldGenVersion?: number;
}

export class GameRepository {
  constructor(private readonly collection: Collection<GameDocument>) {}

  /**
   * Returns the seed and worldGenVersion for an existing game, or creates the
   * game document using gameId as seed with version=undefined (legacy-safe).
   * Safe to call concurrently — $setOnInsert guarantees one seed per game.
   */
  async createOrLoad(gameId: string, config: GameConfig): Promise<{ seed: string; worldGenVersion: number }> {
    const result = await this.collection.findOneAndUpdate(
      { _id: gameId },
      { $setOnInsert: { _id: gameId, seed: gameId, config, createdAt: new Date() } },
      { upsert: true, returnDocument: 'after' }
    );
    return { seed: result!.seed, worldGenVersion: result!.worldGenVersion ?? 1 };
  }

  /** Stamp the game document with the current world generation schema version. */
  async setWorldGenVersion(gameId: string, version: number): Promise<void> {
    await this.collection.updateOne({ _id: gameId }, { $set: { worldGenVersion: version } });
  }
}
