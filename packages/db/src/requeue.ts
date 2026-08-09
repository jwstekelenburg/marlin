import { pool } from "./client.js";
import { requeueFailed } from "./queries.js";

const arg = (process.argv[2] ?? "failed").toLowerCase();
if (arg !== "failed") {
  console.error("usage: npm run requeue -- failed");
  process.exit(1);
}

const { ready, pending } = await requeueFailed();
console.log(`requeued failed → ${ready} ready (have page text), ${pending} pending (refetch)`);
await pool.end();
