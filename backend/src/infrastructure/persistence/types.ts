// backend/src/infrastructure/persistence/types.ts
import { Cell, GameState } from '../../domain/types';

/**
 * Interface defining the contract for game persistence operations.
 */
export interface GameRepository {
  /**
   * Finds and retrieves a game's metadata by its ID.
   * @param gameId The ID of the game to find.
   * @returns A promise resolving to the GameState metadata (excluding board/grid state) or null if not found.
   */
  findGameById(gameId: string): Promise<Partial<GameState> | null>;

  /**
   * Saves the core metadata of a game state.
   * This typically includes config, players, scores, game over status, etc., but not the full board/grid state.
   * @param gameState The game state metadata to save.
   * @returns A promise resolving when the save is complete.
   */
  saveGame(gameState: Partial<GameState>): Promise<void>;

  /**
   * Finds and retrieves a specific chunk of the spatial grid from persistence.
   * @param gameId The ID of the game the chunk belongs to.
   * @param chunkId The ID of the chunk (e.g., "x_y" coordinates of the chunk).
   * @returns A promise resolving to the chunk data (Map<string, Cell>) or null if not found.
   */
  findChunk(gameId: string, chunkId: string): Promise<Map<string, Cell> | null>;

  /**
   * Saves or updates a specific chunk of the spatial grid in persistence.
   * @param gameId The ID of the game the chunk belongs to.
   * @param chunkId The ID of the chunk.
   * @param chunkData The data (Map<string, Cell>) of the chunk to save.
   * @returns A promise resolving when the save is complete.
   */
  saveChunk(gameId: string, chunkId: string, chunkData: Map<string, Cell>): Promise<void>;
}
