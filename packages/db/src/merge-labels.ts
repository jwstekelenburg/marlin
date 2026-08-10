import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeLabel } from "@marlin/shared";
import type { Pool, PoolClient } from "pg";
import { pool } from "./client.js";

type Kind = "tag" | "category";
type Alias = { kind: Kind; from: string; to: string };
type LabelRow = { id: number; name: string; ignored: boolean; domain_count: number };

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function aliasFilePath(): string {
  const override = process.env.LABEL_ALIASES_FILE?.trim();
  if (override) return path.resolve(override);
  return path.join(repoRoot, "data/label-aliases.txt");
}

function parseAliasFile(text: string): Alias[] {
  const out: Alias[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 3) continue;
    const kind = parts[0];
    if (kind !== "tag" && kind !== "category") {
      throw new Error(`unknown kind "${kind}" (want tag or category): ${trimmed}`);
    }
    const to = normalizeLabel(parts[parts.length - 1] ?? "");
    const from = normalizeLabel(parts.slice(1, -1).join(" "));
    if (!from || !to || from === to) continue;
    out.push({ kind, from, to });
  }
  return out;
}

/** Collapse a→b, b→c into a→c. Throws on cycles. */
function resolveAliasMap(aliases: Alias[], kind: Kind): Map<string, string> {
  const oneHop = new Map<string, string>();
  for (const a of aliases) {
    if (a.kind !== kind) continue;
    oneHop.set(a.from, a.to);
  }

  const resolved = new Map<string, string>();
  for (const from of oneHop.keys()) {
    const seen = new Set<string>();
    let cur = from;
    while (oneHop.has(cur)) {
      if (seen.has(cur)) throw new Error(`${kind} alias cycle involving "${cur}"`);
      seen.add(cur);
      cur = oneHop.get(cur)!;
    }
    if (cur !== from) resolved.set(from, cur);
  }
  return resolved;
}

async function getLabel(
  q: Pool | PoolClient,
  kind: Kind,
  name: string,
): Promise<LabelRow | undefined> {
  const table = kind === "tag" ? "tags" : "categories";
  const { rows } = await q.query<LabelRow>(
    `SELECT id, name, ignored, domain_count FROM ${table} WHERE name = $1`,
    [name],
  );
  return rows[0];
}

async function mergeTag(q: PoolClient, from: LabelRow, to: LabelRow): Promise<void> {
  await q.query(
    `DELETE FROM domain_tags AS dt
     USING domain_tags AS keep
     WHERE dt.tag_id = $1 AND keep.tag_id = $2 AND dt.domain_id = keep.domain_id`,
    [from.id, to.id],
  );
  await q.query(`UPDATE domain_tags SET tag_id = $1 WHERE tag_id = $2`, [to.id, from.id]);
  await q.query(`UPDATE tags SET ignored = ignored OR $1 WHERE id = $2`, [from.ignored, to.id]);
  await q.query(`DELETE FROM tags WHERE id = $1`, [from.id]);
  await q.query(
    `UPDATE tags SET domain_count = (SELECT COUNT(*)::int FROM domain_tags WHERE tag_id = $1) WHERE id = $1`,
    [to.id],
  );
}

async function mergeCategory(q: PoolClient, from: LabelRow, to: LabelRow): Promise<void> {
  await q.query(`UPDATE domains SET category_id = $1 WHERE category_id = $2`, [to.id, from.id]);
  await q.query(`UPDATE categories SET ignored = ignored OR $1 WHERE id = $2`, [
    from.ignored,
    to.id,
  ]);
  await q.query(`DELETE FROM categories WHERE id = $1`, [from.id]);
  await q.query(
    `UPDATE categories SET domain_count = (SELECT COUNT(*)::int FROM domains WHERE category_id = $1) WHERE id = $1`,
    [to.id],
  );
}

type PlanRow = {
  kind: Kind;
  from: string;
  to: string;
  action: "merge" | "rename" | "missing";
  fromCount: number;
  toCount: number;
  ignoreNote: string;
};

async function planMap(
  kind: Kind,
  map: Map<string, string>,
): Promise<PlanRow[]> {
  const plan: PlanRow[] = [];
  for (const [from, to] of [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const src = await getLabel(pool, kind, from);
    if (!src) {
      plan.push({ kind, from, to, action: "missing", fromCount: 0, toCount: 0, ignoreNote: "" });
      continue;
    }
    const dst = await getLabel(pool, kind, to);
    if (!dst) {
      plan.push({
        kind,
        from,
        to,
        action: "rename",
        fromCount: src.domain_count,
        toCount: 0,
        ignoreNote: src.ignored ? "ignored stays" : "",
      });
      continue;
    }
    plan.push({
      kind,
      from,
      to,
      action: "merge",
      fromCount: src.domain_count,
      toCount: dst.domain_count,
      ignoreNote:
        src.ignored && !dst.ignored
          ? "will mark target ignored"
          : src.ignored && dst.ignored
            ? "both ignored"
            : "",
    });
  }
  return plan;
}

function printPlan(plan: PlanRow[]): void {
  for (const p of plan) {
    if (p.action === "missing") continue;
    const arrow = `${p.from} → ${p.to}`;
    const extra = p.action === "rename" ? "rename (to missing)" : `into ${p.toCount}`;
    const ign = p.ignoreNote ? `  ${p.ignoreNote}` : "";
    console.log(`  ${p.kind.padEnd(8)} ${arrow}  ${p.fromCount} ${extra}${ign}`);
  }
  const missing = plan.filter((p) => p.action === "missing").length;
  if (missing) console.log(`  (${missing} alias(es) skipped — from not in db)`);
}

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
const plan = [
  ...(await planMap("category", resolveAliasMap(aliases, "category"))),
  ...(await planMap("tag", resolveAliasMap(aliases, "tag"))),
];
const actionable = plan.filter((p) => p.action !== "missing");

console.log(`aliases: ${file}`);
printPlan(plan);
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

const client = await pool.connect();
try {
  await client.query("BEGIN");
  for (const p of plan) {
    if (p.action === "missing") continue;
    const src = await getLabel(client, p.kind, p.from);
    if (!src) continue;
    const dst = await getLabel(client, p.kind, p.to);
    if (!dst) {
      const table = p.kind === "tag" ? "tags" : "categories";
      await client.query(`UPDATE ${table} SET name = $1 WHERE id = $2`, [p.to, src.id]);
      continue;
    }
    if (src.id === dst.id) continue;
    if (p.kind === "tag") await mergeTag(client, src, dst);
    else await mergeCategory(client, src, dst);
  }
  await client.query("COMMIT");
  console.log("applied");
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
} finally {
  client.release();
  await pool.end();
}
