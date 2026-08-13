import { pool } from "./client.js";
import { flushUnfinishedQueue } from "./queries.js";

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(`usage: npm run flush-queue

Deletes unfinished domain rows (pending/fetching/ready/summarizing/failed/skipped).
Keeps done. No confirmation — use carefully.`);
  process.exit(0);
}
if (args.length > 0) {
  console.error("unknown arg; usage: npm run flush-queue");
  process.exit(1);
}

const deleted = await flushUnfinishedQueue();
console.log(`flush-queue: deleted ${deleted} unfinished row(s) (kept done)`);
await pool.end();
