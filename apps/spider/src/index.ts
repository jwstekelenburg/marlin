import "dotenv/config";
import { sql } from "drizzle-orm";
import { db, enqueueHosts, pool } from "@marlin/db";
import { extractPage, fetchHomepage, fetchOptionsFromEnv, normalizeHost } from "@marlin/shared";

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

const maxDepth = envInt("SPIDER_MAX_DEPTH", 1);
const maxHosts = envInt("SPIDER_MAX_HOSTS", 50);
const concurrency = Math.max(1, envInt("SPIDER_CONCURRENCY", 4));
const fromQueue = (process.env.SPIDER_FROM_QUEUE ?? "false").toLowerCase() === "true";
const fetchOpts = fetchOptionsFromEnv();
fetchOpts.delayMs = envInt("SPIDER_DELAY_MS", fetchOpts.delayMs);

type Node = { host: string; depth: number };

function parseSeeds(): string[] {
  return (process.env.SPIDER_SEEDS ?? "")
    .split(/[,\s]+/)
    .map((s) => normalizeHost(s))
    .filter((h): h is string => Boolean(h));
}

async function seedsFromQueue(limit: number): Promise<string[]> {
  const result = await db.execute(sql`
    SELECT host FROM domains
    ORDER BY id
    LIMIT ${limit}
  `);
  return (result.rows as { host: string }[]).map((r) => r.host);
}

const visited = new Set<string>();
const queue: Node[] = [];
let visitedCount = 0;
let enqueuedTotal = 0;

function offer(host: string, depth: number): void {
  if (visited.has(host) || visited.size + queue.length >= maxHosts) return;
  visited.add(host);
  queue.push({ host, depth });
}

async function crawlOne(node: Node): Promise<void> {
  visitedCount += 1;
  console.log(`spider d${node.depth} ${node.host}`);
  const fetched = await fetchHomepage(node.host, fetchOpts);
  if ("error" in fetched) {
    console.warn(`  fetch failed: ${fetched.error}`);
    return;
  }

  const page = extractPage(fetched.html, fetched.finalUrl);
  const next = page.hosts.filter((h) => h !== node.host);
  const inserted = await enqueueHosts([node.host, ...next], node.depth === 0 ? "spider" : "spider");
  enqueuedTotal += inserted;

  if (node.depth < maxDepth) {
    for (const host of next) offer(host, node.depth + 1);
  }
}

async function runPool(): Promise<void> {
  let active = 0;

  async function take(): Promise<void> {
    while (true) {
      const node = queue.shift();
      if (!node) {
        if (active === 0) return;
        await new Promise((r) => setTimeout(r, 40));
        continue;
      }
      active += 1;
      try {
        await crawlOne(node);
      } catch (err) {
        console.warn(`  error ${node.host}:`, err);
      } finally {
        active -= 1;
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => take()));
}

const seedHosts = parseSeeds();
if (fromQueue) {
  const extra = await seedsFromQueue(maxHosts);
  for (const host of extra) seedHosts.push(host);
}

if (seedHosts.length === 0) {
  console.error("no seeds: set SPIDER_SEEDS or SPIDER_FROM_QUEUE=true");
  process.exit(1);
}

const insertedSeeds = await enqueueHosts(seedHosts, "spider");
console.log(
  `spider start: ${seedHosts.length} seed(s), ${insertedSeeds} new, depth<=${maxDepth}, cap=${maxHosts}`,
);

for (const host of seedHosts) offer(host, 0);
await runPool();

console.log(`spider done: fetched ${visitedCount}, newly queued ${enqueuedTotal}`);
await pool.end();
