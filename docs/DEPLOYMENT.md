# Deployment guide

## Architecture

- **`server/`** — a single Node process that serves everything: the REST API, the embed script (`/embed/:token.js`), the demo prototype (`/demo`), and the built dashboard (`web/dist`). One deployable unit.
- **`web/`** — the React dashboard; `npm run build` outputs static files the server hosts. No SSR.
- **Database** — SQLite file at `server/data/contextly.db` (WAL mode). No external DB service needed.

## Deploying to a Node host (Render / Railway / Fly.io)

1. Set environment variables:
   - `JWT_SECRET` — a long random string (**required**).
   - `PORT` — usually provided by the host.
2. Build command: `npm install && npm run build`
3. Start command: `npm start`
4. Attach a persistent disk mounted at `server/data` (SQLite must survive restarts). On Fly.io: `fly volumes create contextly_data --size 1` and mount it at `/app/server/data`.
5. Point your domain at the host. Everything (dashboard, API, embed script) must share **one origin** so the embed script is same-origin with the API and CORS is trivial.

## Deploying the frontend separately (optional)

You can host `web/dist` on Vercel/Netlify/Cloudflare Pages and run `server/` elsewhere:

1. On the static host, proxy `/api/*` and `/embed/*` to the API server (Netlify `_redirects`, Vercel rewrites, or a `_redirects`-equivalent), **or**
2. Change `API` resolution in `server/public/embed.js` to an absolute API base URL, and set the API origin in `web/src/api.js`.
3. Add the API origin to CORS (`server/src/index.js` currently allows any origin — restrict `origin` to your dashboard domain for production).

## Database migrations

Schema lives in `server/src/db.js` using `CREATE TABLE IF NOT EXISTS` — safe to run on every boot. For breaking schema changes, add a small migration runner (a `schema_migrations` table + ordered SQL files) before your first production deploy.

## Production checklist

- [ ] `JWT_SECRET` set to a strong random value (rotate = logs everyone out).
- [ ] HTTPS only (most hosts provide it; embeds require it on https pages).
- [ ] Restrict CORS in `server/src/index.js` to your dashboard origin.
- [ ] Persistent disk for `server/data/` (or swap `node:sqlite` for managed Postgres + an ORM if you expect heavy write load).
- [ ] Backups of the SQLite file (litestream works well if you stay on SQLite).
- [ ] Per-project **Allowed domains** set to the prototype's real host instead of `*`.
- [ ] Log rotation / APM on the Node process.

## Scaling notes

- The MVP uses 5-second polling instead of WebSockets — fine for review traffic; add Socket.IO (events already conceptualized: `comment.created/updated/deleted`) if you want instant push.
- `node:sqlite` is synchronous; for most prototype-review workloads this is a non-issue. Move to Postgres (Prisma/Drizzle) when you need concurrent writers across regions.
- The embed script is served with `Cache-Control: no-cache` so token rotation takes effect immediately; add a CDN cache keyed on the token if download volume grows.
