import "dotenv/config";
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { enqueueHosts, pool } from "@marlin/db";
import { isAllowedEnglishTld, normalizeHost } from "@marlin/shared";

const input = process.argv[2];
if (!input) {
  console.error("usage: npm run ingest -- <domains.txt>");
  process.exit(1);
}

function resolveListFile(file: string): string {
  if (path.isAbsolute(file) && existsSync(file)) return file;
  const fromCwd = path.resolve(process.cwd(), file);
  if (existsSync(fromCwd)) return fromCwd;
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  return path.resolve(repoRoot, file);
}

const file = resolveListFile(input);

const BATCH = 1000;
let batch: string[] = [];
let seen = 0;
let inserted = 0;
let skipped = 0;

async function flush(): Promise<void> {
  if (batch.length === 0) return;
  inserted += await enqueueHosts(batch, "list");
  batch = [];
}

const rl = createInterface({
  input: createReadStream(file, { encoding: "utf8" }),
  crlfDelay: Infinity,
});

for await (const line of rl) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const host = normalizeHost(trimmed);
  if (!host || !isAllowedEnglishTld(host)) {
    skipped += 1;
    continue;
  }
  seen += 1;
  batch.push(host);
  if (batch.length >= BATCH) await flush();
}

await flush();
console.log(`ingest done: ${seen} valid, ${inserted} inserted, ${skipped} skipped`);
await pool.end();
