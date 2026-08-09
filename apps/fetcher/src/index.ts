import "dotenv/config";
import {
  claimNextFetch,
  markFailed,
  markSkipped,
  pool,
  readyBacklog,
  reclaimStuckFetch,
  skipDisallowedTldQueue,
  storeFetchedPage,
  trimApexQueueOverflow,
} from "@marlin/db";
import {
  extractPage,
  fetchHomepage,
  fetchOptionsFromEnv,
  hostSkipReason,
  log,
} from "@marlin/shared";

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

const concurrency = Math.max(1, envInt("FETCH_CONCURRENCY", 16));
const pollMs = envInt("FETCH_POLL_MS", 500);
const maxReady = Math.max(1, envInt("FETCH_MAX_READY", 500));
const fetchOpts = fetchOptionsFromEnv();

async function processOne(): Promise<boolean> {
  const backlog = await readyBacklog();
  if (backlog >= maxReady) return false;

  const job = await claimNextFetch();
  if (!job) return false;

  log.noisy(`fetch ${job.host} (#${job.id})`);
  try {
    const skip = hostSkipReason(job.host);
    if (skip) {
      await markSkipped(job.id, skip);
      log.noisy(`skipped ${job.host} (${skip})`);
      return true;
    }

    const fetched = await fetchHomepage(job.host, fetchOpts);
    if ("error" in fetched) {
      await markFailed(job.id, fetched.error, fetched.status);
      log.warn(`failed ${job.host}: ${fetched.error}`);
      return true;
    }

    const page = extractPage(fetched.html, fetched.finalUrl);
    const discovered = page.hosts.filter((h) => h !== job.host);

    await storeFetchedPage({
      id: job.id,
      title: page.title,
      text: page.body,
      url: fetched.finalUrl,
      httpStatus: fetched.status,
      outboundHosts: discovered,
    });
    log.noisy(
      `ready ${job.host} (body ${page.body.length} chars, ${discovered.length} outbound)`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markFailed(job.id, message);
    log.warn(`failed ${job.host}: ${message}`);
  }

  return true;
}

async function loop(id: number): Promise<void> {
  while (true) {
    try {
      const worked = await processOne();
      if (!worked) await new Promise((r) => setTimeout(r, pollMs));
    } catch (err) {
      log.error(`fetcher ${id} loop error:`, err);
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }
}

const reclaimed = await reclaimStuckFetch();
if (reclaimed > 0) log.info(`reclaimed ${reclaimed} stuck fetch row(s)`);

const tldSkipped = await skipDisallowedTldQueue();
if (tldSkipped > 0) log.info(`skipped ${tldSkipped} non-english TLD row(s)`);

const trimmed = await trimApexQueueOverflow();
if (trimmed > 0) log.info(`trimmed ${trimmed} over-cap pending subdomain(s)`);

log.info(`fetcher starting (concurrency=${concurrency}, maxReady=${maxReady})`);
await Promise.all(Array.from({ length: concurrency }, (_, i) => loop(i + 1)));

await pool.end();
