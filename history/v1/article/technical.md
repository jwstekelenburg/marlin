# Marlin v1: technical notes

Personal homepage crawler + LM cataloguer + search. 560,183 domains done, 4 days, single operator. This is the reference doc: architecture, decisions, numbers, failure modes. No narrative.

---

## Architecture

Four processes. Fetcher/worker/Postgres/API+web run on a local PC. Catalog inference runs on a separate rented GPU, reached only over an OpenAI-compatible HTTP API through an SSH tunnel. No public LLM port. Steward inference stays on the PC (local LM Studio) — sample volume is tiny and must not steal catalog concurrency.

| Component | Responsibility |
|---|---|
| Fetcher | Claim `pending` → HTTPS then HTTP → HTML parse, no JS execution → write title/body/outbound links onto the row → mark `ready`. |
| Worker | Claim `ready` → skip LM call if empty/challenge-page/parked → else one structured JSON completion → mark `done`, wipe staging text, enqueue outbound links at weighted priority. |
| Steward | Does not touch the main queue. Samples 5, then +5, completed pages from busy apexes → local-LM verdict block/keep/unsure → auto-inserts into blocklist. Never auto-blocks an explicit allowlist (e.g. Neocities, tilde communities, universities, git hosting). |
| API + web | Search with filters, ignore-category toggle, admin dashboard (table sizes, queue depth, category breakdown), worker saturation charts. |

Staging fields (title, body text, source URL, outbound link list) live directly on the domain's row. Wiped on successful `done` to avoid unbounded text growth at scale. Kept on LM failure so a retry doesn't require refetching.

Queue claim: `FOR UPDATE SKIP LOCKED`, ordered by `priority DESC, id ASC`. Claim order **is** the crawl policy, there is no separate scheduler.

---

## Schema evolution (order forced by production, not planned upfront)

1. Base tables: domains, categories, tags, domain_tags, trigram extension for fuzzy text search.
2. Split fetch from LM: added staging columns so GPU idle time isn't blocked on network I/O.
3. Added priority + outbound host list + partial indexes to support fast claims.
4. Added ICANN "apex" (registrable domain) derivation, needed for the subdomain cap.
5. Added nullable language/place/country columns, no backfill of existing rows.
6. Added blocklist table + review log, seeded from a static file.
7. Added partial btree indexes so category/language filtering stayed fast past 500k rows.

**Lesson:** don't design the full schema upfront. Ship the minimum, let production load force the next migration. Nullable-with-no-backfill is fine for late-added columns; don't block on backfilling historical rows.

---

## Crawl policy

### Priority model
- Every category has a static crawl-weight in a plain text file (`category-priority.txt`), diffable, hand-tuned.
- Outbound links inherit priority from the **category of the page that linked them**, not from any property of the target.
- Seeds bypass the queue at a fixed high weight.
- Non-English language on a classified page applies a flat priority penalty to its outbound links (multiplicative modifier; `en` and unclassified are unaffected). Penalty stacks additively with category weight.
- New weights only apply to links enqueued going forward. Existing `pending` rows are not rewritten retroactively.
- On insert, priority is set via `GREATEST(existing, new)`, never decreases an existing row, never resurrects a `done` row.

### Why weight instead of block
Hard-excluding a category loses recall, a "boring" site can still link to something worth indexing. Weighting demotes without discarding. Verified in production: several near-empty categories still meaningfully seeded better categories downstream.

### Subdomain flood control
- Problem: a small number of large multi-tenant platforms (blog hosts, forum farms) can dominate the index purely by subdomain count.
- Fix: cap non-apex hosts per registrable domain (ICANN eTLD+1) at a fixed number (100 here). Apex itself always allowed. Overflow dropped at enqueue time, not retroactively purged from already-`done` rows.
- Caveat: the cap is per eTLD+1, not per hosting provider. A farm using unique root domains per tenant (e.g. numeric `.com` per vendor) bypasses the cap entirely. Needs a separate mitigation (denylist / steward) if that pattern shows up.
- Caveat: cap is forward-only. A platform that flooded before the cap existed keeps its already-queued volume.

