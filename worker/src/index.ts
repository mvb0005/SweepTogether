import { SessionDO } from './session-do';
import { ChunkDO } from './chunk-do';
import { Env } from './types';

export { SessionDO, ChunkDO };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Upgrade, Connection',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    // WebSocket upgrade — create a new Session DO per connection
    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('Expected WebSocket upgrade', { status: 426, headers: CORS });
      }
      const doId = env.SESSION_DO.newUniqueId();
      return env.SESSION_DO.get(doId).fetch(request);
    }

    return new Response('SweepTogether — connect via WebSocket at /ws', {
      headers: { ...CORS, 'Content-Type': 'text/plain' },
    });
  },
} satisfies ExportedHandler<Env>;
