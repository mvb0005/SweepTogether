import { Coordinates } from '../types';

export function chunkSetKey(chunks: Coordinates[]): string {
  return chunks.map(c => `${c.x},${c.y}`).sort().join('|');
}