### Sink detection (steward)
- Automated version of "sample recent output from a high-volume apex and ask the model if it's spam."
- Runs as a separate process, does not compete with the main queue for claims.
- Same worker-profile mechanism as catalog, pointed at local LM Studio on the PC GPU — not the rented box. Sample rate is low enough that local concurrency is fine; catalog slots stay dedicated.
- Sample size: 5, then +5 more if ambiguous.
- Verdict: block / keep / unsure, only `block` writes to the blocklist automatically.
- Explicit allowlist overrides steward blocking unconditionally.
- In production: high precision on booking/hotel mills, correctly preserved large legitimate multi-tenant platforms (universities, SaaS-adjacent doc hosts) and one off-aesthetic but legitimate keep (a major B2B marketplace).
- **This is the single highest-leverage addition beyond the original spec.** Manual denylist maintenance does not survive tens of thousands of pages/hour.

### Empty / parked / non-English handling
- Parked = confirmed registrar for-sale copy only. Narrow definition.
- Blank JS-shell pages and bot-challenge interstitials (e.g. "verifying you are human") are a separate `empty` classification, resolved without any LM call.
- Both skip the LM entirely, zero GPU spend.
- No headless-browser rendering fallback. Deliberately deferred: JS rendering on the hot path defeats the "cheap and fast" design goal, and would not have kept up with peak throughput even at partial coverage (empty pages were ~15% of done volume; rendering just that slice at any reasonable concurrency would exceed a fetcher-plane's realistic budget).
- English-only via TLD whitelist (last label only, so multi-part ccTLDs are handled correctly) plus per-page language classification, not a hand-rolled subdomain heuristic.

---

## LM / prompting

- Model: ~4B parameter instruction-tuned model, structured JSON output, one call per domain, no multi-turn.
- Output: name, 2-3 sentence summary, one category, up to five tags.
- `max_tokens`: settled at 400 (p99 output length was ~381 characters / ~156 tokens; a higher cap was pure waste with no quality gain).
- Input text budget: 4000 characters of page text. Halving this would have truncated the majority of pages that reached the LM stage, verified against distribution of ready-page lengths.
- System prompt: ~600-650 tokens, held constant across calls so it prefix-caches on the inference server.
- Total prompt size in production: average ~1335 tokens, p99 ~1900 tokens.

### Prompt failure modes and fixes
| Failure | Root cause | Fix |
|---|---|---|
| Category leaking into the summary field | Model conflated the two output fields under some inputs | Treat a suspiciously short/label-like summary as a structured failure, retry once |
| Coherent-sounding but fabricated summary on a near-blank page | Model inferred content from the **hostname string** when body text was empty | Trust order: visible body text > title > meta. Never generate from domain name alone. Empty/near-empty input skips the LM. |
| Category distribution skewed toward a catch-all "other" bucket | Prompt listed high-frequency generic categories (ecommerce etc.) first, priming the model toward them | Reordered category list in the prompt to lead with target categories (research, blog, theatre, community, etc.) |
| Weak signal-to-noise on category vs tags | Tags accumulated meaningful signal (e.g. hundreds of theatre-tagged pages) that the category field wasn't capturing | Tags data used to detect and correct category prompt bias, treat tags as a leading indicator when tuning categories |

### Model comparison
- Smaller (~1.7B) model tested as a cheaper alternative: faster, but fabricated identity/location details from weak input more often. Not used.
- A same-size sibling model was tested for split GPU load, competed for VRAM with the primary model under decode, rejected for this reason alone.

---

## Inference infrastructure

| Setup | Concurrency | Sustained throughput | Verdict |
|---|---|---|---|
| Local consumer GPU, local inference server | 2 | ~60-80/min | Fine for prompt development, not for volume |
| Rented GPU, wrapper library adding distributed compute framework | 32 (briefly 48) | ~300/min average, spiky, occasionally throttled to ~60/min | Framework overhead consumed shared CPU; not GPU-bound, do not use this stack |
| Same GPU class, cold restart at full concurrency | 32 immediately | crash on first batch | Cold KV-cache + no ramp = activation memory spike, not a steady-state OOM |
| Rented GPU, dedicated CPU allocation, plain inference server, no distributed wrapper | 32 with gradual ramp | ~600/min average (not a spike) | Production workhorse |

### Key infra decisions
- **Dedicated CPU allocation matters more than GPU tier.** A GPU paired with a shared/contended CPU slice underperforms one paired with a smaller but exclusive CPU allocation.
- **Avoid wrapper libraries that assume distributed/multi-node inference** for a single-GPU workload. They add coordination overhead with no benefit and can silently become the actual bottleneck.
- **Ramp concurrency on cold start.** Jumping straight to target concurrency risks an activation-memory spike during first-batch prefill, independent of steady-state KV cache usage. A 30-second staged ramp from low to target concurrency avoided this with no other config changes.
- **GPU memory utilization headroom setting**: set conservatively during debugging (0.88) to survive the above crash; production logs later showed actual KV cache usage around 3-4%, meaning the conservative setting was not a tuned optimum, just what survived the incident. Worth revisiting if optimizing further.
- **Multi-GPU is not obviously better for this workload.** Per-domain LM calls are independent HTTP requests; N single-GPU machines are simpler to reason about than one multi-GPU box.
- **First container pull on a fresh instance is slow** (large image, one-time cost). Budget for this on first boot; subsequent boots on the same disk are fast. Provision more disk than you think (60GB not 40GB, once you account for image + model weights + logs).

### Production GPU: config and raw metrics

Box: RTX PRO 4500 (Blackwell), 32GB VRAM, 16 of 16 CPUs dedicated (no shared slice).

Inference server logs at sustained load:
- Prompt processing: ~6,000 tok/s
- Output generation: ~1,000 tok/s
- KV cache utilization: ~3-4% (never close to a limiting factor at this concurrency)
- GPU/CPU utilization were not separately monitored during the run, throughput and KV numbers above are what was logged.

Launch config that reached steady state:
- Concurrency: 32, reached via ~30s staged ramp from 8
- `--gpu-memory-utilization 0.88`
- Max batched tokens: 8192
- Sampling pinned on every call: `temperature 1.0`, `top_k 64`, `top_p 0.95` (matched the defaults the local dev server had been using, so switching infra didn't shift output distribution)
- `transformers==5.14.1` pinned explicitly, a newer version broke on this model's attention head config
- Multimodal limit flags (e.g. `--limit-mm-per-prompt`) dropped entirely, unnecessary and failed to parse for a text-only workload

Config that did *not* work (previous rental attempt, different day, same GPU class):
- `--max-num-seqs 64`, `--gpu-memory-utilization 0.95`, `--max-num-batched-tokens 16384`
- Jumping straight to concurrency 32 cold on this config crashed on first-batch prefill
- Root cause was an activation memory spike during cold prefill, not steady-state KV pressure, so the fix was the concurrency ramp, not the memory settings

**Takeaway:** 0.88 utilization / 8192 batched tokens is not a tuned optimum, it's a conservative setting that survived the crash. Given KV cache sat at 3-4% in production, there's real headroom to push utilization and batch size higher if squeezing more throughput out of the same box.

### Cost
~600 summaries/min at approximately $0.34/hour rental cost. Roughly 36,000/hour, about $1 per 100,000 domains catalogued. Full 560k-domain run cost a few GPU-hours total, not a meaningful cloud bill.

---

## Concurrency coupling

Fetcher throughput must roughly match worker/LM throughput or one side starves the other.

- Fetcher concurrency tuned in step with worker concurrency (ended at 32/32).
- A bounded "ready" backlog (max queue depth before fetcher pauses) is the actual coupling mechanism, not a fixed sleep or rate limit. This lets the two sides self-balance without hardcoding a ratio.
- At sustained throughput in the several-hundred/min range, a residential network connection becomes a plausible bottleneck (observed unexplained multi-minute throughput dips consistent with ISP-side DNS/rate shaping). Plan for this above roughly 500-600 done/min.

---

## Concurrency-related production bugs

| Symptom | Cause | Fix |
|---|---|---|
| Uncatchable process crash from an HTTP library assertion on socket teardown | Known upstream issue triggered by high fetch concurrency | Explicit crash guard around that specific assertion; cancel unused redirect response bodies |
| Sporadic duplicate-looking category rows | Looked like a missing dedup step | Actually Postgres deadlocks between category/tag upsert and outbound-link insert under high write concurrency, surfaced by the ORM as a generic query failure. Fixed with retry-on-deadlock. |
| Foreign key violation on domain completion | Steward blocked (and deleted pending rows for) an apex while a worker was mid-transaction summarising a domain under that same apex | Lock the row before finalizing (`FOR UPDATE`), abort cleanly if the row was removed mid-transaction, moved link-enqueue out of that transaction |
| Off-by-one context length error | Model max context slightly under actual worst-case prompt + output size | Recomputed and bumped context window to comfortably exceed measured worst case |

---

## Category / tag scaling problem

This is the part that does **not** scale as-is.

- Categories and tags were free-text from the LM, exact-string match, no synonym merging, no canonicalization.
- Rationale: let the model reveal the taxonomy instead of hand-designing one upfront. Correct call for getting started fast.
- Result at 560k domains: **671 distinct categories** (243 used exactly once), **121,055 distinct tags** (~68,000 used exactly once).
- Mitigation used: a manual dry-run string-replace merge tool, aggressive on tags, conservative on categories (distribution still forming, easy to over-merge prematurely).
- **This does not scale past a hobby-sized index.** At 10x+ this scale you need one of: a fixed/enum category set enforced at generation time, a hard tag budget, or a post-hoc embedding-based clustering pass. Free-text-forever is a one-way ratchet toward taxonomy debt.

---

## Storage / query scaling

- Postgres as the sole queue and store, `SKIP LOCKED` for claiming, held up to ~900k stored hosts / 733MB on disk.
- Dead-tuple buildup from high-frequency `UPDATE`/claim churn became visible (11k dead tuples on the main table) before the run was even half done, autovacuum lagged the write rate at times. Worth monitoring proactively, not just at 10x current scale.
- Partial btree indexes (scoped to the common filter combinations, not full-table indexes) were necessary to keep search responsive once the table passed roughly 500k rows.
- A cached counter column for total-domains-per-category was used instead of `COUNT(*)` on every dashboard/ignore-modal load. Correct instinct, but it's the only place a counter cache was used; nothing else in the system is sharded or pre-aggregated. At meaningfully larger scale (tens of millions of rows), claim-index contention and autovacuum tuning become a real, non-trivial ops problem, not solved by anything in this build.

---

## What doesn't scale as-is (explicit list)

1. **Free-text category/tag identity.** Needs canonicalization strategy before 10x growth.
2. **No recrawl.** One LM call per domain, ever. Hijacked/expired domains that change ownership after being catalogued stay wrong indefinitely. Steward prevents new bad domains from entering; it does not correct or re-examine anything already `done`.
3. **No JS rendering.** A meaningful minority of the visually-relevant target sites (small personal sites using canvas/WebGL, heavy client-side rendering) are permanently invisible to a Cheerio-only fetcher. Any fix here changes the cost model significantly (headless rendering is not cheap at the concurrency level this system runs at).
4. **English-only heuristic stack** (TLD whitelist + subdomain-language skip + language penalty) is a pragmatic pile of heuristics, not a real language-detection solution. Leaks obscure-language content through occasionally.
5. **Postgres claim/index/autovacuum behavior** was fine to <1M rows. Explicitly flagged as unverified beyond that without further tuning work.
6. **Default/unclassified priority bucket.** A default priority of zero groups "genuinely unknown" pages together with a long tail of low-value categories the model defaults to (hotel, generic business, expired-domain squats). This under-differentiates and lets low-value pages accumulate disproportionately in the unexamined middle of the queue. Needs a stricter "unknown" bucket or exclude unclassified from search by default.

---

## What worked, kept as-is

- Splitting fetch and LM into separate claim stages, so GPU sits idle only on LM-side backpressure, never on network latency.
- Priority-by-source-category queueing over naive breadth-first crawling.
- Per-registrable-domain subdomain cap over platform-level denylisting.
- Skipping the LM entirely on empty/parked/challenge pages, zero GPU spend.
- Pinned, fixed sampling parameters for every LM call (temperature/top_k/top_p held constant so category drift over time reflects prompt/data changes, not sampling noise).
- Gradual concurrency ramp on any cold inference-server start.
- Matching fetch concurrency to worker concurrency via backlog depth, not a fixed ratio.
- Automated sink detection (steward) as a second, independent process rather than folding spam-detection logic into the main worker.
- Iterating crawl weights from periodic production snapshots rather than trying to get the prompt or policy "right" in one pass.

---

## Reference numbers (final state, 560,183 done)

- Search-visible (non-ignored category) domains: ~379,000
- Empty-classified: 82,265 (~14.7% of done); roughly 59k blank JS shells, 23k bot-challenge interstitials
- Nonprofit category: 26,971
- Community category: 13,277
- Software category: 7,417
- Categories: 671 total, 243 singleton
- Tags: 121,055 total, ~68,000 singleton
- Distinct registrable domains (apexes): ~640,000, mean ~1.4 hosts per apex
- Peak sustained throughput: ~600 domains/min on a dedicated-CPU rented GPU
- Approximate cost per 100,000 domains catalogued: ~$1 in GPU rental
- Total disk footprint at 560k domains: 733MB
