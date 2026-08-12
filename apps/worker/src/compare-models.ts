/**
 * Side-by-side LM quality compare.
 *
 * Fetches each domain once, then runs the same catalog prompt against each
 * model. Models are loaded one at a time (load → all domains → unload) so a
 * machine that only fits 1–3 small models can still walk a longer list.
 *
 * Usage:
 *   npm run compare-models -- <model> [model...]
 *   npm run compare-models -- model-a model-b --domains example.com,foo.com
 *   npm run compare-models -- model-a model-b --category blog --limit 12
 *   npm run compare-models -- model-a model-b --out tmp/compare.json
 *
 * Without --domains, samples done hosts from the widest category in Postgres
 * (highest domain_count, skipping empty/parked). Optional --category overrides.
 */
import dotenv from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, sampleDoneHosts } from "@marlin/db";
import {
  catalogWithoutLlm,
  envInt,
  extractPage,
  fetchHomepage,
  fetchOptionsFromEnv,
  normalizeHost,
  pickSiteName,
  skipLmReason,
  type LlmCatalogResult,
  type SkipLmKind,
} from "@marlin/shared";
import { catalogPage } from "./lm.js";
import { resolveWorkerProfile } from "./profile.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
dotenv.config({ path: path.join(repoRoot, ".env") });

const profile = resolveWorkerProfile();

type Cli = {
  models: string[];
  domains: string[];
  category: string | null;
  limit: number;
  out: string | null;
  contextLength: number;
  unload: boolean;
};

type PageFixture = {
  host: string;
  url: string;
  title: string;
  text: string;
  bodyChars: number;
  skipLm: SkipLmKind | null;
  /** Prior catalog from DB when sampling, for reference only. */
  prior: { name: string | null; summary: string | null; category: string } | null;
};

type ModelResult = {
  model: string;
  ms: number;
  ok: boolean;
  error?: string;
  result?: LlmCatalogResult & { displayName: string };
};

function usage(exit = 1): never {
  console.error(`usage: npm run compare-models -- <model> [model...] [options]

options:
  --domains host[,host...]   fixed hosts (skip DB sample)
  --category name            sample from this done category (default: widest)
  --limit N                  sample size when using DB (default: 8)
  --out path.json            write full report JSON
  --context N                LM Studio load context_length (default: 8192)
  --no-unload                leave the last model loaded
`);
  process.exit(exit);
}

function parseArgs(argv: string[]): Cli {
  const models: string[] = [];
  const domains: string[] = [];
  let category: string | null = null;
  let limit = 8;
  let out: string | null = null;
  let contextLength = envInt("LM_COMPARE_CONTEXT", 8192);
  let unload = true;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--help" || a === "-h") usage(0);
    if (a === "--no-unload") {
      unload = false;
      continue;
    }
    if (a === "--domains") {
      const next = argv[++i];
      if (!next) usage();
      domains.push(
        ...next
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      );
      continue;
    }
    if (a === "--category") {
      category = argv[++i] ?? null;
      if (!category) usage();
      continue;
    }
    if (a === "--limit") {
      const raw = argv[++i];
      const n = Number(raw);
      if (!raw || !Number.isFinite(n) || n < 1) usage();
      limit = Math.floor(n);
      continue;
    }
    if (a === "--out") {
      out = argv[++i] ?? null;
      if (!out) usage();
      continue;
    }
    if (a === "--context") {
      const raw = argv[++i];
      const n = Number(raw);
      if (!raw || !Number.isFinite(n) || n < 1024) usage();
      contextLength = Math.floor(n);
      continue;
    }
    if (a.startsWith("-")) {
      console.error(`unknown flag: ${a}`);
      usage();
    }
    models.push(a);
  }

  if (models.length === 0) usage();
  return { models, domains, category, limit, out, contextLength, unload };
}

function openaiBase(): string {
  return profile.baseUrl.replace(/\/$/, "");
}

/** Native LM Studio REST root (`…/api/v1`) derived from OpenAI-compat base. */
function nativeBase(): string {
  const openai = openaiBase();
  if (openai.endsWith("/v1")) return `${openai.slice(0, -3)}/api/v1`;
  return `${openai}/api/v1`;
}

function apiKey(): string {
  return profile.apiKey;
}

async function lmFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
}

