#!/usr/bin/env bash
# Marlin summariser: OpenAI-compatible vLLM tuned for catalog jobs
# (~4k char page body, structured JSON, high concurrency on one 4090).
set -euo pipefail

MODEL="${MODEL:-google/gemma-4-E4B-it}"
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8000}"

# Budget: system + schema + ~4k chars body + max_tokens 700 ≈ ≤5k.
# Keeping this low frees VRAM for many parallel sequences (KV cache).
MAX_MODEL_LEN="${MAX_MODEL_LEN:-5120}"
MAX_NUM_SEQS="${MAX_NUM_SEQS:-64}"
MAX_NUM_BATCHED_TOKENS="${MAX_NUM_BATCHED_TOKENS:-16384}"
GPU_MEMORY_UTILIZATION="${GPU_MEMORY_UTILIZATION:-0.95}"
KV_CACHE_DTYPE="${KV_CACHE_DTYPE:-fp8}"
DTYPE="${DTYPE:-auto}"

API_KEY_VALUE="${VLLM_API_KEY:-${API_KEY:-}}"

args=(
  "$MODEL"
  --host "$HOST"
  --port "$PORT"
  --dtype "$DTYPE"
  --max-model-len "$MAX_MODEL_LEN"
  --max-num-seqs "$MAX_NUM_SEQS"
  --max-num-batched-tokens "$MAX_NUM_BATCHED_TOKENS"
  --gpu-memory-utilization "$GPU_MEMORY_UTILIZATION"
  --kv-cache-dtype "$KV_CACHE_DTYPE"
  # Text-only catalog calls — skip multimodal encoder memory.
  --limit-mm-per-prompt image=0,audio=0
  # Identical system prompt on every Marlin job.
  --enable-prefix-caching
  --async-scheduling
)

if [[ -n "$API_KEY_VALUE" ]]; then
  args+=(--api-key "$API_KEY_VALUE")
fi

# Extra CLI flags: docker run … marlin-summariser --quantization fp8
if [[ $# -gt 0 ]]; then
  args+=("$@")
fi

echo "marlin summariser: model=$MODEL max_model_len=$MAX_MODEL_LEN max_num_seqs=$MAX_NUM_SEQS kv=$KV_CACHE_DTYPE"
exec vllm serve "${args[@]}"
