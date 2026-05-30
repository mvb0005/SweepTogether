# Discord Activity Setup

SweepTogether runs as a [Discord Activity](https://discord.com/developers/docs/activities/overview) at **`https://local.sweeptogether.com`**.

## Local stack

1. **Cloudflare tunnel** (already in `docker-compose.yml`) — point `local.sweeptogether.com` → `nginx:80`
2. **Optional hosts entry** for testing without tunnel DNS:
   ```
   127.0.0.1 local.sweeptogether.com
   ```
3. Start the stack:
   ```bash
   docker compose up --build
   ```
4. Open **https://local.sweeptogether.com** (tunnel) or **http://local.sweeptogether.com:8080** (hosts file)

## Discord Developer Portal

1. Create an app at [discord.com/developers/applications](https://discord.com/developers/applications)
2. Enable **Activities**
3. **OAuth2 → Redirects**: not required for embedded authorize flow
4. **Activities → URL Mappings**:
   | Prefix | Target |
   |--------|--------|
   | `/` | `https://local.sweeptogether.com` |
   | `/cdn` | `https://cdn.discordapp.com` |

   The CDN mapping is required for profile pictures inside the Activity iframe (CSP blocks direct external image loads).
5. Copy **Client ID** and **Client Secret**

## Environment

Root `.env` (used by `docker-compose` backend):

```env
DISCORD_CLIENT_ID=your_client_id
DISCORD_CLIENT_SECRET=your_client_secret
SOCKET_CORS_ORIGINS=https://local.sweeptogether.com,http://local.sweeptogether.com,http://localhost:8080
PUBLIC_URL=https://local.sweeptogether.com
CLOUDFLARE_TUNNEL_TOKEN=...
```

Frontend `frontend/.env.development`:

```env
VITE_DISCORD_CLIENT_ID=your_client_id
VITE_AB_VARIANT=treatment
```

Restart after changing env vars:

```bash
docker compose up -d --build backend frontend nginx
```

## Behaviour

| Context | Game room | Username | Avatar |
|---------|-----------|----------|--------|
| Discord Activity | `discord-{instanceId}` (voice channel session) | Discord display name | Discord profile picture |
| Browser fallback | `default` | URL param or `Anonymous` | Colored circle |

In Discord, API calls use `/.proxy/api/*` (nginx rewrites to backend). Web browser uses `/api/*` directly.

When players are in the activity's voice channel, avatars show a **green ring** while they are speaking (Discord `SPEAKING_START` / `SPEAKING_STOP` events). This requires the `rpc.voice.read` OAuth scope — you must launch the activity from a voice channel, then re-launch once after scope changes so Discord re-authorizes.

Player avatars and display names for everyone in the activity are refreshed from Discord's [Instance Participants API](https://docs.discord.com/developers/activities/development-guides/multiplayer-experience#instance-participants) (`getInstanceConnectedParticipants` + `ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE`). Guild nicknames from the activity instance are used when present.

## Launch in Discord

1. Join a voice channel
2. Open **Activities** → your app → **Launch**
3. Everyone in the same activity instance shares one board

Without `VITE_DISCORD_CLIENT_ID`, the app runs in normal web mode at the same URL.
