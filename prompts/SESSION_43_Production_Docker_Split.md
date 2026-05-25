# Session 43: Production Docker Compose Split

## Original Prompt
Keep a fast dev stack while preserving a production-oriented compose file for deployed builds.

## Session Notes
- Added `docker-compose.prod.yml`: production backend build, `frontend/Dockerfile.prod` (static nginx), `nginx/nginx.prod.conf` entry point on `:8080`.
- Dev stack (`docker-compose.yml`) and prod stack are now independent — dev uses Vite + nodemon; prod uses compiled assets and `npm start` backend.

## Deferred / Incomplete
- Cloudflare tunnel service remains in dev compose only; prod tunnel wiring not updated this session.
- CI does not yet build/test prod compose on every PR.
