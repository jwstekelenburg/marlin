# I built a search engine for people making things, in a weekend, for about the price of a pizza

Sunday, 2am. I couldn't sleep and I was annoyed at search engines again. Every query I actually cared about, portfolios, zines, weird little art projects, one-person software, drowned under a foot of corporate documentation and SEO sludge. So I did the thing you do at 2am: I opened a terminal and typed out a plan.

"I want to make a search engine for myself only. There are 40-ish million domains. We can store a bit of metadata about each one. Even with 1KB each that's 40GB, which is doable."

By Wednesday lunch I had 560,183 homepages catalogued, an empty queue of anything worth fetching next, and a decision to stop. This is the story of that weekend: what I built, what broke, what it cost, and what I'd tell you if you wanted to build your own.

**The headline, if you only read one paragraph:** for about $10, an overnight GPU rental, and a few hours of steering the thing while it ran, you can have a personal search index of a few hundred thousand sites, under a gigabyte on disk. That's the whole pitch. Everything below is how I got there and where the sharp edges are.

> Full technical details are [provided separately](technical.md).

![Search UI — query “Research”](images/hero-search.png)

## What I was actually trying to build

Not "index the web." Just: find people doing stuff, art, code, hardware, poetry, little theatres, and not drown in `docs.company.com`. Personal, single user, no accounts. A crawler that only ever looks at homepages, a small local language model that reads each one and writes a name, two or three sentences, a category, and a handful of tags. A little search UI on top with fuzzy matching so I could type half a word and still find the right site.

I wrote down what I was explicitly *not* building, mostly so that agents helping me wouldn't quietly "simplify" it into something bigger: no IP scanning, no Redis, no storing full page HTML, no recrawl scheduler, nothing multi-tenant. Ignore was just a checkbox on a category, applied at search time. The crawler still summarised ecommerce sites, I just didn't have to look at them.

The napkin math was tens of millions of domains at roughly 1KB of metadata each, which is genuinely nothing for a Postgres box. Page text itself was never meant to be a corpus, just a scratch buffer that gets thrown away the moment the model is done with it.

## The machine

Four processes, three of them on my own PC, one rented GPU that never touches the database directly:

- **A fetcher.** Grabs a pending domain, tries HTTPS then HTTP, pulls the title, body text, and outbound links with a simple HTML parser, no JavaScript execution. Sets the row to "ready."
- **A worker.** Grabs a ready domain, skips the model entirely if the page is empty, parked, or a bot-challenge wall, otherwise makes one structured request to a small local model (Gemma, 4B parameters) and gets back a name, summary, category, and tags. Wipes the scratch text, enqueues the outbound links at a priority based on what kind of page they came from.
- **A steward.** This one doesn't touch the main queue at all. It samples domains from hosts that are producing suspiciously many pages, asks the model "block, keep, or unsure," and quietly maintains a blocklist. More on why I needed this later.
- **An API and a tiny web UI.** Search with filters, a page to toggle which categories are hidden, and a dashboard so I could actually see what the factory was doing instead of squinting at logs.

![Dashboard — pipeline, categories, Postgres size](images/dashboard.png)

Everything the fetcher grabs lives directly on the domain's own database row while it's "in progress." Once the model is done with it, that text gets wiped. That matters more than it sounds, because at any real scale you cannot let raw page text pile up forever. Forty million rows times a few kilobytes each adds up fast, and I only needed that text for the few seconds the model was reading it.

## The web is 90% corporate, actually

The first version worked within a couple hours. Point it at a sample of domains, watch things get summarised, search for them. Great. Then, Sunday afternoon, I looked at what had actually been catalogued and it was the wrong web. Over 90% corporate sites and documentation. My seed list was skewed and the crawler had no opinions about what to chase next.

The fix wasn't to block anything. Blocking felt tempting but wrong, because a boring corporate docs page might still link out to someone's personal blog, and I didn't want to lose that. Instead I weighted the queue: pages classified as "portfolio" or "zine" or "software" push their outbound links way up the priority list, pages classified as "corporate" or "docs" push theirs down. One text file, `category-priority.txt`, became the steering wheel for the rest of the weekend. I'd tune a number, watch what came in over the next hour, tune again.

That same afternoon I wiped the database twice because the quality was bad enough to just start over. Two bugs stood out:

