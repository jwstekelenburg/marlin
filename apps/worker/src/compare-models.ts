/**
 * Side-by-side LM quality compare.
 *
 * Fetches each domain once, then runs the same catalog prompt against each
 * lm profile. Profiles may point at different hosts/models. When consecutive
 * profiles share an LM Studio OpenAI base, models are loaded one at a time
 * (load → all domains → unload) so a machine that only fits one model can
 * still walk a longer list.
 *
 * Usage:
 *   npm run compare-models -- <lm-profile> [lm-profile...]
 *   npm run compare-models -- studio-g4-4b studio-g4-2b --domains example.com,foo.com
 *   npm run compare-models -- studio-g4-4b vast-g4-4b-1 --category blog --limit 12
 *   npm run compare-models -- studio-g4-4b studio-g4-2b --policy v1-simple --out tmp/compare.json
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
  getLmProfile,
  loadCatalogPolicies,
  loadLmProfiles,
  normalizeHost,
  pickSiteName,
  resolveCatalogPolicy,
  skipLmReason,
  type CatalogPolicy,
  type LmProfile,
  type LlmCatalogResult,
  type SkipLmKind,
} from "@marlin/shared";
import { catalogPage, lmClientFrom } from "./lm.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
dotenv.config({ path: path.join(repoRoot, ".env") });

type Cli = {
  lms: string[];
  domains: string[];
  category: string | null;
  limit: number;
  out: string | null;
  contextLength: number;
  policy: string | null;
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

type ProfileResult = {
  lm: string;
  model: string;
  ms: number;
  ok: boolean;
  error?: string;
  result?: LlmCatalogResult & { displayName: string };
};

function usage(exit = 1): never {
  let lmNames = "(could not load data/lm-profiles.json)";
  let policyNames = "(could not load data/catalog-policies.json)";
  try {
    lmNames = Object.keys(loadLmProfiles()).sort().join(", ");
  } catch {
    // keep fallback
  }
  try {
    policyNames = Object.keys(loadCatalogPolicies()).sort().join(", ");
  } catch {
    // keep fallback
  }
  console.error(`usage: npm run compare-models -- <lm-profile> [lm-profile...] [options]

lm profiles (data/lm-profiles.json): ${lmNames}
catalog policies (data/catalog-policies.json): ${policyNames}

options:
  --domains host[,host...]   fixed hosts (skip DB sample)
  --category name            sample from this done category (default: widest)
  --limit N                  sample size when using DB (default: 8)
  --out path.json            write full report JSON
  --context N                LM Studio load context_length (default: 8192)
  --policy, -P <name>        catalog policy (default: CATALOG_POLICY env)
  --no-unload                leave the last LM Studio model loaded
`);
  process.exit(exit);
}

function parseArgs(argv: string[]): Cli {
  const lms: string[] = [];
  const domains: string[] = [];
  let category: string | null = null;
  let limit = 8;
  let out: string | null = null;
  let contextLength = envInt("LM_COMPARE_CONTEXT", 8192);
  let policy: string | null = null;
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
    if (a === "--policy" || a === "-P") {
      const next = argv[++i];
      if (!next || next.startsWith("-")) usage();
      policy = next;
      continue;
    }
    if (a.startsWith("--policy=")) {
      policy = a.slice("--policy=".length) || null;
      if (!policy) usage();
      continue;
    }
    if (a.startsWith("-P=")) {
      policy = a.slice("-P=".length) || null;
      if (!policy) usage();
      continue;
    }
    if (a.startsWith("-")) {
      console.error(`unknown flag: ${a}`);
      usage();
    }
    lms.push(a);
  }

  if (lms.length === 0) usage();
  return { lms, domains, category, limit, out, contextLength, policy, unload };
}

function openaiBase(lm: LmProfile): string {
  return lm.baseUrl.replace(/\/$/, "");
}

/** Native LM Studio REST root (`…/api/v1`) derived from OpenAI-compat base. */
function nativeBase(lm: LmProfile): string {
  const openai = openaiBase(lm);
  if (openai.endsWith("/v1")) return `${openai.slice(0, -3)}/api/v1`;
  return `${openai}/api/v1`;
}

async function lmFetch(lm: LmProfile, url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${lm.apiKey}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
}

