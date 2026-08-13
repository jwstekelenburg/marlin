import "dotenv/config";
import cors from "@fastify/cors";
import Fastify from "fastify";
import {
  analyzeCategoryProfile,
  analyzeCategorySimilarity,
  analyzeLabelsOverview,
  analyzeLexicalCandidates,
  analyzeOverview,
  analyzePlatformDetail,
  analyzePlatforms,
  analyzeSteward,
  analyzeTagPairs,
  analyzeTagProfile,
  applyMerges,
  blockApex,
  dashboardSnapshot,
  domainStats,
  labelsByIds,
  listLabels,
  listSpiralCandidates,
  pipelineSnapshot,
  planOneMerge,
  pool,
  searchDomains,
  setLabelIgnored,
  typeaheadCountries,
  typeaheadLabels,
  typeaheadLanguages,
  unblockApex,
  type TagPairMetric,
} from "@marlin/db";

const port = Number(process.env.API_PORT ?? 3000);
/** Host bind. Default loopback; Compose sets API_HOST=0.0.0.0 for published ports. */
const host = process.env.API_HOST?.trim() || "127.0.0.1";

const DEFAULT_CORS_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
];

function corsOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS?.trim();
  if (!raw) return DEFAULT_CORS_ORIGINS;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const app = Fastify({ logger: true });
const allowedOrigins = new Set(corsOrigins());
await app.register(cors, {
  origin(origin, cb) {
    // Non-browser / same-origin tools send no Origin.
    if (!origin) {
      cb(null, true);
      return;
    }
    cb(null, allowedOrigins.has(origin));
  },
});

const MAX_Q = 200;
const MAX_IDS = 20;
const MAX_OFFSET = 10_000;

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (raw == null || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.trunc(n);
}

