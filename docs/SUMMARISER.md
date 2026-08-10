# Remote summariser (vLLM)

GPU-only OpenAI-compatible server for Marlin catalog calls. **Not** in Compose — build on a rented box (RTX 4090 is the sweet spot), reach it from your PC via SSH tunnel. Fetcher + worker + Postgres stay local.

Defaults match the worker workload: Gemma 4 E4B instruct, ~5k context (4k-char body + prompt + 700 completion), text-only, prefix caching on the shared system prompt, FP8 KV for more parallel sequences.

## On the GPU box

Accept the model license on Hugging Face, then:

```bash
# clone or copy apps/summariser/
docker build -t marlin-summariser ./apps/summariser

docker run --gpus all --ipc=host --shm-size=16g --restart unless-stopped \
  -e HF_TOKEN \
  -e VLLM_API_KEY=pick-a-secret \
  -p 127.0.0.1:8000:8000 \
  -v "$HOME/.cache/huggingface:/root/.cache/huggingface" \
  marlin-summariser
```

Bind **`127.0.0.1:8000`** so the API is not on the public internet. Smoke:

```bash
curl -s http://127.0.0.1:8000/v1/models \
  -H "Authorization: Bearer pick-a-secret"
```

### Tunables (env)

| Env | Default | Notes |
| --- | --- | --- |
| `MODEL` | `google/gemma-4-E4B-it` | HF id |
| `MAX_MODEL_LEN` | `5120` | Raise only if you raise `LM_TEXT_CHARS` / `max_tokens` |
| `MAX_NUM_SEQS` | `64` | Raise toward `128`–`256` if VRAM allows (watch OOM) |
| `GPU_MEMORY_UTILIZATION` | `0.95` | Drop to `0.90` if the box is unstable |
| `KV_CACHE_DTYPE` | `fp8` | More concurrent jobs; set `auto` to disable |
| `VLLM_API_KEY` / `API_KEY` | unset | If set, required as `Authorization: Bearer …` |
| `HF_TOKEN` | — | Needed for gated HF downloads |

Extra vLLM flags after the image name, e.g. `marlin-summariser --quantization fp8`.

CUDA 13 hosts: `docker build --build-arg VLLM_IMAGE=vllm/vllm-openai:gemma4-cu130 -t marlin-summariser ./apps/summariser`.

## On your PC (SSH tunnel)

```bash
ssh -N -L 8000:127.0.0.1:8000 user@gpu-box
```

`.env` (or shell):

```bash
LM_BASE_URL=http://127.0.0.1:8000/v1
LM_MODEL=google/gemma-4-E4B-it
LM_API_KEY=pick-a-secret
WORKER_CONCURRENCY=32   # ≤ summariser MAX_NUM_SEQS; raise FETCH_MAX_READY so ready stays full
```

Then `npm run worker` as usual. Scale out = more identical boxes + more tunnels (or different local ports) + more worker processes / higher concurrency pointed at each.

## Why these defaults

- Short `--max-model-len` → VRAM goes to **concurrent** catalog jobs, not unused 128k context.
- `--limit-mm-per-prompt image=0,audio=0` → no multimodal encoder tax (pages are text).
- `--enable-prefix-caching` → shared Marlin system prompt is not recomputed every call.
- `--async-scheduling` + high `--max-num-seqs` → continuous batching for throughput.
- No Gemma “thinking” / tool parsers → no extra reasoning tokens on a JSON catalog schema.
