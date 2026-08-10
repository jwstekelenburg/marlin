# Throughput-tuned OpenAI-compatible summariser for rented GPUs (RTX 4090+).
# Not part of docker-compose — build and run on the GPU box only.
#
#   docker build -t marlin-summariser ./apps/summariser
#   docker run --gpus all --ipc=host --shm-size=16g \
#     -e HF_TOKEN -e VLLM_API_KEY=secret \
#     -p 127.0.0.1:8000:8000 \
#     -v "$HOME/.cache/huggingface:/root/.cache/huggingface" \
#     marlin-summariser
#
# Then SSH tunnel from your PC: ssh -N -L 8000:127.0.0.1:8000 user@gpu-box
# Worker: LM_BASE_URL=http://127.0.0.1:8000/v1 LM_MODEL=google/gemma-4-E4B-it
#
# Image tag `gemma4` is required for Gemma 4 support (CUDA 12.9).
# For CUDA 13 hosts: docker build --build-arg VLLM_IMAGE=vllm/vllm-openai:gemma4-cu130 …

ARG VLLM_IMAGE=vllm/vllm-openai:gemma4
FROM ${VLLM_IMAGE}

COPY entrypoint.sh /usr/local/bin/marlin-summariser-entrypoint
USER root
RUN chmod +x /usr/local/bin/marlin-summariser-entrypoint

ENV MODEL=google/gemma-4-E4B-it \
    HOST=0.0.0.0 \
    PORT=8000 \
    MAX_MODEL_LEN=5120 \
    MAX_NUM_SEQS=64 \
    MAX_NUM_BATCHED_TOKENS=16384 \
    GPU_MEMORY_UTILIZATION=0.95 \
    KV_CACHE_DTYPE=fp8 \
    DTYPE=auto \
    # Hugging Face cache (mount a volume over this in production)
    HF_HOME=/root/.cache/huggingface

EXPOSE 8000

# Listen on all interfaces inside the container; publish as 127.0.0.1:8000 on the host for SSH tunnels.
ENTRYPOINT ["/usr/local/bin/marlin-summariser-entrypoint"]
