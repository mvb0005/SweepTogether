/** Per-replica fill queue + single-flight guard. Swappable for Mongo/Redis lease later. */
export interface FillPoint {
  x: number;
  y: number;
}

export interface FillCoordinator {
  pushSeeds(gameId: string, points: FillPoint[], maxQueue: number): void;
  /** Returns true if this replica should start draining (not already running). */
  tryAcquire(gameId: string): boolean;
  takeBatch(gameId: string, maxSeeds: number): FillPoint[];
  hasPending(gameId: string): boolean;
  release(gameId: string): void;
}

export class InMemoryFillCoordinator implements FillCoordinator {
  private queues = new Map<string, FillPoint[]>();
  private running = new Set<string>();

  pushSeeds(gameId: string, points: FillPoint[], maxQueue: number): void {
    if (points.length === 0) return;
    let queue = this.queues.get(gameId);
    if (!queue) {
      queue = [];
      this.queues.set(gameId, queue);
    }
    queue.push(...points);
    if (queue.length > maxQueue) {
      queue.splice(0, queue.length - maxQueue);
    }
  }

  tryAcquire(gameId: string): boolean {
    if (this.running.has(gameId)) return false;
    this.running.add(gameId);
    return true;
  }

  takeBatch(gameId: string, maxSeeds: number): FillPoint[] {
    const queue = this.queues.get(gameId);
    if (!queue || queue.length === 0) return [];
    return queue.splice(0, maxSeeds);
  }

  hasPending(gameId: string): boolean {
    return (this.queues.get(gameId)?.length ?? 0) > 0;
  }

  release(gameId: string): void {
    this.running.delete(gameId);
  }
}
