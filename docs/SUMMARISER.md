# Remote LM (vLLM on Vast)

GPU-only OpenAI-compatible server for Marlin catalog calls. Fetcher + worker + Postgres stay on your PC; the rented box only runs vLLM. Reach it with an **SSH tunnel** (no public LLM port).

Launch recipes live in [`docs/vast-templates/`](./vast-templates/) — registry, image, disk, ports, env, startup script. Docs only; not read by code.

**Current default:** [`vast-templates/marlin-4090-gemma4-e4b.txt`](./vast-templates/marlin-4090-gemma4-e4b.txt) — Docker Hub `vllm/vllm-openai:gemma4`, Gemma 4 E4B, 1× 24GB class GPU.

## Observed throughput & cost (rough guide)

Big error bars — page mix, vCPU slice, tunnel, and queue depth move this a lot.

| Setup | Workers | Sustained ballpark |
| --- | --- | --- |
| Local LM Studio, Gemma 4 E4B | 2 | **~60–80 / min** |
| Rented RTX 4090 (vLLM), same model | ~24–32 | **~250–400 LM / min** when CPU is healthy |

Count **LM** completions (exclude `empty` / `parked`), not raw `done`/min.

Cost sketch (one 4090, ~$0.30–0.40/hr ≈ **~$0.35/hr average**):

- ~400 summaries/min → ~24k/hr → **~$0.015 per 1k summaries**
- Prefer offers with a **dedicated CPU slice** (clock + cores for *your* container), not merely “32 vCPU” on a busy host.

## Scale-out

**Prefer N× (1× RTX 4090) over 1× multi-GPU.** Catalog jobs are independent HTTP calls. Point each worker at its tunnel via `vast` / `vast2` in [`data/worker-profiles.json`](../data/worker-profiles.json).

## On your PC

```bash
WORKER_PROFILE=vast
npm run worker
npm run worker -- vast2   # second tunnel
```

| Profile field | Notes |
| --- | --- |
| `baseUrl` | Tunnel root (`http://127.0.0.1:8000/v1`) |
| `model` | `google/gemma-4-E4B-it` |
| `concurrency` | Soft-ramps via `WORKER_RAMP_*`; ≤ server `--max-num-seqs` |
| `textChars` | **4000** — keep; most long pages already hit this cap |
| `apiKey` | Whatever the server expects |

Catalog `max_tokens` is **400** (prod: summary p99 ~381 chars / JSON ~156 tok; 700 was waste).

## Token budget (why these defaults)

| Piece | Approx size |
| --- | --- |
| System prompt | ~600–650 tokens (prefix-cached) |
| Prompt total (prod dump) | avg ~1335, p99 ~1900 |
| JSON out (46k LM dones) | p99 ~156 tok; summary max ~515 chars |
| Server `--max-model-len` | **5184** (margin; do not cut yet) |

Do **not** drop `textChars` to 2500 without a quality A/B — ~57% of ready LM pages would lose a mid-page tail.
