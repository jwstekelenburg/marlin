import { pool } from "./client.js";
import { requeueByStatus } from "./queries.js";

const from = (process.argv[2] ?? "failed").toLowerCase();

if (from !== "failed" && from !== "processing") {
  console.error("usage: npm run requeue -- failed|processing");
  process.exit(1);
}

const count = await requeueByStatus(from);
console.log(`requeued ${count} ${from} domain(s) -> pending`);
await pool.end();
