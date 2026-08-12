# Vast.ai LM templates

[Vast.ai template settings](https://docs.vast.ai/guides/templates/template-settings)

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
| `filters` | For the rental UI, helps narrow search. See [ref](https://docs.vast.ai/cli/reference/) |

## Configs

| File | Use |
| --- | --- |
| [marlin-4090-gemma4-e4b.txt](./marlin-4090-gemma4-e4b.txt) | 1× RTX 4090 (24GB), Gemma 4 E4B, official vLLM Gemma image |

## Worker side

Point a profile in [`data/worker-profiles.json`](../../data/worker-profiles.json) at the tunnel (`http://127.0.0.1:8000/v1`). Soft-ramp concurrency with `WORKER_RAMP_*` (see `.env.example`).

Throughput tip: count **LM** completions (exclude `empty`/`parked`), not raw `done`/min. Prefer hosts with a dedicated CPU slice over inflated vCPU marketing.

## Making a tunnel

```bash
# Use real port and ip, gained from vastai instance ssh connect info.
# The string they give doesn't attack the id or provide the tunnel with -L
ssh -i $env:USERPROFILE\.ssh\id_vastai -p 49052 root@38.117.87.46 -L 8000:127.0.0.1:18000
```

# For later automation

- [Search vast ai offers](https://docs.vast.ai/api-reference/search/search-offers)

TODO compare against top_p: 1, top_k: -1
