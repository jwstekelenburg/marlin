# Dev and build workflow

## Prerequisites

- Node 22+
- Docker + Compose (Postgres; optional full stack)
- LM Studio running locally before the worker — [LM_STUDIO.md](./LM_STUDIO.md) (rented GPU: [SUMMARISER.md](./SUMMARISER.md))

## First-time setup

```bash
cp .env.example .env
npm install
docker compose -f docker-compose.yml -f docker-compose.dev.yml up postgres migrate
```

`DATABASE_URL` in `.env` should stay `postgres://marlin:marlin@localhost:5433/marlin` when Postgres is published on the host (container still listens on 5432 internally).

If you start Postgres without the migrate service:

```bash
npm run db:migrate
```

## Daily development

LM Studio local server on `:1234`, then:

```bash
npm run dev                 # API :3000 + Vite UI :5173
npm run ingest -- ./data/domains.sample.txt
npm run fetcher             # network: pending → ready (stores outbound hosts)
npm run worker              # GPU: ready → done (profile from WORKER_PROFILE)
npm run worker -- vast      # same, override profile from data/worker-profiles.json
```

Edit [`data/category-priority.txt`](../data/category-priority.txt) to boost or demote LLM categories. Restart fetcher + worker after changes. Seeds ingest at the `seed` weight so they jump the queue.

`MAX_SUBDOMAINS_PER_APEX` (default 100) caps how many hosts under one registrable domain are stored. Extra Tumblr/Neocities-style user sites are dropped at enqueue, not shelved. After migrate, over-cap **pending** rows on those apexes are deleted; `done` stays.

Optional spider (keep caps small until you trust it):

```bash
npm run spider              # uses SPIDER_* from .env
```

Open http://localhost:5173 — search, **Dashboard** for queues / categories / throughput, then **Ignore lists** to hide ecommerce / social / news after they appear.

Other scripts:

| Command | What |
| --- | --- |
| `npm run dev:fetcher` | fetcher with reload |
| `npm run dev:worker` | LM worker with reload |
| `npm run dev:spider` | spider with reload |
| `npm run dev:tools` | api + web + fetcher + LM worker |
| `npm run requeue -- failed` | `failed` → `ready` if page text exists, else `pending` |
| `npm run flush-queue` | delete unfinished domain rows; keep `done` |
| `npm run merge-labels` | dry-run tag/category spelling merges (`data/label-aliases.txt`); `-- --apply` to write |
| `npm run typecheck` | `tsc --noEmit` in workspaces that define it |
| `npm run db:studio` | Drizzle Studio |

Safe test order: LM Studio up → `npm run probe -- example.com` → migrate → ingest sample file → fetcher + worker → UI + ignore modal → spider with `SPIDER_MAX_DEPTH=1` and a low `SPIDER_MAX_HOSTS`.

## Docker (UI + API)

```bash
docker compose up --build postgres migrate api web
```

UI at http://localhost:8080, API at http://localhost:3000.

Fetcher + worker + spider are behind the Compose profile `tools` so a UI-only up does not crawl:

```bash
docker compose --profile tools up --build
```

From containers, LM Studio is `http://host.docker.internal:1234/v1` (see compose `extra_hosts`). Bind LM Studio to `0.0.0.0:1234`.

## Env vars

See [`.env.example`](../.env.example). Apps load the repo-root `.env` via `@marlin/db` (not `apps/*/.env`).