One site's summary field just said "academic-profile," a category label the model had shoved into the wrong slot. Fix: treat a suspiciously short summary as a failure and retry once with a stricter prompt.

Another site, a GoDaddy domain-parking page with basically no real HTML, got summarised by the model as being "for the furry community." but it had just seen the word "furry" in the hostname, with empty body, and invented an entire fandom site out of nothing. That one taught me the actual rule: trust visible text over the title, trust the title over anything guessed from the domain name, and if a page is near-empty or clearly parked, don't even bother asking the model, just mark it and move on.

## Sunday night: Tumblr is not the web

By evening the crawl had a new problem. Tumblr and Neocities blogs were showing up in such volume that they were going to become the entire index. My first instinct was to block them, which felt wrong, because Neocities specifically is exactly the aesthetic I was hunting for. The actual fix was a cap: allow the main domain always, but once a given root domain has produced more than 100 subdomains, stop enqueueing new ones from it. One pass of that rule deleted over 45,000 queued pages instantly. Tumblr still ended up contributing over 9,000 pages to the final index, since the cap only applies going forward, but it stopped being the whole story.

This was also the night the actual purpose came into focus, less "index everything," more "find the people making things for a community." I reseeded the crawl with about ten deliberately chosen doors: tilde communities, small independent blogging platforms, a webring or two. Almost the entire final index traces back to links found from those ten seeds, not from the seed list itself.

![Family share over time — Tumblr / Neocities / Blogspot](images/family-share-over-time.png)

Monday morning brought a related flavor of the same problem: forum farms and Chinese B2B vendor microsites riding a "forum" category boost into a black hole of near-identical pages. Same lesson, different category. I demoted "forum" hard and started keeping an explicit blocklist file for known mills.

## Renting a GPU, badly, then well

My own GPU, a consumer card, could summarise roughly one page per second running locally. Fine for building the prompt, hopeless for actually filling an index. So I rented a cloud GPU to run the same small model at real concurrency, and this is where most of my actual debugging time went, none of it about the AI itself.

The short version: my first rental setup used a wrapper library that insisted on spinning up a distributed compute framework even for a single GPU, and that framework fought with the host machine for CPU time. I was paying for a GPU and getting throttled by CPU contention I never asked for. Threw that away, ran the plain open source inference server instead, no wrapper. Hit a crash on cold start at high concurrency, which turned out to be a memory spike during the first batch, not a steady-state problem, fixed by ramping concurrency up gradually instead of slamming it at full speed from a cold start.

The machine that actually did the job was a mid-range workstation GPU with a full, unshared set of CPU cores attached. That distinction, a dedicated CPU slice versus an impressively named but shared one, may have mattered more than the GPU model itself. Sustained throughput on that box was around 600 summaries a minute, at a rental cost of about thirty five cents an hour. That's roughly a dollar to catalogue a hundred thousand sites.

Ballpark napkin math at those rates, assuming you can keep the GPUs fed and they scale roughly linearly. Renting two or three GPUs costs about the same for a given milestone, because each one runs for less wall-clock time; you mostly buy days back:

| Sites | Approx. cost | 1 GPU | 2 GPUs | 3 GPUs |
| --- | --- | --- | --- | --- |
| 10k | ~$0.10 | ~17 min | ~8 min | ~6 min |
| 100k | ~$1 | ~3 hrs | ~1.5 hrs | ~1 hr |
| 1M | ~$10 | ~1.2 days | ~14 hrs | ~9 hrs |
| 10M | ~$100 | ~12 days | ~6 days | ~4 days |

Those figures lean on the best of the three setups I actually tried. Sustained throughput across them looked like this:

![Observed throughput across three GPU setups](images/throughput-setups.png)

> \* The 4090 run used the Vast.ai / vLLM wrapper with the CPU pegged — GPU underutilised. The PRO 4500 numbers are the plain vLLM setup with a dedicated CPU slice.

The GPU/CPU utilisation data came from the servers own management UI, where I noticed CPU was +90% while GPU was between 30-50%. I never benchmarked the GPU/CPU on the RTX PRO 4500 because it was an overnight run just for clearing the priority queue and wrapping things up. I got the token throughput values from the server logs. Hour by hour, the weekend looked quiet for most of Monday and Tuesday, then the good box held near 600 pages a minute until the queue was empty:

