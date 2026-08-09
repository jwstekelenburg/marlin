import { pool } from "./client.js";
import { flushUnfinishedQueue } from "./queries.js";

const deleted = await flushUnfinishedQueue();
console.log(`flush-queue: deleted ${deleted} unfinished row(s) (kept done)`);
await pool.end();
