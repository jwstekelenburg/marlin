import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeLabel } from "@marlin/shared";
import type { Pool, PoolClient } from "pg";
import { pool } from "./client.js";

export type LabelKind = "tag" | "category";

export type Alias = { kind: LabelKind; from: string; to: string };

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** How often completeDomain re-reads data/label-aliases.txt (mtime may be unchanged). */
const ALIAS_CACHE_MS = 30_000;

type AliasMaps = {
  category: Map<string, string>;
  tag: Map<string, string>;
  mtimeMs: number;
  loadedAt: number;
};

let aliasCache: AliasMaps | null = null;

export function aliasFilePath(): string {
  const override = process.env.LABEL_ALIASES_FILE?.trim();
  if (override) return path.resolve(override);
  return path.join(repoRoot, "data/label-aliases.txt");
}

/** Resolved from→to maps for runtime rewrite. Reloads when the file changes or cache ages out. */
export function getLabelAliasMaps(reload = false): Pick<AliasMaps, "category" | "tag"> {
  const file = aliasFilePath();
  const now = Date.now();
  let mtimeMs = 0;
  if (existsSync(file)) {
    try {
      mtimeMs = statSync(file).mtimeMs;
    } catch {
      mtimeMs = 0;
    }
  }

  if (
    !reload &&
    aliasCache &&
    aliasCache.mtimeMs === mtimeMs &&
    now - aliasCache.loadedAt < ALIAS_CACHE_MS
  ) {
    return { category: aliasCache.category, tag: aliasCache.tag };
  }

  const aliases = existsSync(file) ? parseAliasFile(readFileSync(file, "utf8")) : [];
  aliasCache = {
    category: resolveAliasMap(aliases, "category"),
    tag: resolveAliasMap(aliases, "tag"),
    mtimeMs,
    loadedAt: now,
  };
  return { category: aliasCache.category, tag: aliasCache.tag };
}

/** Rewrite LM labels through data/label-aliases.txt before upsert. */
export function applyLabelAliases(input: {
  category: string;
  tags: string[];
}): { category: string; tags: string[] } {
  const maps = getLabelAliasMaps();
  const categoryRaw = normalizeLabel(input.category);
  const category = maps.category.get(categoryRaw) ?? categoryRaw;
  const tags = [
    ...new Set(
      input.tags
        .map(normalizeLabel)
        .filter(Boolean)
        .map((t) => maps.tag.get(t) ?? t),
    ),
  ].sort();
  return { category, tags };
}

export type LabelRow = {
  id: number;
  name: string;
  ignored: boolean;
  domain_count: number;
};

export type MergePlanRow = {
  kind: LabelKind;
  from: string;
  to: string;
  action: "merge" | "rename" | "missing";
  fromCount: number;
  toCount: number;
  ignoreNote: string;
};

export function parseAliasFile(text: string): Alias[] {
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
export function resolveAliasMap(aliases: Alias[], kind: LabelKind): Map<string, string> {
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

export function aliasLine(kind: LabelKind, from: string, to: string): string {
  return `${kind}  ${from}  ${to}`;
}

async function getLabel(
  q: Pool | PoolClient,
  kind: LabelKind,
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

export async function planMerges(
  aliases: Alias[],
  q: Pool | PoolClient = pool,
): Promise<MergePlanRow[]> {
  async function planMap(kind: LabelKind, map: Map<string, string>): Promise<MergePlanRow[]> {
    const plan: MergePlanRow[] = [];
    for (const [from, to] of [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const src = await getLabel(q, kind, from);
      if (!src) {
        plan.push({ kind, from, to, action: "missing", fromCount: 0, toCount: 0, ignoreNote: "" });
        continue;
      }
      const dst = await getLabel(q, kind, to);
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

  return [
    ...(await planMap("category", resolveAliasMap(aliases, "category"))),
    ...(await planMap("tag", resolveAliasMap(aliases, "tag"))),
  ];
}

/** Plan a single from→to merge (UI / API). */
export async function planOneMerge(
  kind: LabelKind,
  fromRaw: string,
  toRaw: string,
): Promise<MergePlanRow> {
  const from = normalizeLabel(fromRaw);
  const to = normalizeLabel(toRaw);
  if (!from || !to || from === to) {
    return {
      kind,
      from,
      to,
      action: "missing",
      fromCount: 0,
      toCount: 0,
      ignoreNote: "invalid names",
    };
  }
  const [row] = await planMerges([{ kind, from, to }]);
  return (
    row ?? {
      kind,
      from,
      to,
      action: "missing",
      fromCount: 0,
      toCount: 0,
      ignoreNote: "",
    }
  );
}

export async function applyMerges(plan: MergePlanRow[]): Promise<number> {
  const actionable = plan.filter((p) => p.action !== "missing");
  if (actionable.length === 0) return 0;

  const client = await pool.connect();
  let applied = 0;
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
        applied += 1;
        continue;
      }
      if (src.id === dst.id) continue;
      if (p.kind === "tag") await mergeTag(client, src, dst);
      else await mergeCategory(client, src, dst);
      applied += 1;
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return applied;
}
