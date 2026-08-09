# AGENT.md

Context for Cursor and future agents working in this repo. Human how-tos: `docs/DEV.md`, `docs/MIGRATIONS.md`, `docs/LM_STUDIO.md`. Do not duplicate those step-by-steps here; keep this file to facts that are expensive to infer.

## What this is

Marlin is a **personal, single-user** search index aimed at tens of millions of domains. No auth, no multi-tenancy. Do **not** add `userId` or a domain-ignore table unless asked. Ignore is a boolean on `categories` and `tags`.

v1 discovery is a **domain list file** plus **link following**. There is no IPv4/ICMP/TLS-SAN scanner.

## Layout

| Path | Owns |
| --- | --- |
| `apps/spider` | Ingest CLI (`src/ingest.ts`) + BFS link spider (`src/index.ts`) |
| `apps/worker` | Queue consumer, homepage fetch, **one** LM Studio call; `src/probe.ts` is the no-DB smoke test |
| `apps/api` | Fastify `/api/*` search + ignore toggles |
| `apps/web` | Vite + React search UI + ignore modal |
| `packages/db` | Drizzle schema, SQL migrations, pool, queries, migrate/requeue CLIs |
| `packages/shared` | Hostname normalize, English TLD whitelist, fetch/extract, LLM prompt + JSON schema |
| `data/domains.sample.txt` | Tiny ingest file for test runs |

`packages/db` is the only place schema/SQL should live. `packages/shared` is the only place hostname rules and the LLM schema should live — spider and worker must not fork copies.

Runtime is TypeScript via `tsx` (dev and Docker). Workspace `exports` point at `src/*.ts`.

## Invariants (do not “simplify” away)

- **One LM call per domain.** Structured JSON schema first, one prompt-only retry, then `failed`. Prompt/schema: `packages/shared/src/llm.ts`. Caller: `apps/worker/src/lm.ts`. Display `name` is `pickSiteName` in `packages/shared/src/name.ts` (prefer cleaned `<title>` when the model returns a generic word).
- **Ignore is search-time only.** Worker still summarizes ecommerce/news/social so categories can be learned, then toggled off in the UI (`ignored` on `categories` / `tags`).
- **Category/tag identity** is the lowercased exact LLM string (`normalizeLabel`). No fuzzy merge / synonym collapsing.
- **Queue is Postgres**, `FOR UPDATE SKIP LOCKED` on `domains.status` (`packages/db/src/queries.ts` `claimNextDomain`). Not Redis.
- **Do not store full HTML.** Fetch + truncated text only (`packages/shared/src/page.ts`).
- **No IPv4 scanning** in v1. Discovery = ingest list + `<a href>` hosts.
- **`normalizeHost`** (`packages/shared/src/hostname.ts`) strips `www.`, lowercases, rejects IPs/localhost/no-TLD. Spider **and** worker must use it or dedup breaks (`domains.host` UNIQUE).
- **English TLD whitelist** (`packages/shared/src/tlds.ts`): last label only (`.de` out, `.co.uk` → `uk` in). Applied in `enqueueHosts`, spider BFS, and worker (no LM call). Override with `TLD_WHITELIST`. Existing pending/processing non-matches are bulk-marked `skipped` on worker start. `de.wikipedia.org` is `.org` and still allowed.
- **Never edit an applied migration.** Add `packages/db/migrations/0002_….sql`.
- **LM Studio is host-side**, not a Compose service. Containers use `http://host.docker.internal:1234/v1`.

## Data flow

```
domains.txt  --ingest-->  domains(status=pending, source=list)
seeds        --spider-->  domains(pending, source=spider) + more hosts from links
pending      --worker-->  claim processing → fetch → extract links (source=link)
                         → LM catalog → upsert category/tags, bump domain_count → done|failed
UI search    --api-->     done rows, hide ignored category OR any ignored tag
```

Statuses: `pending` | `processing` | `done` | `failed` | `skipped`.

`domain_count` on categories/tags is a **counter cache** incremented when a domain is completed. Do not `COUNT(*)` 40M rows for the ignore modal.

## Workflows

**Dev:** Postgres via Compose (host port **5433** → container 5432); api/web/worker/spider on the host (`npm run dev` = api+web). LM Studio `:1234`. Vite `:5173` proxies `/api` → `:3000`. Root `.env` is loaded from `packages/db/src/env.ts` (repo root), not per-app folders.

**Safe test order:** LM Studio → `npm run probe -- example.com` (no DB) → migrate → `npm run ingest -- ./data/domains.sample.txt` → `npm run worker` (concurrency 1) → UI search → ignore modal → only then spider with depth 1 / low `SPIDER_MAX_HOSTS`.

**Schema change:** edit `packages/db/src/schema.ts` (+ queries) → new SQL under `packages/db/migrations/` → `npm run db:migrate`. Keep Compose `migrate` as a dependency of api/worker/spider.

**Prod-ish:** `docker compose up --build` for postgres+migrate+api+web. Spider+worker: `--profile tools`.

**Requeue:** `npm run requeue -- failed` or `processing`. Do not auto-retry failed rows in a tight loop. Worker startup already reclaims `processing` → `pending`.

## LM / fetch pitfalls

- Default `WORKER_CONCURRENCY=1` (local GPU). Must be ≤ LM Studio Parallel. Parallel N **divides** the loaded context across N slots — `Context size has been exceeded` after raising concurrency almost always means the window is too small, not a Marlin bug. `LM_TEXT_CHARS` caps page text (default 4000). Do not prompt-only retry context-exceeded errors.
- Body cap ~1MB, text to the model ~8k chars, HTTPS then HTTP, 15s fetch timeout, LM timeout often 60–120s.
- If LM is down, mark `failed`. Do not leave rows in `processing` without reclaim (startup reset covers crash mid-job).
- `LM_MODEL` empty → first id from `GET /v1/models`.

## Search pitfalls

- Empty `q` = browse latest `done` rows with filters. Fuzzy: `pg_trgm` `%` / `similarity()` plus `ILIKE` on summary/host/name (`searchDomains` in `packages/db/src/queries.ts`).
- Typeahead hits `categories` / `tags` (tiny), never a trgm scan of `domains` for selectboxes.
- Hide if category `ignored` **or** the domain has **any** ignored tag.
- GIN trgm on `domains.summary` will be large at 40M rows — do not add extra trgm indexes casually.

## Scale notes

~40M domains × ~1KB ≈ 40GB plus the summary trgm index. Unique `host` is the dedup key. Ingest streams the list file in batches of 1000.

## Explicit non-goals (v1)

IPv4/TLS scanning, user accounts, recrawl scheduler, robots.txt beyond UA + delay, storing HTML, cleaning near-duplicate categories, Redis, multi-tenant ignore lists.

## Where to look

- Schema / queue / search SQL: `packages/db/src/schema.ts`, `packages/db/src/queries.ts`
- First migration + trgm: `packages/db/migrations/0001_init.sql`
- Fetch + extract: `packages/shared/src/page.ts`
- Compose profiles: `docker-compose.yml` (`tools`), overlay `docker-compose.dev.yml` (host-run apps)
- Env template: `.env.example`
