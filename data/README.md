# `data/` — forkable policy config

Edit these files to shape **what** Marlin indexes and how it orders work. Runtime knobs (DB URL, ports, concurrency, timeouts) stay in the repo-root [`.env`](../.env.example) — see [Getting Started](../docs/GETTING_STARTED.md).

Path overrides (optional) are listed below; defaults resolve from the repo root.

| File | Purpose | When it matters | Reload | Path override |
| --- | --- | --- | --- | --- |
| [`lm-profiles.json`](./lm-profiles.json) | Named LM connections: `baseUrl`, `model`, `apiKey`, `timeoutMs` | Pointing at LM Studio or a Vast SSH tunnel; A/B via probe/compare | Restart worker / steward; pass `--lm` on probe/compare | `LM_PROFILES_FILE` |
| [`worker-profiles.json`](./worker-profiles.json) | Named worker bundles: `lm` (key into lm-profiles), `concurrency` | Picking which LM a long-running worker hits and how hard | Restart worker / steward | `WORKER_PROFILES_FILE` |
| [`catalog-policies.json`](./catalog-policies.json) | Catalog LM policy: system prompt, `textChars`, sampling (`temperature` / `top_p` / `top_k` / `max_tokens`) | Changing what the cataloger does (not where it runs) | Restart worker; `--policy` on worker / probe / compare | `CATALOG_POLICIES_FILE` |
| [`steward-policies.json`](./steward-policies.json) | Steward spiral-judge prompt, `sampleSummaryChars`, sampling | Changing how apex traps are judged | Restart steward; `--policy` on steward | `STEWARD_POLICIES_FILE` |
| [`category-priority.txt`](./category-priority.txt) | Crawl/LM queue weights by category (`seed`, `default`, per-label ints) | Biasing discovery toward makers vs ecommerce after LM classifies a page | Restart fetcher + worker | `CATEGORY_PRIORITY_FILE` |
| [`language-priority.txt`](./language-priority.txt) | Additive queue adjust from source page language (`en`, `mul`, `default`) | Keeping non-English outbound links later in the queue | Restart fetcher + worker | `LANGUAGE_PRIORITY_FILE` |
| [`tlds.txt`](./tlds.txt) | Allowed last-label TLDs (English-oriented whitelist) | Skipping `.de` / `.jp` / etc. at enqueue | Restart fetcher / worker / spider | `TLD_FILE` (or process-wide `TLD_WHITELIST=com,org,…`) |
| [`blocked-apex.txt`](./blocked-apex.txt) | Seed crawler-trap apex denylist → Postgres `blocked_apexes` | Forumotion farms, B2B mills; apex + subdomains refused | Restart (DB overlay refreshes ~30s) | `BLOCKED_APEX_FILE` |
| [`allowed-apex.txt`](./allowed-apex.txt) | UGC / platform apexes the steward must never auto-block | Tumblr, Neocities, GitHub Pages, … | Restart steward | `ALLOWED_APEX_FILE` |
| [`label-aliases.txt`](./label-aliases.txt) | Tag/category spelling merges (`kind from to`) | Collapsing near-duplicate LLM labels | Soft-reload ~30s for new inserts; existing rows need `npm run merge-labels -- --apply` | `LABEL_ALIASES_FILE` |
| [`feed-prompt.txt`](./feed-prompt.txt) | High-level `/feed` intent (one paragraph) | Changing what the river is *for* | Then recompile `feed-strategy.json` (agent; see [`docs/FEED_PROMPT_TEMPLATE.md`](../docs/FEED_PROMPT_TEMPLATE.md)) | `FEED_PROMPT_FILE` |
| [`feed-strategy.json`](./feed-strategy.json) | Compiled include/exclude category+tag **names** | Ranking `/feed` | API reloads on mtime (no restart) | `FEED_STRATEGY_FILE` |
| [`domains.sample.txt`](./domains.sample.txt) | Tiny host list for a first **ingest** | Smoke-testing the pipeline | CLI arg only | — |
| [`seeds.makers.txt`](./seeds.makers.txt) | Larger maker / small-web seed list for **ingest** (not the BFS spider) | Biasing discovery when you ingest | CLI arg only | — |

## Profiles vs policies

- **LM profile** — *where* (URL / model / key).
- **Worker profile** — *which* LM + concurrency for a long-running process.
- **Catalog / steward policy** — *what* the model is asked to do (prompt + budgets + sampling).

Select with `.env` (`WORKER_PROFILE`, `CATALOG_POLICY`, `STEWARD_POLICY`) or CLI (`--profile` / positional, `--policy`). Two workers can share an LM profile and run different catalog policies.

`systemPrompt` may be a single string or an array of lines (joined with newlines).

## What does **not** live here

- **`.env`** — process runtime (see `.env.example`).
- **JSON schemas** for catalog / steward responses — fixed contracts in `packages/shared` (`LLM_JSON_SCHEMA`, `STEWARD_SPIRAL_JSON_SCHEMA`). Fork code to change the field shape.
- **Empty/parked heuristics**, language-subdomain and SSRF rules — still in `packages/shared`.
- **Ignore toggles** — search-time only, via the UI / API (booleans on categories and tags).
- **Steward blocks after boot** — grow in Postgres `blocked_apexes` beyond the seed file.
- **Feed events** — impressions / clicks / votes live in Postgres `feed_events`, not in `data/`.

## Compose / Docker

Compose mounts the repo; the same `data/` paths apply inside containers. Worker/steward LM profiles that talk to a host LM use `host.docker.internal` (see lm profile `docker-g4-4b`).
