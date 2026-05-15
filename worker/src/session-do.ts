import { DurableObject } from 'cloudflare:workers';
import {
  CHUNK_SIZE,
  GAME_ID,
  Env,
  ClientMessage,
  ServerMessage,
  ChunkDelta,
  ChunkStateResponse,
} from './types';

export class SessionDO extends DurableObject<Env> {
  private ws: WebSocket | null = null;
  private gameId: string = GAME_ID;
  private playerId: string = 'anon';
  private isLocked: boolean = false;

  // Chunk stubs cached by "chunkX:chunkY"
  private readonly chunkStubs = new Map<string, DurableObjectStub>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  // ── Entry point ──────────────────────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();
    this.ws = server;

    server.addEventListener('message', event => {
      const data = typeof event.data === 'string' ? event.data : '';
      this.handleMessage(data).catch(e => console.error('[SessionDO] message error', e));
    });

    server.addEventListener('close', () => this.handleClose());
    server.addEventListener('error', e => console.error('[SessionDO] ws error', e));

    return new Response(null, { status: 101, webSocket: client });
  }

  // ── RPC: Chunk DOs call this to push deltas to the player ───────────────────

  async onChunkDelta(delta: ChunkDelta): Promise<void> {
    if (!this.ws) return;

    const msg: ServerMessage = {
      type: 'chunkDelta',
      chunkX: delta.chunkX,
      chunkY: delta.chunkY,
      ...(delta.revealed  && { revealed:  delta.revealed  }),
      ...(delta.flagged   && { flagged:   delta.flagged   }),
      ...(delta.unflagged && { unflagged: delta.unflagged }),
    };
    this.ws.send(JSON.stringify(msg));

    if (delta.mineHit) {
      this.isLocked = true;
      this.send({ type: 'mineHit', ...delta.mineHit });
    }
  }

  // ── Message routing ──────────────────────────────────────────────────────────

  private async handleMessage(raw: string): Promise<void> {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      this.send({ type: 'error', message: 'Invalid JSON' });
      return;
    }

    switch (msg.type) {
      case 'join':
        this.playerId = msg.playerId || 'anon';
        this.gameId   = GAME_ID;
        this.send({ type: 'joined', playerId: this.playerId });
        break;

      case 'subscribe':
        await this.handleSubscribe(msg.chunkX, msg.chunkY);
        break;

      case 'unsubscribe':
        await this.handleUnsubscribe(msg.chunkX, msg.chunkY);
        break;

      case 'reveal':
        if (!this.isLocked) await this.handleReveal(msg.worldX, msg.worldY);
        break;

      case 'flag':
        if (!this.isLocked) await this.handleFlag(msg.worldX, msg.worldY);
        break;

      case 'chord':
        if (!this.isLocked) await this.handleChord(msg.worldX, msg.worldY);
        break;
    }
  }

  // ── Chunk subscription ───────────────────────────────────────────────────────

  private getChunkStub(chunkX: number, chunkY: number): DurableObjectStub {
    const key = `${chunkX}:${chunkY}`;
    let stub = this.chunkStubs.get(key);
    if (!stub) {
      stub = this.env.CHUNK_DO.get(
        this.env.CHUNK_DO.idFromName(`${this.gameId}:${chunkX}:${chunkY}`)
      );
      this.chunkStubs.set(key, stub);
    }
    return stub;
  }

  private async handleSubscribe(chunkX: number, chunkY: number): Promise<void> {
    const state: ChunkStateResponse = await (this.getChunkStub(chunkX, chunkY) as any)
      .subscribe(this.ctx.id.toString());
    this.send({ type: 'chunkState', ...state });
  }

  private async handleUnsubscribe(chunkX: number, chunkY: number): Promise<void> {
    const key = `${chunkX}:${chunkY}`;
    const stub = this.chunkStubs.get(key);
    if (stub) {
      await (stub as any).unsubscribe(this.ctx.id.toString());
      this.chunkStubs.delete(key);
    }
  }

  // ── Player actions ───────────────────────────────────────────────────────────

  private worldToChunk(worldX: number, worldY: number) {
    const chunkX  = Math.floor(worldX / CHUNK_SIZE);
    const chunkY  = Math.floor(worldY / CHUNK_SIZE);
    const localX  = ((worldX % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const localY  = ((worldY % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const cellIdx = localY * CHUNK_SIZE + localX;
    return { chunkX, chunkY, cellIdx };
  }

  private async handleReveal(worldX: number, worldY: number): Promise<void> {
    const { chunkX, chunkY, cellIdx } = this.worldToChunk(worldX, worldY);
    await (this.getChunkStub(chunkX, chunkY) as any).reveal([cellIdx], this.playerId);
  }

  private async handleFlag(worldX: number, worldY: number): Promise<void> {
    const { chunkX, chunkY, cellIdx } = this.worldToChunk(worldX, worldY);
    await (this.getChunkStub(chunkX, chunkY) as any).toggleFlag(cellIdx, this.playerId);
  }

  private async handleChord(_worldX: number, _worldY: number): Promise<void> {
    // TODO: chord click (needs cross-chunk neighbour flag state queries)
  }

  // ── Disconnect ───────────────────────────────────────────────────────────────

  private handleClose(): void {
    const myId = this.ctx.id.toString();
    for (const stub of this.chunkStubs.values()) {
      (stub as any).unsubscribe(myId).catch(console.error);
    }
    this.chunkStubs.clear();
    this.ws = null;
  }

  // ── Utilities ────────────────────────────────────────────────────────────────

  private send(msg: ServerMessage): void {
    try {
      this.ws?.send(JSON.stringify(msg));
    } catch {
      // WS already closed
    }
  }
}
