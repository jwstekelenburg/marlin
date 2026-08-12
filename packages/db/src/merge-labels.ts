import { existsSync, readFileSync } from "node:fs";
import { pool } from "./client.js";
import { aliasFilePath, applyMerges, parseAliasFile, planMerges } from "./label-merge.js";

const apply = process.argv.slice(2).includes("--apply");
if (process.argv.slice(2).some((a) => a === "--help" || a === "-h")) {
  console.log("usage: npm run merge-labels -- [--apply]");
  console.log("  default is dry-run. --apply writes. map: data/label-aliases.txt");
  await pool.end();
  process.exit(0);
}
if (process.argv.slice(2).some((a) => a !== "--apply")) {
  console.error("unknown arg; usage: npm run merge-labels -- [--apply]");
  await pool.end();
  process.exit(1);
}

const file = aliasFilePath();
if (!existsSync(file)) {
  console.error(`alias file not found: ${file}`);
  await pool.end();
  process.exit(1);
}

const aliases = parseAliasFile(readFileSync(file, "utf8"));
const plan = await planMerges(aliases);
const actionable = plan.filter((p) => p.action !== "missing");

console.log(`aliases: ${file}`);
for (const p of plan) {
  if (p.action === "missing") continue;
  const arrow = `${p.from} → ${p.to}`;
  const extra = p.action === "rename" ? "rename (to missing)" : `into ${p.toCount}`;
  const ign = p.ignoreNote ? `  ${p.ignoreNote}` : "";
  console.log(`  ${p.kind.padEnd(8)} ${arrow}  ${p.fromCount} ${extra}${ign}`);
}
const missing = plan.filter((p) => p.action === "missing").length;
if (missing) console.log(`  (${missing} alias(es) skipped — from not in db)`);
console.log(
  `${actionable.length} change(s) (${plan.filter((p) => p.action === "merge").length} merge, ${plan.filter((p) => p.action === "rename").length} rename)`,
);

if (!apply) {
  console.log("dry-run; pass --apply to write");
  await pool.end();
  process.exit(0);
}

if (actionable.length === 0) {
  console.log("nothing to apply");
  await pool.end();
  process.exit(0);
}

const n = await applyMerges(plan);
console.log(`applied ${n}`);
await pool.end();
