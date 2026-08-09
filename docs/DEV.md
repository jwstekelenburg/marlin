# Dev and build workflow

## Prerequisites

- Node 22+
- Docker + Compose (Postgres; optional full stack)
- LM Studio running locally before the worker — [LM_STUDIO.md](./LM_STUDIO.md)

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
npm run worker              # separate terminal; concurrency 1
```

Optional spider (keep caps small until you trust it):

```bash
npm run spider              # uses SPIDER_* from .env
```

Open http://localhost:5173 — search, then **Ignore lists** to hide ecommerce / social / news categories after they appear.

Other scripts:

| Command | What |
| --- | --- |
| `npm run dev:worker` | worker with reload |
| `npm run dev:spider` | spider with reload |
| `npm run dev:tools` | api + web + worker |
| `npm run requeue -- failed` | `failed` → `pending` (also `processing`) |
| `npm run typecheck` | `tsc --noEmit` in workspaces that define it |
| `npm run db:studio` | Drizzle Studio |

Safe test order: LM Studio up → `npm run probe -- example.com` → migrate → ingest sample file → worker → UI + ignore modal → spider with `SPIDER_MAX_DEPTH=1` and a low `SPIDER_MAX_HOSTS`.

## Docker (UI + API)

```bash
docker compose up --build postgres migrate api web
```

UI at http://localhost:8080, API at http://localhost:3000.

Worker + spider are behind the Compose profile `tools` so a UI-only up does not crawl:

```bash
docker compose --profile tools up --build
```

From containers, LM Studio is `http://host.docker.internal:1234/v1` (see compose `extra_hosts`). Bind LM Studio to `0.0.0.0:1234`.

## Env vars

See [`.env.example`](../.env.example). Apps load the repo-root `.env` via `@marlin/db` (not `apps/*/.env`).
