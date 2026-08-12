# `data/` — forkable policy config

Edit these files to shape **what** Marlin indexes and how it orders work. Runtime knobs (DB URL, ports, concurrency, timeouts) stay in the repo-root [`.env`](../.env.example) — see [Getting Started](../docs/GETTING_STARTED.md).

Path overrides (optional) are listed below; defaults resolve from the repo root.

| File | Purpose | When it matters | Reload | Path override |
| --- | --- | --- | --- | --- |
| [`worker-profiles.json`](./worker-profiles.json) | Named LM bundles: `baseUrl`, `model`, `apiKey`, `concurrency`, `timeoutMs`, `textChars` | Pointing at LM Studio or a Vast SSH tunnel; picking concurrency | Restart worker / steward / probe | `WORKER_PROFILES_FILE` |
| [`category-priority.txt`](./category-priority.txt) | Crawl/LM queue weights by category (`seed`, `default`, per-label ints) | Biasing discovery toward makers vs ecommerce after LM classifies a page | Restart fetcher + worker | `CATEGORY_PRIORITY_FILE` |
| [`language-priority.txt`](./language-priority.txt) | Additive queue adjust from source page language (`en`, `mul`, `default`) | Keeping non-English outbound links later in the queue | Restart fetcher + worker | `LANGUAGE_PRIORITY_FILE` |
| [`tlds.txt`](./tlds.txt) | Allowed last-label TLDs (English-oriented whitelist) | Skipping `.de` / `.jp` / etc. at enqueue | Restart fetcher / worker / spider | `TLD_FILE` (or process-wide `TLD_WHITELIST=com,org,…`) |
| [`blocked-apex.txt`](./blocked-apex.txt) | Seed crawler-trap apex denylist → Postgres `blocked_apexes` | Forumotion farms, B2B mills; apex + subdomains refused | Restart (DB overlay refreshes ~30s) | `BLOCKED_APEX_FILE` |
| [`allowed-apex.txt`](./allowed-apex.txt) | UGC / platform apexes the steward must never auto-block | Tumblr, Neocities, GitHub Pages, … | Restart steward | `ALLOWED_APEX_FILE` |
| [`label-aliases.txt`](./label-aliases.txt) | Tag/category spelling merges (`kind from to`) | Collapsing near-duplicate LLM labels | Soft-reload ~30s for new inserts; existing rows need `merge-labels --apply` | `LABEL_ALIASES_FILE` |
| [`domains.sample.txt`](./domains.sample.txt) | Tiny host list for a first ingest | Smoke-testing the pipeline | CLI arg only | — |
| [`seeds.makers.txt`](./seeds.makers.txt) | Larger maker / small-web seed list | Biasing discovery when you ingest | CLI arg only | — |

## What does **not** live here

- **`.env`** — process runtime (see `.env.example`).
- **LLM prompt / JSON schema**, empty/parked heuristics, language-subdomain and SSRF rules — still in `packages/shared` (fork the code to change).
- **Ignore toggles** — search-time only, via the UI / API (booleans on categories and tags).
- **Steward blocks after boot** — grow in Postgres `blocked_apexes` beyond the seed file.

## Compose / Docker

Compose mounts the repo; the same `data/` paths apply inside containers. Worker/steward profiles that talk to a host LM use `host.docker.internal` (see profile `docker-local`).