async function loadModel(model: string, contextLength: number): Promise<string> {
  const res = await lmFetch(`${nativeBase()}/models/load`, {
    method: "POST",
    body: JSON.stringify({
      model,
      context_length: contextLength,
      flash_attention: true,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`load ${model} failed (${res.status}): ${text.slice(0, 400)}`);
  }
  const body = (await res.json()) as { instance_id?: string; status?: string };
  const id = body.instance_id || model;
  console.error(`loaded ${id} (${body.status ?? "ok"})`);
  return id;
}

async function unloadModel(instanceId: string): Promise<void> {
  const res = await lmFetch(`${nativeBase()}/models/unload`, {
    method: "POST",
    body: JSON.stringify({ instance_id: instanceId }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`warn: unload ${instanceId} failed (${res.status}): ${text.slice(0, 200)}`);
    return;
  }
  console.error(`unloaded ${instanceId}`);
}

async function resolveHosts(cli: Cli): Promise<{
  sampleCategory: string | null;
  fixturesMeta: { host: string; prior: PageFixture["prior"] }[];
}> {
  if (cli.domains.length > 0) {
    const fixturesMeta = cli.domains.map((raw) => {
      const host = normalizeHost(raw);
      if (!host) throw new Error(`invalid domain: ${raw}`);
      return { host, prior: null };
    });
    return { sampleCategory: null, fixturesMeta };
  }

  const sample = await sampleDoneHosts({
    category: cli.category ?? undefined,
    limit: cli.limit,
  });
  console.error(
    `sampled ${sample.hosts.length} done hosts from category "${sample.category}"`,
  );
  return {
    sampleCategory: sample.category,
    fixturesMeta: sample.hosts.map((h) => ({
      host: h.host,
      prior: { name: h.name, summary: h.summary, category: sample.category },
    })),
  };
}

async function fetchFixture(
  host: string,
  prior: PageFixture["prior"],
): Promise<PageFixture | { host: string; error: string }> {
  const fetched = await fetchHomepage(host, fetchOptionsFromEnv());
  if ("error" in fetched) {
    return { host, error: fetched.error };
  }
  const page = extractPage(fetched.html, fetched.finalUrl);
  return {
    host,
    url: fetched.finalUrl,
    title: page.title,
    text: page.text,
    bodyChars: page.body.length,
    skipLm: skipLmReason(page.title, page.body),
    prior,
  };
}

async function runModelOnPage(model: string, page: PageFixture): Promise<ModelResult> {
  const started = Date.now();
  try {
    if (page.skipLm) {
      const result = catalogWithoutLlm(page.skipLm, page.host, page.title);
      return {
        model,
        ms: Date.now() - started,
        ok: true,
        result: { ...result, displayName: result.name },
      };
    }

    const catalog = await catalogPage({
      url: page.url,
      title: page.title,
      text: page.text,
      lm: profile,
      model,
    });
    const displayName = pickSiteName({
      llmName: catalog.name,
      title: page.title,
      host: page.host,
      category: catalog.category,
    });
    return {
      model,
      ms: Date.now() - started,
      ok: true,
      result: { ...catalog, displayName },
    };
  } catch (err) {
    return {
      model,
      ms: Date.now() - started,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function printHumanReport(
  pages: PageFixture[],
  byHost: Map<string, ModelResult[]>,
  models: string[],
): void {
  for (const page of pages) {
    console.log(`\n══ ${page.host} ══`);
    console.log(`title: ${page.title || "(none)"}`);
    console.log(`url: ${page.url}  bodyChars=${page.bodyChars}`);
    if (page.skipLm) console.log(`skipLm: ${page.skipLm} (no model call)`);
    if (page.prior?.summary) {
      console.log(`prior [${page.prior.category}]: ${page.prior.name ?? "—"} — ${page.prior.summary}`);
    }

    for (const model of models) {
      const row = byHost.get(page.host)?.find((r) => r.model === model);
      if (!row) continue;
      console.log(`\n── ${model} (${row.ms}ms) ──`);
      if (!row.ok || !row.result) {
        console.log(`ERROR: ${row.error}`);
        continue;
      }
      const r = row.result;
      console.log(`name:     ${r.displayName}${r.name && r.name !== r.displayName ? ` (llm: ${r.name})` : ""}`);
      console.log(`category: ${r.category}`);
      console.log(`tags:     ${r.tags.join(", ") || "—"}`);
      console.log(`lang/geo: ${r.language ?? "—"} / ${r.place ?? "—"} / ${r.country ?? "—"}`);
      console.log(`summary:  ${r.summary}`);
    }
  }
}

const cli = parseArgs(process.argv.slice(2));

let sampleCategory: string | null = null;
let fixturesMeta: { host: string; prior: PageFixture["prior"] }[] = [];

try {
  ({ sampleCategory, fixturesMeta } = await resolveHosts(cli));
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  await pool.end().catch(() => undefined);
  process.exit(1);
}

console.error(`fetching ${fixturesMeta.length} domains…`);
const fetchResults = await Promise.all(
  fixturesMeta.map((m) => fetchFixture(m.host, m.prior)),
);

const pages: PageFixture[] = [];
for (const r of fetchResults) {
  if ("error" in r) {
    console.error(`fetch failed ${r.host}: ${r.error}`);
    continue;
  }
  pages.push(r);
}

if (pages.length === 0) {
  console.error("no pages fetched successfully");
  await pool.end();
  process.exit(1);
}

const byHost = new Map<string, ModelResult[]>();
for (const p of pages) byHost.set(p.host, []);

let lastInstance: string | null = null;

try {
  for (const model of cli.models) {
    console.error(`\n=== model ${model} ===`);
    if (lastInstance && cli.unload) {
      await unloadModel(lastInstance);
      lastInstance = null;
    }

    let instanceId = model;
    try {
      instanceId = await loadModel(model, cli.contextLength);
      lastInstance = instanceId;
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      console.error("falling back to JIT load via chat completions…");
      lastInstance = null;
    }

    const chatModel = instanceId;
    for (const page of pages) {
      process.stderr.write(`  ${page.host} … `);
      const result = await runModelOnPage(chatModel, page);
      byHost.get(page.host)!.push({ ...result, model });
      process.stderr.write(result.ok ? `ok ${result.ms}ms\n` : `FAIL ${result.error}\n`);
    }
  }
} finally {
  if (lastInstance && cli.unload) {
    await unloadModel(lastInstance);
  }
}

printHumanReport(pages, byHost, cli.models);

const report = {
  generatedAt: new Date().toISOString(),
  models: cli.models,
  sampleCategory,
  domains: pages.map((p) => ({
    host: p.host,
    url: p.url,
    title: p.title,
    bodyChars: p.bodyChars,
    skipLm: p.skipLm,
    prior: p.prior,
    results: byHost.get(p.host) ?? [],
  })),
};

if (cli.out) {
  const outPath = path.isAbsolute(cli.out) ? cli.out : path.join(process.cwd(), cli.out);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.error(`\nwrote ${outPath}`);
}

await pool.end();