async function loadModel(
  lm: LmProfile,
  model: string,
  contextLength: number,
): Promise<string> {
  const res = await lmFetch(lm, `${nativeBase(lm)}/models/load`, {
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
  console.error(`loaded ${id} on ${lm.name} (${body.status ?? "ok"})`);
  return id;
}

async function unloadModel(lm: LmProfile, instanceId: string): Promise<void> {
  const res = await lmFetch(lm, `${nativeBase(lm)}/models/unload`, {
    method: "POST",
    body: JSON.stringify({ instance_id: instanceId }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`warn: unload ${instanceId} failed (${res.status}): ${text.slice(0, 200)}`);
    return;
  }
  console.error(`unloaded ${instanceId} on ${lm.name}`);
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

async function runProfileOnPage(
  lm: LmProfile,
  policy: CatalogPolicy,
  chatModel: string,
  page: PageFixture,
): Promise<ProfileResult> {
  const started = Date.now();
  try {
    if (page.skipLm) {
      const result = catalogWithoutLlm(page.skipLm, page.host, page.title);
      return {
        lm: lm.name,
        model: chatModel,
        ms: Date.now() - started,
        ok: true,
        result: { ...result, displayName: result.name },
      };
    }

    const catalog = await catalogPage({
      url: page.url,
      title: page.title,
      text: page.text,
      lm: lmClientFrom(lm, policy),
      model: chatModel,
    });
    const displayName = pickSiteName({
      llmName: catalog.name,
      title: page.title,
      host: page.host,
      category: catalog.category,
    });
    return {
      lm: lm.name,
      model: chatModel,
      ms: Date.now() - started,
      ok: true,
      result: { ...catalog, displayName },
    };
  } catch (err) {
    return {
      lm: lm.name,
      model: chatModel,
      ms: Date.now() - started,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function printHumanReport(
  pages: PageFixture[],
  byHost: Map<string, ProfileResult[]>,
  lms: string[],
): void {
  for (const page of pages) {
    console.log(`\n══ ${page.host} ══`);
    console.log(`title: ${page.title || "(none)"}`);
    console.log(`url: ${page.url}  bodyChars=${page.bodyChars}`);
    if (page.skipLm) console.log(`skipLm: ${page.skipLm} (no model call)`);
    if (page.prior?.summary) {
      console.log(`prior [${page.prior.category}]: ${page.prior.name ?? "—"} — ${page.prior.summary}`);
    }

    for (const lmName of lms) {
      const row = byHost.get(page.host)?.find((r) => r.lm === lmName);
      if (!row) continue;
      console.log(`\n── ${lmName} / ${row.model} (${row.ms}ms) ──`);
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

let profiles: LmProfile[];
let catalogPolicy: CatalogPolicy;
try {
  profiles = cli.lms.map((name) => getLmProfile(name));
  catalogPolicy = resolveCatalogPolicy({ name: cli.policy });
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

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

const byHost = new Map<string, ProfileResult[]>();
for (const p of pages) byHost.set(p.host, []);

let lastLoad: { lm: LmProfile; instanceId: string } | null = null;

try {
  for (const lm of profiles) {
    console.error(
      `\n=== lm ${lm.name} policy=${catalogPolicy.name} model=${lm.model || "(auto)"} url=${lm.baseUrl} ===`,
    );

    if (lastLoad && cli.unload) {
      await unloadModel(lastLoad.lm, lastLoad.instanceId);
      lastLoad = null;
    }

    let chatModel = lm.model;
    if (chatModel) {
      try {
        const instanceId = await loadModel(lm, chatModel, cli.contextLength);
        lastLoad = { lm, instanceId };
        chatModel = instanceId;
      } catch (err) {
        console.error(err instanceof Error ? err.message : err);
        console.error("falling back to JIT load via chat completions…");
        lastLoad = null;
      }
    } else {
      console.error("profile model empty — using /v1/models first id via catalog call");
    }

    for (const page of pages) {
      process.stderr.write(`  ${page.host} … `);
      const result = await runProfileOnPage(lm, catalogPolicy, chatModel, page);
      byHost.get(page.host)!.push(result);
      process.stderr.write(result.ok ? `ok ${result.ms}ms\n` : `FAIL ${result.error}\n`);
    }
  }
} finally {
  if (lastLoad && cli.unload) {
    await unloadModel(lastLoad.lm, lastLoad.instanceId);
  }
}

printHumanReport(pages, byHost, cli.lms);

const report = {
  generatedAt: new Date().toISOString(),
  catalogPolicy: {
    name: catalogPolicy.name,
    textChars: catalogPolicy.textChars,
    sampling: catalogPolicy.sampling,
  },
  lms: profiles.map((p) => ({
    name: p.name,
    baseUrl: p.baseUrl,
    model: p.model,
  })),
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
  const outPath = path.isAbsolute(cli.out) ? cli.out : path.join(repoRoot, cli.out);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.error(`\nwrote ${outPath}`);
}

await pool.end();
