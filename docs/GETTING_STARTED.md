# Getting Started

Fork Marlin, configure it under [`data/`](../data/README.md), set runtime knobs in [`.env`](../.env.example), and run your own personal search index. This is the operator guide for entities, configuration, CLI, local LM Studio, and rented vLLM/Vast.

There is **no support SLA**. See the [README](../README.md) and [CONTRIBUTING](../CONTRIBUTING.md). Agent invariants live in [`AGENTS.md`](../AGENTS.md) — do not treat this file as a second copy of those rules.

## Prerequisites

- **Node 22+**
- **Docker + Compose** (Postgres; optional full stack)
- An **OpenAI-compatible LM** that can return structured JSON-schema output:
  - Local: [LM Studio](#path-a-local-lm-studio)
  - Rented GPU: [vLLM on Vast](#path-b-rented-gpu-vllm--vast)

**Catalog model (v1 defaults):** Gemma 4 E4B — `google/gemma-4-e4b` in LM Studio, `google/gemma-4-E4B-it` on Vast. Profile `textChars` **4000**; catalog `max_tokens` **400**.

## Mental model

Marlin is a **personal, single-user** index. No auth, no multi-tenancy. Discovery is a **domain list file** plus **link following** (no IPv4 scanner).

### Processes

| Process | Job |
| --- | --- |
| **Ingest** | Load a domain list file → `pending` (usual way to seed) |
| **Spider** *(optional)* | BFS from a few seeds → more `pending` hosts. Not a replacement for ingest/fetcher; primary link growth is LM outbound enqueue |
| **Fetcher** | Claim `pending` → fetch homepage → store title/body + outbound hosts → `ready` |
| **LM worker** | Claim `ready` → empty/parked heuristics or one LM call → `done` / `failed`; enqueue outbound hosts |
| **Steward** | Separate spiral detector: nominate busy apexes → LM sample → auto-block (does not claim `ready`) |
| **API + web** | Search, ignore toggles, Dashboard / Workers / Analyze |

Fetch and LM are **separate on purpose**: the GPU should not sit idle waiting on HTTP.

### Domain statuses

`pending` → `fetching` → `ready` → `summarizing` → `done` | `failed` | `skipped`

### Staging (Postgres, not Redis)

- Fetcher writes `page_title` / `page_text` / `page_url` and `outbound_hosts`.
- On successful `done`, those staging columns are **wiped** (page text must not stick around at tens of millions of rows).
- On LM `failed`, text + outbound hosts are **kept** so `npm run requeue -- failed` can go back to `ready` without refetching.

### Categories, tags, ignore

- The LM returns one **category** and up to five **tags** (lowercased exact strings).
- [`data/label-aliases.txt`](../data/label-aliases.txt) rewrites spellings at complete time; existing DB rows need `npm run merge-labels -- --apply` or Analyze → Labels.
- **Ignore** is search-time only (UI/API booleans on categories and tags). The worker still summarizes ecommerce/news/social so you can learn labels, then hide them.

### Apex, caps, denylists

- **Apex** = ICANN eTLD+1 (`alice.tumblr.com` → `tumblr.com`).
- **`MAX_SUBDOMAINS_PER_APEX`** (`.env`, default 100): overflow hosts are not stored.
- **`data/blocked-apex.txt`** seeds crawler-trap denylist (Forumotion, B2B mills, …) into Postgres; steward can add more. Unfinished queue under a blocked apex is dropped; `done` stays.
- **`data/allowed-apex.txt`**: steward must never auto-block these UGC platforms.
- **TLD whitelist** (`data/tlds.txt`) and non-English language-subdomain filter also gate what is indexable.

### Data flow

```
domains.txt --ingest--> pending (seed priority)          ← usual seed path
seeds --spider--> pending (seed / default by depth)      ← optional BFS; skip unless you want it
pending --fetcher--> fetching → page_* + outbound_hosts → ready
ready --lm worker--> empty / parked (no LM) | LM → done (staging cleared) | failed (staging kept)
                     → enqueue outbound hosts at category + language priority  ← main link growth
UI search --api--> done rows (hide ignored labels unless filtered)
```

## Config you will touch

Two layers:

1. **Policy** — [`data/`](../data/README.md) (what to index, queue weights, LM endpoints, denylists). Inventory and reload rules are in that README.
2. **Runtime** — [`.env.example`](../.env.example) copied to `.env` (DB URL, ports, fetch/worker/spider concurrency and timeouts).

Apps load the **repo-root** `.env` (not `apps/*/.env`).

### When each policy file matters

| File | Touch it when… |
| --- | --- |
| `lm-profiles.json` | Changing LM URL, model, apiKey, or timeout |
| `worker-profiles.json` | Changing which LM a worker uses, concurrency, or `textChars` |
| `category-priority.txt` | Boosting maker categories / demoting ecommerce after LM classifies pages |
| `language-priority.txt` | Changing how hard non-English outbound links are demoted |
| `tlds.txt` | Allowing or refusing ccTLDs |
| `blocked-apex.txt` / `allowed-apex.txt` | Seeding crawler traps vs UGC platforms the steward must spare |
| `label-aliases.txt` | Collapsing spelling variants of tags/categories |
| `domains.sample.txt` / `seeds.makers.txt` | Ingest inputs (CLI path args) |

### Important `.env` knobs

| Var | Role |
| --- | --- |
| `DATABASE_URL` | Postgres (host publish is **5433** → container 5432) |
| `WORKER_PROFILE` | Which entry in `worker-profiles.json` (CLI can override). Resolves an `lm` key from `lm-profiles.json`. |
| `FETCH_CONCURRENCY` / `FETCH_MAX_READY` | Network parallelism; pause fetch when LM backlog is full |
| `MAX_SUBDOMAINS_PER_APEX` | Cap non-apex hosts per registrable domain |
| `WORKER_RAMP_*` | Soft-start LM concurrency (avoids cold vLLM OOM); `WORKER_RAMP_MS=0` disables |
| `SPIDER_*` | Seeds, depth, host cap, delay — keep small until you trust the spider |
| `TLD_WHITELIST` | Advanced: replace `data/tlds.txt` for this process only |

Still in **code** (fork `packages/shared` to change): LLM prompt/schema, empty/parked heuristics, language-subdomain and SSRF fetch rules.

## First-time setup

```bash
cp .env.example .env
npm install
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres migrate
```

Or shorter:

```bash
npm run docker:db
```

`DATABASE_URL` should stay `postgres://marlin:marlin@localhost:5433/marlin` when using the published host port.

If Postgres is already up without the migrate service:

```bash
npm run db:migrate
```

## Path A: local LM Studio

1. Install LM Studio and download **Gemma 4 E4B** (or another instruct model with JSON-schema output).
2. Load the model. Context length must cover profile `concurrency` × prompt size — roughly `N × 4k+` when Parallel is N, or keep Parallel = concurrency and size context accordingly.
3. Developer → Local Server → Start. Bind **`0.0.0.0:1234`** if Docker workers will reach the host via `host.docker.internal`.
4. Confirm: `curl http://localhost:1234/v1/models`
5. Set `WORKER_PROFILE=local` (or `docker-g4-4b` for Compose workers → `host.docker.internal`). That worker entry’s `lm` key points at `lm-profiles.json`. Empty `model` in the LM profile → first id from `/v1/models`. Edit worker `concurrency` to match LM Studio Parallel.

**Parallel vs context:** `concurrency=4` with Parallel 4 needs a large enough context for four full prompts. A 4k window + Parallel 4 ≈ 1k tokens per job → long pages hit “Context size has been exceeded”. Bump context (e.g. 16k–32k) or drop Parallel and concurrency together.

### Smoke test (no database)

```bash
npm run probe -- example.com --lm local
```

Fetches a homepage and runs one structured LM call (includes meta description). Production worker prompts use **title + body only**. `--lm` is required (from `data/lm-profiles.json`); one-shots do not fall back to `WORKER_PROFILE`.

### First crawl

```bash
npm run dev                 # API :3000 (127.0.0.1) + Vite UI :5173
npm run ingest -- ./data/domains.sample.txt
npm run fetcher             # pending → ready
npm run worker              # ready → done (profile from WORKER_PROFILE)
```

Open http://localhost:5173 — search, **Dashboard**, **Ignore lists**. Safe order: LM up → probe → migrate → sample ingest → fetcher + worker → UI → spider last with low caps.

### What one LM call returns

```json
{
  "name": "short site name",
  "summary": "2-3 factual sentences",
  "category": "one label",
  "tags": ["up", "to", "five"],
  "language": "en",
  "place": "",
  "country": ""
}
```

Near-empty / bot-check → `empty` (no LM). Clear for-sale lander → `parked` (no LM). Else one chat completion with JSON schema; one prompt-only retry; then `failed`. If LM is down, mark `failed` and keep page text. On worker startup, leftover `summarizing` rows reclaim to `ready`.

Prompt/schema: [`packages/shared/src/llm.ts`](../packages/shared/src/llm.ts).

### Compare models

Pass **lm profile** keys (not raw model ids). Profiles may point at different hosts:

```bash
npm run compare-models -- studio-g4-4b studio-g4-2b
npm run compare-models -- studio-g4-4b vast-g4-4b-1 --domains example.com,wikipedia.org
npm run compare-models -- studio-g4-4b studio-g4-2b --category blog --limit 12 --out tmp/compare.json
```
## Path B: rented GPU (vLLM / Vast)

GPU box runs **only** vLLM. Fetcher, worker, and Postgres stay on your PC. Reach the API with an **SSH tunnel** (no public LLM port).

### Template

Paste-ready recipes live in [`docs/vast-templates/`](./vast-templates/) (docs only; not read by Marlin). Default: [`marlin-4090-gemma4-e4b.txt`](./vast-templates/marlin-4090-gemma4-e4b.txt) — Docker Hub `vllm/vllm-openai:gemma4`, Gemma 4 E4B, 1× 24GB-class GPU.

- Prefer offers with a **dedicated CPU slice**, not inflated shared “32 vCPU”.
- Prefer **N× (1× RTX 4090)** over one multi-GPU box — catalog calls are independent HTTP jobs.

### Tunnel

Use the instance SSH port/IP from Vast (example shape):

```bash
ssh -i $env:USERPROFILE\.ssh\id_vastai -p <port> root@<ip> -L 8000:127.0.0.1:8000
```

Smoke on the box: `curl -s --max-time 5 http://127.0.0.1:8000/v1/models`

### Worker on your PC

Point [`data/lm-profiles.json`](../data/lm-profiles.json) (`vast-g4-4b-1` / `vast-g4-4b-2`) at the tunnel, and keep concurrency / `textChars` on the matching [`worker-profiles.json`](../data/worker-profiles.json) entries:

| File | Field | Notes |
| --- | --- | --- |
| `lm-profiles.json` | `baseUrl` | e.g. `http://127.0.0.1:8000/v1` |
| `lm-profiles.json` | `model` | `google/gemma-4-E4B-it` |
| `lm-profiles.json` | `apiKey` | Whatever the server expects |
| `worker-profiles.json` | `lm` | Key into `lm-profiles.json` |
| `worker-profiles.json` | `concurrency` | Soft-ramps via `WORKER_RAMP_*`; ≤ server `--max-num-seqs` |
| `worker-profiles.json` | `textChars` | **4000** — do not cut without a quality A/B |

```bash
WORKER_PROFILE=vast-g4-4b-1
npm run worker
npm run worker -- vast-g4-4b-2   # second tunnel
```

Rough throughput (big error bars): local LM Studio ~60–80 LM/min at concurrency 2; rented 4090 ~250–400 LM/min at 24–32 when CPU is healthy. Count **LM** completions (exclude `empty` / `parked`).

Server defaults in the template: `--max-model-len 5184`, `--max-num-seqs 32`. Catalog `max_tokens` is **400**.

## CLI catalog

| Command | What |
| --- | --- |
| `npm run dev` | API + Vite web |
| `npm run ingest -- <file>` | Domain list → `pending` at seed priority (usual seed) |
| `npm run fetcher` | Network: `pending` → `ready` |
| `npm run worker` / `npm run worker -- <profile>` | LM: `ready` → `done` |
| `npm run spider` | Optional BFS discovery only (`SPIDER_*`); not ingest+fetch |
| `npm run steward` | Spiral apex judge / auto-block |
| `npm run probe -- <host> --lm <profile>` | No-DB LM smoke test (`data/lm-profiles.json`) |
| `npm run compare-models -- <lm> [lm…]` | A/B catalog across lm profiles |
| `npm run requeue -- failed` | `failed` → `ready` if page text exists, else `pending` |
| `npm run flush-queue` | Delete unfinished domain rows; keep `done` |
| `npm run merge-labels` | Dry-run aliases; `-- --apply` for existing DB rows |
| `npm run docker:db` | Postgres + migrate (dev overlay; apps stay on host) |
| `npm run docker:up` | Build/start postgres + migrate + api + web |
| `npm run docker:up:tools` | Same + fetcher/worker/spider/steward |
| `npm run docker:down` | Stop containers (**keeps** Postgres volume) |
| `npm run docker:logs` | Follow compose logs |
| `npm run db:migrate` / `db:studio` | Schema apply / browse |
| `npm run check` / `check -w @marlin/<pkg>` | Typecheck + lint (+ tests where present) |
| `npm run dev:fetcher` / `dev:worker` / `dev:spider` / `dev:steward` | Watch-mode tools |
| `npm run dev:tools` | api + web + fetcher + worker |

## Day-2 ops

- **Ignore modal** — hide ecommerce / social / news after labels appear (search-time).
- **Dashboard / Workers** — queue depths, throughput, live pipeline.
- **Analyze** (`/analyze`) — Labels (co-occurrence, lexical merge), Platforms (apex quality), Steward (block ledger).
- **HTTP API** — UI backend only (no auth). Route list: [`apps/api/src/index.ts`](../apps/api/src/index.ts).
- **Priority** — edit `category-priority.txt` / `language-priority.txt`; restart fetcher + worker. Seeds use `seed` weight.
- **Spider** *(optional)* — not the main crawl. Prefer ingest + fetcher + LM outbound enqueue. If you run it, keep `SPIDER_MAX_DEPTH=1` and a low `SPIDER_MAX_HOSTS`.
- **Steward** — needs the same `WORKER_PROFILE`; start after you have enough `done` rows to sample.

## Docker

**Dev (Postgres only; apps on the host):**

```bash
npm run docker:db          # postgres + migrate (keeps volume)
npm run dev                # api + web on host
```

**Run the stack in Docker** (no intention of hacking the code):

```bash
npm run docker:up          # build + start postgres, migrate, api, web
# UI http://localhost:8080  API http://localhost:3000
npm run docker:logs        # optional follow
npm run docker:down        # stop containers; does NOT delete the Postgres volume
```

Compose sets `API_HOST=0.0.0.0`. Host-run API defaults to `127.0.0.1`.

Fetcher + worker + spider + steward are behind Compose profile `tools`:

```bash
npm run docker:up:tools    # full stack including crawl/LM tools
```

From containers, LM Studio is `http://host.docker.internal:1234/v1` via worker profile `docker-g4-4b` (`DOCKER_WORKER_PROFILE`, independent of host `WORKER_PROFILE`). Bind LM Studio to `0.0.0.0:1234`.

## Schema changes

See [`MIGRATIONS.md`](./MIGRATIONS.md). Short version: edit `packages/db/src/schema.ts` → new SQL under `packages/db/migrations/` (never edit an applied migration) → `npm run db:migrate`. Full wipe: `docker compose down -v` (destroys data). Prefer `npm run docker:down` when you only want to stop containers.

## Non-goals and responsibility

v1 does not include IPv4/TLS scanning, user accounts, recrawl scheduling, storing HTML, Redis, or multi-tenant ignore lists. You are responsible for crawl politeness, site terms, and LM / model license terms on whatever hardware you run.

Deep invariants for agents: [`AGENTS.md`](../AGENTS.md).
