import "dotenv/config";
import {
  claimNextLm,
  completeDomain,
  markFailed,
  pool,
  reclaimStuckLm,
  skipDisallowedTldQueue,
} from "@marlin/db";
import { pickSiteName } from "@marlin/shared";
import { catalogPage } from "./lm.js";

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

const concurrency = Math.max(1, envInt("WORKER_CONCURRENCY", 1));
const pollMs = envInt("WORKER_POLL_MS", 200);

async function processOne(): Promise<boolean> {
  const job = await claimNextLm();
  if (!job) return false;

  const title = job.page_title ?? "";
  const text = job.page_text || title || job.host;
  const url = job.page_url || `https://${job.host}/`;

  console.log(`lm ${job.host} (#${job.id})`);
  try {
    const catalog = await catalogPage({ url, title, text });
    const name = pickSiteName({
      llmName: catalog.name,
      title,
      host: job.host,
      category: catalog.category,
    });
    if (name !== catalog.name) console.log(`  name ${catalog.name || "(empty)"} → ${name}`);

    await completeDomain({
      id: job.id,
      name,
      summary: catalog.summary,
      category: catalog.category,
      tags: catalog.tags,
      httpStatus: job.http_status,
    });
    console.log(`done ${job.host} [${catalog.category}]`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markFailed(job.id, message);
    console.warn(`failed ${job.host}: ${message}`);
  }

  return true;
}

async function loop(id: number): Promise<void> {
  while (true) {
    try {
      const worked = await processOne();
      if (!worked) await new Promise((r) => setTimeout(r, pollMs));
    } catch (err) {
      console.error(`lm worker ${id} loop error:`, err);
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }
}

const reclaimed = await reclaimStuckLm();
if (reclaimed > 0) console.log(`reclaimed ${reclaimed} stuck summarizing row(s)`);

const tldSkipped = await skipDisallowedTldQueue();
if (tldSkipped > 0) console.log(`skipped ${tldSkipped} non-english TLD row(s)`);

console.log(`lm worker starting (concurrency=${concurrency})`);
await Promise.all(Array.from({ length: concurrency }, (_, i) => loop(i + 1)));

await pool.end();