![Weekend completion rate — done pages per minute](images/rate-over-time.png)

## Inventing a second worker at midnight

Late Monday night, staring at the crawl still running, I asked myself something like: at this scale I can't manually watch for bad spirals, could I have a second small process sample five, then ten, completed pages from any domain that's producing suspiciously many, and ask the model itself whether to block it?

That became the steward, and it's the single addition that let the index grow from around 65,000 pages to 560,000 without me babysitting it. It sat on the same local card and LM Studio I'd used for prompt work, so spiral judgements never competed with the rented GPU that was filling the index. Over the run it blocked 177 problem domains on its own, almost entirely hotel and booking mills, and correctly left alone things like universities and legitimate large platforms that just happen to have a lot of subdomains.

## What the numbers actually looked like

![Index snapshots — Sunday evening through Wednesday noon (UTC)](images/snapshots-mon-wed.png)

Watching this over four days was genuinely the fun part. Early on, blogs and personal sites made up over half the index. That was mostly Tumblr and Neocities flooding in. By the end that share had dropped to about 12%. Not because I found fewer personal sites. I found more of everything, but the crawl matured into a much broader mix: nonprofits, community sites, software projects, magazines, museums, podcasts.

The nonprofit category alone ended with almost 27,000 real organisations. I spot checked a sample and it's genuinely full of things like food banks, wildlife charities, and civic groups. That's the kind of result that makes the weekend feel worth it, a category I barely thought about at the start turning into one of the strongest parts of the index.

Eventually the prioritised categories ran dry and the crawler started clearing the zero-priority backlog, the stuff that had been queued the whole time but never bubbled up. That backlog is a fair cross-section of the raw internet with none of the curation. So right on schedule, once nothing was left to prioritise ahead of it, the model started cataloguing a wave of adult sites.

Roughly 15% of everything crawled ended up as "empty," meaning the page was either a bare JavaScript shell my simple HTML parser couldn't see through, or a bot-detection wall. I never built a fallback that actually renders JavaScript, on purpose, since it would have meant running a full browser at scale, which is a different and much more expensive project. Some of the most aesthetically perfect sites for what I was hunting for are sitting in that empty bucket right now, which stings a little, but was the right tradeoff for a weekend budget.

## The part that will actually bite you at scale

If you try this yourself, the crawling and the GPU renting are the fun, satisfying parts. The part that quietly becomes a mess is category and tag handling. I let the model invent its own category and tag names freely, on the theory that it would teach me the taxonomy instead of me guessing one upfront. That was the right call for getting started fast. It also means I ended up with 671 distinct categories, many used exactly once, and over 121,000 tags, more than half used only a single time, mostly because the model spells things slightly differently call to call. I wrote a manual merge tool to clean the worst of it up by hand. That does not scale past a hobby project. If you're building something bigger than a weekend index, decide up front whether you're going to constrain the model to a fixed list of categories or budget real time for cleanup, because "just let the model freestyle" catches up with you fast.

The other genuine scaling issue is prompt and crawl steering itself. None of the fixes above came from a clever one-shot prompt. They came from watching production data at several points over the weekend and nudging weights, one file, a handful of numbers, based on what the crawl was actually doing. That loop, look at real output, adjust one lever, watch again, did more work than any amount of upfront planning would have.

## So, should you build one

If you want a search engine that only returns the kind of thing you actually go looking for, yes, I think this is very doable in a weekend, and cheap enough that the GPU bill isn't the reason not to try. The rough shape that worked for me: split fetching from summarising so a slow network connection never leaves an expensive GPU idle, weight your crawl queue instead of hard-blocking categories you don't want yet, cap subdomains instead of banning whole platforms, skip the model entirely on empty or parked pages, and build some kind of automated sink-detector once you're past the size where you can eyeball the incoming pages yourself.

I'm not planning to host or release my own production database, at least not right now, so I can't hand you my 560,000 sites directly. But the code is going up as open source, so you can point your own crawl wherever your own curiosity leads.

**Repo:** [Marlin - from Finding Nemo, on a search accross the ocean](https://github.com/alexmorleyfinch/marlin)

![Search UI — query “Art”](images/closing-search.png)