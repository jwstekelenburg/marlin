# LM Studio setup

The worker calls a **host-side** LM Studio server. It is not a Compose service (the GPU stays on the host).

## App settings

1. Install LM Studio and download an instruct model **≥7B** that supports structured output (Qwen2.5 7B, Llama 3.1 8B, or similar). Smaller models often break JSON schema.
2. Load the model. Context length **≥ 8k** at parallel 1. If Parallel is N, LM Studio **splits that context across N slots** — raise context to roughly `N × 4k+` or keep Parallel = `WORKER_CONCURRENCY` and size context accordingly.
3. Developer → Local Server → Start.
4. Bind **`0.0.0.0:1234`** (not only localhost) so Docker worker containers can reach it via `host.docker.internal`.
5. Confirm:

```bash
curl http://localhost:1234/v1/models
```

## Smoke test (no database / queue)

Same fetch + one structured LM call as the worker, prints JSON to stdout:

```bash
npm run probe -- example.com
```

If that works, the LM worker can talk to LM Studio. Keep fetch (`npm run fetcher`) in a separate terminal so HTTP does not stall the GPU.

## Marlin env

```bash
LM_BASE_URL=http://localhost:1234/v1          # host-run worker
# LM_BASE_URL=http://host.docker.internal:1234/v1   # Compose worker
LM_MODEL=                                     # empty → first id from /v1/models
LM_API_KEY=lm-studio                          # LM Studio usually accepts any/empty
LM_TIMEOUT_MS=120000
WORKER_CONCURRENCY=1                          # must be ≤ LM Studio Parallel
LM_TEXT_CHARS=4000                            # page text sent to the model
```

**Parallel vs context:** `WORKER_CONCURRENCY=4` with LM Studio Parallel 4 is fine only if the loaded context is large enough for 4 full prompts at once. A 4k window + Parallel 4 ≈ 1k tokens per job → Wikipedia pages blow up with `Context size has been exceeded`. Either bump context (e.g. 16k–32k) or drop Parallel / concurrency together.

## What the worker sends (one call per domain)

1. Fetch homepage (HTTPS then HTTP, ≤5 redirects, ~15s, body cap 1MB).
2. Extract title, meta description, visible text (truncated to ~8k chars). **HTML is not stored.**
3. **One** `POST /v1/chat/completions` with `response_format.json_schema` (`domain_catalog`). On failure, **one** prompt-only retry, then the domain is `failed`.

System prompt and schema live in [`packages/shared/src/llm.ts`](../packages/shared/src/llm.ts). Implementation: [`apps/worker/src/lm.ts`](../apps/worker/src/lm.ts).

Expected object:

```json
{
  "name": "short site name",
  "summary": "2-3 factual sentences",
  "category": "one label",
  "tags": ["up", "to", "five"]
}
```

Category/tag strings are stored lowercased exactly as returned. No synonym merging. Ignore flags are **search-time only** — the worker still summarizes ecommerce/news/social so you can toggle them off in the UI after a test run.

`temperature` 0.2, `max_tokens` 400.

If LM Studio is down, the job is marked `failed` (page text kept). On LM worker startup, leftover `summarizing` rows are reclaimed to `ready`.
