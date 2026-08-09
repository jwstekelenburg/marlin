import "dotenv/config";
import {
  claimNextDomain,
  completeDomain,
  enqueueHosts,
  markFailed,
  pool,
  reclaimStuckProcessing,
} from "@marlin/db";
import { extractPage, fetchHomepage, fetchOptionsFromEnv } from "@marlin/shared";
import { catalogPage } from "./lm.js";

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

const concurrency = Math.max(1, envInt("WORKER_CONCURRENCY", 1));
const pollMs = envInt("WORKER_POLL_MS", 1000);
const fetchOpts = fetchOptionsFromEnv();

async function processOne(): Promise<boolean> {
  const job = await claimNextDomain();
  if (!job) return false;

  console.log(`processing ${job.host} (#${job.id})`);
  try {
    const fetched = await fetchHomepage(job.host, fetchOpts);
    if ("error" in fetched) {
      await markFailed(job.id, fetched.error, fetched.status);
      console.warn(`failed ${job.host}: ${fetched.error}`);
      return true;
    }

    const page = extractPage(fetched.html, fetched.finalUrl);
    const discovered = page.hosts.filter((h) => h !== job.host);
    if (discovered.length > 0) {
      const inserted = await enqueueHosts(discovered, "link");
      if (inserted > 0) console.log(`  enqueued ${inserted} linked host(s)`);
    }

    const catalog = await catalogPage({
      url: fetched.finalUrl,
      title: page.title,
      text: page.text || page.description || page.title || job.host,
    });

    await completeDomain({
      id: job.id,
      name: catalog.name || job.host,
      summary: catalog.summary,
      category: catalog.category,
      tags: catalog.tags,
      httpStatus: fetched.status,
    });
    console.log(`done ${job.host} [${catalog.category}]`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markFailed(job.id, message);
    console.warn(`failed ${job.host}: ${message}`);
  }

  return true;
}

async function workerLoop(id: number): Promise<void> {
  while (true) {
    try {
      const worked = await processOne();
      if (!worked) await new Promise((r) => setTimeout(r, pollMs));
    } catch (err) {
      console.error(`worker ${id} loop error:`, err);
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }
}

const reclaimed = await reclaimStuckProcessing();
if (reclaimed > 0) console.log(`reclaimed ${reclaimed} stuck processing row(s)`);

console.log(`worker starting (concurrency=${concurrency})`);
await Promise.all(Array.from({ length: concurrency }, (_, i) => workerLoop(i + 1)));

await pool.end();
