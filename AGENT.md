# AGENT.md

This is a fully vibe coded project with oversight, so this file reflects the current truth. When the humans request contradicts this file, clarify the intent to stray from the definition.

Context for Cursor and future agents working in this repo. Human how-tos: `docs/DEV.md`, `docs/MIGRATIONS.md`, `docs/LM_STUDIO.md`. Do not duplicate those step-by-steps here; keep this file to facts that are expensive to infer.

## What this is

Marlin is a **personal, single-user** search index aimed at tens of millions of domains. No auth, no multi-tenancy. Do **not** add `userId` or a domain-ignore table unless asked. Ignore is a boolean on `categories` and `tags`.

v1 discovery is a **domain list file** plus **link following**. There is no IPv4/ICMP/TLS-SAN scanner.

## Layout

| Path | Owns |
| --- | --- |
| `apps/spider` | Ingest CLI (`src/ingest.ts`) + BFS link spider (`src/index.ts`) |
| `apps/fetcher` | High-concurrency homepage fetch → store extracted text, enqueue link hosts |
| `apps/worker` | LM-only: claim `ready` pages, one LM Studio call, write summary; `src/probe.ts` is the no-DB smoke test |
| `apps/api` | Fastify `/api/*` search + ignore toggles |
| `apps/web` | Vite + React search UI + ignore modal |
| `packages/db` | Drizzle schema, SQL migrations, pool, queries, migrate/requeue CLIs |
| `packages/shared` | Hostname normalize, English TLD whitelist, fetch/extract, LLM prompt + JSON schema, `pickSiteName` |
| `data/domains.sample.txt` | Tiny ingest file for test runs |

`packages/db` is the only place schema/SQL should live. `packages/shared` is the only place hostname rules and the LLM schema should live — spider/fetcher/worker must not fork copies.

Runtime is TypeScript via `tsx` (dev and Docker). Workspace `exports` point at `src/*.ts`.

## Invariants (do not “simplify” away)

- **Fetch and LM are separate processes.** Fetcher saturates the network; LM worker keeps `WORKER_CONCURRENCY` in-flight LM Studio calls with no sleep between successes. Do not merge them back into one sequential job — GPU idle time during HTTP is the whole point of the split.
- **Staging is Postgres, not Redis.** Extracted title/text/url live on `domains.page_*`. Wipe `page_title` / `page_text` / `page_url` on successful `done` (40M × 4KB must not stick around). LM-failed rows **keep** text so `npm run requeue -- failed` can go back to `ready` without refetching.
- **One LM call per domain.** Structured JSON schema first, one prompt-only retry, then `failed`. Prompt/schema: `packages/shared/src/llm.ts`. Caller: `apps/worker/src/lm.ts`. Display `name` is `pickSiteName` in `packages/shared/src/name.ts`.
- **Ignore is search-time only.** Worker still summarizes ecommerce/news/social so categories can be learned, then toggled off in the UI.
- **Category/tag identity** is the lowercased exact LLM string (`normalizeLabel`). No fuzzy merge.
- **Queue is Postgres** `FOR UPDATE SKIP LOCKED`: `pending→fetching` (`claimNextFetch`), `ready→summarizing` (`claimNextLm`).
- **Fetcher backpressure:** `FETCH_MAX_READY` (default 500) counts `ready`+`summarizing`. Fetcher sleeps instead of claiming when at cap so page text does not unbounded-grow ahead of the GPU.
- **Do not store full HTML.** Fetch + truncated text only (`packages/shared/src/page.ts`, `LM_TEXT_CHARS`).
- **No IPv4 scanning** in v1.
- **`normalizeHost`** strips `www.`, lowercases, rejects IPs/localhost/no-TLD.
- **English TLD whitelist** (`packages/shared/src/tlds.ts`): last label only. Applied in `enqueueHosts`, spider BFS, and fetcher. Override with `TLD_WHITELIST`. `de.wikipedia.org` is `.org` and still allowed.
- **Never edit an applied migration.** Next file is after `0002_page_pipeline.sql`.
- **LM Studio is host-side.** Containers use `http://host.docker.internal:1234/v1`.

## Data flow

```
domains.txt  --ingest-->  pending
seeds        --spider-->  pending + link hosts
pending      --fetcher--> fetching → fetch homepage → extract → page_* stored → ready
                          (+ enqueue new hosts as pending)
ready        --lm worker--> summarizing → LM → done (page_* cleared) | failed (page_* kept)
UI search    --api-->     done rows, hide ignored category OR any ignored tag
```

Statuses: `pending` | `fetching` | `ready` | `summarizing` | `done` | `failed` | `skipped`.

Startup reclaim: fetcher maps `fetching`/`processing` → `pending`. LM worker maps `summarizing` → `ready`.

`domain_count` on categories/tags is a counter cache incremented on complete. Do not `COUNT(*)` 40M rows for the ignore modal.

## Workflows

**Dev:** Postgres via Compose (host **5433** → container 5432); apps on the host. `npm run dev` = api+web. LM Studio on host. Vite `:5173` → `/api` → `:3000`. Root `.env` via `packages/db/src/env.ts`.

**Safe test order:** LM Studio → `npm run probe -- example.com` → migrate → ingest → **`npm run fetcher`** + **`npm run worker`** (two terminals) → UI → ignore modal → spider last.

**Schema change:** edit `packages/db/src/schema.ts` → new SQL in `packages/db/migrations/` → `npm run db:migrate`. Compose `migrate` must stay a dependency of api/fetcher/worker/spider.

**Prod-ish:** `docker compose up --build` postgres+migrate+api+web. Fetcher+worker+spider: `--profile tools`.

**Requeue:** `npm run requeue -- failed` → rows with `page_text` become `ready`, others `pending`. No auto-retry loop.

## LM / fetch pitfalls

- `WORKER_CONCURRENCY` ≤ LM Studio Parallel. Parallel N **divides** loaded context. `LM_TEXT_CHARS` default 4000. Do not prompt-only retry context-exceeded errors.
- `FETCH_CONCURRENCY` default 16 (network). Raising LM concurrency does not require lowering fetch; `FETCH_MAX_READY` is the coupling knob.
- Empty LM queue: poll `WORKER_POLL_MS` (200). After a response, claim immediately — do not add delay on the success path.
- If LM is down, mark `failed` and keep page text. Ctrl+C mid-summarize → next LM worker start reclaims to `ready`.

## Search pitfalls

- Empty `q` = browse latest `done`. Fuzzy on summary/host/name. Typeahead hits `categories`/`tags` only.
- Hide ignored category **or** any ignored tag.
- Do not add extra trgm indexes on `domains` casually.

## Scale notes

~40M metadata × ~1KB plus trgm. Page text is a **bounded staging buffer** (`FETCH_MAX_READY`), not a permanent corpus. Unique `host` is the dedup key.

## Explicit non-goals (v1)

IPv4/TLS scanning, user accounts, recrawl scheduler, robots.txt beyond UA+delay, storing HTML, Redis, multi-tenant ignore lists, cleaning near-duplicate categories.

## Where to look

- Schema / queue / search: `packages/db/src/schema.ts`, `packages/db/src/queries.ts`
- Migrations: `packages/db/migrations/0001_init.sql`, `0002_page_pipeline.sql`
- Fetch + extract: `packages/shared/src/page.ts`, `apps/fetcher/src/index.ts`
- LM loop: `apps/worker/src/index.ts`, `apps/worker/src/lm.ts`
- Compose profiles: `docker-compose.yml` (`tools`)
- Env: `.env.example`
