import { Collection } from 'mongodb';
import { GameConfig } from '../../domain/types';

export interface GameDocument {
  _id: string;
  seed: number;
  config: GameConfig;
  createdAt: Date;
}

export class GameRepository {
  constructor(private readonly collection: Collection<GameDocument>) {}

  /**
   * Returns the seed for an existing game, or creates the game with a new random seed.
   * Safe to call concurrently — $setOnInsert guarantees one seed per game.
   */
  async createOrLoad(gameId: string, config: GameConfig): Promise<number> {
    const seed = Math.floor(Math.random() * 2 ** 31);
    const result = await this.collection.findOneAndUpdate(
      { _id: gameId },
      { $setOnInsert: { _id: gameId, seed, config, createdAt: new Date() } },
      { upsert: true, returnDocument: 'after' }
    );
    return result!.seed;
  }
}
