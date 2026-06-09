import { Router, Request, Response } from 'express';

const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token';

// Discord authorization codes are short; reject anything implausible early.
const MAX_CODE_LENGTH = 512;

// Lightweight in-memory fixed-window rate limiter (per client IP). This endpoint
// is unauthenticated and triggers an outbound call to Discord using our client
// secret, so it must not be freely spammable. For multi-replica deployments this
// should move to a shared store (Redis), but per-process limiting is a sane floor.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 20;
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now >= entry.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX;
}

// Periodically drop stale buckets so the map can't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of hits) {
    if (now >= entry.resetAt) hits.delete(ip);
  }
}, RATE_LIMIT_WINDOW_MS).unref();

export function createDiscordRoutes(): Router {
  const router = Router();

  router.post('/token', async (req: Request, res: Response) => {
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    if (rateLimited(ip)) {
      res.status(429).json({ error: 'Too many requests' });
      return;
    }

    const clientId = process.env.DISCORD_CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    const { code } = req.body as { code?: unknown };

    if (!clientId || !clientSecret) {
      res.status(503).json({ error: 'Discord OAuth is not configured on the server' });
      return;
    }

    if (typeof code !== 'string' || code.length === 0 || code.length > MAX_CODE_LENGTH) {
      res.status(400).json({ error: 'Missing or invalid OAuth code' });
      return;
    }

    try {
      const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
      });

      const tokenRes = await fetch(DISCORD_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });

      const data = await tokenRes.json() as { access_token?: string; error?: string };

      if (!tokenRes.ok || !data.access_token) {
        // Log Discord's detail server-side only; return a generic message to the client.
        console.error('[discord/token] exchange failed:', data);
        res.status(502).json({ error: 'Token exchange failed' });
        return;
      }

      res.json({ access_token: data.access_token });
    } catch (err) {
      console.error('[discord/token] error:', err);
      res.status(500).json({ error: 'Token exchange failed' });
    }
  });

  return router;
}
