# Marlin

Personal, single-user search index for websites. Ingest a domain list, fetch homepages, summarize each host with an OpenAI-compatible LM (local LM Studio or rented vLLM), and search summaries with category/tag filters. Discovery is **list ingest + link following after LM** (optional BFS spider exists — not required). Not an IP scanner.

## Provided as-is

This repository is published so others can **fork it and configure their own copy**. It is offered **as-is**, without warranty of any kind.

There is **no expectation** of updates, bugfixes, PR review, merges, issue triage, or ongoing activity from the author. Issues and pull requests may be ignored. If you want changes, fork and own them. See [CONTRIBUTING.md](CONTRIBUTING.md) and [LICENSE](LICENSE) (MIT).

You are responsible for how you crawl, what you store, and compliance with site terms and model licenses on whatever hardware you run.

## Why fork it

Policy that shapes *what* you index lives under [`data/`](data/README.md) (TLD whitelist, crawl priorities, LM profiles, denylists, label aliases, seed lists). Process runtime (DB URL, ports, concurrency, timeouts) lives in [`.env`](.env.example). Prompt/schema and a few heuristics remain in `packages/shared` if you need to change behavior in code.

## Architecture (sketch)

Fetch and LM are **separate processes** so the GPU is not blocked on HTTP. Staging text lives in Postgres only until a domain is `done`.

```
ingest → pending → fetcher → ready → LM worker → done
  (optional spider also → pending)     ↘ empty / parked (no LM)
                                       ↘ failed (page text kept for requeue)
                                       → enqueue outbound hosts (main link growth)
```

UI: search, ignore lists, Dashboard, Workers, Analyze. Details: [Getting Started](docs/GETTING_STARTED.md).

## Docs

| Doc | For |
| --- | --- |
| **[Getting Started](docs/GETTING_STARTED.md)** | Entities, config, CLI, LM Studio, vLLM/Vast |
| [`data/README.md`](data/README.md) | Inventory of every policy file |
| [`docs/MIGRATIONS.md`](docs/MIGRATIONS.md) | Schema / SQL migrations |
| [`AGENTS.md`](AGENTS.md) | Invariants for coding agents |
| [`docs/vast-templates/`](docs/vast-templates/) | Paste-ready Vast launch recipes |

## Optional futures (not a commitment)

If a later version appears at all: **v2** would turn the catalog into a **feed**; **v4** would tackle **tag scale and quality**. Neither is promised.

## Quick start

```bash
cp .env.example .env
npm install
npm run docker:db
# LM Studio on :1234 (or Vast tunnel + WORKER_PROFILE=vast-g4-4b-1) — see Getting Started
# One-shot smoke: npm run probe -- example.com --lm local
npm run ingest -- ./data/domains.sample.txt
npm run fetcher   # one terminal
npm run worker    # another
npm run dev       # UI http://localhost:5173
```

Or run UI/API entirely in Docker: `npm run docker:up` → http://localhost:8080

Full walkthrough: [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md).
