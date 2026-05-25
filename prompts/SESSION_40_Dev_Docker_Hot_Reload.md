# Session 40: Dev Docker Hot-Reload Stack

## Original Prompt
Uncommitted work included a dev/prod Docker split — restore a productive local loop with Vite HMR and nodemon without breaking production builds.

## Session Notes
- Switched `docker-compose.yml` to development mode: backend runs `nodemon` with `src/` volume mount (preserves image-built `native/index.node`), frontend runs Vite dev server on `:3000`.
- Updated `nginx/nginx.conf` to proxy to `frontend:3000` with WebSocket upgrade headers for HMR.
- Replaced multi-stage production `frontend/Dockerfile` with a dev-oriented image; production build lives in `frontend/Dockerfile.prod`.
- Backend Dockerfile default CMD is `npm run dev`; `NODE_OPTIONS=--max-old-space-size=4096` added for marathon testing.
- Updated `CLAUDE.md` with `docker compose` commands for dev vs prod stacks.

## Deferred / Incomplete
- Production stack validation on a fresh machine (not run this session).
- Native addon must still be built inside the backend image — volume mount excludes `native/` intentionally.
