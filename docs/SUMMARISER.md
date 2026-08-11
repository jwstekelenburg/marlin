# Remote summariser (vLLM)

GPU-only OpenAI-compatible server for Marlin catalog calls. Fetcher + worker + Postgres stay on your PC; the rented box only runs vLLM. Reach it with an **SSH tunnel** (no public LLM port, no HTTPS).

Two ways to get a server:

1. **Vast.ai stock `vastai/vllm` template** (practical default) — configure env and boot.
2. **`apps/summariser` Docker image** — our tuned entrypoint; build/push when you have registry + disk for the large base image.

## Observed throughput & cost (rough guide)

Big error bars — page mix, vCPU slice, tunnel, and queue depth move this a lot. Use for planning only.

| Setup | Workers | Sustained ballpark |
| --- | --- | --- |
| Local LM Studio, Gemma 4 E4B | 2 | **~60–80 / min** |
| Rented RTX 4090 (Vast vLLM), same model | ~32 | **~300–400 / min** sustained (brief bursts higher) |

Cost sketch (one 4090, ~$0.30–0.40/hr ≈ **~$0.35/hr average**):

- ~400 summaries/min → ~24k/hr → **~$0.015 per 1k summaries**
- **~$8 / day (~£6)** → on the order of **~500k summaries per instance-day**
- **Two instances → ~£12 / 24h → ~1M summaries** (if both stay saturated)

Prefer offers with a **fat vCPU allocation** (12–24+ cores for *your* slice), not merely a fancy host CPU name (e.g. “96-core EPYC” often means a thin container share). Keep `ready` backlog healthy (`FETCH_MAX_READY`) so the GPU is not starved.

## Scale-out: more machines, not more GPUs on one box

**Prefer N× (1× RTX 4090) over 1× (multi-GPU).**

Catalog jobs are independent HTTP calls. Extra GPUs on one host only help if you run **separate vLLM processes** (ops-heavy on Vast’s Ray/template stack) or tensor-parallel (useless for a ~4B model). Separate boxes give:

- linear-ish throughput (second tunnel + second worker process / port)
- failure isolation
- simpler templates (`num_gpus=1`)

Point each worker at its tunnel via a profile (`vast` / `vast2` in `data/worker-profiles.json`) or run multiple worker processes with different `--profile` args.

## Vast.ai `vastai/vllm` template

Launch mode **SSH**. Disk **≥40GB**. Ports: at least **8000**. Accept the Gemma license on Hugging Face; set `HF_TOKEN`.

Example env:

```text
DATA_DIRECTORY=/workspace/
PORTAL_CONFIG=localhost:8000:18000:/docs:vLLM API
VLLM_MODEL=google/gemma-4-E4B-it
HF_TOKEN=<token>
AUTO_PARALLEL=true
RAY_ADDRESS=127.0.0.1
RAY_ARGS=--head --port 6379 --dashboard-host 127.0.0.1 --dashboard-port 28265
VLLM_ARGS=--max-num-seqs 64 --max-model-len 5184 --max-num-batched-tokens 16384 --gpu-memory-utilization 0.95 --kv-cache-dtype fp8 --enable-prefix-caching --async-scheduling --download-dir /workspace/models --host 127.0.0.1 --port 18000
```

On-start: `entrypoint.sh`

Notes:

- Vast’s wrapper **waits for Ray** even on one GPU — keep `RAY_*` / `AUTO_PARALLEL` as above (`AUTO_PARALLEL` only sets `--tensor-parallel-size`, it does not disable Ray).
- Do **not** pass `--limit-mm-per-prompt image=0,audio=0` on current Vast vLLM (wrong type; use JSON in `/etc/vllm-args.conf` if you need it, or omit).
- Filter offers for **1× GPU**, `gpu_ram >= 24000`, enough **instance** CPUs/RAM — not `cuda_max_good>=13` unless you must.

SSH tunnel (API listens on **18000** inside; Caddy may own 8000):

```bash
ssh -i ~/.ssh/id_vast -p <port> root@<ip> -L 8000:127.0.0.1:18000
```

Smoke on the box: `curl -s --max-time 5 http://127.0.0.1:18000/v1/models`  
Logs: `/var/log/portal/vllm.log` (and Ray log if stuck on “Waiting for Ray”).

## `apps/summariser` image (optional)

```bash
docker build -t marlin-summariser ./apps/summariser

docker run --gpus all --ipc=host --shm-size=16g --restart unless-stopped \
  -e HF_TOKEN \
  -e VLLM_API_KEY=pick-a-secret \
  -p 127.0.0.1:8000:8000 \
  -v "$HOME/.cache/huggingface:/root/.cache/huggingface" \
  marlin-summariser
```

| Env | Default | Notes |
| --- | --- | --- |
| `MODEL` | `google/gemma-4-E4B-it` | HF id |
| `MAX_MODEL_LEN` | `5184` | Raise only if you raise `LM_TEXT_CHARS` / `max_tokens` |
| `MAX_NUM_SEQS` | `64` | Raise if VRAM allows |
| `GPU_MEMORY_UTILIZATION` | `0.95` | Drop to `0.90` if unstable |
| `KV_CACHE_DTYPE` | `fp8` | More concurrent jobs |
| `VLLM_API_KEY` / `API_KEY` | unset | Bearer token if set |

Base image is large; local build needs tens of GB free Docker disk.

## On your PC

Edit [`data/worker-profiles.json`](../data/worker-profiles.json) (url / model / concurrency live together), then:

```bash
WORKER_PROFILE=vast          # default in .env
npm run worker               # uses WORKER_PROFILE
npm run worker -- vast       # CLI overrides env
npm run worker -- vast2      # second tunnel on :8001
```

| Profile field | Notes |
| --- | --- |
| `baseUrl` | OpenAI-compat root (`http://127.0.0.1:8000/v1`) |
| `model` | e.g. `google/gemma-4-E4B-it` |
| `concurrency` | Target in-flight LM calls; worker auto-ramps 8→…→N (`WORKER_RAMP_*`); ≤ server max-num-seqs |
| `apiKey` | Whatever the server expects (`lm-studio` is fine for many setups) |

Tune concurrency against sustained `lm calls: N last minute` and `nvidia-smi` (VRAM full + CPU pegged + util sawtooth is often “full,” not broken). Early bursts can outrun the sustained rate.

## Why these defaults

- Short `--max-model-len` → VRAM goes to **concurrent** catalog jobs, not unused 128k context.
- `--enable-prefix-caching` → shared Marlin system prompt is not recomputed every call.
- `--async-scheduling` + high `--max-num-seqs` → continuous batching for throughput.
- No Gemma “thinking” / tool parsers → no extra reasoning tokens on a JSON catalog schema.
- Text-only pages; skip multimodal limits unless your vLLM build accepts JSON `--limit-mm-per-prompt`.
