import { Router, Request, Response } from 'express';

const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token';

export function createDiscordRoutes(): Router {
  const router = Router();

  router.post('/token', async (req: Request, res: Response) => {
    const clientId = process.env.DISCORD_CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    const { code } = req.body as { code?: string };

    if (!clientId || !clientSecret) {
      res.status(503).json({ error: 'Discord OAuth is not configured on the server' });
      return;
    }
    if (!code || typeof code !== 'string') {
      res.status(400).json({ error: 'Missing OAuth code' });
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
        console.error('[discord/token] exchange failed:', data);
        res.status(502).json({ error: data.error ?? 'Token exchange failed' });
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
