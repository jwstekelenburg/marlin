# Above the roadmap

This file just allows me, the human operator, to high-level split work into blocks of big tasks with natural stopping points.

## Plan

- V1: Basic domain crawler/summariser, 500k records
- V2: Use the data, analyse the data
- V3: Back to scaling with new arch/tools

This pattern may repeat. Scale to get next set of data, refine, repeat.

We only keep going as long as we're interested and we get something out of it. V1 was cool on it's own. V2 may yeild interesting results, it may not, and this may die.

With this setup, we can document and snapshot at each version, each time providing useful information.

## [x] V1

- [x] Wrap up V1_TODO.md
- [-] Clean up repo for publishing
  - [x] run it again
  - [x] one more llm check
  - [ ] read through it yourself
  - [ ] make repo public
- [ ] Publish article probs using github pages
- [ ] Market article
- [ ] Check pg backup works

## [ ] V2

Our search page is cool, but, it's also hard now we have so many tags and categories... and search only goes as far as the users brain. We need to surface cool shit! That could be an entirely separate follow up article

- [ ] feed/recommendation system? or simpler
- [ ] No embeddings/semantic search? or push to v3
- [ ] category / tag collapsing? or push to v3
- [ ] News source curation as its own tracked category/pipeline?
- [ ] CT-log-based seeding as a first-class discovery source (script exists conceptually, not yet integrated)
- [ ] Use another model to analyse tags/categories and solve some of the problems we have
- [ ] check if two domains go same or similar place or clone. probs bad for data burden

## [ ] V3

This falls off the back of the previous task. We don't even know _if_ we need to scale, unless we have something worth scaling for... Write more here when ready

- [ ] yt subs classification
- [ ] Recrawl/freshness scheduling (explicitly a v1 non-goal already — keep it that way)
- [ ] Expand steward to do more config stuff, like steer category priority
- [ ] prompts to config, auto calculate params for gpu workloads etc
