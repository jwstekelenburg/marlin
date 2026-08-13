import "dotenv/config";
import {
  claimNextLm,
  completeDomain,
  markFailed,
  markSkipped,
  pool,
  reclaimStuckLm,
  dropBlockedApexQueue,
  refreshBlockedApexGate,
  skipDisallowedTldQueue,
  trimApexQueueOverflow,
} from "@marlin/db";
import {
  buildLlmPageText,
  catalogWithoutLlm,
  envInt,
  hostSkipReason,
  installFetchCrashGuards,
  log,
  pickSiteName,
  skipLmReason,
} from "@marlin/shared";
import { catalogPage } from "./lm.js";
import { resolveWorkerProfile } from "./profile.js";

installFetchCrashGuards("worker");

const profile = resolveWorkerProfile({ argv: process.argv });
const concurrency = Math.max(1, profile.concurrency);
const pollMs = envInt("WORKER_POLL_MS", 200);
/** Soft-start: avoid a cold prefill storm that can OOM vLLM. Ramp 0 = start at full concurrency. */
const rampStart = Math.min(concurrency, Math.max(1, envInt("WORKER_RAMP_START", 8)));
const rampStep = Math.max(1, envInt("WORKER_RAMP_STEP", 8));
const rampMs = Math.max(0, envInt("WORKER_RAMP_MS", 30_000));

let lmCallsTotal = 0;
let lmCallsWindow = 0;

setInterval(() => {
  log.info(`lm calls: ${lmCallsWindow} last minute (${lmCallsTotal} total)`);
  lmCallsWindow = 0;
}, 60_000);

async function processOne(): Promise<boolean> {
  const job = await claimNextLm();
  if (!job) return false;

  const title = job.page_title ?? "";
  const body = job.page_text ?? "";
  const url = job.page_url || `https://${job.host}/`;

  const skip = hostSkipReason(job.host);
  if (skip) {
    await markSkipped(job.id, skip);
    log.noisy(`skipped ${job.host} (${skip})`);
    return true;
  }

  try {
    const skipLm = skipLmReason(title, body);
    if (skipLm) {
      const catalog = catalogWithoutLlm(skipLm, job.host, title);
      const { enqueued, priority, aborted } = await completeDomain({
        id: job.id,
        ...catalog,
        httpStatus: job.http_status,
        outboundHosts: job.outbound_hosts ?? [],
      });
      if (aborted) {
        log.noisy(`dropped ${job.host} (not summarizing — apex blocked or already done?)`);
        return true;
      }
      log.noisy(
        `done ${job.host} [${catalog.category}/${skipLm}] no-lm links@${priority}` +
          (enqueued > 0 ? ` +${enqueued}` : ""),
      );
      return true;
    }

    const text = buildLlmPageText({
      title,
      description: "",
      body,
      limit: profile.textChars,
    });
    log.noisy(`lm ${job.host} (#${job.id})`);
    lmCallsTotal += 1;
    lmCallsWindow += 1;
    const catalog = await catalogPage({ url, title, text, lm: profile });
    const name = pickSiteName({
      llmName: catalog.name,
      title,
      host: job.host,
      category: catalog.category,
    });
    if (name !== catalog.name) log.noisy(`  name ${catalog.name || "(empty)"} → ${name}`);

    const { enqueued, priority, aborted } = await completeDomain({
      id: job.id,
      name,
      summary: catalog.summary,
      category: catalog.category,
      tags: catalog.tags,
      language: catalog.language,
      place: catalog.place,
      country: catalog.country,
      httpStatus: job.http_status,
      outboundHosts: job.outbound_hosts ?? [],
    });
    if (aborted) {
      log.noisy(`dropped ${job.host} (not summarizing — apex blocked or already done?)`);
      return true;
    }
    log.noisy(
      `done ${job.host} [${catalog.category}] links@${priority}` +
        (enqueued > 0 ? ` +${enqueued}` : ""),
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
      log.error(`lm worker ${id} loop error:`, err);
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }
}

const reclaimed = await reclaimStuckLm();
if (reclaimed > 0) log.info(`reclaimed ${reclaimed} stuck summarizing row(s)`);

const tldSkipped = await skipDisallowedTldQueue();
if (tldSkipped > 0) log.info(`skipped ${tldSkipped} non-english TLD row(s)`);

const blockedDropped = await dropBlockedApexQueue();
if (blockedDropped > 0) log.info(`dropped ${blockedDropped} blocked-apex queue row(s)`);

const trimmed = await trimApexQueueOverflow();
if (trimmed > 0) log.info(`trimmed ${trimmed} over-cap pending subdomain(s)`);

setInterval(() => {
  refreshBlockedApexGate().catch((err) => log.warn("blocked-apex gate refresh failed:", err));
}, 30_000);

const loops: Promise<void>[] = [];
let active = 0;

function addWorkers(n: number): number {
  const toAdd = Math.min(n, concurrency - active);
  for (let i = 0; i < toAdd; i++) {
    active += 1;
    loops.push(loop(active));
  }
  return toAdd;
}

const initial = rampMs === 0 ? concurrency : rampStart;
addWorkers(initial);
log.info(
  `lm worker starting profile=${profile.name} lm=${profile.lm} model=${profile.model || "(auto)"} ` +
    `url=${profile.baseUrl} concurrency=${active}/${concurrency}` +
    (active < concurrency ? ` ramp +${rampStep}/${rampMs}ms` : ""),
);

if (active < concurrency) {
  const timer = setInterval(() => {
    const added = addWorkers(rampStep);
    if (added > 0) log.info(`lm worker concurrency ${active}/${concurrency}`);
    if (active >= concurrency) clearInterval(timer);
  }, rampMs);
}

await Promise.all(loops);

await pool.end();
