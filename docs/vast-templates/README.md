# Vast.ai LM templates

Human-readable launch recipes for rented GPU boxes. Paste into the Vast UI (custom/docker template). **Not loaded by Marlin code.**

Each config file documents one working setup. Add a new file when you design another (different CUDA tag, GPU class, model, etc.).

## Required fields

| Field | Meaning |
| --- | --- |
| `name` | Short id (same as filename stem) |
| `registry` | `docker` \| `ghcr` \| `nvcr` \| `custom` (include registry URL if custom) |
| `image` | Full image reference (e.g. `vllm/vllm-openai:gemma4`) |
| `disk_gb` | Minimum Vast disk slider |
| `ports` | Ports to open / map |
| `env` | Environment variables for the template |
| `startup` | On-start / user_data shell (image-specific) |
| `notes` | Offer filters, tunnel, pitfalls |

## Configs

| File | Use |
| --- | --- |
| [marlin-4090-gemma4-e4b.txt](./marlin-4090-gemma4-e4b.txt) | 1× RTX 4090 (24GB), Gemma 4 E4B, official vLLM Gemma image |

## Worker side

Point a profile in [`data/worker-profiles.json`](../../data/worker-profiles.json) at the tunnel (`http://127.0.0.1:8000/v1`). Soft-ramp concurrency with `WORKER_RAMP_*` (see `.env.example`).

Throughput tip: count **LM** completions (exclude `empty`/`parked`), not raw `done`/min. Prefer hosts with a dedicated CPU slice over inflated vCPU marketing.
