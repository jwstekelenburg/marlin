# LM Studio setup

The worker calls a **host-side** LM Studio server for local dev. It is not a Compose service (the GPU stays on the host). For a rented GPU box (vLLM, SSH tunnel, no Compose), see [SUMMARISER.md](./SUMMARISER.md) and [vast-templates](./vast-templates/).

**Catalog model (v1):** Gemma 4 E4B (`google/gemma-4-e4b` in LM Studio; `google/gemma-4-E4B-it` on Vast). Profile `textChars` is **4000**; catalog `max_tokens` is **400**.

## App settings

1. Install LM Studio and download **Gemma 4 E4B** (or another instruct model that supports structured JSON-schema output).
2. Load the model. Context length must cover profile `concurrency` × prompt size — raise context to roughly `N × 4k+` when Parallel is N, or keep Parallel = profile `concurrency` and size context accordingly.
3. Developer → Local Server → Start.
4. Bind **`0.0.0.0:1234`** (not only localhost) so Docker worker containers can reach it via `host.docker.internal`.
5. Confirm:

```bash
curl http://localhost:1234/v1/models
```

## Smoke test (no database / queue)

Fetches a homepage and runs one structured LM call (includes meta description in the prompt). Prints JSON to stdout:

```bash
npm run probe -- example.com
```

If that works, the LM worker can talk to LM Studio. Keep fetch (`npm run fetcher`) in a separate terminal so HTTP does not stall the GPU.

Production worker prompts use **title + body only** (meta is not stored in `page_text`); probe / compare-models still include meta from a fresh extract.

## Model quality compare

Runs the same catalog prompt on the same pages across multiple models. Each model is **loaded → all domains → unloaded** so VRAM-limited machines can walk a longer list one model at a time.

```bash
# sample ~8 done hosts from the widest category in Postgres
npm run compare-models -- google/gemma-4-e4b other-model-id

# fixed domains
npm run compare-models -- model-a model-b --domains example.com,wikipedia.org

# pick a category + write JSON report
npm run compare-models -- model-a model-b --category blog --limit 12 --out tmp/compare.json
```

Model ids are whatever LM Studio shows (`GET /v1/models` or the UI). Optional flags: `--context 8192`, `--no-unload`, `--category`, `--limit`, `--domains`, `--out`.

## Marlin worker profile

LM url / model / concurrency / `textChars` live in [`data/worker-profiles.json`](../data/worker-profiles.json):

```bash
WORKER_PROFILE=local                 # .env default for host-run LM Studio
# WORKER_PROFILE=docker-local        # Compose worker → host.docker.internal
npm run worker                       # uses WORKER_PROFILE
npm run worker -- local              # CLI overrides env
```

Edit the `local` profile’s `concurrency` to match LM Studio Parallel. Empty `model` → first id from `/v1/models`.

**Parallel vs context:** profile `concurrency=4` with LM Studio Parallel 4 is fine only if the loaded context is large enough for 4 full prompts at once. A 4k window + Parallel 4 ≈ 1k tokens per job → long pages blow up with `Context size has been exceeded`. Either bump context (e.g. 16k–32k) or drop Parallel / concurrency together.

## What the worker sends (one call per domain)

1. Fetcher already stored title + visible body on `domains.page_*` (HTTPS then HTTP, ≤5 redirects, body cap ~1MB). **HTML is not stored.**
2. Near-empty body / bot-check interstitial → category `empty` (no LM). Clear for-sale / registrar copy → `parked` (no LM).
3. Else **one** `POST /v1/chat/completions` with `response_format.json_schema` (`domain_catalog`). On failure, **one** prompt-only retry, then the domain is `failed`.

System prompt and schema live in [`packages/shared/src/llm.ts`](../packages/shared/src/llm.ts). Implementation: [`apps/worker/src/lm.ts`](../apps/worker/src/lm.ts).

Expected object:

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

`language` is ISO 639-1 (or `mul`); `country` is ISO 3166-1 alpha-2; empty strings become null in Postgres. Category/tag strings are stored lowercased (`normalizeLabel`), then rewritten by [`data/label-aliases.txt`](../data/label-aliases.txt) at `completeDomain`. Existing misspellings need `npm run merge-labels -- --apply` or the Analyze UI merge. Ignore flags are **search-time only** — the worker still summarizes ecommerce/news/social so you can toggle them off in the UI.

Sampling is always sent explicitly so server/model `generation_config` defaults cannot change quality.

If LM Studio is down, the job is marked `failed` (page text kept). On LM worker startup, leftover `summarizing` rows are reclaimed to `ready`.