function parseNonNegInt(raw: string | undefined): number | undefined {
  if (raw == null || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.trunc(n);
}

function clampQ(raw: string | undefined): string {
  return (raw ?? "").slice(0, MAX_Q);
}

function parseIds(raw: string | undefined): number[] {
  return (raw ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
    .slice(0, MAX_IDS);
}

app.get("/api/health", async () => ({ ok: true }));

app.get("/api/stats", async () => domainStats());

app.get("/api/dashboard", async () => {
  const snap = await dashboardSnapshot();
  return {
    ...snap,
    fetchMaxReady: Math.max(1, Number(process.env.FETCH_MAX_READY ?? 500) || 500),
  };
});

app.get("/api/workers", async () => {
  const snap = await pipelineSnapshot();
  return {
    ...snap,
    fetchMaxReady: Math.max(1, Number(process.env.FETCH_MAX_READY ?? 500) || 500),
  };
});

app.get("/api/search", async (req) => {
  const q = req.query as Record<string, string | undefined>;
  return searchDomains({
    q: clampQ(q.q),
    categoryId: parsePositiveInt(q.categoryId),
    tagIds: parseIds(q.tagIds),
    country: q.country?.slice(0, 16),
    language: q.language?.slice(0, 16),
    limit: parsePositiveInt(q.limit),
    offset: (() => {
      const off = parseNonNegInt(q.offset);
      return off == null ? undefined : Math.min(off, MAX_OFFSET);
    })(),
  });
});

app.get("/api/countries", async (req) => {
  const q = clampQ((req.query as { q?: string }).q);
  return typeaheadCountries(q, q ? 20 : 50);
});

app.get("/api/languages", async (req) => {
  const q = clampQ((req.query as { q?: string }).q);
  return typeaheadLanguages(q, q ? 20 : 50);
});

app.get("/api/categories", async (req) => {
  const q = req.query as { q?: string; ids?: string };
  const ids = parseIds(q.ids);
  if (ids.length) return labelsByIds("category", ids);
  return typeaheadLabels("category", clampQ(q.q), q.q ? 20 : 200);
});

app.get("/api/tags", async (req) => {
  const q = req.query as { q?: string; ids?: string };
  const ids = parseIds(q.ids);
  if (ids.length) return labelsByIds("tag", ids);
  return typeaheadLabels("tag", clampQ(q.q), q.q ? 20 : 200);
});

app.get("/api/ignore-options", async (req, reply) => {
  const q = req.query as { kind?: string; q?: string; limit?: string; offset?: string };
  const kindRaw = (q.kind ?? "").trim().toLowerCase();
  const kind =
    kindRaw === "category" || kindRaw === "categories"
      ? ("category" as const)
      : kindRaw === "tag" || kindRaw === "tags"
        ? ("tag" as const)
        : null;
  if (!kind) {
    return reply.code(400).send({ error: "kind=categories|tags required" });
  }
  const limit = Math.min(parsePositiveInt(q.limit) ?? 100, 500);
  const offset = Math.min(parseNonNegInt(q.offset) ?? 0, MAX_OFFSET);
  return listLabels(kind, { q: clampQ(q.q), limit, offset });
});

app.patch("/api/categories/:id", async (req, reply) => {
  const id = parsePositiveInt((req.params as { id: string }).id);
  if (id == null) return reply.code(400).send({ error: "invalid id" });
  const body = req.body as { ignored?: unknown } | null;
  if (!body || typeof body.ignored !== "boolean") {
    return reply.code(400).send({ error: "ignored boolean required" });
  }
  const row = await setLabelIgnored("category", id, body.ignored);
  if (!row) return reply.code(404).send({ error: "not found" });
  return row;
});

app.patch("/api/tags/:id", async (req, reply) => {
  const id = parsePositiveInt((req.params as { id: string }).id);
  if (id == null) return reply.code(400).send({ error: "invalid id" });
  const body = req.body as { ignored?: unknown } | null;
  if (!body || typeof body.ignored !== "boolean") {
    return reply.code(400).send({ error: "ignored boolean required" });
  }
  const row = await setLabelIgnored("tag", id, body.ignored);
  if (!row) return reply.code(404).send({ error: "not found" });
  return row;
});

app.get("/api/analyze", async () => analyzeOverview());

app.get("/api/analyze/platforms", async (req) => {
  const q = req.query as { limit?: string; q?: string; minSubdomains?: string };
  return analyzePlatforms({
    limit: parsePositiveInt(q.limit),
    q: clampQ(q.q),
    minSubdomains: parseNonNegInt(q.minSubdomains),
  });
});

app.get("/api/analyze/platforms/:apex", async (req, reply) => {
  const apex = decodeURIComponent((req.params as { apex: string }).apex).slice(0, 253);
  const detail = await analyzePlatformDetail(apex);
  if (!detail) return reply.code(404).send({ error: "not found" });
  return detail;
});

app.get("/api/analyze/labels", async () => analyzeLabelsOverview());

app.get("/api/analyze/labels/tag-pairs", async (req) => {
  const q = req.query as { minCount?: string; metric?: string; limit?: string };
  const metric = (q.metric ?? "jaccard") as TagPairMetric;
  return analyzeTagPairs({
    minCount: parsePositiveInt(q.minCount),
    metric: ["count", "jaccard", "lift", "pmi"].includes(metric) ? metric : "jaccard",
    limit: parsePositiveInt(q.limit),
  });
});

app.get("/api/analyze/labels/categories/:id", async (req, reply) => {
  const id = parsePositiveInt((req.params as { id: string }).id);
  if (id == null) return reply.code(400).send({ error: "invalid id" });
  const profile = await analyzeCategoryProfile(id);
  if (!profile) return reply.code(404).send({ error: "not found" });
  return profile;
});

app.get("/api/analyze/labels/tags/:id", async (req, reply) => {
  const id = parsePositiveInt((req.params as { id: string }).id);
  if (id == null) return reply.code(400).send({ error: "invalid id" });
  const profile = await analyzeTagProfile(id);
  if (!profile) return reply.code(404).send({ error: "not found" });
  return profile;
});

app.get("/api/analyze/labels/category-similarity", async (req) => {
  const limit = parsePositiveInt((req.query as { limit?: string }).limit);
  return analyzeCategorySimilarity(limit);
});

app.get("/api/analyze/labels/lexical", async (req) => {
  const limit = parsePositiveInt((req.query as { limit?: string }).limit);
  return analyzeLexicalCandidates(limit);
});

app.post("/api/analyze/labels/merge", async (req, reply) => {
  const body = req.body as {
    kind?: string;
    from?: string;
    to?: string;
    apply?: boolean;
  };
  if (body.kind !== "tag" && body.kind !== "category") {
    return reply.code(400).send({ error: "kind must be tag or category" });
  }
  if (!body.from?.trim() || !body.to?.trim()) {
    return reply.code(400).send({ error: "from and to required" });
  }
  const plan = await planOneMerge(body.kind, body.from, body.to);
  if (plan.action === "missing") {
    return reply.code(400).send({ error: "merge not actionable", plan });
  }
  if (!body.apply) {
    return { applied: false, plan };
  }
  const n = await applyMerges([plan]);
  return { applied: true, count: n, plan };
});

app.get("/api/analyze/steward", async (req) => {
  const q = req.query as {
    source?: string;
    q?: string;
    blockLimit?: string;
    reviewLimit?: string;
    candidateLimit?: string;
  };
  const candidateLimit = parsePositiveInt(q.candidateLimit) ?? 40;
  const [steward, candidates] = await Promise.all([
    analyzeSteward({
      source: q.source?.slice(0, 32),
      q: clampQ(q.q),
      blockLimit: parsePositiveInt(q.blockLimit),
      reviewLimit: parsePositiveInt(q.reviewLimit),
    }),
    listSpiralCandidates(Math.min(Math.max(candidateLimit, 1), 100)),
  ]);
  return { ...steward, candidates };
});
app.delete("/api/analyze/steward/blocks/:apex", async (req, reply) => {
  const apex = decodeURIComponent((req.params as { apex: string }).apex).slice(0, 253);
  const result = await unblockApex(apex);
  if (!result.ok) return reply.code(404).send({ error: "not blocked", apex: result.apex });
  return result;
});

app.post("/api/analyze/steward/blocks", async (req, reply) => {
  const body = req.body as { apex?: string; reason?: string };
  if (!body.apex?.trim()) return reply.code(400).send({ error: "apex required" });
  try {
    const result = await blockApex({
      apex: body.apex,
      reason: body.reason?.trim() || "manual block from Analyze UI",
      source: "steward",
    });
    return { ok: true, apex: body.apex.trim().toLowerCase(), ...result };
  } catch (err) {
    return reply.code(400).send({
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

const shutdown = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port, host });
